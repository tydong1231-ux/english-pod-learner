import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ response: null, queue: [], prompts: [], writes: [], previous: [], dbError: null }));
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class {
    getGenerativeModel() { return { generateContent: async prompt => { mock.prompts.push(prompt); const response = mock.queue.length ? mock.queue.shift() : mock.response; return { response: { text: () => JSON.stringify(response) } }; } }; }
} }));
vi.mock('./supabase', () => ({ isSupabaseConfigured: () => true, supabase: { from: table => {
    const query = { select: () => query, order: () => query, limit: () => query, eq: () => query,
        maybeSingle: async () => ({ data: null, error: mock.dbError }),
        upsert: payload => { mock.writes.push(payload); return query; },
        single: async () => ({ data: { id: 'one', ...mock.writes.at(-1) } }),
        then: resolve => resolve({ data: table === 'vocabulary' ? [{ word: 'migration' }] : mock.previous.map(phrase => ({ phrase })) }),
    }; return query;
} } }));
import { RemixGemini } from './remixGemini';
import { RemixService } from '../services/remix';
const phrase = 'what we found was that';
const sentence = 'What we found was that it really comes down to trust.';
const exercise = target => ({ phrase: target, meaning: 'Introduce a finding', question: 'What did customer research teach you?', examples: [1, 2, 3].map(n => ({ sentence: `${target} migration mattered to team ${n}.`, usedVocabulary: ['migration'], usedRemixPhrases: [] })), noAlternative: false });
beforeEach(() => { mock.response = exercise(phrase); mock.queue = []; mock.prompts = []; mock.writes = []; mock.previous = []; mock.dbError = null; });
it('accepts a valid exercise and saves one source-scoped record', async () => {
    const item = await RemixService.generate({ sourcePodcastId: 'podcast', sourceSegmentIndex: 0, segment: { text: sentence }, apiKey: 'fake' });
    expect(item.phrase).toBe(phrase);
    expect(mock.writes).toHaveLength(1);
});
it('does not save noAlternative responses', async () => {
    mock.response = { noAlternative: true };
    await RemixService.generate({ sourcePodcastId: 'podcast', sourceSegmentIndex: 0, segment: { text: sentence }, apiKey: 'fake' });
    expect(mock.writes).toHaveLength(0);
});
it('REQUIREMENT: rejects a previously shown phrase returned by Gemini', async () => {
    await expect(new RemixGemini('fake').generateExercise({ sourceSentence: sentence, excludedPhrases: [phrase] })).rejects.toThrow();
});
it('REQUIREMENT: excludes the current target from previous-phrase candidates', async () => {
    mock.previous = [phrase];
    await RemixService.generate({ sourcePodcastId: 'new-podcast', sourceSegmentIndex: 0, segment: { text: sentence }, apiKey: 'fake' });
    const candidates = JSON.parse(mock.prompts.at(-1).match(/Previous Remix phrase candidates: (.*)/)[1]);
    expect(candidates).not.toContain(phrase);
});
it('REQUIREMENT: rejects a phrase which is only a substring of a source word', async () => {
    mock.response = exercise('count');
    await expect(new RemixGemini('fake').generateExercise({ sourceSentence: 'The accounting software is reliable.' })).rejects.toThrow();
});

const generate = excludedPhrases => RemixService.generate({ sourcePodcastId: 'podcast', sourceSegmentIndex: 0, segment: { text: sentence }, apiKey: 'fake', excludedPhrases });
it('retries a repeated selection once and only saves the valid alternative', async () => {
    const alternative = 'it really comes down to';
    mock.queue = [exercise(phrase), exercise(alternative), exercise(alternative)];
    const result = await generate([phrase]);
    expect(mock.prompts).toHaveLength(3);
    expect(mock.writes).toHaveLength(1);
    expect(result.phrase).toBe(alternative);
});
it('stops after two repeated selections without overwriting the saved record', async () => {
    await expect(generate([phrase])).rejects.toThrow('repeated an excluded');
    expect(mock.prompts).toHaveLength(2);
    expect(mock.writes).toHaveLength(0);
});
it('does not save an exercise that changes the preselected target', async () => {
    mock.queue = [exercise(phrase), exercise('it really comes down to')];
    await expect(generate([])).rejects.toThrow('changed the selected');
    expect(mock.writes).toHaveLength(0);
});
it('reports PGRST205 clearly without AI generation or writes', async () => {
    mock.dbError = { code: 'PGRST205', message: 'Not found' };
    await expect(RemixService.getBySource('podcast', 0)).rejects.toThrow('Remix database table is missing');
    expect(mock.prompts).toHaveLength(0);
    expect(mock.writes).toHaveLength(0);
});
