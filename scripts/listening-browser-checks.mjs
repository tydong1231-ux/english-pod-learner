import assert from 'node:assert/strict';

export async function checkListeningProgress(page, base, source, courses) {
    const library = () => page.goto(base + '/#/');
    const row = id => page.locator(`[data-testid="library-episode"][data-episode-id="${id}"]`);
    await library(); // Flush the preceding player's real progress before seeding history.
    await page.evaluate(({ source, courses }) => {
        localStorage.removeItem('podfluent-library-state');
        const records = Object.fromEntries(courses.slice(0, 8).map(course => [JSON.stringify([source, course.id]), { position: 60, duration: 60, completed: true }]));
        localStorage.setItem('podfluent-listening-progress-v1', JSON.stringify(records));
    }, { source, courses });
    await library();
    await page.waitForFunction(id => document.querySelector('[data-next-unplayed="true"]')?.dataset.episodeId === id, courses[8].id);
    const bounds = await row(courses[8].id).boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height < 780, 'Default location brings the next unplayed row into view');
    assert.equal(await row(courses[0].id).getByRole('progressbar').getAttribute('aria-valuetext'), 'Played');
    await page.getByRole('combobox', { name: 'Sort library' }).selectOption('title_desc');
    assert.equal(await page.locator('[data-next-unplayed="true"]').getAttribute('data-episode-id'), courses[8].id, 'Sorting does not choose another target');
    // A last-played item takes precedence over newest-unplayed, even when an old
    // folder/search would hide it. Preserve the user's sorting choice.
    await page.evaluate(({ source, episode }) => {
        const records = JSON.parse(localStorage.getItem('podfluent-listening-progress-v1'));
        records[JSON.stringify([source, episode.id])] = { started: true, position: 12, duration: 60, lastPlayedAt: new Date().toISOString() };
        localStorage.setItem('podfluent-listening-progress-v1', JSON.stringify(records));
        localStorage.setItem('podfluent-library-state', JSON.stringify({ folder: 'Not this folder', searchQuery: 'no matching title', sortMode: 'title_desc' }));
    }, { source, episode: courses[10] });
    await library();
    await row(courses[10].id).getByText('最近播放', { exact: true }).waitFor();
    await page.waitForFunction(id => {
        const rect = document.querySelector(`[data-episode-id="${id}"]`)?.getBoundingClientRect();
        return rect && rect.top >= 0 && rect.bottom < innerHeight;
    }, courses[10].id);
    assert.equal(await page.getByRole('combobox', { name: 'Sort library' }).inputValue(), 'title_desc');
    assert.equal(await row(courses[10].id).getByRole('progressbar').getAttribute('aria-valuetext'), '20% played');
    await page.evaluate(() => {
        localStorage.removeItem('podfluent-listening-progress-v1');
        localStorage.removeItem('podfluent-library-state');
    });
    await library();
    await row(courses[0].id).click();
    await page.waitForFunction(() => document.querySelector('audio')?.readyState >= 2);
    await page.locator('audio').evaluate(audio => { audio.currentTime = 17; });
    await page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('podfluent-listening-progress-v1') || '{}')).some(record => record.position === 17));
    await library();
    assert.equal(await row(courses[0].id).getByRole('progressbar').getAttribute('aria-valuetext'), '28% played');
    await page.getByRole('link', { name: 'Offline', exact: true }).click();
    const saved = page.locator('.offline-course').filter({ has: page.getByRole('heading', { name: courses[0].title, exact: true }) });
    await saved.getByRole('progressbar').waitFor();
    assert.equal(await saved.getByRole('progressbar').getAttribute('aria-valuetext'), '28% played', 'Online progress appears in Offline');
    await saved.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('audio')?.currentTime >= 16);
    await page.locator('audio').evaluate(audio => { audio.currentTime = 30; });
    await page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('podfluent-listening-progress-v1'))).some(record => record.position === 30));
    await library();
    assert.equal(await row(courses[0].id).getByRole('progressbar').getAttribute('aria-valuetext'), '50% played', 'Offline progress appears in Library');
    await row(courses[2].id).click();
    await page.waitForFunction(() => document.querySelector('audio')?.readyState >= 2);
    await page.locator('audio').evaluate(audio => { audio.currentTime = 15; });
    await page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('podfluent-listening-progress-v1'))).some(record => record.position === 15));
    await page.reload();
    await page.waitForFunction(() => document.querySelector('audio')?.currentTime >= 14);
    await page.getByRole('combobox', { name: 'Set sleep timer' }).selectOption('episodes:1');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.locator('audio').evaluate(audio => { audio.currentTime = audio.duration - .15; });
    await page.waitForFunction(() => document.querySelector('audio')?.ended);
    await library();
    await row(courses[2].id).getByRole('progressbar').waitFor();
    await row(courses[2].id).getByText('最近播放', { exact: true }).waitFor();
    assert.equal(await row(courses[2].id).getByRole('progressbar').getAttribute('aria-valuetext'), 'Played', 'Completion survives navigation for an undownloaded episode');
    await row(courses[2].id).click();
    await page.waitForFunction(() => document.querySelector('audio')?.readyState >= 2);
    assert.equal(await page.locator('audio').evaluate(audio => audio.currentTime), 0, 'Completed episodes replay from the beginning');
    await library();
    console.log('PASS: default unplayed location, online/offline shared progress, online reload resume, completion retention and replay.');
}
