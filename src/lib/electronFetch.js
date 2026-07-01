import { isElectronRenderer } from './env';

export async function electronFetch(input, init = {}) {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) {
        return fetch(input, init);
    }

    const request = await serializeRequest(input, init);
    const result = await ipcRenderer.invoke('http-fetch', request);

    if (!result?.ok) {
        throw new TypeError(result?.error || 'Electron HTTP request failed');
    }

    const body = result.bodyBase64
        ? base64ToUint8Array(result.bodyBase64)
        : null;

    return new Response(body, {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers || {},
    });
}

function getIpcRenderer() {
    if (!isElectronRenderer) return null;

    try {
        return window.require?.('electron')?.ipcRenderer || null;
    } catch {
        return null;
    }
}

async function serializeRequest(input, init = {}) {
    const inputRequest = input instanceof Request ? input : null;
    const url = inputRequest ? inputRequest.url : String(input);
    const method = init.method || inputRequest?.method || 'GET';
    const headers = {
        ...headersToPlainObject(inputRequest?.headers),
        ...headersToPlainObject(init.headers),
    };
    const canHaveBody = !['GET', 'HEAD'].includes(method.toUpperCase());
    const body = init.body !== undefined
        ? init.body
        : inputRequest?.body && canHaveBody
            ? await inputRequest.clone().arrayBuffer()
            : undefined;
    const serializedBody = await serializeBody(body);

    if (serializedBody?.contentType && !hasHeader(headers, 'content-type')) {
        headers['content-type'] = serializedBody.contentType;
    }

    return {
        url,
        method,
        headers,
        body: serializedBody,
    };
}

function headersToPlainObject(headers) {
    if (!headers) return {};

    const output = {};
    new Headers(headers).forEach((value, key) => {
        output[key] = value;
    });
    return output;
}

async function serializeBody(body) {
    if (body === undefined || body === null) return null;

    if (typeof body === 'string') {
        return { type: 'text', value: body };
    }

    if (body instanceof URLSearchParams) {
        return {
            type: 'text',
            value: body.toString(),
            contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
        };
    }

    if (body instanceof Blob) {
        return {
            type: 'base64',
            value: arrayBufferToBase64(await body.arrayBuffer()),
            contentType: body.type || undefined,
        };
    }

    if (body instanceof ArrayBuffer) {
        return {
            type: 'base64',
            value: arrayBufferToBase64(body),
        };
    }

    if (ArrayBuffer.isView(body)) {
        return {
            type: 'base64',
            value: arrayBufferToBase64(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
        };
    }

    if (body instanceof FormData) {
        // Use the native Response object to serialize FormData to a Blob
        // This automatically generates the multipart boundary and payload
        const res = new Response(body);
        const blob = await res.blob();
        return {
            type: 'base64',
            value: arrayBufferToBase64(await blob.arrayBuffer()),
            contentType: blob.type || 'multipart/form-data',
        };
    }

    throw new TypeError(`Unsupported request body type for Electron fetch proxy: ${body.constructor?.name || typeof body}`);
}

function hasHeader(headers, name) {
    const normalized = name.toLowerCase();
    return Object.keys(headers).some((key) => key.toLowerCase() === normalized);
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }

    return btoa(binary);
}

function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}
