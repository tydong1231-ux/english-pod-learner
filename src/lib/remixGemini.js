import { GoogleGenerativeAI } from '@google/generative-ai';

const REMIX_SYSTEM_PROMPT = 'Create natural English speaking practice. Return JSON only and follow the requested schema exactly.';

export class RemixGemini {
    constructor(apiKey, modelName = 'gemini-2.0-flash-exp') {
        if (!apiKey) throw new Error('Gemini API key is required for Remix');

        const genAI = new GoogleGenerativeAI(apiKey);
        this.model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: REMIX_SYSTEM_PROMPT,
            generationConfig: {
                responseMimeType: 'application/json',
                maxOutputTokens: 4096,
            },
        });
    }

    async selectPhrase({ sourceSentence, excludedPhrases = [] }) {
        const parsed = await this.generateJson(`Source sentence: ${JSON.stringify(sourceSentence)}
Excluded phrases: ${JSON.stringify(excludedPhrases)}
Return {"phrase":"","noAlternative":false}.
Choose ONE best reusable spoken-English chunk directly from the source, usually 2–10 words. Prefer versatile chunks or sentence structures; avoid proper nouns, numbers, context-specific wording and isolated basic words. Never choose an excluded phrase. If no meaningful choice remains, return {"phrase":"","noAlternative":true}.`);
        if (parsed?.noAlternative === true) return { noAlternative: true };
        const phrase = typeof parsed?.phrase === 'string' ? parsed.phrase.trim() : '';
        validatePhrase(phrase, sourceSentence, excludedPhrases);
        return { phrase, noAlternative: false };
    }

    async generateExercise({ sourceSentence, targetPhrase, excludedPhrases = [], vocabulary = [], previousPhrases = [] }) {
        const prompt = `
Source sentence: ${JSON.stringify(sourceSentence)}
Excluded phrases: ${JSON.stringify(excludedPhrases)}
Vocabulary candidates: ${JSON.stringify(vocabulary)}
Previous Remix phrase candidates: ${JSON.stringify(previousPhrases)}
${targetPhrase ? `Target phrase (keep exactly): ${JSON.stringify(targetPhrase)}` : ''}

Return:
{
  "phrase": "",
  "meaning": "",
  "question": "",
  "examples": [
    {"sentence":"","usedVocabulary":[],"usedRemixPhrases":[]},
    {"sentence":"","usedVocabulary":[],"usedRemixPhrases":[]},
    {"sentence":"","usedVocabulary":[],"usedRemixPhrases":[]}
  ],
  "noAlternative": false
}

Rules:
1. phrase: ${targetPhrase ? 'copy Target phrase exactly; do not select another phrase.' : 'copy the single most useful reusable spoken-English phrase from Source, usually 2-10 words. Never choose an excluded phrase. If none remains, set phrase="" and noAlternative=true.'}
2. question: one short, specific, open-ended question that naturally invites a 20-60 second spoken answer using the phrase, without giving the answer. Topic priority: AI accounting/product management > work/job > daily life; do not force an accounting topic.
3. examples: exactly 3 natural, complete sentences; all must use the target phrase. When natural, at least 2 use vocabulary candidates and at least 1 also uses a previous Remix phrase. Never force awkward combinations.
4. meaning: one brief plain-English explanation.
`;

        const parsed = await this.generateJson(prompt);
        const result = validateExercise(parsed, sourceSentence, excludedPhrases);
        if (targetPhrase && (result.noAlternative || !isExcludedPhrase(result.phrase, [targetPhrase]))) {
            throw new Error('Gemini changed the selected Remix phrase');
        }
        return result;
    }

    async regenerateQuestion({ phrase, sourceSentence, previousQuestion }) {
        const prompt = `
Target phrase: ${JSON.stringify(phrase)}
Source sentence: ${JSON.stringify(sourceSentence)}
Previous question: ${JSON.stringify(previousQuestion || '')}

Return: {"question":""}

Generate one new specific open question that naturally invites the target phrase. Topic priority: AI accounting/product management > work/job > daily life. It should support a 20-60 second spoken answer. Do not repeat or lightly paraphrase the previous question.
`;

        const parsed = await this.generateJson(prompt);
        const question = typeof parsed?.question === 'string' ? parsed.question.trim() : '';
        if (!question) throw new Error('Gemini returned an empty Remix question');
        return question;
    }

    async generateJson(prompt) {
        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();
            try {
                return JSON.parse(text);
            } catch {
                return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
            }
        } catch (error) {
            throw new Error(`Gemini Remix error: ${error.message}`);
        }
    }
}

export function validateExercise(value, sourceSentence, excludedPhrases = []) {
    if (value?.noAlternative === true) {
        return { noAlternative: true, phrase: '', meaning: '', question: '', examples: [] };
    }

    const phrase = typeof value?.phrase === 'string' ? value.phrase.trim() : '';
    const meaning = typeof value?.meaning === 'string' ? value.meaning.trim() : '';
    const question = typeof value?.question === 'string' ? value.question.trim() : '';
    const examples = Array.isArray(value?.examples)
        ? value.examples.slice(0, 3).map(normalizeExample).filter(Boolean)
        : [];

    if (!phrase || !question || examples.length !== 3) {
        throw new Error('Gemini returned an incomplete Remix exercise');
    }

    validatePhrase(phrase, sourceSentence, excludedPhrases);

    if (examples.some((example) => !containsWholePhrase(example.sentence, phrase))) {
        throw new Error('Gemini returned an example without the target phrase');
    }

    const phraseKey = normalizeText(phrase);
    const sanitizedExamples = examples.map((example) => ({
        ...example,
        usedRemixPhrases: example.usedRemixPhrases.filter((candidate) => normalizeText(candidate) !== phraseKey),
    }));

    return { phrase, meaning, question, examples: sanitizedExamples, noAlternative: false };
}

function normalizeExample(value) {
    if (typeof value === 'string') {
        const sentence = value.trim();
        return sentence ? { sentence, usedVocabulary: [], usedRemixPhrases: [] } : null;
    }

    const sentence = typeof value?.sentence === 'string' ? value.sentence.trim() : '';
    if (!sentence) return null;

    return {
        sentence,
        usedVocabulary: normalizeStringArray(value.usedVocabulary),
        usedRemixPhrases: normalizeStringArray(value.usedRemixPhrases),
    };
}

function normalizeStringArray(value) {
    return Array.isArray(value)
        ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
        : [];
}

export function containsWholePhrase(text, phrase) {
    const textTokens = tokenize(text);
    const phraseTokens = tokenize(phrase);
    if (phraseTokens.length === 0 || phraseTokens.length > textTokens.length) return false;

    for (let i = 0; i <= textTokens.length - phraseTokens.length; i += 1) {
        let matches = true;
        for (let j = 0; j < phraseTokens.length; j += 1) {
            if (textTokens[i + j] !== phraseTokens[j]) {
                matches = false;
                break;
            }
        }
        if (matches) return true;
    }

    return false;
}

export function isExcludedPhrase(phrase, excludedPhrases = []) {
    const phraseKey = normalizeText(phrase);
    return excludedPhrases.some((candidate) => normalizeText(candidate) === phraseKey);
}

function tokenize(value) {
    const normalized = normalizeText(value);
    return normalized ? normalized.split(' ') : [];
}

function normalizeText(value) {
    return String(value || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9']+/g, ' ').trim();
}

function validatePhrase(phrase, sourceSentence, excludedPhrases) {
    if (isExcludedPhrase(phrase, excludedPhrases)) throw new Error('Gemini repeated an excluded Remix phrase');
    if (!containsWholePhrase(sourceSentence, phrase)) throw new Error('Gemini selected a phrase that is not in the source sentence');
}
