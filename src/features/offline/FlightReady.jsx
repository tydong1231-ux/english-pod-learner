import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, Circle, Plane, ShieldCheck } from 'lucide-react';
import { checkAppShell } from '../../lib/appShell';
import { getStorageStatus, requestOfflineStorage } from '../../lib/storagePersistence';
import { formatBytes, formatOfflineDuration, hasOfflineContent, listOfflineEpisodes, verifyOfflineEpisode, offlineDb, OFFLINE_CHANGED } from '../../lib/offlineLibrary';
import { isWebBuild } from '../../lib/env';
import './offline.css';

export function FlightReady() {
    const [summary, setSummary] = useState({ count: 0, duration: 0, complete: false, shell: false, persistent: null, usage: 0 });
    const [checking, setChecking] = useState(false);
    const [message, setMessage] = useState('');
    const mounted = useRef(false);

    const refresh = useCallback(async () => {
        try {
            const [records, storage, shell] = await Promise.all([listOfflineEpisodes(), getStorageStatus(), checkAppShell()]);
            const ready = records.filter(hasOfflineContent);
            if (mounted.current) setSummary({ count: ready.length, duration: ready.reduce((sum, record) => sum + record.duration, 0), complete: ready.length > 0 && ready.length === records.length, shell, ...storage });
        } catch (error) { if (mounted.current) setMessage(`Offline check unavailable: ${error.message}`); }
    }, []);

    useEffect(() => {
        mounted.current = true;
        const initial = setTimeout(refresh, 0);
        const changed = () => { setMessage(''); refresh(); };
        window.addEventListener(OFFLINE_CHANGED, changed);
        navigator.serviceWorker?.addEventListener('controllerchange', refresh);
        return () => {
            mounted.current = false;
            clearTimeout(initial);
            window.removeEventListener(OFFLINE_CHANGED, changed);
            navigator.serviceWorker?.removeEventListener('controllerchange', refresh);
        };
    }, [refresh]);

    async function testOffline() {
        setChecking(true);
        const failed = [];
        try {
            // Read the app's own database and cached shell; this test makes no network requests.
            const records = await listOfflineEpisodes();
            for (let index = 0; index < records.length; index++) {
                if (!mounted.current) return;
                setMessage(`Checking stored audio and subtitles ${index + 1}/${records.length}…`);
                if (!await verifyOfflineEpisode(records[index])) {
                    failed.push(records[index].podcast.title);
                    await offlineDb.episodes.update(records[index].key, { verified: false });
                }
            }
            window.dispatchEvent(new Event(OFFLINE_CHANGED));
            await refresh();
            if (mounted.current) setMessage(failed.length ? `Download again: ${failed.join(', ')}` : records.length ? 'Local audio and subtitles verified. Final check: reopen and play once in airplane mode.' : 'Download episodes first, then run Test Offline.');
        } catch (error) { if (mounted.current) setMessage(`Verification failed: ${error.message}`); }
        finally { if (mounted.current) setChecking(false); }
    }

    async function enablePersistence() {
        const status = await requestOfflineStorage();
        await refresh();
        if (mounted.current) setMessage(status.persistent ? 'Persistent storage enabled.' : 'Not granted yet. On iPhone, add PodFluent to the Home Screen and open it from that icon, then try again.');
    }

    const ready = summary.complete && summary.shell && summary.persistent === true;
    return (
        <details className="flight-ready" aria-label="Flight readiness">
            <summary><Plane size={18} /><span><strong>{ready ? 'Flight Ready ✓' : 'Offline check'}</strong><small>{summary.count} episodes downloaded · {formatOfflineDuration(summary.duration)} available offline</small></span></summary>
            <div className="flight-checks">{[
                ['Audio', summary.complete], ['Subtitles', summary.complete], ['App shell', summary.shell], ['Storage persistent', summary.persistent === true],
            ].map(([label, ok]) => <span key={label} className={ok ? 'flight-check-ok' : ''}>{ok ? <CheckCircle size={15} /> : <Circle size={15} />}{label}</span>)}</div>
            <div className="flight-actions"><button className="offline-button primary" onClick={testOffline} disabled={checking}>{checking ? 'Checking…' : 'Test Offline'}</button>{summary.persistent !== true && <button className="offline-button" onClick={enablePersistence}><ShieldCheck size={16} /> Enable persistent storage</button>}<span>{formatBytes(summary.usage)} used</span></div>
            {!summary.shell && <p className="flight-note">{isWebBuild ? 'Open the published HTTPS app online to finish saving its startup files.' : 'Offline app startup is available in the published PWA build.'}</p>}
            <p className="flight-note">Before you fly, open the app and play a downloaded episode in airplane mode.</p>
            {message && <p className="flight-note" role="status">{message}</p>}
        </details>
    );
}
