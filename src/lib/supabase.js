import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

function createMissingSupabaseClient() {
    return new Proxy({}, {
        get() {
            throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.');
        },
    });
}

export const supabase = isSupabaseConfigured
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : createMissingSupabaseClient();

export async function uploadAudio(file) {
    if (!isSupabaseConfigured) {
        throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.');
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    const { error } = await supabase.storage
        .from('audio-files')
        .upload(filePath, file);

    if (error) {
        throw error;
    }

    const { data: { publicUrl } } = supabase.storage
        .from('audio-files')
        .getPublicUrl(filePath);

    return publicUrl;
}
