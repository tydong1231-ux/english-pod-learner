import { useEffect, useRef, useState } from 'react';
import { Download, CheckCircle, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { currentSource, downloadOfflineEpisode, episodeKey, getOfflineEpisodeSummary, hasOfflineContent } from '../lib/offlineLibrary';

export function DownloadEpisodeButton({ podcast }) {
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const savedKey = useLiveQuery(async () => {
        const key = await episodeKey(currentSource(), podcast.id);
        return hasOfflineContent(await getOfflineEpisodeSummary(key)) ? key : null;
    }, [podcast.id]);
    const controller = useRef(null);
    const navigate = useNavigate();
    useEffect(() => () => controller.current?.abort(), []);

    async function download(event) {
        event.stopPropagation();
        if (savedKey) {
            try { sessionStorage.setItem('podfluent-offline-queue', JSON.stringify([savedKey])); } catch { /* Play this episode without a queue. */ }
            navigate(`/offline/player/${savedKey}`);
            return;
        }
        controller.current = new AbortController();
        setBusy(true);
        try {
            await downloadOfflineEpisode(podcast, setStatus, controller.current.signal);
            setStatus('Downloaded. Audio and subtitles are ready offline.');
        } catch (error) {
            setStatus(error.name === 'AbortError' ? 'Download cancelled.' : error.name === 'QuotaExceededError'
                ? 'Not enough website storage. Remove an offline copy and retry.' : error.message || 'Download failed. Please retry.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="offline-download" onClick={event => event.stopPropagation()}>
            <button type="button" className="offline-button" onClick={download} disabled={busy} aria-label={savedKey ? `Play ${podcast.title} offline` : `Download ${podcast.title} for offline use`}>
                {savedKey ? <CheckCircle size={16} /> : <Download size={16} />}
                {busy ? 'Downloading…' : savedKey ? 'Play offline ✓' : 'Download'}
            </button>
            {busy && <button type="button" className="offline-button" onClick={() => controller.current?.abort()} aria-label="Cancel download"><X size={16} /></button>}
            {status && <span className="offline-download-status" role="status">{status}</span>}
        </div>
    );
}
