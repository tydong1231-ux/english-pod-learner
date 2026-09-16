import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { downloadOfflineEpisode } from '../../lib/offlineLibrary';

export function FlightDownloadBar({ episodes, onDownloaded, onBusyChange, busy, disabled = false }) {
    const [message, setMessage] = useState('');
    const controller = useRef(null);
    const mounted = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);

    async function download() {
        const queue = [...episodes];
        controller.current = new AbortController();
        onBusyChange(true);
        let completed = 0;
        const failures = [];
        try {
            for (let index = 0; index < queue.length; index++) {
                if (controller.current.signal.aborted) break;
                const episode = queue[index];
                try {
                    await downloadOfflineEpisode(episode, status => {
                        if (mounted.current) setMessage(`${index + 1}/${queue.length} · ${episode.title}: ${status}`);
                    }, controller.current.signal);
                    completed += 1;
                    if (mounted.current) onDownloaded(episode.id);
                } catch (error) {
                    if (controller.current.signal.aborted) break;
                    failures.push(`${episode.title}: ${error.name === 'QuotaExceededError' ? 'Storage full. Remove downloads and retry.' : error.message}`);
                }
            }
            if (mounted.current) setMessage(`${completed}/${queue.length} Ready Offline.${controller.current.signal.aborted ? ' Cancelled; unfinished episodes stay selected.' : ''}${failures.length ? ` Retry selected episodes. ${failures.join(' · ')}` : ''}`);
        } finally { if (mounted.current) onBusyChange(false); }
    }

    return (
        <section className="flight-download-bar" aria-label="Batch download">
            <p className="flight-note" role="status">{message || 'Keep this page open until downloads finish.'}</p>
            <div className="flight-actions"><button className="offline-button primary" onClick={download} disabled={disabled || busy || !episodes.length}><Download size={17} /> {busy ? 'Downloading…' : `Download (${episodes.length})`}</button>{busy && <button className="offline-button" onClick={() => controller.current?.abort()}>Cancel</button>}</div>
        </section>
    );
}
