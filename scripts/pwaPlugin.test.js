import { describe, it, expect } from 'vitest';
import { pwaPlugin } from './pwaPlugin';

describe('offline app shell', () => {
    it('serves redirected hosting HTML as a fresh response for offline navigation', async () => {
        let worker;
        pwaPlugin().generateBundle.call({ emitFile: value => { worker = value; } }, {}, {});
        const cachedHTML = new Response('<html>Offline app</html>', { headers: { 'content-type': 'text/html' } });
        Object.defineProperty(cachedHTML, 'redirected', { value: true });
        const handlers = {};
        const workerScope = {
            location: { origin: 'https://podcast.botly.cn' },
            addEventListener: (type, handler) => { handlers[type] = handler; },
        };
        const cacheStorage = { open: async () => ({ match: async path => {
            expect(path).toBe('/index.html');
            return cachedHTML;
        } }) };
        new Function('self', 'caches', worker.source)(workerScope, cacheStorage);
        let result;
        handlers.fetch({
            request: { url: 'https://podcast.botly.cn/', method: 'GET', mode: 'navigate', redirect: 'manual' },
            respondWith: promise => { result = promise; },
        });
        const response = await result;
        expect(response.redirected).toBe(false);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/html');
        expect(await response.text()).toBe('<html>Offline app</html>');
    });

    it('always precaches HTML even when Vite emits it after generateBundle', () => {
        let worker;
        pwaPlugin().generateBundle.call({ emitFile: value => { worker = value; } }, {}, { 'assets/main.js': {}, 'assets/main.css': {} });
        expect(worker.fileName).toBe('sw.js');
        const assets = JSON.parse(worker.source.match(/const ASSETS = (.*);/)[1]);
        expect(assets).toEqual(expect.arrayContaining(['/index.html', '/assets/main.js', '/assets/main.css', '/manifest.webmanifest']));
        expect(worker.source).toContain("url.origin !== self.location.origin");
        expect(worker.source).toContain("/__offline_audio/");
    });
});
