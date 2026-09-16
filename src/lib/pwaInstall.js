// Capture the browser's offer at startup, even before Offline is opened.
let prompt = null;
const listeners = new Set();
export const getInstallPrompt = () => prompt;
export const subscribeInstallPrompt = listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};
export function clearInstallPrompt() {
    prompt = null;
    listeners.forEach(listener => listener());
}
window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    prompt = event;
    listeners.forEach(listener => listener());
});
window.addEventListener('appinstalled', clearInstallPrompt);
