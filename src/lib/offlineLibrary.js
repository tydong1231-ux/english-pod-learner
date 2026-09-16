import Dexie from 'dexie';
import { supabase } from './supabase';
import { getSupabaseRuntimeConfig } from './runtimeConfig';
import { electronFetch } from './electronFetch';
import { requestOfflineStorage } from './storagePersistence';
import { audioDuration, blobDigest, validSubtitles } from './offlineVerification';
import { offlineAudioUrl } from './appShell';

export const offlineDb = new Dexie('PodFluentOffline');
offlineDb.version(1).stores({ episodes: 'key, title, savedAt' });
offlineDb.version(2).stores({ episodes: 'key, title, savedAt', audio: 'key' }).upgrade(async transaction => {
    for (const record of await transaction.table('episodes').toArray()) {
        if (!record.audioBlob) continue;
        const data = await Dexie.waitFor(record.audioBlob.arrayBuffer());
        await transaction.table('audio').put({ key: record.key, data, type: record.audioBlob.type });
        delete record.audioBlob;
        await transaction.table('episodes').put(record);
    }
});
export const OFFLINE_CHANGED = 'podfluent-offline-changed';
const downloads = new Map();
// Bound each file to avoid excessive memory use on phones. Batches run sequentially.
const MAX_AUDIO_BYTES = 256 * 1024 * 1024;

export function episodeKey(source, id) {
    return blobDigest(new Blob([`${source}\n${id}`]));
}

export function currentSource() {
    return getSupabaseRuntimeConfig().url.replace(/\/$/, '');
}

export function listOfflineEpisodes() {
    return offlineDb.episodes.orderBy('savedAt').reverse().toArray();
}

export async function getOfflineEpisode(key) {
    const record = await offlineDb.episodes.get(key);
    if (!record) return undefined;
    return { ...record, audioBlob: await getOfflineAudio(key) };
}

export async function getOfflineEpisodeSummary(key) {
    const [record, mediaCount] = await Promise.all([
        offlineDb.episodes.get(key),
        offlineDb.audio.where('key').equals(key).count(),
    ]);
    return mediaCount ? record : null;
}

async function getOfflineAudio(key) {
    const media = await offlineDb.audio.get(key);
    return media?.data ? new Blob([media.data], { type: media.type || 'audio/mpeg' }) : null;
}

export function hasOfflineContent(record) {
    return record?.verified === true && record.bytes > 0
        && (!('audioBlob' in record) || record.audioBlob?.size === record.bytes) && validSubtitles(record.segments)
        && Number.isFinite(record.duration) && record.duration > 0;
}

export async function verifyOfflineEpisode(record) {
    if (!hasOfflineContent(record)) return false;
    const audio = record.audioBlob || await getOfflineAudio(record.key);
    if (!audio || audio.size !== record.bytes) return false;
    return await blobDigest(audio) === record.audioHash
        && await blobDigest(new Blob([JSON.stringify(record.segments)])) === record.subtitleHash;
}

// Publish Ready Offline only after an IndexedDB readback matches both complete hashes.
export async function saveOfflineEpisode(record, signal) {
    if (!record.audioBlob?.size || !validSubtitles(record.segments)) throw new Error('Complete audio and subtitles are required.');
    const key = await episodeKey(record.source, record.podcast.id);
    const audioHash = await blobDigest(record.audioBlob);
    const subtitleHash = await blobDigest(new Blob([JSON.stringify(record.segments)]));
    const { audioBlob, ...metadata } = record;
    const audioData = await audioBlob.arrayBuffer();
    signal?.throwIfAborted();
    await offlineDb.transaction('rw', offlineDb.episodes, offlineDb.audio, async () => {
        const previous = await offlineDb.episodes.get(key);
        await offlineDb.episodes.put({
            ...metadata, key, title: record.podcast.title, savedAt: new Date().toISOString(),
            bytes: record.audioBlob.size, duration: 0, audioHash, subtitleHash, verified: false,
            position: previous?.position || 0,
        });
        await offlineDb.audio.put({ key, data: audioData, type: audioBlob.type });
    });
    try {
        const duration = await audioDuration(record.audioBlob, offlineAudioUrl(key), signal);
        const stored = await getOfflineEpisode(key);
        if (!await verifyOfflineEpisode({ ...stored, duration, verified: true })) throw new Error('Local storage verification failed. Please download again.');
        signal?.throwIfAborted();
        const updated = await offlineDb.episodes.update(key, { duration, verified: true });
        if (!updated) throw new Error('The download was removed before verification finished.');
        notifyChange();
        return key;
    } catch (error) {
        await removeOfflineEpisode(key);
        throw error;
    }
}

export async function downloadOfflineEpisode(podcast, onStatus, signal) {
    const source = currentSource();
    const key = await episodeKey(source, podcast.id);
    if (downloads.has(key)) return downloads.get(key);
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(() => controller.abort(new DOMException('Download timed out. Please retry on Wi-Fi.', 'TimeoutError')), 10 * 60 * 1000);
    const downloadSignal = controller.signal;
    const task = (async () => {
        await requestOfflineStorage();
        downloadSignal.throwIfAborted();
        const existing = await getOfflineEpisode(key);
        if (existing && await verifyOfflineEpisode(existing)) return key;
        if (podcast.status !== 'READY') throw new Error('This episode does not have a finished transcript yet.');
        onStatus?.('Downloading subtitles…');
        const { data, error } = await supabase.from('transcripts').select('content').eq('podcast_id', podcast.id)
            .abortSignal(downloadSignal).single();
        if (error) throw error;
        if (!validSubtitles(data?.content)) throw new Error('Complete, timed subtitles are not available for this episode.');
        onStatus?.('Downloading audio…');
        const response = await electronFetch(podcast.audio_url, { signal: downloadSignal, cache: 'no-store' });
        if (!response.ok) throw new Error(`Audio download failed (${response.status}).`);
        const total = Number(response.headers.get('content-length'));
        if (total > MAX_AUDIO_BYTES) throw new Error('This audio exceeds the 256 MB per-episode download limit.');
        let audioBlob;
        const type = response.headers.get('content-type')?.split(';')[0] || 'audio/mpeg';
        if (/text\/|application\/json/i.test(type)) throw new Error('The server did not return an audio file.');
        const mediaType = /^(audio|video)\//.test(type) ? type : 'audio/mpeg';
        if (response.body?.getReader) {
            const reader = response.body.getReader();
            const chunks = [];
            let loaded = 0;
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    loaded += value.byteLength;
                    if (loaded > MAX_AUDIO_BYTES) throw new Error('This audio exceeds the 256 MB per-episode download limit.');
                    chunks.push(value);
                    onStatus?.(total ? `Downloading ${Math.min(100, Math.round(loaded / total * 100))}%…` : `Downloading ${formatBytes(loaded)}…`);
                }
                if (total > 0 && loaded !== total && !response.headers.get('content-encoding')) throw new Error('Audio download was incomplete. Please retry.');
                audioBlob = new Blob(chunks, { type: mediaType });
            } finally {
                await reader.cancel().catch(() => {});
                reader.releaseLock();
            }
        } else {
            audioBlob = new Blob([await response.blob()], { type: mediaType });
        }
        if (!audioBlob.size || audioBlob.size > MAX_AUDIO_BYTES) throw new Error('The audio is empty or too large.');
        downloadSignal.throwIfAborted();
        onStatus?.('Checking audio and verifying local storage…');
        return saveOfflineEpisode({ source, podcast: { ...podcast, audio_url: undefined }, segments: data.content, audioBlob }, downloadSignal);
    })();
    downloads.set(key, task);
    try { return await task; } finally {
        downloads.delete(key);
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
    }
}

export async function removeOfflineEpisode(key) {
    await offlineDb.transaction('rw', offlineDb.episodes, offlineDb.audio, async () => {
        await offlineDb.episodes.delete(key);
        await offlineDb.audio.delete(key);
    });
    notifyChange();
}

export function saveOfflineProgress(key, position) {
    if (!key || !Number.isFinite(position) || position < 0) return Promise.resolve();
    return offlineDb.episodes.update(key, { position, progressUpdatedAt: new Date().toISOString() });
}

export function formatBytes(bytes = 0) {
    return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatOfflineDuration(seconds = 0) {
    const minutes = Math.floor(seconds / 60);
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function notifyChange() {
    window.dispatchEvent(new Event(OFFLINE_CHANGED));
}
