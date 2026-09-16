import assert from 'node:assert/strict';

// Exercise the real provider adapters, persistence service and both card views.
// Responses are synthetic; no AI charges or production database writes.
export async function checkVocabularyRoots(page, base, source, episodeId) {
    let saved = [];
    let requests = 0;
    const cardFor = prompt => prompt.includes('"inspect"') ? {
        word: 'inspect', definition: 'Examine something carefully.', translation: '仔细检查', ipa: 'ɪnˈspekt', examples: ['Inspect the engine.', 'Inspect the package.'],
        roots: [{ root: 'spect', meaning: '看', examples: [{ word: 'prospect', meaning: 'a future possibility' }, { word: 'retrospect', meaning: 'looking back on events' }] }],
    } : { word: 'fly', definition: 'Travel through the air.', translation: '飞行', roots: [], examples: [] };
    await page.route(source + '/rest/v1/vocabulary**', async route => {
        const request = route.request();
        let response;
        if (request.method() === 'POST') {
            response = { id: `word-${saved.length}`, ...request.postDataJSON() };
            saved.push(response);
        } else {
            const word = new URL(request.url()).searchParams.get('word')?.replace(/^eq\./, '');
            response = word ? saved.filter(card => card.word === word) : saved;
        }
        await route.fulfill({ json: response });
    });
    await page.route(source + '/v1/chat/completions', async route => {
        const prompt = route.request().postDataJSON().messages.at(-1).content;
        assert.ok(prompt.includes('"roots"'), 'OpenAI adapter must request roots');
        requests++;
        await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(cardFor(prompt)) } }] } });
    });
    await page.route('https://generativelanguage.googleapis.com/**', async route => {
        const prompt = route.request().postDataJSON().contents[0].parts[0].text;
        assert.ok(prompt.includes('"roots"'), 'Gemini adapter must request roots');
        requests++;
        await route.fulfill({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(cardFor(prompt)) }], role: 'model' }, finishReason: 'STOP', index: 0 }] } });
    });
    const roots = () => page.getByRole('region', { name: '词根拆解' });
    const verifyOrder = async () => {
        await roots().waitFor();
        assert.equal(await roots().getByRole('listitem').count(), 2);
        await roots().getByText('prospect (a future possibility)', { exact: true }).waitFor();
        const english = await page.getByText('Examine something carefully.', { exact: true }).boundingBox();
        const module = await roots().boundingBox();
        const chinese = await page.getByText('仔细检查', { exact: true }).boundingBox();
        assert.ok(english.y < module.y && module.y + module.height <= chinese.y, 'Roots belong between English and Chinese');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    };
    for (const provider of ['gemini', 'openai']) {
        saved = [];
        await page.evaluate(({ provider, source }) => {
            const config = JSON.parse(localStorage.getItem('english-pod-storage') || '{"state":{}}');
            Object.assign(config.state, { vocabProvider: provider, apiKey: 'mock-gemini-key', openaiApiKey: 'mock-openai-key', openaiBaseUrl: source + '/v1' });
            localStorage.setItem('english-pod-storage', JSON.stringify(config));
        }, { provider, source });
        await page.goto(`${base}/#/player/${episodeId}`);
        await page.reload(); // Rehydrate the provider setting; hash navigation alone does not.
        await page.getByText('Inspect', { exact: true }).click();
        await verifyOrder();
        assert.ok(saved[0].meaning.includes('【词根拆解】'), 'Root content must be saved, not only shown transiently');
        await page.screenshot({ path: `artifacts/word-roots-${provider}-mobile.png` });
        await page.reload();
        const countBefore = requests;
        await page.getByText('Inspect', { exact: true }).click();
        await verifyOrder();
        assert.equal(requests, countBefore, 'Reloaded card must use stored roots without regeneration');
        await page.getByRole('button', { name: 'Close vocabulary' }).click();
        await page.getByText('Fly', { exact: true }).click();
        await page.getByText('Travel through the air.', { exact: true }).waitFor();
        assert.equal(await roots().count(), 0, 'Words without roots hide the whole module');
        await page.goto(`${base}/#/vocabulary`);
        await page.getByRole('heading', { name: 'inspect', exact: true }).click();
        await verifyOrder();
        await page.screenshot({ path: `artifacts/word-roots-${provider}-saved.png` });
        console.log(`PASS: ${provider} new card, stored/reopened card, English→roots→Chinese order, no-root hiding, mobile layout.`);
    }
    await page.unroute(source + '/rest/v1/vocabulary**');
    await page.unroute(source + '/v1/chat/completions');
    await page.unroute('https://generativelanguage.googleapis.com/**');
}
