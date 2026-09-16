import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), gemini: vi.fn(), openai: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('../lib/gemini', () => ({ GeminiService: class { generateVocabCard(...args) { return mocks.gemini(...args); } } }));
vi.mock('../lib/openaiVocab', () => ({ OpenAIVocabService: class { generateVocabCard(...args) { return mocks.openai(...args); } } }));
import { VocabService } from './vocab';

afterEach(() => vi.resetAllMocks());
const generated = { word: 'inspect', definition: 'Examine something carefully.', roots: [
    { root: 'spect', meaning: '看', examples: [{ word: 'prospect', meaning: 'a future possibility' }, { word: 'retrospect', meaning: 'looking back' }] },
] };

describe('saved vocabulary roots', () => {
    it.each(['gemini', 'openai'])('persists and displays roots from %s including schema fallback', async provider => {
        const inserts = [];
        const query = {
            select: () => query, eq: () => query,
            maybeSingle: async () => ({ data: null }),
            insert: data => { inserts.push(data); return query; },
            single: async () => inserts.length === 1
                ? { error: { message: 'Could not find column ipa' } }
                : { data: { id: 'new-card', ...inserts.at(-1) } },
        };
        mocks.from.mockReturnValue(query);
        mocks[provider].mockResolvedValue(generated);
        const result = await VocabService.createVocabCard('inspect', 'Inspect the engine.', 'episode', 'test-key', { provider, openaiApiKey: 'test-key' });
        expect(inserts).toHaveLength(2);
        expect(inserts[0].meaning).toContain('【词根拆解】');
        expect(inserts[1].meaning).toBe(inserts[0].meaning);
        expect(result.definition).toBe(inserts[1].meaning);
        expect(result.meaning).toBe(result.definition);
    });
    it('returns an existing card without regenerating or updating it', async () => {
        const old = { word: 'inspect', meaning: 'An old definition.' };
        const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: old }) };
        mocks.from.mockReturnValue(query);
        expect(await VocabService.createVocabCard('inspect', 'Inspect it.', 'episode', 'test-key')).toEqual(old);
        expect(mocks.gemini).not.toHaveBeenCalled();
        expect(mocks.openai).not.toHaveBeenCalled();
    });
});
