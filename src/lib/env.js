export const isElectronRenderer =
    typeof window !== 'undefined' && window.process?.type === 'renderer';

export const isWebBuild = import.meta.env.VITE_IS_WEB === 'true';

export const isRemoteAccess = !isElectronRenderer;

export const canUseLocalFeatures = isElectronRenderer && !isWebBuild;

export const remoteAccessPassword = import.meta.env.VITE_REMOTE_ACCESS_PASSWORD || '';
