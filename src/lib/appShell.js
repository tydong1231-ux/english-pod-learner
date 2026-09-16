import { isWebBuild } from './env';

export function offlineAudioUrl(key) {
    return isWebBuild && navigator.serviceWorker?.controller && /^[a-f0-9]{64}$/.test(key)
        ? `/__offline_audio/${key}` : null;
}

export async function checkAppShell() {
    if (!isWebBuild || !('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.getRegistration();
    const worker = navigator.serviceWorker.controller || registration?.active;
    if (!worker) return false;
    return new Promise(resolve => {
        const channel = new MessageChannel();
        const finish = value => { clearTimeout(timer); channel.port1.close(); resolve(value); };
        const timer = setTimeout(() => finish(false), 4000);
        channel.port1.onmessage = event => finish(event.data?.type === 'PODFLUENT_SHELL_RESULT' && event.data.ready === true);
        worker.postMessage({ type: 'CHECK_PODFLUENT_SHELL' }, [channel.port2]);
    });
}
