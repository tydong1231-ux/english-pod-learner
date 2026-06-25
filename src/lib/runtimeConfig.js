const STORAGE_KEY = 'podfluent-runtime-config';
export const RUNTIME_CONFIG_CHANGED = 'podfluent-runtime-config-changed';

const envConfig = {
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    remoteAccessPassword: import.meta.env.VITE_REMOTE_ACCESS_PASSWORD || '',
    disableLocalEngine: import.meta.env.VITE_DISABLE_LOCAL_ENGINE === 'true',
};

export function getRuntimeConfig() {
    return {
        ...envConfig,
        ...readStoredRuntimeConfig(),
    };
}

export function saveRuntimeConfig(config) {
    const next = {
        supabaseUrl: config.supabaseUrl?.trim() || '',
        supabaseAnonKey: config.supabaseAnonKey?.trim() || '',
        remoteAccessPassword: config.remoteAccessPassword || '',
        disableLocalEngine: Boolean(config.disableLocalEngine),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(RUNTIME_CONFIG_CHANGED, { detail: next }));
    return next;
}

export function isLocalEngineDisabled() {
    return getRuntimeConfig().disableLocalEngine;
}

export function getRemoteAccessPassword() {
    return getRuntimeConfig().remoteAccessPassword;
}

export function getSupabaseRuntimeConfig() {
    const config = getRuntimeConfig();
    return {
        url: config.supabaseUrl,
        anonKey: config.supabaseAnonKey,
        isConfigured: Boolean(config.supabaseUrl && config.supabaseAnonKey),
    };
}

function readStoredRuntimeConfig() {
    if (typeof localStorage === 'undefined') return {};

    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return {
            supabaseUrl: parsed.supabaseUrl || '',
            supabaseAnonKey: parsed.supabaseAnonKey || '',
            remoteAccessPassword: parsed.remoteAccessPassword || '',
            disableLocalEngine: Boolean(parsed.disableLocalEngine),
        };
    } catch {
        return {};
    }
}
