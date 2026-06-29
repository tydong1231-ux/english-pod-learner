export class OpenAIVocabService {
    constructor({ apiKey, baseUrl, model }) {
        if (!apiKey) throw new Error('OpenAI API key is required');
        this.apiKey = apiKey;
        this.baseUrl = normalizeBaseUrl(baseUrl || 'https://api.openai.com/v1');
        this.model = model || 'gpt-4o-mini';
    }

    async generateVocabCard(word, contextSentence) {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                response_format: { type: 'json_object' },
                temperature: 0.2,
                messages: [
                    {
                        role: 'system',
                        content: 'You create concise English vocabulary cards. Return only strict JSON.',
                    },
                    {
                        role: 'user',
                        content: `Create a vocabulary card for "${word}" in this sentence: "${contextSentence}".

Return this exact JSON shape:
{
  "word": "string",
  "ipa": "string",
  "definition": "brief English definition",
  "translation": "Chinese translation",
  "examples": ["short example 1", "short example 2"],
  "originalSentence": "the input sentence"
}`,
                    },
                ],
            }),
        });

        if (!response.ok) {
            const detail = await response.text();
            throw new Error(`OpenAI-compatible API failed (${response.status}): ${detail.slice(0, 500)}`);
        }

        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content;
        if (!text) throw new Error('OpenAI-compatible API returned no message content');

        try {
            const parsed = JSON.parse(cleanJson(text));
            if (!parsed.definition && !parsed.meaning) {
                throw new Error('response missing definition');
            }
            return {
                ...parsed,
                word: parsed.word || word,
                originalSentence: parsed.originalSentence || contextSentence,
            };
        } catch (error) {
            throw new Error(`Could not parse OpenAI-compatible response: ${error.message}`);
        }
    }
}

function normalizeBaseUrl(baseUrl) {
    let trimmed = baseUrl.trim().replace(/\/+$/, '');
    if (trimmed.endsWith('/chat/completions')) {
        trimmed = trimmed.slice(0, -'/chat/completions'.length).replace(/\/+$/, '');
    }
    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function cleanJson(text) {
    return text
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '');
}
