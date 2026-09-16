import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), transcript: vi.fn(), duration: vi.fn() }));
vi.mock('./runtimeConfig', () => ({ getSupabaseRuntimeConfig: () => ({ url: 'https://example.supabase.co' }) }));
vi.mock('./electronFetch', () => ({ electronFetch: mocks.fetch }));
vi.mock('./supabase', () => ({ supabase: { from: () => {
    const query = { select: () => query, eq: () => query, abortSignal: () => query, single: mocks.transcript };
    return query;
} } }));
vi.mock('./offlineVerification', async importOriginal => ({ ...await importOriginal(), audioDuration: mocks.duration }));

import { offlineDb, downloadOfflineEpisode, getOfflineEpisode, getOfflineEpisodeSummary, saveOfflineEpisode, listOfflineEpisodes, episodeKey, verifyOfflineEpisode, hasOfflineContent, saveOfflineProgress, removeOfflineEpisode } from './offlineLibrary';

const podcast = { id: 'flight-1', title: 'At the airport', status: 'READY', audio_url: 'https://example.test/airport.mp3' };
const segments = [{ start: 0, end: 120, text: 'Welcome aboard.', words: [{ word: 'Welcome', start: 0, end: 1 }] }];
const record = () => ({ podcast, source: 'https://example.supabase.co', segments, audioBlob: new Blob(['test-audio'], { type: 'audio/mpeg' }) });

beforeEach(async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('navigator', { storage: { persisted: async () => false, persist: async () => true, estimate: async () => ({ usage: 0, quota: 1e9 }) } });
    mocks.fetch.mockReset();
    mocks.transcript.mockReset().mockResolvedValue({ data: { content: segments }, error: null });
    mocks.duration.mockReset().mockResolvedValue(120);
    await offlineDb.episodes.clear();
    await offlineDb.audio.clear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('flight downloads', () => {
    it('reads complete audio back from IndexedDB before marking it ready', async () => {
        mocks.fetch.mockResolvedValue(new Response('test-audio', { headers: { 'content-type': 'audio/mpeg', 'content-length': '10' } }));
        const key = await downloadOfflineEpisode(podcast);
        const stored = await getOfflineEpisode(key);
        expect(hasOfflineContent(stored)).toBe(true);
        expect(await stored.audioBlob.text()).toBe('test-audio');
        expect(stored.segments).toEqual(segments);
        expect(stored.duration).toBe(120);
        expect(await verifyOfflineEpisode(stored)).toBe(true);
        expect(mocks.fetch.mock.calls[0][1].cache).toBe('no-store');
    });

    it('keeps existing verified downloads without another network request', async () => {
        const key = await saveOfflineEpisode(record());
        expect(await downloadOfflineEpisode(podcast)).toBe(key);
        expect(mocks.fetch).not.toHaveBeenCalled();
        expect(mocks.transcript).not.toHaveBeenCalled();
    });

    it('rejects a truncated download without creating a ready record', async () => {
        mocks.fetch.mockResolvedValue(new Response('partial', { headers: { 'content-type': 'audio/mpeg', 'content-length': '100' } }));
        await expect(downloadOfflineEpisode(podcast)).rejects.toThrow('incomplete');
        expect(await listOfflineEpisodes()).toEqual([]);
    });

    it('does not publish audio without complete timed subtitles', async () => {
        mocks.transcript.mockResolvedValue({ data: { content: [] }, error: null });
        await expect(downloadOfflineEpisode(podcast)).rejects.toThrow('subtitles');
        expect(mocks.fetch).not.toHaveBeenCalled();
        expect(await listOfflineEpisodes()).toEqual([]);
    });

    it('does not confuse an HTTP error page with audio', async () => {
        mocks.fetch.mockResolvedValue(new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } }));
        await expect(downloadOfflineEpisode(podcast)).rejects.toThrow('audio file');
        expect(await listOfflineEpisodes()).toEqual([]);
    });

    it('does not mark unsupported audio as ready', async () => {
        mocks.duration.mockRejectedValue(new Error('Unsupported audio'));
        await expect(saveOfflineEpisode(record())).rejects.toThrow('Unsupported audio');
        expect(await listOfflineEpisodes()).toEqual([]);
    });

    it('detects changed audio bytes and changed subtitles in stored records', async () => {
        const key = await saveOfflineEpisode(record());
        const stored = await getOfflineEpisode(key);
        expect(await verifyOfflineEpisode({ ...stored, audioBlob: new Blob(['bad!-audio']) })).toBe(false);
        expect(await verifyOfflineEpisode({ ...stored, segments: [{ ...segments[0], text: 'Different transcript' }] })).toBe(false);
    });

    it('leaves no false success when storage is full', async () => {
        vi.spyOn(offlineDb.episodes, 'put').mockRejectedValueOnce(new DOMException('Storage full', 'QuotaExceededError'));
        await expect(saveOfflineEpisode(record())).rejects.toMatchObject({ name: 'QuotaExceededError' });
        expect(await listOfflineEpisodes()).toEqual([]);
    });

    it('cancels before network access and supports retrying the same episode', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(downloadOfflineEpisode(podcast, null, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.fetch).not.toHaveBeenCalled();
        mocks.fetch.mockResolvedValue(new Response('test-audio', { headers: { 'content-type': 'audio/mpeg' } }));
        expect(await downloadOfflineEpisode(podcast)).toBeTruthy();
    });

    it('reads an offline download after reopening the database without network', async () => {
        const key = await saveOfflineEpisode(record());
        await saveOfflineProgress(key, 42);
        offlineDb.close();
        await offlineDb.open();
        const stored = await getOfflineEpisode(key);
        expect(await verifyOfflineEpisode(stored)).toBe(true);
        expect(stored.position).toBe(42);
        expect(mocks.fetch).not.toHaveBeenCalled();
        expect(mocks.transcript).not.toHaveBeenCalled();
    });

    it('isolates equal episode IDs from different cloud libraries', async () => {
        expect(await episodeKey('https://first.test', '1')).not.toBe(await episodeKey('https://second.test', '1'));
    });

    it('removes only local data and progress updates cannot resurrect it', async () => {
        const key = await saveOfflineEpisode(record());
        await removeOfflineEpisode(key);
        await saveOfflineProgress(key, 42);
        expect(await getOfflineEpisode(key)).toBeUndefined();
        expect(await offlineDb.audio.count()).toBe(0);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('keeps the download list and progress updates separate from large media', async () => {
        const key = await saveOfflineEpisode(record());
        const audioRead = vi.spyOn(offlineDb.audio, 'get');
        const audioWrite = vi.spyOn(offlineDb.audio, 'put');
        const list = await listOfflineEpisodes();
        expect(list[0].audioBlob).toBeUndefined();
        expect(list[0].audioData).toBeUndefined();
        expect(hasOfflineContent(await getOfflineEpisodeSummary(key))).toBe(true);
        await saveOfflineProgress(key, 35);
        expect(audioRead).not.toHaveBeenCalled();
        expect(audioWrite).not.toHaveBeenCalled();
    });

    it('detects a missing media record when rechecking a lightweight list entry', async () => {
        const key = await saveOfflineEpisode(record());
        const [summary] = await listOfflineEpisodes();
        await offlineDb.audio.delete(key);
        expect(await verifyOfflineEpisode(summary)).toBe(false);
        expect(await getOfflineEpisodeSummary(key)).toBeNull();
    });

    it('upgrades earlier Blob downloads without losing audio or progress', async () => {
        const key = await saveOfflineEpisode(record());
        const stored = await getOfflineEpisode(key);
        await offlineDb.delete();
        const legacy = new Dexie('PodFluentOffline');
        legacy.version(1).stores({ episodes: 'key, title, savedAt' });
        await legacy.episodes.put({ ...stored, position: 33 });
        legacy.close();
        await offlineDb.open();
        const restored = await getOfflineEpisode(key);
        expect(await verifyOfflineEpisode(restored)).toBe(true);
        expect(restored.position).toBe(33);
        expect((await offlineDb.episodes.get(key)).audioBlob).toBeUndefined();
    });
});
