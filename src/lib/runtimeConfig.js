const STORAGE_KEY = 'podfluent-runtime-config';
export const RUNTIME_CONFIG_CHANGED = 'podfluent-runtime-config-changed';

const envConfig = {
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    remoteAccessPassword: import.meta.env.VITE_REMOTE_ACCESS_PASSWORD || '',
    disableLocalEngine: import.meta.env.VITE_DISABLE_LOCAL_ENGINE === 'true',
};

export function getRuntimeConfig() {
    const stored = readStoredRuntimeConfig();
    return {
        supabaseUrl: stored.supabaseUrl || envConfig.supabaseUrl,
        supabaseAnonKey: stored.supabaseAnonKey || envConfig.supabaseAnonKey,
        remoteAccessPassword: stored.remoteAccessPassword || envConfig.remoteAccessPassword,
        disableLocalEngine: stored.hasOwnProperty('disableLocalEngine') ? stored.disableLocalEngine : envConfig.disableLocalEngine,
    };
}

export function saveRuntimeConfig(config) {
    const next = {
        supabaseUrl: config.supabaseUrl?.trim() || '',
        supabaseAnonKey: config.supabaseAnonKey?.trim() || '',
        remoteAccessPassword: config.remoteAccessPassword || '',
        disableLocalEngine: Boolean(config.disableLocalEngine),
    };

    // If the saved value is the exact same as envConfig, don't store it in local override
    // This prevents old env values from getting stuck in localStorage.
    const toStore = { ...next };
    if (toStore.supabaseUrl === envConfig.supabaseUrl) delete toStore.supabaseUrl;
    if (toStore.supabaseAnonKey === envConfig.supabaseAnonKey) delete toStore.supabaseAnonKey;
    if (toStore.remoteAccessPassword === envConfig.remoteAccessPassword) delete toStore.remoteAccessPassword;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    
    // Dispatch the fully resolved config to listeners
    const resolved = getRuntimeConfig();
    window.dispatchEvent(new CustomEvent(RUNTIME_CONFIG_CHANGED, { detail: resolved }));
    return resolved;
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
            disableLocalEngine: parsed.hasOwnProperty('disableLocalEngine') ? Boolean(parsed.disableLocalEngine) : undefined,
        };
    } catch {
        return {};
    }
}
