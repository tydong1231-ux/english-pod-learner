import assert from 'node:assert/strict';

async function finishEpisode(page) {
    await page.locator('audio').evaluate(audio => { audio.currentTime = audio.duration - 0.25; });
}

async function expectPlaying(page) {
    await page.waitForFunction(() => {
        const audio = document.querySelector('audio');
        return audio && !audio.paused && audio.currentTime > 0.1 && audio.currentTime < 5;
    });
}

export async function checkOnlineContinuousPlayback(page, base, courses) {
    const firstRoute = `/player/${courses[0].id}`;
    const secondRoute = `/player/${courses[1].id}`;
    const openFirst = async () => {
        await page.goto(base + '/#/');
        await page.evaluate(ids => {
            localStorage.setItem('podfluent-playback-context', JSON.stringify({ orderedIds: ids }));
        }, courses.map(course => course.id));
        await page.goto(base + '/#' + firstRoute);
        await page.waitForFunction(() => document.querySelector('audio')?.readyState >= 2);
        await page.getByRole('button', { name: 'Play', exact: true }).click();
        await expectPlaying(page);
        await page.evaluate(() => { window.continuousAudio = document.querySelector('audio'); });
    };

    // Both media sources: first uncached, then cached. The mock transcript takes
    // 1.5 seconds, deliberately outlasting the old 120 ms autoplay timeout.
    for (const cached of [false, true]) {
        await openFirst();
        await finishEpisode(page);
        await page.waitForURL('**/#' + secondRoute);
        await page.getByText(courses[1].title, { exact: true }).waitFor();
        await expectPlaying(page);
        assert.equal(await page.evaluate(() => document.querySelector('audio') === window.continuousAudio), true,
            'Episode changes must reuse the user-authorized media element');
        const src = await page.locator('audio').getAttribute('src');
        assert.equal(src.startsWith('blob:'), cached, 'Exercise both streamed and cached audio');
        await finishEpisode(page);
        await page.waitForFunction(() => document.querySelector('audio')?.ended);
        assert.ok(page.url().endsWith(secondRoute), 'The last episode must stop without looping');
    }

    // An episode-count sleep timer must still suppress automatic advancement.
    await openFirst();
    await page.getByRole('combobox', { name: 'Set sleep timer' }).selectOption('episodes:1');
    await finishEpisode(page);
    await page.waitForFunction(() => document.querySelector('audio')?.ended);
    assert.ok(page.url().endsWith(firstRoute));
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor();

    // Simulate a browser denying only the next automatic play attempt.
    await openFirst();
    await page.evaluate(() => {
        const original = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
            HTMLMediaElement.prototype.play = original;
            return Promise.reject(new DOMException('Autoplay blocked by test', 'NotAllowedError'));
        };
    });
    await finishEpisode(page);
    await page.waitForURL('**/#' + secondRoute);
    await page.getByRole('alert').filter({ hasText: 'Tap Play to continue' }).waitFor();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expectPlaying(page);
    assert.equal(await page.getByRole('alert').count(), 0, 'A successful retry clears the error');
    console.log('PASS: online automatic next episode with slow transcripts, streaming/cache sources, stable media element, queue end, sleep timer, blocked autoplay recovery.');
}

export async function checkOfflineContinuousPlayback(page) {
    const queue = await page.evaluate(() => JSON.parse(sessionStorage.getItem('podfluent-offline-queue')));
    // Keep the page alive: actual route changes must carry playback intent.
    await page.evaluate(key => { location.hash = '/offline/player/' + key; }, queue[0]);
    await page.waitForFunction(() => document.querySelector('audio')?.readyState >= 2);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await finishEpisode(page);
    await page.waitForURL('**/#/offline/player/' + queue[1]);
    await expectPlaying(page);
    console.log('PASS: downloaded episodes continue automatically without a network connection.');
}
