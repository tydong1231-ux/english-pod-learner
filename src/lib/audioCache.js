import { db } from '../db';
import { electronFetch } from './electronFetch';

const ONE_MB = 1024 * 1024;

export async function checkAudioCache(podcastId, sourceUrl) {
    if (!podcastId || !sourceUrl) return null;
    const cached = await db.audioCache.get(podcastId);
    if (cached?.audioBlob && cached.sourceUrl === sourceUrl) {
        return cached;
    }
    return null;
}

export async function getCachedAudioUrl(podcastId, sourceUrl, onStatus) {
    if (!podcastId || !sourceUrl) {
        return { url: sourceUrl, cached: false, revoke: () => { } };
    }

    const cached = await checkAudioCache(podcastId, sourceUrl);
    if (cached) {
        onStatus?.(`Using cached audio (${formatBytes(cached.size || cached.audioBlob.size)}).`);
        return createAudioObjectUrl(cached.audioBlob);
    }

    const audioBlob = await cacheAudioForPodcast(podcastId, sourceUrl, onStatus);
    return createAudioObjectUrl(audioBlob);
}

export async function cacheAudioForPodcast(podcastId, sourceUrl, onStatus) {
    if (!podcastId || !sourceUrl) return null;

    const cached = await checkAudioCache(podcastId, sourceUrl);
    if (cached) {
        onStatus?.(`Audio already cached (${formatBytes(cached.size || cached.audioBlob.size)}).`);
        return cached.audioBlob;
    }

    onStatus?.('Caching audio locally...');
    const audioBlob = await fetchAudioBlob(sourceUrl, (loaded, total) => {
        if (total) {
            onStatus?.(`Caching audio ${Math.round((loaded / total) * 100)}%...`);
        } else if (loaded > ONE_MB) {
            onStatus?.(`Caching audio ${formatBytes(loaded)}...`);
        }
    });

    await db.audioCache.put({
        podcastId,
        sourceUrl,
        audioBlob,
        mimeType: audioBlob.type || 'audio/mpeg',
        size: audioBlob.size,
        createdAt: new Date().toISOString(),
    });

    onStatus?.(`Audio cached (${formatBytes(audioBlob.size)}).`);
    return audioBlob;
}

export async function saveAudioFileToCache(podcastId, sourceUrl, file) {
    if (!podcastId || !sourceUrl || !file) return null;

    const audioBlob = file instanceof Blob
        ? file
        : new Blob([file], { type: file.type || 'audio/mpeg' });

    await db.audioCache.put({
        podcastId,
        sourceUrl,
        audioBlob,
        mimeType: audioBlob.type || file.type || 'audio/mpeg',
        size: audioBlob.size,
        createdAt: new Date().toISOString(),
    });

    return audioBlob;
}

export async function clearAudioCache() {
    await db.audioCache.clear();
}

export async function getAudioCacheStats() {
    const entries = await db.audioCache.toArray();
    const bytes = entries.reduce((total, entry) => total + (entry.size || entry.audioBlob?.size || 0), 0);
    return {
        count: entries.length,
        bytes,
        label: formatBytes(bytes),
    };
}

async function fetchAudioBlob(sourceUrl, onProgress) {
    const response = await electronFetch(sourceUrl, { cache: 'force-cache' });
    if (!response.ok) {
        throw new Error(`Audio download failed with HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    const contentLength = Number(response.headers.get('content-length') || 0);

    if (!response.body?.getReader) {
        const blob = await response.blob();
        onProgress?.(blob.size, blob.size);
        return blob;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        onProgress?.(loaded, contentLength);
    }

    return new Blob(chunks, { type: contentType });
}

function formatBytes(bytes) {
    if (!bytes) return '0 MB';
    if (bytes < ONE_MB) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / ONE_MB).toFixed(1)} MB`;
}

function createAudioObjectUrl(audioBlob) {
    const objectUrl = URL.createObjectURL(audioBlob);
    return {
        url: objectUrl,
        cached: true,
        revoke: () => URL.revokeObjectURL(objectUrl),
    };
}
