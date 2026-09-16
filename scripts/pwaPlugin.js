import { createHash } from 'node:crypto';
import { createOfflineMediaResponse } from '../src/lib/offlineMediaResponse.js';

// Precache the built shell only. Audio is explicitly managed in the offline library;
// Supabase responses, credentials and third-party requests never enter this cache.
export function pwaPlugin() {
    return {
        name: 'podfluent-offline-shell',
        apply: 'build',
        transformIndexHtml() {
            return [
                { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' }, injectTo: 'head' },
                { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/icon.jpg' }, injectTo: 'head' },
                { tag: 'meta', attrs: { name: 'theme-color', content: '#2563eb' }, injectTo: 'head' },
                { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
            ];
        },
        generateBundle(_options, bundle) {
            const assets = Object.keys(bundle).filter(name => !name.endsWith('.map'));
            const version = createHash('sha256').update(assets.join('|')).update(String(Date.now())).digest('hex').slice(0, 16);
            // Vite may emit HTML after this hook. Include it explicitly.
            const paths = [...new Set(['/index.html', ...assets.map(name => `/${name}`), '/icon.jpg', '/manifest.webmanifest'])];
            this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const CACHE = 'podfluent-shell-${version}';
const ASSETS = ${JSON.stringify(paths)};
const respondToOfflineMedia = ${createOfflineMediaResponse.toString()};
function readOfflineAudio(key) {
    return new Promise((resolve, reject) => {
        const opening = indexedDB.open('PodFluentOffline');
        opening.onupgradeneeded = () => opening.transaction.abort();
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
            const db = opening.result;
            if (!db.objectStoreNames.contains('episodes')) { db.close(); resolve(null); return; }
            const store = db.objectStoreNames.contains('audio') ? 'audio' : 'episodes';
            const transaction = db.transaction(store, 'readonly');
            const reading = transaction.objectStore(store).get(key);
            reading.onsuccess = () => {
                const record = reading.result;
                resolve(record?.data ? { size: record.data.byteLength, type: record.type, slice: (start, end) => record.data.slice(start, end) } : record?.audioBlob || null);
            };
            reading.onerror = () => reject(reading.error);
            transaction.oncomplete = () => db.close();
            transaction.onabort = () => { db.close(); reject(transaction.error); };
        };
    });
}
self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
// Let existing tabs finish using the old version before activating an update.
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('podfluent-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/__offline_audio/')) {
        const key = url.pathname.slice('/__offline_audio/'.length);
        if (!['GET', 'HEAD'].includes(request.method) || !/^[a-f0-9]{64}$/.test(key)) {
            event.respondWith(new Response(null, { status: 400 }));
        } else {
            event.respondWith(readOfflineAudio(key).then(blob => respondToOfflineMedia(request, blob)).catch(() => new Response('Offline storage unavailable', { status: 503 })));
        }
        return;
    }
    if (request.method !== 'GET') return;
    if (request.mode === 'navigate') {
        // Pages redirects /index.html to /. A cached redirected response cannot
        // satisfy a navigation whose redirect mode is manual, such as reload.
        event.respondWith(caches.open(CACHE).then(cache => cache.match('/index.html')).then(response => response
            ? new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers })
            : fetch(request)));
    } else if (ASSETS.includes(url.pathname)) {
        event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)).then(response => response || fetch(request)));
    }
});
self.addEventListener('message', event => {
    if (event.data?.type !== 'CHECK_PODFLUENT_SHELL') return;
    event.waitUntil(caches.open(CACHE).then(async cache => {
        const responses = await Promise.all(ASSETS.map(path => cache.match(path)));
        event.ports[0]?.postMessage({ type: 'PODFLUENT_SHELL_RESULT', ready: responses.every(response => response?.ok) });
    }).catch(() => event.ports[0]?.postMessage({ type: 'PODFLUENT_SHELL_RESULT', ready: false })));
});
` });
        },
    };
}
