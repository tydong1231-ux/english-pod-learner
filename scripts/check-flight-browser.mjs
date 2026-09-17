// Run against `npm run preview -- --config vite.web.config.js --port 4173`.
// Uses isolated browser storage and synthetic courses; never reads live cloud data.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { checkOnlineContinuousPlayback, checkOfflineContinuousPlayback } from './player-browser-checks.mjs';
import { checkListeningProgress } from './listening-browser-checks.mjs';
import { checkVocabularyRoots } from './vocabulary-browser-checks.mjs';
import { checkRemix } from './remix-review-checks.mjs';
const browsers = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const browser = await browsers[engine].launch({ headless: true, executablePath: process.env.BROWSER_PATH || (engine === 'chromium' ? process.env.CHROMIUM_PATH : undefined) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1, hasTouch: true, serviceWorkers: 'allow' });
const base = 'http://127.0.0.1:4173';
const errors = [];
let offlineExternalRequests = 0;
let offline = false;
let failSecond = true;
const sampleRate = 8000;
const pcm = Buffer.alloc(60 * sampleRate * 2);
const wav = Buffer.alloc(44 + pcm.length);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
const media = process.env.FLIGHT_AUDIO_FIXTURE ? await readFile(process.env.FLIGHT_AUDIO_FIXTURE) : wav;
const mediaType = process.env.FLIGHT_AUDIO_FIXTURE ? 'audio/mpeg' : 'audio/wav';
let mockBase;
const courses = ['At the airport', 'Coffee on board'].map((title, index) => ({ id: `flight-test-${index + 1}`, title, status: 'READY', folder: 'Travel English', created_at: '2026-09-12T00:00:00Z' }));
const mockServer = createServer((request, response) => {
    if (offline) offlineExternalRequests++;
    response.setHeader('access-control-allow-origin', base);
    response.setHeader('access-control-allow-headers', 'authorization,apikey,content-type,x-client-info,prefer,accept,range');
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    const url = new URL(request.url, mockBase);
    if (url.pathname === '/rest/v1/podcasts') {
        const id = url.searchParams.get('id')?.replace(/^eq\./, '');
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(id ? courses.find(course => String(course.id) === id) : courses));
        return;
    }
    if (url.pathname === '/rest/v1/transcripts') {
        response.setHeader('content-type', 'application/json');
        setTimeout(() => response.end(JSON.stringify({ content: [{ start: 0, end: 30, text: 'Inspect the engine. Fly safely.', words: [{ word: 'Inspect', start: 0, end: 1 }, { word: 'Fly', start: 1, end: 2 }] }, { start: 30, end: 60, text: 'Please fasten your seat belt.' }] })), 1500);
        return;
    }
    if (url.pathname.endsWith('.wav')) {
        if (url.pathname === '/2.wav' && failSecond) { failSecond = false; response.writeHead(503); response.end('Temporary failure'); return; }
        response.setHeader('content-type', mediaType);
        response.setHeader('accept-ranges', 'bytes');
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
        if (range) {
            const start = Number(range[1]);
            const end = Math.min(range[2] ? Number(range[2]) : media.length - 1, media.length - 1);
            response.writeHead(206, { 'content-range': `bytes ${start}-${end}/${media.length}`, 'content-length': end - start + 1 });
            response.end(media.subarray(start, end + 1));
        } else {
            response.setHeader('content-length', media.length);
            response.end(media);
        }
        return;
    }
    response.writeHead(404); response.end();
});
await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
mockBase = `http://127.0.0.1:${mockServer.address().port}`;
courses.forEach((course, index) => { course.audio_url = `${mockBase}/${index + 1}.wav`; });
await context.addInitScript(() => localStorage.setItem('podfluent_auth', 'true'));
await context.routeWebSocket('**/*', socket => socket.close());
await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base || url.origin === mockBase) return route.continue();
    if (offline) { offlineExternalRequests++; return route.abort(); }
    return route.abort();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
if (process.env.DEBUG_BROWSER) page.on('console', entry => { if (entry.type() === 'error') console.error(entry.text().slice(0, 500)); });
if (process.env.DEBUG_BROWSER) {
    page.on('response', response => { if (response.url().includes('/__offline_audio/')) console.error('Local media:', response.status(), response.headers(), response.request().headers().range); });
    page.on('requestfailed', request => { if (request.url().includes('/__offline_audio/')) console.error('Local media request failed:', request.failure()); });
}
try {
    await page.goto(base + '/#/settings', { waitUntil: 'networkidle' });
    await page.locator('#supabaseUrl').fill(mockBase);
    await page.locator('#supabaseAnonKey').fill('flight-test-public-key');
    await page.getByRole('button', { name: 'Save Settings', exact: true }).first().click();
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    const cachedHTML = await page.evaluate(async () => {
        const names = await caches.keys();
        const cache = await caches.open(names.find(name => name.startsWith('podfluent-shell-')));
        return Boolean(await cache.match('/index.html'));
    });
    assert.equal(cachedHTML, true, 'The PWA shell must include its HTML entry point');
    await page.getByText('At the airport', { exact: true }).waitFor();
    assert.equal(await page.locator('.flight-ready, .flight-download-bar, .flight-select, .offline-download').count(), 0, 'Library must contain no offline controls');
    await page.getByRole('link', { name: 'Offline', exact: true }).click();
    await page.getByRole('button', { name: 'Install app', exact: true }).click();
    await page.getByRole('dialog', { name: 'Add to Home Screen' }).waitFor();
    await page.getByRole('heading', { name: 'On iPhone or iPad' }).waitFor();
    await mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/mobile-install-guide.png' });
    await page.getByRole('button', { name: 'Got it' }).click();
    await page.evaluate(() => {
        const offer = new Event('beforeinstallprompt', { cancelable: true });
        offer.prompt = async () => { window.installRequested = true; };
        offer.userChoice = Promise.resolve({ outcome: 'dismissed' });
        window.dispatchEvent(offer);
    });
    await page.getByRole('button', { name: 'Install app', exact: true }).click();
    await page.getByRole('button', { name: 'Install on this device', exact: true }).click();
    assert.equal(await page.evaluate(() => window.installRequested), true, 'Supported browsers receive the native install request');
    await page.getByRole('button', { name: 'Got it' }).click();
    await page.getByRole('button', { name: 'Add downloads', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select At the airport for download' }).waitFor();
    await page.getByRole('button', { name: 'Select shown' }).click();
    await page.getByRole('button', { name: 'Download (2)', exact: true }).click();
    await page.getByText(/1\/2 Ready Offline.*Retry selected episodes/).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Download (1)', exact: true }).click();
    await page.getByText('1/1 Ready Offline.', { exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: /^Downloaded/ }).click();
    await page.getByText('2 episodes downloaded · 0h 2m available offline').waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, 'Mobile UI must not overflow horizontally');
    await checkOnlineContinuousPlayback(page, base, courses);
    // A realistic list checks density, long titles, controls and saved markers.
    for (let index = 3; index <= 14; index++) courses.push({ ...courses[0], id: `flight-test-${index}`, title: `EnglishPod ${String(index).padStart(3, '0')} · ${['Making plans for the weekend', 'Asking for directions in a new city', 'A conversation at the coffee shop'][index % 3]}`, folder: index % 2 ? 'Daily life' : 'Travel English' });
    await checkListeningProgress(page, base, mockBase, courses);
    await checkVocabularyRoots(page, base, mockBase, courses[0].id);
    await checkRemix(page, base, mockBase, courses[0].id);
    await page.goto(base + '/#/');
    await page.locator('[data-testid="library-episode"]').nth(13).waitFor();
    assert.equal(await page.getByRole('img', { name: 'Downloaded to this device' }).count(), 2);
    for (const width of [320, 390, 430, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        const metrics = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('[data-testid="library-episode"]')].map(row => row.getBoundingClientRect());
            return { top: rows[0].top, visible: rows.filter(row => row.bottom < innerHeight - 85).length, overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.equal(metrics.overflow, false, `No overflow at ${width}px`);
        if (width <= 430) { assert.ok(metrics.top < 205, `Compact library header at ${width}px: ${metrics.top}`); assert.ok(metrics.visible >= 5, `At least five complete episodes visible at ${width}px`); }
        await page.screenshot({ path: `artifacts/mobile-library-${width}.png` });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('combobox', { name: 'Sort library' }).selectOption('title_desc');
    await page.getByRole('textbox', { name: 'Search library' }).fill('coffee');
    assert.ok(await page.locator('[data-testid="library-episode"]').count() > 0);
    await page.getByRole('textbox', { name: 'Search library' }).fill('');
    await page.getByRole('button', { name: /Daily life/ }).first().click();
    assert.equal(await page.locator('[data-testid="library-episode"]').count(), 6);
    await page.getByRole('link', { name: 'Offline', exact: true }).click();
    await page.getByRole('button', { name: 'Add downloads', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select At the airport for download' }).waitFor();
    assert.equal(await page.getByRole('checkbox', { name: 'Select At the airport for download' }).isDisabled(), true);
    await page.getByRole('combobox', { name: 'Download folder' }).selectOption('Daily life');
    await page.getByRole('button', { name: 'Select shown' }).click();
    await page.getByRole('combobox', { name: 'Download folder' }).selectOption('Travel English');
    await page.getByRole('button', { name: 'Select shown' }).click();
    assert.equal(await page.getByRole('button', { name: 'Download (12)', exact: true }).isEnabled(), true, 'Selection is preserved across folders and skips saved episodes');
    await page.screenshot({ path: 'artifacts/mobile-add-downloads.png' });
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Download (0)', exact: true }).isDisabled(), true);
    // Close the page, go offline and cold-open the PWA start URL in a new page.
    await page.close();
    offline = true;
    await context.setOffline(true);
    const offlinePage = await context.newPage();
    offlinePage.on('pageerror', error => errors.push(error.message));
    await offlinePage.goto(base + '/#/offline');
    await offlinePage.getByText('2 episodes downloaded · 0h 2m available offline').waitFor();
    await offlinePage.getByRole('searchbox', { name: 'Search downloads' }).fill('airport');
    assert.equal(await offlinePage.locator('.offline-course').count(), 1);
    await offlinePage.getByRole('searchbox', { name: 'Search downloads' }).fill('no-such-course');
    await offlinePage.getByRole('button', { name: 'Show all downloads' }).click();
    assert.equal(await offlinePage.locator('.offline-course').count(), 2);
    assert.equal(await offlinePage.locator('.flight-ready').getAttribute('open'), null, 'Flight details start collapsed');
    await offlinePage.locator('.flight-ready > summary').click();
    await offlinePage.getByRole('button', { name: 'Test Offline', exact: true }).click();
    await offlinePage.getByText(/Local audio and subtitles verified/).waitFor({ timeout: 30000 });
    await offlinePage.locator('.flight-ready > summary').click();
    await mkdir('artifacts', { recursive: true });
    await offlinePage.screenshot({ path: 'artifacts/flight-offline-mobile.png', fullPage: true });
    await offlinePage.getByRole('button', { name: 'Play', exact: true }).first().click();
    await offlinePage.waitForFunction(() => document.querySelector('audio')?.readyState >= 1);
    const localAudioSrc = await offlinePage.locator('audio').getAttribute('src');
    assert.ok(localAudioSrc.startsWith('/__offline_audio/'), 'PWA playback must use its local media endpoint');
    const range = await offlinePage.evaluate(async url => {
        const response = await fetch(url, { headers: { Range: 'bytes=0-1' } });
        return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
    }, localAudioSrc);
    assert.deepEqual(range, { status: 206, bytes: 2 }, 'Seeking must read a byte range from IndexedDB while offline');
    await offlinePage.getByRole('button', { name: 'Play', exact: true }).click();
    await offlinePage.waitForFunction(() => document.querySelector('audio').currentTime > 0);
    await offlinePage.getByRole('button', { name: 'Pause', exact: true }).click();
    await offlinePage.locator('audio').evaluate(audio => { audio.currentTime = 17; });
    await offlinePage.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 17) < 1);
    await offlinePage.getByRole('button', { name: 'Offline', exact: true }).click();
    await offlinePage.getByRole('button', { name: /Continue listening/ }).click();
    await offlinePage.waitForFunction(() => document.querySelector('audio')?.currentTime >= 16, { timeout: 15000 });
    await offlinePage.reload();
    await offlinePage.waitForFunction(() => document.querySelector('audio')?.currentTime >= 16);
    await offlinePage.screenshot({ path: 'artifacts/flight-offline-player.png', fullPage: true });
    await checkOfflineContinuousPlayback(offlinePage);
    assert.equal(offlineExternalRequests, 0, 'Offline library and playback must not depend on cloud requests');
    // Removing a local download must remove its passive Library badge too.
    offline = false;
    await context.setOffline(false);
    await offlinePage.goto(base + '/#/offline');
    offlinePage.once('dialog', dialog => dialog.accept());
    await offlinePage.getByRole('button', { name: /^Remove offline download/ }).first().click();
    await offlinePage.waitForFunction(() => document.querySelectorAll('.offline-course').length === 1);
    await offlinePage.evaluate(() => localStorage.removeItem('podfluent-library-state'));
    await offlinePage.getByRole('link', { name: 'Library', exact: true }).click();
    await offlinePage.locator('[data-testid="library-episode"]').nth(13).waitFor();
    await offlinePage.getByRole('img', { name: 'Downloaded to this device' }).waitFor();
    assert.equal(await offlinePage.getByRole('img', { name: 'Downloaded to this device' }).count(), 1);
    assert.deepEqual(errors, [], 'No browser runtime errors');
    console.log(`PASS (${engine}): compact Library at 320/390/430px and desktop, saved indicators, search/sort/folders, Offline-only batch downloads with cross-folder selection and retry, install guide, collapsed checks, cold offline launch, continuous playback/seek/progress, no cloud requests.`);
} catch (error) {
    await mkdir('artifacts', { recursive: true });
    const current = context.pages().at(-1);
    if (current) {
        await current.screenshot({ path: `artifacts/flight-${engine}-failure.png`, fullPage: true }).catch(() => {});
        console.error((await current.locator('body').innerText()).slice(0, 2500));
    }
    throw error;
} finally { await browser.close(); mockServer.closeAllConnections(); await new Promise(resolve => mockServer.close(resolve)); }
