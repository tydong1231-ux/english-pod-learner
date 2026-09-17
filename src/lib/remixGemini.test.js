import { describe, expect, it } from 'vitest';
import { containsWholePhrase, isExcludedPhrase, validateExercise } from './remixOpenAI';

function exercise(phrase, overrides = {}) {
    return {
        phrase,
        meaning: 'meaning',
        question: 'What did you learn?',
        examples: [
            { sentence: `${phrase} helped us understand the issue.`, usedVocabulary: [], usedRemixPhrases: [] },
            { sentence: `${phrase} changed our product decision.`, usedVocabulary: [], usedRemixPhrases: [] },
            { sentence: `${phrase} was useful in daily life.`, usedVocabulary: [], usedRemixPhrases: [] },
        ],
        noAlternative: false,
        ...overrides,
    };
}

describe('Remix phrase validation', () => {
    it('treats straight and typographic apostrophes as the same phrase', () => {
        expect(containsWholePhrase('I wouldn’t necessarily say that.', "I wouldn't necessarily say that")).toBe(true);
        expect(isExcludedPhrase("I wouldn't necessarily say that", ['I wouldn’t necessarily say that'])).toBe(true);
    });

    it('requires whole-word phrase matches in the source', () => {
        expect(containsWholePhrase('AI accounting products are evolving quickly.', 'accounting')).toBe(true);
        expect(containsWholePhrase('AI accounting products are evolving quickly.', 'count')).toBe(false);
        expect(() => validateExercise(exercise('count'), 'AI accounting products are evolving quickly.')).toThrow('not in the source sentence');
    });

    it('rejects a phrase already shown in the current Remix session', () => {
        expect(isExcludedPhrase('What we found was that', ['what we found was that'])).toBe(true);
        expect(() => validateExercise(
            exercise('What we found was that'),
            'What we found was that users needed simpler onboarding.',
            ['what we found was that'],
        )).toThrow('repeated an excluded Remix phrase');
    });

    it('does not count the target phrase itself as a reused Remix phrase', () => {
        const value = exercise('what we found was that', {
            examples: [
                {
                    sentence: 'What we found was that onboarding mattered more than pricing.',
                    usedVocabulary: ['onboarding'],
                    usedRemixPhrases: ['what we found was that', 'it comes down to'],
                },
                { sentence: 'What we found was that the workflow was too complex.', usedVocabulary: [], usedRemixPhrases: [] },
                { sentence: 'What we found was that users wanted faster setup.', usedVocabulary: [], usedRemixPhrases: [] },
            ],
        });
        const result = validateExercise(value, 'What we found was that users needed simpler onboarding.');
        expect(result.examples[0].usedRemixPhrases).toEqual(['it comes down to']);
    });
});
