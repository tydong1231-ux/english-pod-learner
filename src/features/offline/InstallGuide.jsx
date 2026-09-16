import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Smartphone, Share, X } from 'lucide-react';
import { clearInstallPrompt, getInstallPrompt, subscribeInstallPrompt } from '../../lib/pwaInstall';

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function InstallGuide() {
    const [installed, setInstalled] = useState(standalone);
    const [installing, setInstalling] = useState(false);
    const prompt = useSyncExternalStore(subscribeInstallPrompt, getInstallPrompt);
    const dialog = useRef(null);
    useEffect(() => {
        const media = window.matchMedia('(display-mode: standalone)');
        const changed = () => setInstalled(standalone());
        const installedNow = () => { setInstalled(true); dialog.current?.close(); };
        media.addEventListener('change', changed);
        window.addEventListener('appinstalled', installedNow);
        return () => { media.removeEventListener('change', changed); window.removeEventListener('appinstalled', installedNow); };
    }, []);

    async function install() {
        if (!prompt) { dialog.current.showModal(); return; }
        setInstalling(true);
        try { await prompt.prompt(); await prompt.userChoice; }
        catch { dialog.current?.showModal(); }
        finally { clearInstallPrompt(); setInstalling(false); }
    }

    if (installed) return <span className="offline-installed"><Smartphone size={16} /> App mode</span>;
    return <>
        <button className="offline-button install-trigger" onClick={() => dialog.current.showModal()}><Smartphone size={17} /> Install app</button>
        <dialog className="install-dialog" ref={dialog} aria-labelledby="install-title" onClick={event => { if (event.target === dialog.current) dialog.current.close(); }}>
            <div className="install-dialog-heading"><h2 id="install-title">Add to Home Screen</h2><button className="offline-button" aria-label="Close install guide" onClick={() => dialog.current.close()}><X size={20} /></button></div>
            <p>Open PodFluent like an app, then download your episodes there.</p>
            <h3>On iPhone or iPad</h3>
            <ol>
                <li>Open this website in <strong>Safari</strong>.</li>
                <li>Tap <strong>Share <Share size={16} /></strong>, then <strong>Add to Home Screen</strong>. Scroll down in the share menu if needed.</li>
                <li>Leave <strong>Open as Web App</strong> on if shown, then tap <strong>Add</strong>.</li>
                <li>Open the new <strong>PodFluent</strong> icon. Go to <strong>Offline → Add downloads</strong> and select episodes.</li>
            </ol>
            <p className="flight-note">Keep the app open until downloads finish. Before your flight, switch to airplane mode and try opening and playing a downloaded episode.</p>
            <details><summary>Android or desktop</summary><p>Use your browser menu → Install app or Add to Home screen.</p></details>
            {prompt && <button className="offline-button primary install-done" onClick={install} disabled={installing}>Install on this device</button>}
            <button className="offline-button primary install-done" onClick={() => dialog.current.close()}>Got it</button>
        </dialog>
    </>;
}
