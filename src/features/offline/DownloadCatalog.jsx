import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Search, RefreshCw } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { useDownloadedEpisodes } from '../../hooks/useDownloadedEpisodes';
import { useListeningProgress } from '../../hooks/useListeningProgress';
import { ListeningProgress } from '../../components/ListeningProgress';
import { FlightDownloadBar } from './FlightDownloadBar';

export function DownloadCatalog() {
    const [episodes, setEpisodes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [online, setOnline] = useState(navigator.onLine);
    const [revision, setRevision] = useState(0);
    const [query, setQuery] = useState('');
    const [folder, setFolder] = useState('');
    const [sort, setSort] = useState('title');
    const [selection, setSelection] = useState(() => new Set());
    const [busy, setBusy] = useState(false);
    const saved = useDownloadedEpisodes();
    const { progressFor } = useListeningProgress();
    useEffect(() => {
        const changed = () => setOnline(navigator.onLine);
        window.addEventListener('online', changed);
        window.addEventListener('offline', changed);
        return () => { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); };
    }, []);
    useEffect(() => {
        let cancelled = false;
        async function load() {
            if (!online) { setLoading(false); return; }
            setLoading(true);
            setError('');
            try {
                if (!isSupabaseConfigured()) throw new Error('Set up your library in Settings first.');
                const { data, error } = await supabase.from('podcasts').select('*').eq('status', 'READY').order('created_at', { ascending: false });
                if (error) throw error;
                if (!cancelled) setEpisodes((data || []).filter(episode => episode.status === 'READY'));
            } catch (error) { if (!cancelled) setError(error.message || 'Could not load episodes. Try again.'); }
            finally { if (!cancelled) setLoading(false); }
        }
        load();
        return () => { cancelled = true; };
    }, [online, revision]);
    const folders = useMemo(() => [...new Set(episodes.map(episode => episode.folder || 'Inbox'))].sort(), [episodes]);
    const shown = episodes.filter(episode => (!folder || (episode.folder || 'Inbox') === folder)
        && `${episode.title} ${episode.folder || 'Inbox'}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
        .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, undefined, { numeric: true })
            : sort === 'title_desc' ? b.title.localeCompare(a.title, undefined, { numeric: true }) : `${b.created_at}`.localeCompare(`${a.created_at}`));
    const selected = episodes.filter(episode => selection.has(episode.id) && !saved.has(String(episode.id)));

    function toggle(id) {
        setSelection(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    }

    return <section className="download-catalog" aria-label="Episodes to download">
        <div className="offline-catalog-filters">
            <label className="offline-search"><Search size={17} /><input type="search" aria-label="Search episodes to download" placeholder="Find episodes" value={query} onChange={event => setQuery(event.target.value)} /></label>
            <div className="offline-filter-row">
                <select aria-label="Download folder" value={folder} onChange={event => setFolder(event.target.value)}><option value="">All folders</option>{folders.map(name => <option key={name}>{name}</option>)}</select>
                <select aria-label="Sort downloads" value={sort} onChange={event => setSort(event.target.value)}><option value="title">Title A–Z</option><option value="title_desc">Title Z–A</option><option value="newest">Newest first</option></select>
            </div>
        </div>
        {!online && <p className="offline-message" role="status">You’re offline. Connect to Wi-Fi to add downloads. Your saved episodes are in Downloaded.</p>}
        {error && <div className="offline-message" role="alert">{error}<button className="offline-button" onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} /> Retry</button></div>}
        <div className="offline-selection-toolbar">
            <button className="offline-text-button" disabled={busy || !online || !shown.some(episode => !saved.has(String(episode.id)))} onClick={() => setSelection(previous => new Set([...previous, ...shown.filter(episode => !saved.has(String(episode.id))).map(episode => episode.id)]))}>Select shown</button>
            <button className="offline-text-button" disabled={busy || !selected.length} onClick={() => setSelection(new Set())}>Clear</button>
            <span>{selected.length ? `${selected.length} selected` : `${shown.length} episodes`}</span>
        </div>
        {loading ? <p role="status">Loading episodes…</p> : !error && shown.length === 0 ? <p className="offline-empty">No episodes found.</p> : null}
        <div className="download-catalog-list">{shown.map(episode => {
            const downloaded = saved.has(String(episode.id));
            return <label key={episode.id} className={`download-catalog-row ${selection.has(episode.id) && !downloaded ? 'selected' : ''}`}>
                <input type="checkbox" checked={downloaded || selection.has(episode.id)} disabled={busy || downloaded || !online} aria-label={`Select ${episode.title} for download`} onChange={() => toggle(episode.id)} />
                <span><strong>{episode.title}</strong><small className="offline-course-meta"><span>{episode.folder || 'Inbox'}</span><ListeningProgress record={progressFor(episode)} duration={episode.duration} title={episode.title} /></small></span>
                {downloaded && <CheckCircle size={18} className="offline-saved-icon" aria-label="Downloaded" />}
            </label>;
        })}</div>
        <FlightDownloadBar episodes={selected} busy={busy} disabled={!online} onBusyChange={setBusy}
            onDownloaded={id => setSelection(previous => { const next = new Set(previous); next.delete(id); return next; })} />
    </section>;
}
