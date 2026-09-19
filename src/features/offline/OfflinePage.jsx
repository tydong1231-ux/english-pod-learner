import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Trash2, Search } from 'lucide-react';
import { formatOfflineDuration, hasOfflineContent, listOfflineEpisodes, removeOfflineEpisode, OFFLINE_CHANGED } from '../../lib/offlineLibrary';
import { FlightReady } from './FlightReady';
import { InstallGuide } from './InstallGuide';
import { DownloadCatalog } from './DownloadCatalog';
import { PasswordGate } from '../../components/PasswordGate';
import { isRemoteAccess } from '../../lib/env';
import { useListeningProgress } from '../../hooks/useListeningProgress';
import { useUnplayedLocation } from '../../hooks/useUnplayedLocation';
import { ListeningProgress } from '../../components/ListeningProgress';
import { listeningState, mostRecentlyPlayed } from '../../lib/listeningProgress';
import './offline.css';

export function OfflinePage() {
    const [episodes, setEpisodes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [search, setSearch] = useState('');
    const [view, setView] = useState('saved');
    const [catalogOpened, setCatalogOpened] = useState(false);
    const navigate = useNavigate();
    const { progressFor, ready: progressReady } = useListeningProgress();
    const withProgress = episodes.map(record => {
        const progress = progressFor(record.podcast, record.source) || record;
        return { ...record, ...listeningState(progress, record.duration), lastPlayedAt: progress.lastPlayedAt, progressUpdatedAt: progress.updatedAt || record.progressUpdatedAt };
    });
    const query = search.trim().toLocaleLowerCase();
    const lastPlayed = mostRecentlyPlayed(withProgress, record => record);
    const displayedEpisodes = withProgress.filter(record => `${record.podcast.title} ${record.podcast.folder || ''}`.toLocaleLowerCase().includes(query))
        .sort((a, b) => (Date.parse(b.podcast.created_at) || Date.parse(b.savedAt) || 0) - (Date.parse(a.podcast.created_at) || Date.parse(a.savedAt) || 0));
    const listRef = useUnplayedLocation(displayedEpisodes.filter(hasOfflineContent).map(record => ({ ...record.podcast, id: record.key, progress: record })), episode => episode.progress, !loading && progressReady && view === 'saved');
    const resumeEpisode = withProgress.filter(record => hasOfflineContent(record) && !record.completed && record.position > 0 && record.position < record.duration)
        .sort((a, b) => (b.progressUpdatedAt || '').localeCompare(a.progressUpdatedAt || ''))[0];

    useEffect(() => {
        let cancelled = false;
        async function refresh() {
            try {
                const result = await listOfflineEpisodes();
                if (!cancelled) setEpisodes(result);
            } catch (error) {
                if (!cancelled) setMessage(`Cannot read offline storage: ${error.message}`);
            } finally { if (!cancelled) setLoading(false); }
        }
        refresh();
        window.addEventListener(OFFLINE_CHANGED, refresh);
        return () => { cancelled = true; window.removeEventListener(OFFLINE_CHANGED, refresh); };
    }, []);

    async function remove(record) {
        if (!window.confirm(`Remove “${record.podcast.title}” from this offline library? The cloud episode is kept.`)) return;
        try { await removeOfflineEpisode(record.key); setMessage('Offline download removed.'); }
        catch (error) { setMessage(`Could not remove the download: ${error.message}`); }
    }

    function open(record) {
        const queue = (displayedEpisodes.some(item => item.key === record.key) ? displayedEpisodes : episodes).filter(hasOfflineContent);
        try { sessionStorage.setItem('podfluent-offline-queue', JSON.stringify(queue.map(item => item.key))); } catch { /* Single-episode playback still works. */ }
        navigate(`/offline/player/${record.key}`);
    }

    return (
        <div className="container offline-page">
            <header className="offline-heading">
                <h1>Offline</h1>
                <InstallGuide />
            </header>
            <div className="offline-view-switch" role="group" aria-label="Offline views">
                <button aria-pressed={view === 'saved'} onClick={() => setView('saved')}>Downloaded <span>{episodes.length}</span></button>
                <button aria-pressed={view === 'browse'} onClick={() => { setCatalogOpened(true); setView('browse'); }}>Add downloads</button>
            </div>
            <div hidden={view !== 'saved'}>
            <FlightReady />
            {resumeEpisode && <button className="offline-resume" onClick={() => open(resumeEpisode)}>
                <Play size={22} /><span><strong>Continue listening</strong><span>{resumeEpisode.podcast.title} · {positionLabel(resumeEpisode.position)} / {positionLabel(resumeEpisode.duration)}</span></span>
            </button>}
            {message && <p role="status" className="offline-message">{message}</p>}
            {episodes.length > 0 && <label className="offline-search"><Search size={18} /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search downloads" aria-label="Search downloads" /><span>{displayedEpisodes.length}/{episodes.length}</span></label>}
            {loading ? <p>Loading offline episodes…</p> : episodes.length === 0 ? <div className="offline-empty"><p>No downloads yet.</p><p>Choose episodes in Add downloads to listen without a connection.</p><button className="offline-button primary" onClick={() => { setCatalogOpened(true); setView('browse'); }}>Choose episodes</button></div> : (
                <div className="offline-list" ref={listRef}>{displayedEpisodes.length === 0 && <div className="offline-empty"><p>No downloads match “{search}”.</p><button className="offline-button" onClick={() => setSearch('')}>Show all downloads</button></div>}{displayedEpisodes.map(record => (
                    <article className="offline-course" key={record.key} data-episode-id={record.key} data-last-played={lastPlayed?.key === record.key ? 'true' : undefined}>
                        {lastPlayed?.key === record.key && <span className="last-played-badge">最近播放</span>}
                        <div className="offline-course-info"><h2>{record.podcast.title}</h2><p className="offline-course-meta"><span title={record.podcast.folder || 'Inbox'}>{record.podcast.folder || 'Inbox'} · {formatOfflineDuration(record.duration)}</span><ListeningProgress record={record} duration={record.duration} title={record.podcast.title} /></p>{!hasOfflineContent(record) && <span className="offline-badge">Incomplete — remove and download again</span>}</div>
                        <div className="offline-course-actions">
                            <button className="offline-button primary" onClick={() => open(record)} disabled={!hasOfflineContent(record)} aria-label="Play" title={`Play ${record.podcast.title}`}><Play size={18} /></button>
                            <button className="offline-button" onClick={() => remove(record)} aria-label={`Remove offline download of ${record.podcast.title}`}><Trash2 size={16} /></button>
                        </div>
                    </article>
                ))}</div>
            )}
            </div>
            {catalogOpened && <div hidden={view !== 'browse'}>{isRemoteAccess ? <PasswordGate><DownloadCatalog /></PasswordGate> : <DownloadCatalog />}</div>}
        </div>
    );
}

function positionLabel(seconds = 0) {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
