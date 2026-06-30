import { isElectronRenderer } from './env';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

export class OpenAIVocabService {
    constructor({ apiKey, baseUrl, model }) {
        if (!apiKey?.trim()) throw new Error('OpenAI-compatible API key is required');
        this.apiKey = apiKey.trim();
        this.baseUrl = normalizeBaseUrl(baseUrl || DEFAULT_BASE_URL);
        this.model = model?.trim() || DEFAULT_MODEL;
    }

    async generateVocabCard(word, contextSentence) {
        const data = await this.createChatCompletion({
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
        });
        const text = extractMessageContent(data);
        if (!text) throw new Error('OpenAI-compatible API returned no message content');

        try {
            const parsed = parseJsonFromModelText(text);
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

    async testConnection() {
        const data = await this.createChatCompletion({
            temperature: 0,
            max_tokens: 80,
            messages: [
                {
                    role: 'system',
                    content: 'Return only strict JSON.',
                },
                {
                    role: 'user',
                    content: 'Return {"ok":true,"message":"vocabulary provider ready"}.',
                },
            ],
        });
        const text = extractMessageContent(data);
        if (!text) throw new Error('Provider returned no message content');

        return {
            ok: true,
            baseUrl: this.baseUrl,
            model: this.model,
            preview: text.trim().slice(0, 160),
        };
    }

    async createChatCompletion(payload) {
        const requestWithJsonMode = {
            ...payload,
            model: this.model,
            response_format: { type: 'json_object' },
        };

        try {
            return await requestChatCompletion({
                endpoint: `${this.baseUrl}/chat/completions`,
                apiKey: this.apiKey,
                payload: requestWithJsonMode,
            });
        } catch (error) {
            if (!shouldRetryWithoutJsonMode(error)) {
                throw error;
            }

            const requestWithoutJsonMode = {
                ...payload,
                model: this.model,
            };
            return requestChatCompletion({
                endpoint: `${this.baseUrl}/chat/completions`,
                apiKey: this.apiKey,
                payload: requestWithoutJsonMode,
            });
        }
    }
}

export async function testOpenAICompatibleConfig(config) {
    const service = new OpenAIVocabService(config);
    return service.testConnection();
}

export function normalizeBaseUrl(baseUrl) {
    let trimmed = baseUrl.trim().replace(/\/+$/, '');
    if (trimmed.endsWith('/chat/completions')) {
        trimmed = trimmed.slice(0, -'/chat/completions'.length).replace(/\/+$/, '');
    }

    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error('OpenAI-compatible Base URL is not a valid URL');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('OpenAI-compatible Base URL must start with http:// or https://');
    }

    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (parsed.hostname === 'api.openai.com' && (!pathname || pathname === '')) {
        return `${parsed.origin}/v1`;
    }

    return trimmed;
}

async function requestChatCompletion({ endpoint, apiKey, payload }) {
    if (isElectronRenderer) {
        const ipcResponse = await requestViaElectron(endpoint, apiKey, payload);
        if (ipcResponse) return ipcResponse;
    }

    let response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(payload),
        });
    } catch (error) {
        throw new OpenAIProviderError(
            `Cannot reach OpenAI-compatible provider. Check Base URL, proxy, and network. Details: ${error.message}`,
            { status: 0, detail: error.message }
        );
    }

    const body = await response.text();
    if (!response.ok) {
        throw buildProviderError(response.status, response.statusText, body);
    }

    try {
        return JSON.parse(body);
    } catch {
        throw new OpenAIProviderError(`Provider returned non-JSON response: ${body.slice(0, 500)}`, {
            status: 502,
            detail: body,
        });
    }
}

async function requestViaElectron(endpoint, apiKey, payload) {
    try {
        const ipcRenderer = window.require?.('electron')?.ipcRenderer;
        if (!ipcRenderer?.invoke) return null;

        const result = await ipcRenderer.invoke('openai-chat-completion', {
            endpoint,
            apiKey,
            payload,
        });

        if (result?.ok) return result.data;
        throw buildProviderError(result?.status, result?.statusText, result?.body);
    } catch (error) {
        if (isMissingIpcHandlerError(error)) {
            return null;
        }
        throw error;
    }
}

function buildProviderError(status = 0, statusText = '', body = '') {
    const detail = stringifyProviderBody(body).slice(0, 1000);
    const prefix = status ? `OpenAI-compatible API failed (${status}${statusText ? ` ${statusText}` : ''})` : 'OpenAI-compatible API request failed';
    const hint = getProviderHint(status, detail);
    return new OpenAIProviderError(`${prefix}: ${hint}${detail ? ` Details: ${detail}` : ''}`, {
        status,
        detail,
    });
}

function stringifyProviderBody(body) {
    if (!body) return '';
    if (typeof body !== 'string') return JSON.stringify(body);

    try {
        const parsed = JSON.parse(body);
        return parsed?.error?.message || parsed?.message || JSON.stringify(parsed);
    } catch {
        return body;
    }
}

function getProviderHint(status, detail) {
    const normalized = detail.toLowerCase();

    if (status === 401 || status === 403 || normalized.includes('invalid api key') || normalized.includes('unauthorized')) {
        return 'Token is invalid or does not have access to this provider/model.';
    }

    if (status === 404) {
        return 'Base URL or model name is probably wrong.';
    }

    if (status === 429) {
        return 'Provider rate limit or quota was reached.';
    }

    if (normalized.includes('response_format') || normalized.includes('json_object')) {
        return 'Provider does not support JSON mode; retrying without JSON mode failed.';
    }

    if (normalized.includes('model') && (normalized.includes('not found') || normalized.includes('does not exist'))) {
        return 'Model name is not available for this token/provider.';
    }

    if (status === 0) {
        return 'Network request failed.';
    }

    return 'Provider rejected the request.';
}

function shouldRetryWithoutJsonMode(error) {
    if (!(error instanceof OpenAIProviderError)) return false;
    if (![400, 422].includes(Number(error.status))) return false;

    const detail = `${error.detail || ''}`.toLowerCase();
    return detail.includes('response_format') ||
        detail.includes('json_object') ||
        detail.includes('json mode') ||
        detail.includes('extra_forbidden');
}

function extractMessageContent(data) {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((item) => {
                if (typeof item === 'string') return item;
                return item?.text || item?.content || '';
            })
            .join('');
    }
    if (content && typeof content === 'object') {
        return JSON.stringify(content);
    }
    return '';
}

function parseJsonFromModelText(text) {
    const cleaned = cleanJson(text);
    try {
        return JSON.parse(cleaned);
    } catch {
        const objectMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!objectMatch) throw new Error('response was not JSON');
        return JSON.parse(objectMatch[0]);
    }
}

function cleanJson(text) {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced ? fenced[1].trim() : trimmed;
}

function isMissingIpcHandlerError(error) {
    const message = `${error?.message || ''}`;
    return message.includes('No handler registered') || message.includes('Cannot read properties of undefined');
}

class OpenAIProviderError extends Error {
    constructor(message, { status, detail } = {}) {
        super(message);
        this.name = 'OpenAIProviderError';
        this.status = status;
        this.detail = detail;
    }
}
