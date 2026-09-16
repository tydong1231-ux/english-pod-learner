import { describe, expect, it } from 'vitest';
import { createOfflineMediaResponse } from './offlineMediaResponse';

const blob = new Blob(['0123456789'], { type: 'audio/mpeg' });
const request = (range, method = 'GET') => new Request('https://local.test/__offline_audio/key', { method, headers: range ? { Range: range } : {} });
describe('local audio byte ranges', () => {
    it('serves a complete file from local storage', async () => {
        const response = createOfflineMediaResponse(request(), blob);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-length')).toBe('10');
        expect(response.headers.get('content-type')).toBe('audio/mpeg');
        expect(await response.text()).toBe('0123456789');
    });
    it.each([
        ['bytes=0-1', '01', 'bytes 0-1/10'],
        ['bytes=5-', '56789', 'bytes 5-9/10'],
        ['bytes=-3', '789', 'bytes 7-9/10'],
        ['bytes=8-99', '89', 'bytes 8-9/10'],
        ['bytes=-99', '0123456789', 'bytes 0-9/10'],
    ])('supports Safari seek request %s', async (range, body, contentRange) => {
        const response = createOfflineMediaResponse(request(range), blob);
        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe(contentRange);
        expect(response.headers.get('content-length')).toBe(String(body.length));
        expect(await response.text()).toBe(body);
    });
    it.each(['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', 'bytes=NaN-'])('rejects invalid range %s', range => {
        const response = createOfflineMediaResponse(request(range), blob);
        expect(response.status).toBe(416);
        expect(response.headers.get('content-range')).toBe('bytes */10');
    });
    it('answers HEAD without reading media into the response body', async () => {
        const response = createOfflineMediaResponse(request('bytes=0-1', 'HEAD'), blob);
        expect(response.status).toBe(206);
        expect(response.headers.get('content-length')).toBe('2');
        expect(await response.text()).toBe('');
    });
    it('returns an explicit local miss instead of fetching from the cloud', () => {
        expect(createOfflineMediaResponse(request(), null).status).toBe(404);
    });
});
