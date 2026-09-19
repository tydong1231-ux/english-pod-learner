import assert from 'node:assert/strict';

export async function checkRemix(page, base, source, episodeId) {
    const sourceSentence = 'What we found was that it really comes down to trust.';
    const first = 'what we found was that';
    const second = 'it really comes down to';
    let record = null;
    const prompts = [];
    const writes = [];
    const exercise = phrase => ({ phrase, meaning: 'Introduce an observation.', question: 'What did your latest customer interviews reveal?', examples: [
        { sentence: `${phrase} migration needed a clearer plan.`, usedVocabulary: ['migration'], usedRemixPhrases: [] },
        { sentence: `${phrase} adoption improved after onboarding.`, usedVocabulary: ['adoption'], usedRemixPhrases: [] },
        { sentence: `${phrase} trust mattered more than features.`, usedVocabulary: [], usedRemixPhrases: [] },
    ], noAlternative: false });
    await page.route(source + '/rest/v1/transcripts**', route => route.fulfill({ json: { content: [{ start: 0, end: 60, text: sourceSentence }] } }));
    await page.route(source + '/rest/v1/vocabulary**', async route => {
        assert.equal(route.request().method(), 'GET', 'Remix must not modify Vocabulary');
        await route.fulfill({ json: [{ word: 'migration' }, { word: 'adoption' }] });
    });
    await page.route(source + '/rest/v1/remix_items**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        let response;
        if (request.method() === 'POST' || request.method() === 'PATCH') {
            writes.push({ method: request.method(), payload: request.postDataJSON(), conflict: url.searchParams.get('on_conflict') });
            record = { id: 'stable-remix-record', ...record, ...request.postDataJSON(), podcasts: { title: 'At the airport' } };
            response = record;
        } else response = record ? [record] : [];
        await route.fulfill({ json: response });
    });
    await page.evaluate(source => {
        const stored = JSON.parse(localStorage.getItem('english-pod-storage') || '{}');
        stored.state = { ...stored.state, openaiApiKey: 'fake-test-key', openaiBaseUrl: source + '/v1', openaiModel: 'test-model' };
        localStorage.setItem('english-pod-storage', JSON.stringify(stored));
    }, source);
    await page.route(source + '/v1/chat/completions', async route => {
        const prompt = route.request().postDataJSON().messages.at(-1).content;
        prompts.push(prompt);
        let output;
        if (prompt.includes('Previous question:')) output = { question: 'What surprised you when you tested the onboarding process?' };
        else {
            const excluded = JSON.parse(prompt.match(/Excluded phrases: (.*)/)[1]);
            output = excluded.includes(second) ? { noAlternative: true } : exercise(excluded.includes(first) ? second : first);
        }
        await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(output) } }] } });
    });
    await page.goto(`${base}/#/player/${episodeId}`);
    await page.reload();
    await page.getByRole('button', { name: 'Remix', exact: true }).click();
    const panel = page.locator('aside').filter({ has: page.getByRole('button', { name: 'Close Remix' }) });
    await panel.getByText(first, { exact: true }).waitFor();
    assert.equal(await panel.getByText(record.examples[0].sentence, { exact: true }).count(), 0, 'Examples start hidden');
    const beforeExamples = prompts.length;
    await panel.getByRole('button', { name: 'Show examples' }).click();
    for (const example of record.examples) await panel.getByText(example.sentence, { exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Hide examples' }).click();
    assert.equal(prompts.length, beforeExamples, 'Expand/collapse does not call AI');
    const examples = structuredClone(record.examples);
    await panel.getByRole('button', { name: 'Regenerate question' }).click();
    await panel.getByText('What surprised you when you tested the onboarding process?', { exact: true }).waitFor();
    assert.equal(record.phrase, first);
    assert.deepEqual(record.examples, examples);
    assert.deepEqual(Object.keys(writes.at(-1).payload).sort(), ['question', 'updated_at']);
    await panel.getByRole('button', { name: 'Switch', exact: true }).click();
    await panel.getByText(second, { exact: true }).waitFor();
    assert.equal(record.id, 'stable-remix-record');
    assert.equal(writes.at(-1).conflict, 'source_podcast_id,source_segment_index');
    await panel.getByRole('button', { name: 'Switch', exact: true }).click();
    await panel.getByRole('button', { name: 'No alternative', disabled: true }).waitFor();
    assert.deepEqual(JSON.parse(prompts.at(-1).match(/Excluded phrases: (.*)/)[1]), [first, second]);
    for (const width of [320, 390, 430, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `artifacts/remix-review-${width}.png` });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.getByRole('button', { name: 'Close Remix' }).click();
    const beforeReopen = prompts.length;
    await page.getByRole('button', { name: 'Remix', exact: true }).click();
    await panel.getByText(second, { exact: true }).waitFor();
    assert.equal(prompts.length, beforeReopen, 'Reopen uses the saved record');
    await page.goto(`${base}/#/remix`);
    await page.getByText(second, { exact: true }).waitFor();
    assert.equal(await page.locator('article').count(), 1);
    assert.equal(await page.getByText(record.examples[0].sentence, { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Show examples' }).click();
    assert.equal(prompts.length, beforeReopen);
    await page.getByText(record.examples[0].sentence, { exact: true }).waitFor();
    console.log('PASS: Remix generation, hidden examples without AI calls, question-only regeneration, Switch exclusions, one record, noAlternative, reopening, saved page, mobile/desktop layout; Vocabulary read-only.');
    await page.unroute(source + '/rest/v1/transcripts**');
    await page.unroute(source + '/rest/v1/vocabulary**');
    await page.unroute(source + '/rest/v1/remix_items**');
    await page.unroute(source + '/v1/chat/completions');
}
