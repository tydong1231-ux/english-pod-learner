const STORAGE_KEY = 'podfluent-runtime-config';
export const RUNTIME_CONFIG_CHANGED = 'podfluent-runtime-config-changed';

const buildEnvConfig = {
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    remoteAccessPassword: import.meta.env.VITE_REMOTE_ACCESS_PASSWORD || '',
    disableLocalEngine: import.meta.env.VITE_DISABLE_LOCAL_ENGINE === 'true',
    sourcePath: '',
};

let envConfig = buildEnvConfig;
let runtimeEnvLoadPromise = null;
let runtimeEnvLoaded = false;

export function getRuntimeConfig() {
    const stored = readStoredRuntimeConfig();
    const storedMatchesCurrentEnv = doesStoredConfigMatchCurrentEnv(stored);

    return {
        supabaseUrl: storedMatchesCurrentEnv && stored.supabaseUrl ? stored.supabaseUrl : envConfig.supabaseUrl,
        supabaseAnonKey: storedMatchesCurrentEnv && stored.supabaseAnonKey ? stored.supabaseAnonKey : envConfig.supabaseAnonKey,
        remoteAccessPassword: storedMatchesCurrentEnv && stored.remoteAccessPassword ? stored.remoteAccessPassword : envConfig.remoteAccessPassword,
        disableLocalEngine: storedMatchesCurrentEnv && hasOwn(stored, 'disableLocalEngine')
            ? stored.disableLocalEngine
            : envConfig.disableLocalEngine,
        sourcePath: envConfig.sourcePath || '',
    };
}

export async function loadRuntimeEnvConfig() {
    if (runtimeEnvLoaded) return getRuntimeConfig();
    if (runtimeEnvLoadPromise) return runtimeEnvLoadPromise;

    runtimeEnvLoadPromise = (async () => {
        const electronConfig = await getElectronRuntimeEnvConfig();
        if (electronConfig) {
            envConfig = {
                ...buildEnvConfig,
                ...electronConfig,
                disableLocalEngine: Boolean(electronConfig.disableLocalEngine),
            };
        }

        runtimeEnvLoaded = true;
        const resolved = getRuntimeConfig();
        window.dispatchEvent(new CustomEvent(RUNTIME_CONFIG_CHANGED, { detail: resolved }));
        return resolved;
    })();

    return runtimeEnvLoadPromise;
}

export function saveRuntimeConfig(config) {
    const next = {
        supabaseUrl: config.supabaseUrl?.trim() || '',
        supabaseAnonKey: config.supabaseAnonKey?.trim() || '',
        remoteAccessPassword: config.remoteAccessPassword || '',
        disableLocalEngine: Boolean(config.disableLocalEngine),
    };

    const toStore = { ...next };
    toStore.__envSignature = getEnvSignature(envConfig);

    // Values equal to the current env do not need to be duplicated in localStorage.
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
            disableLocalEngine: hasOwn(parsed, 'disableLocalEngine') ? Boolean(parsed.disableLocalEngine) : undefined,
            __envSignature: parsed.__envSignature || '',
        };
    } catch {
        return {};
    }
}

async function getElectronRuntimeEnvConfig() {
    if (typeof window === 'undefined' || window.process?.type !== 'renderer') return null;

    try {
        const ipcRenderer = window.require?.('electron')?.ipcRenderer;
        if (!ipcRenderer?.invoke) return null;
        return await ipcRenderer.invoke('get-runtime-env-config');
    } catch {
        return null;
    }
}

function doesStoredConfigMatchCurrentEnv(stored) {
    if (!stored || Object.keys(stored).length === 0) return false;
    if (stored.__envSignature) return stored.__envSignature === getEnvSignature(envConfig);

    // Old versions saved raw values without an env signature. If the new env
    // file has Supabase values, prefer the env file over stale localStorage.
    return !envConfig.supabaseUrl && !envConfig.supabaseAnonKey;
}

function getEnvSignature(config) {
    return [
        config.supabaseUrl || '',
        config.supabaseAnonKey || '',
        config.remoteAccessPassword || '',
        config.disableLocalEngine ? '1' : '0',
    ].join('|');
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}
