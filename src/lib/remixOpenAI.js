import { OpenAIVocabService } from './openaiVocab';

const REMIX_SYSTEM_PROMPT = 'Create natural English speaking practice. Return JSON only and follow the requested schema exactly.';

export class RemixOpenAI {
    constructor({ apiKey, baseUrl, model }) {
        this.client = new OpenAIVocabService({ apiKey, baseUrl, model });
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
        const parsed = await this.generateJson(`Source sentence: ${JSON.stringify(sourceSentence)}
Excluded phrases: ${JSON.stringify(excludedPhrases)}
Vocabulary candidates: ${JSON.stringify(vocabulary)}
Previous Remix phrase candidates: ${JSON.stringify(previousPhrases)}
Target phrase (keep exactly): ${JSON.stringify(targetPhrase)}

Return {"phrase":"","meaning":"","question":"","examples":[{"sentence":"","usedVocabulary":[],"usedRemixPhrases":[]},{"sentence":"","usedVocabulary":[],"usedRemixPhrases":[]},{"sentence":"","usedVocabulary":[],"usedRemixPhrases":[]}],"noAlternative":false}.
Rules: phrase must equal Target phrase exactly. Question: one short specific open question for a 20–60 second answer; topic priority AI accounting/product management > work/job > daily life. Examples: exactly 3 natural complete sentences, all using Target phrase; when natural, at least 2 use vocabulary candidates and at least 1 uses a previous Remix phrase. Meaning: one brief plain-English explanation. Never force awkward combinations.`);

        const result = validateExercise(parsed, sourceSentence, excludedPhrases);
        if (result.noAlternative || !isExcludedPhrase(result.phrase, [targetPhrase])) {
            throw new Error('Remix provider changed the selected phrase');
        }
        return result;
    }

    async regenerateQuestion({ phrase, sourceSentence, previousQuestion }) {
        const parsed = await this.generateJson(`Target phrase: ${JSON.stringify(phrase)}
Source sentence: ${JSON.stringify(sourceSentence)}
Previous question: ${JSON.stringify(previousQuestion || '')}
Return {"question":""}.
Generate one new specific open question that naturally invites the target phrase. Topic priority: AI accounting/product management > work/job > daily life. Support a 20–60 second spoken answer. Do not repeat or lightly paraphrase the previous question.`);
        const question = typeof parsed?.question === 'string' ? parsed.question.trim() : '';
        if (!question) throw new Error('Remix provider returned an empty question');
        return question;
    }

    async generateJson(prompt) {
        try {
            const data = await this.client.createChatCompletion({
                temperature: 0.2,
                max_tokens: 4096,
                messages: [
                    { role: 'system', content: REMIX_SYSTEM_PROMPT },
                    { role: 'user', content: prompt },
                ],
            });
            const text = extractMessageContent(data);
            if (!text) throw new Error('provider returned no message content');
            return parseJsonFromModelText(text);
        } catch (error) {
            throw new Error(`OpenAI-compatible Remix error: ${error.message}`);
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
        throw new Error('Remix provider returned an incomplete exercise');
    }

    validatePhrase(phrase, sourceSentence, excludedPhrases);

    if (examples.some((example) => !containsWholePhrase(example.sentence, phrase))) {
        throw new Error('Remix provider returned an example without the target phrase');
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
    if (isExcludedPhrase(phrase, excludedPhrases)) throw new Error('Remix provider repeated an excluded Remix phrase');
    if (!containsWholePhrase(sourceSentence, phrase)) throw new Error('Remix provider selected a phrase that is not in the source sentence');
}

function extractMessageContent(data) {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map((item) => typeof item === 'string' ? item : item?.text || item?.content || '').join('');
    }
    if (content && typeof content === 'object') return JSON.stringify(content);
    return '';
}

function parseJsonFromModelText(text) {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const cleaned = fenced ? fenced[1].trim() : trimmed;
    try {
        return JSON.parse(cleaned);
    } catch {
        const objectMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!objectMatch) throw new Error('response was not JSON');
        return JSON.parse(objectMatch[0]);
    }
}
