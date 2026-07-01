import { createClient } from '@supabase/supabase-js';
import { electronFetch } from './electronFetch';
import { getSupabaseRuntimeConfig } from './runtimeConfig';

const AUDIO_BUCKET = 'audio-files';

let cachedClient = null;
let cachedSignature = '';

export function isSupabaseConfigured() {
    return getSupabaseRuntimeConfig().isConfigured;
}

function createSupabaseClient(url, anonKey) {
    return createClient(url, anonKey, {
        global: {
            fetch: electronFetch,
        },
    });
}

function getSupabaseClient() {
    const config = getSupabaseRuntimeConfig();
    if (!config.isConfigured) {
        throw new Error('Supabase is not configured. Open Settings and fill in Supabase URL and anon key.');
    }

    const signature = `${config.url}|${config.anonKey}`;
    if (!cachedClient || cachedSignature !== signature) {
        cachedClient = createSupabaseClient(config.url, config.anonKey);
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
        .from(AUDIO_BUCKET)
        .upload(filePath, file);

    if (error) {
        throw new Error(`Supabase Storage upload failed: ${formatSupabaseError(error)}`);
    }

    const { data: { publicUrl } } = client.storage
        .from(AUDIO_BUCKET)
        .getPublicUrl(filePath);

    return publicUrl;
}

export async function testSupabaseConnection({ supabaseUrl, supabaseAnonKey }) {
    const url = supabaseUrl?.trim();
    const anonKey = supabaseAnonKey?.trim();

    if (!url || !anonKey) {
        return {
            ok: false,
            checks: [{
                name: 'Configuration',
                ok: false,
                message: 'Supabase URL and anon key are required.',
            }],
        };
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch {
        return {
            ok: false,
            checks: [{
                name: 'Configuration',
                ok: false,
                message: 'Supabase URL is not a valid URL.',
            }],
        };
    }

    if (!parsedUrl.hostname.endsWith('.supabase.co') && !parsedUrl.hostname.includes('localhost')) {
        return {
            ok: false,
            checks: [{
                name: 'Configuration',
                ok: false,
                message: 'Supabase URL should look like https://your-project.supabase.co.',
            }],
        };
    }

    const client = createSupabaseClient(url, anonKey);
    const checks = [];
    let testFilePath = null;
    let uploadedTestFilePath = null;
    let publicUrl = null;
    let testPodcastId = null;

    const addCheck = async (name, action) => {
        try {
            const result = await action();
            checks.push({ name, ok: true, message: result?.message || 'OK' });
            return result;
        } catch (error) {
            checks.push({ name, ok: false, message: formatSupabaseError(error) });
            return null;
        }
    };

    await addCheck('Database tables', async () => {
        const tables = ['podcasts', 'transcripts', 'vocabulary'];
        for (const table of tables) {
            const { error } = await client
                .from(table)
                .select('*', { count: 'exact', head: true });
            if (error) {
                throw new Error(`${table}: ${formatSupabaseError(error)}`);
            }
        }
        return { message: 'Can read podcasts, transcripts, and vocabulary.' };
    });

    await addCheck('Folder column', async () => {
        const { error } = await client
            .from('podcasts')
            .select('folder', { count: 'exact', head: true });
        if (error) throw error;
        return { message: 'podcasts.folder is available for library grouping.' };
    });

    await addCheck('Storage bucket', async () => {
        testFilePath = `connection-test-${Date.now()}.txt`;
        const file = new Blob(['podfluent connection test'], { type: 'text/plain' });
        const { error } = await client.storage
            .from(AUDIO_BUCKET)
            .upload(testFilePath, file, {
                contentType: 'text/plain',
                upsert: false,
            });
        if (error) throw error;
        uploadedTestFilePath = testFilePath;
        publicUrl = client.storage.from(AUDIO_BUCKET).getPublicUrl(testFilePath).data.publicUrl;
        return { message: `Can upload to ${AUDIO_BUCKET}.` };
    });

    await addCheck('Public file URL', async () => {
        if (!publicUrl) throw new Error('Skipped because Storage bucket upload failed. Fix the Storage bucket check first.');
        const response = await electronFetch(publicUrl, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Public file returned HTTP ${response.status}. Make sure ${AUDIO_BUCKET} is public.`);
        }
        return { message: 'Uploaded files are publicly readable.' };
    });

    await addCheck('Podcast insert', async () => {
        if (!publicUrl) throw new Error('Storage upload did not produce a public URL.');
        const { data, error } = await client
            .from('podcasts')
            .insert({
                title: 'podfluent-connection-test.mp3',
                status: 'PENDING',
                audio_url: publicUrl,
                progress: 'Connection test',
            })
            .select('id')
            .single();
        if (error) throw error;
        testPodcastId = data.id;
        return { message: 'Can insert into the podcasts table.' };
    });

    await addCheck('Cleanup', async () => {
        const cleanupErrors = [];

        if (testPodcastId) {
            const { error } = await client
                .from('podcasts')
                .delete()
                .eq('id', testPodcastId);
            if (error) cleanupErrors.push(error);
        }

        if (uploadedTestFilePath) {
            const { error } = await client.storage
                .from(AUDIO_BUCKET)
                .remove([uploadedTestFilePath]);
            if (error) cleanupErrors.push(error);
        }

        if (cleanupErrors.length > 0) throw cleanupErrors[0];
        return { message: 'Test data was cleaned up.' };
    });

    return {
        ok: checks.every((check) => check.ok),
        checks,
    };
}

export function formatSupabaseError(error) {
    const message = [
        error?.message,
        error?.details,
        error?.hint,
        error?.code,
        error?.statusCode,
        error?.status,
    ].filter(Boolean).join(' ');

    const normalized = message.toLowerCase();

    if (!message) {
        return 'Unknown Supabase error.';
    }

    if (
        message.startsWith('Cannot reach Supabase.') ||
        message.startsWith('Supabase Storage upload failed:') ||
        message.startsWith('Supabase podcast insert failed:') ||
        message.startsWith('Supabase anon key is invalid') ||
        message.startsWith('Supabase RLS policy blocked') ||
        message.startsWith('Supabase database schema is missing') ||
        message.startsWith(`Supabase Storage bucket "${AUDIO_BUCKET}"`)
    ) {
        return message;
    }

    if (
        normalized.includes('fetch failed') ||
        normalized.includes('failed to fetch') ||
        normalized.includes('networkerror') ||
        normalized.includes('enotfound') ||
        normalized.includes('getaddrinfo')
    ) {
        return `Cannot reach Supabase. Check the Supabase URL, DNS, proxy, and network. Details: ${message}`;
    }

    if (
        normalized.includes('invalid api key') ||
        normalized.includes('jwt') ||
        normalized.includes('apikey') ||
        normalized.includes('401') ||
        normalized.includes('403')
    ) {
        return `Supabase anon key is invalid or not allowed. Details: ${message}`;
    }

    if (
        normalized.includes('bucket not found') ||
        normalized.includes(AUDIO_BUCKET)
    ) {
        return `Supabase Storage bucket "${AUDIO_BUCKET}" is missing or blocked by policy. Run docs/supabase-schema.sql and check Storage policies. Details: ${message}`;
    }

    if (
        normalized.includes('row-level security') ||
        normalized.includes('permission denied') ||
        normalized.includes('violates row-level security')
    ) {
        return `Supabase RLS policy blocked this operation. Run docs/supabase-schema.sql or update policies. Details: ${message}`;
    }

    if (
        normalized.includes('relation') ||
        normalized.includes('does not exist') ||
        normalized.includes('schema cache')
    ) {
        return `Supabase database schema is missing or stale. Run docs/supabase-schema.sql. Details: ${message}`;
    }

    return message;
}
