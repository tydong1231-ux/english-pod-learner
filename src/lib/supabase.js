import { createClient } from '@supabase/supabase-js';
import { getSupabaseRuntimeConfig } from './runtimeConfig';

let cachedClient = null;
let cachedSignature = '';

export function isSupabaseConfigured() {
    return getSupabaseRuntimeConfig().isConfigured;
}

function getSupabaseClient() {
    const config = getSupabaseRuntimeConfig();
    if (!config.isConfigured) {
        throw new Error('Supabase is not configured. Open Settings and fill in Supabase URL and anon key.');
    }

    const signature = `${config.url}|${config.anonKey}`;
    if (!cachedClient || cachedSignature !== signature) {
        cachedClient = createClient(config.url, config.anonKey);
        cachedSignature = signature;
    }

    return cachedClient;
}

export const supabase = new Proxy({}, {
    get(_target, prop) {
        const client = getSupabaseClient();
        const value = client[prop];
        return typeof value === 'function' ? value.bind(client) : value;
    },
});

export async function uploadAudio(file) {
    const client = getSupabaseClient();
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    const { error } = await client.storage
        .from('audio-files')
        .upload(filePath, file);

    if (error) {
        throw error;
    }

    const { data: { publicUrl } } = client.storage
        .from('audio-files')
        .getPublicUrl(filePath);

    return publicUrl;
}
