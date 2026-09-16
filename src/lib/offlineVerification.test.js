import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioDuration } from './offlineVerification';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('audio metadata check cancellation', () => {
    it('cancels immediately during metadata loading and releases the media element', async () => {
        const audio = { duration: 60, load: vi.fn(), removeAttribute: vi.fn() };
        vi.stubGlobal('document', { createElement: () => audio });
        const controller = new AbortController();
        const pending = audioDuration(new Blob(['audio']), '/__offline_audio/test', controller.signal);
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(audio.removeAttribute).toHaveBeenCalledWith('src');
        expect(audio.onloadedmetadata).toBeNull();
        expect(audio.onerror).toBeNull();
    });
    it('returns local media duration without creating another Blob URL', async () => {
        const objectUrl = vi.spyOn(URL, 'createObjectURL');
        const audio = { duration: 60, load: vi.fn(), removeAttribute: vi.fn() };
        vi.stubGlobal('document', { createElement: () => audio });
        const pending = audioDuration(new Blob(['audio']), '/__offline_audio/test');
        audio.onloadedmetadata();
        expect(await pending).toBe(60);
        expect(objectUrl).not.toHaveBeenCalled();
    });
});
