import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VocabularyDefinition } from '../components/VocabularyDefinition';
import { normalizeRoots, vocabularyMeaning, vocabularyPrompt } from './vocabularyRoots';

const root = { root: 'spect', meaning: '看', examples: [
    { word: 'prospect', meaning: 'a future possibility' },
    { word: 'retrospect', meaning: 'looking back on events' },
] };
const card = { word: 'inspect', definition: 'Examine something carefully.', roots: [root] };
const render = text => renderToStaticMarkup(<VocabularyDefinition text={text} />);

describe('vocabulary root contract and display', () => {
    it('asks both providers for structured roots separate from English', () => {
        const prompt = vocabularyPrompt('inspect', 'Inspect the engine.');
        expect(prompt).toContain('"roots":[{"root"');
        expect(prompt).toContain('exactly two distinct words');
        expect(prompt).toContain('Keep definition English-only');
        expect(prompt).toContain('Use []');
    });
    it('round-trips roots through the existing meaning column', () => {
        const meaning = vocabularyMeaning(card);
        const stored = JSON.parse(JSON.stringify({ meaning }));
        const html = render(stored.meaning);
        expect(html).toContain('aria-label="词根拆解"');
        expect(html).not.toContain('<h4');
        expect(html).toContain('spect (看)');
        expect(html).toContain('prospect (a future possibility)');
        expect(html).toContain('retrospect (looking back on events)');
        expect(html.indexOf(card.definition)).toBeLessThan(html.indexOf('<section'));
        expect(render(meaning)).toBe(html);
    });
    it.each([undefined, [], null, 'not-an-array'])('hides absent roots (%s)', roots => {
        expect(render(vocabularyMeaning({ ...card, roots }))).not.toContain('<section');
    });
    it('leaves old cards untouched and recognizes the previous marker', () => {
        expect(vocabularyMeaning({ meaning: card.definition })).toBe(card.definition);
        const legacy = `${card.definition} 【词根拆解】 ① spect (看): prospect (future possibility); retrospect (looking back)`;
        expect(vocabularyMeaning({ meaning: legacy })).toBe(legacy);
        expect(render(legacy)).toContain('aria-label="词根拆解"');
        expect(render(`${card.definition} 【词根拆解】`)).not.toContain('<section');
    });
    it('rejects incomplete, duplicate, and target-word examples', () => {
        expect(normalizeRoots([null, {}, { ...root, examples: [] }])).toEqual([]);
        expect(normalizeRoots([{ ...root, examples: [root.examples[0], root.examples[0]] }])).toEqual([]);
        expect(normalizeRoots([root], 'prospect')).toEqual([]);
        expect(normalizeRoots([root, root])).toHaveLength(1);
    });
    it('caps roots and examples and renders model strings as text, not HTML', () => {
        const roots = [root, { ...root, root: 'other' }, { ...root, root: 'third' }];
        expect(normalizeRoots(roots)).toHaveLength(2);
        expect(normalizeRoots([{ ...root, examples: [...root.examples, { word: 'extra', meaning: 'extra example' }] }])[0].examples).toHaveLength(2);
        expect(render(vocabularyMeaning({ ...card, definition: '<img src=x onerror=alert(1)>' }))).not.toContain('<img');
    });
});
