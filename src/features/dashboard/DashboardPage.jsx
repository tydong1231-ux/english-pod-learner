import React, { useRef, useEffect, useState } from 'react';
import { Upload, Play, Trash2, Clock, AlertTriangle, Loader, FileAudio, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatSupabaseError, supabase, isSupabaseConfigured } from '../../lib/supabase';
import { canUseLocalFeatures } from '../../lib/env';
import { normalizeFolder, PodcastService, PodcastStatus } from '../../services/podcast';
import { useStore } from '../../store';
import { LogViewer } from '../../components/LogViewer';
import styles from './DashboardPage.module.css';

export function DashboardPage() {
    const [podcasts, setPodcasts] = useState([]);
    const [loading, setLoading] = useState(isSupabaseConfigured());
    const [connectionError, setConnectionError] = useState(null);
    const [uploadState, setUploadState] = useState({ status: 'idle', message: '' });
    const [deletingIds, setDeletingIds] = useState(() => new Set());
    const [deleteState, setDeleteState] = useState({ status: 'idle', message: '' });
    const [selectedFolder, setSelectedFolder] = useState('all');
    const [importFolder, setImportFolder] = useState('Inbox');
    const [newFolderName, setNewFolderName] = useState('');
    const [sortMode, setSortMode] = useState('created_desc');
    const { apiKey, geminiModel, transcriptionPrompt } = useStore();
    const fileInputRef = useRef(null);
    const navigate = useNavigate();

    const folders = React.useMemo(() => {
        const values = new Set(['Inbox']);
        podcasts.forEach((podcast) => values.add(normalizeFolder(podcast.folder)));
        if (newFolderName.trim()) values.add(normalizeFolder(newFolderName));
        return [...values].sort((a, b) => a.localeCompare(b));
    }, [podcasts, newFolderName]);

    const displayedPodcasts = React.useMemo(() => {
        const filtered = selectedFolder === 'all'
            ? [...podcasts]
            : podcasts.filter((podcast) => normalizeFolder(podcast.folder) === selectedFolder);

        filtered.sort((a, b) => {
            if (sortMode === 'title_asc') return a.title.localeCompare(b.title);
            if (sortMode === 'title_desc') return b.title.localeCompare(a.title);
            if (sortMode === 'folder_asc') return normalizeFolder(a.folder).localeCompare(normalizeFolder(b.folder)) || b.created_at.localeCompare(a.created_at);
            if (sortMode === 'status_asc') return a.status.localeCompare(b.status) || b.created_at.localeCompare(a.created_at);
            return b.created_at.localeCompare(a.created_at);
        });

        return filtered;
    }, [podcasts, selectedFolder, sortMode]);

    // Fetch podcasts on mount and subscribe to changes
    useEffect(() => {
        if (!isSupabaseConfigured()) {
            return undefined;
        }

        fetchPodcasts();

        // Real-time subscription (may not work on all Supabase tiers)
        const channel = supabase
            .channel('public:podcasts')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'podcasts' }, () => {
                fetchPodcasts(); // Refresh list on any change
            })
            .subscribe();

        // Fallback polling every 3 seconds (reliable refresh)
        const pollInterval = setInterval(() => {
            fetchPodcasts();
        }, 3000);

        return () => {
            supabase.removeChannel(channel);
            clearInterval(pollInterval);
        };
    }, []);

    async function fetchPodcasts() {
        try {
            const { data, error } = await supabase
                .from('podcasts')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setPodcasts(data || []);
            setConnectionError(null);
        } catch (err) {
            console.error("Error fetching podcasts:", err);
            setConnectionError(formatSupabaseError(err));
        } finally {
            setLoading(false);
        }
    }

    const handleFileSelect = async (e) => {
        const input = e.target;
        const file = input.files[0];
        if (!file) return;
        if (!isSupabaseConfigured()) {
            alert('Supabase is not configured. Open Settings and fill in Supabase URL and anon key.');
            input.value = '';
            return;
        }

        try {
            setUploadState({ status: 'loading', message: `Uploading ${file.name}...` });
            const folder = normalizeFolder(importFolder);
            const id = await PodcastService.importPodcast(file, { folder });
            setUploadState({ status: 'success', message: `${file.name} uploaded successfully.` });
            setTimeout(() => setUploadState({ status: 'idle', message: '' }), 3000);

            // Validate UI update immediately
            fetchPodcasts();

            // Auto-start processing if API key exists
            if (apiKey) {
                // Callback to update local state on progress
                const updateLocalStatus = (msg) => {
                    setPodcasts(prev => prev.map(p => {
                        if (p.id === id) {
                            return { ...p, status: PodcastStatus.PROCESSING, progress: msg };
                        }
                        return p;
                    }));
                };

                PodcastService.processPodcast(id, apiKey, geminiModel, transcriptionPrompt, updateLocalStatus, file)
                    .then(() => fetchPodcasts())
                    .catch(err => {
                        console.error(err);
                        fetchPodcasts();
                    });
            } else {
                alert("Please set your Gemini API Key in Settings to process this podcast.");
            }
        } catch (err) {
            console.error("Import failed", err);
            setUploadState({ status: 'error', message: formatSupabaseError(err) });
            alert(`Failed to import podcast.\n\n${formatSupabaseError(err)}\n\nOpen Settings > App Connection and click Test Connection.`);
        } finally {
            input.value = '';
        }
    };

    const handleProcess = (testId) => {
        if (!apiKey) {
            navigate('/settings');
            return;
        }

        // Optimistic update wrapper
        const updateLocalStatus = (msg) => {
            setPodcasts(prev => prev.map(p => {
                if (p.id === testId) {
                    return { ...p, status: PodcastStatus.PROCESSING, progress: msg };
                }
                return p;
            }));
        };

        PodcastService.processPodcast(testId, apiKey, geminiModel, transcriptionPrompt, updateLocalStatus).catch(err => {
            console.error(err);
            setPodcasts(prev => prev.map(p => {
                if (p.id === testId) {
                    return { ...p, status: PodcastStatus.ERROR, error: err.message };
                }
                return p;
            }));
        });
    };

    const handleCreateFolder = () => {
        const folder = normalizeFolder(newFolderName);
        setImportFolder(folder);
        setSelectedFolder(folder);
        setNewFolderName('');
    };

    const handleFolderChange = async (podcastId, folder) => {
        const nextFolder = normalizeFolder(folder);
        setPodcasts(prev => prev.map(pod => pod.id === podcastId ? { ...pod, folder: nextFolder } : pod));
        try {
            await PodcastService.updatePodcastFolder(podcastId, nextFolder);
        } catch (err) {
            console.error('Folder update failed', err);
            alert(err.message || 'Failed to update folder.');
            fetchPodcasts();
        }
    };

    const [deleteConfirmId, setDeleteConfirmId] = React.useState(null);

    const handleDeleteClick = (e, id) => {
        e.stopPropagation();
        e.preventDefault();
        setDeleteConfirmId(id);
    };

    const confirmDelete = async (e, id) => {
        e.stopPropagation();
        e.preventDefault();
        setDeletingIds(prev => new Set(prev).add(id));
        setDeleteState({ status: 'loading', message: 'Deleting podcast...' });
        try {
            await PodcastService.deletePodcast(id);
            setDeleteConfirmId(null);
            setDeleteState({ status: 'success', message: 'Podcast deleted.' });
            setTimeout(() => setDeleteState({ status: 'idle', message: '' }), 2500);
            // Optimistic update or wait for subscription
            setPodcasts(prev => prev.filter(p => p.id !== id));
        } catch (err) {
            console.error('Delete failed', err);
            setDeleteState({ status: 'error', message: err.message || 'Delete failed.' });
        } finally {
            setDeletingIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    };

    const cancelDelete = (e) => {
        e.stopPropagation();
        e.preventDefault();
        setDeleteConfirmId(null);
    };

    if (loading) return <div className="container" style={{ display: 'flex', justifyContent: 'center', marginTop: '50px' }}><Loader className={styles.spin} /></div>;
    if (!isSupabaseConfigured()) {
        return (
            <div className="container">
                <header className={styles.header}>
                    <div>
                        <h1>Setup Required</h1>
                        <p className={styles.subtitle}>Configure Supabase before using the library.</p>
                    </div>
                </header>
                <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>
                        <AlertTriangle size={48} />
                    </div>
                    <h3>Supabase is not configured</h3>
                    <p>Open Settings and fill in Supabase URL and anon key.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <header className={styles.header}>
                <div>
                    <h1>Your Library</h1>
                    <p className={styles.subtitle}>{podcasts.length} Podcasts</p>
                </div>
                {canUseLocalFeatures && (
                    <button
                        className={styles.importButton}
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadState.status === 'loading'}
                    >
                        {uploadState.status === 'loading' ? <Loader size={20} className={styles.spin} /> : <Upload size={20} />}
                        {uploadState.status === 'loading' ? 'Uploading' : 'Import Podcast'}
                    </button>
                )}
                <input
                    type="file"
                    ref={fileInputRef}
                    accept="audio/*,video/*"
                    style={{ display: 'none' }}
                    onChange={handleFileSelect}
                />
            </header>

            <div className={styles.libraryControls}>
                <div className={styles.controlGroup}>
                    <label>Folder</label>
                    <select
                        value={selectedFolder}
                        onChange={(e) => setSelectedFolder(e.target.value)}
                    >
                        <option value="all">All folders</option>
                        {folders.map(folder => (
                            <option key={folder} value={folder}>{folder}</option>
                        ))}
                    </select>
                </div>
                <div className={styles.controlGroup}>
                    <label>Import to</label>
                    <select
                        value={importFolder}
                        onChange={(e) => setImportFolder(e.target.value)}
                    >
                        {folders.map(folder => (
                            <option key={folder} value={folder}>{folder}</option>
                        ))}
                    </select>
                </div>
                <div className={styles.controlGroup}>
                    <label>New folder</label>
                    <div className={styles.inlineControl}>
                        <input
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            placeholder="Folder name"
                        />
                        <button
                            type="button"
                            onClick={handleCreateFolder}
                            disabled={!newFolderName.trim()}
                        >
                            Add
                        </button>
                    </div>
                </div>
                <div className={styles.controlGroup}>
                    <label>Sort</label>
                    <select
                        value={sortMode}
                        onChange={(e) => setSortMode(e.target.value)}
                    >
                        <option value="created_desc">Newest first</option>
                        <option value="title_asc">Title A-Z</option>
                        <option value="title_desc">Title Z-A</option>
                        <option value="folder_asc">Folder</option>
                        <option value="status_asc">Status</option>
                    </select>
                </div>
            </div>

            {(uploadState.status !== 'idle' || deleteState.status !== 'idle') && (
                <div className={styles.operationStatus}>
                    {uploadState.status !== 'idle' && (
                        <div className={styles.statusLine} data-status={uploadState.status}>
                            {uploadState.status === 'loading' && <Loader size={16} className={styles.spin} />}
                            {uploadState.status === 'success' && <CheckCircle size={16} />}
                            {uploadState.status === 'error' && <AlertTriangle size={16} />}
                            <span>{uploadState.message}</span>
                        </div>
                    )}
                    {deleteState.status !== 'idle' && (
                        <div className={styles.statusLine} data-status={deleteState.status}>
                            {deleteState.status === 'loading' && <Loader size={16} className={styles.spin} />}
                            {deleteState.status === 'success' && <CheckCircle size={16} />}
                            {deleteState.status === 'error' && <AlertTriangle size={16} />}
                            <span>{deleteState.message}</span>
                        </div>
                    )}
                </div>
            )}

            {connectionError ? (
                <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>
                        <AlertTriangle size={48} />
                    </div>
                    <h3>Supabase connection failed</h3>
                    <p>{connectionError}</p>
                </div>
            ) : displayedPodcasts.length === 0 ? (
                <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>
                        <FileAudio size={48} />
                    </div>
                    <h3>No podcasts here</h3>
                    <p>Import an audio file or switch folders.</p>
                </div>
            ) : (
                <div className={styles.grid}>
                    {displayedPodcasts.map(pod => (
                        <div
                            key={pod.id}
                            className={styles.card}
                            onClick={() => pod.status === PodcastStatus.READY && navigate(`/player/${pod.id}`)}
                        >
                            <div className={styles.cardIcon}>
                                {pod.status === PodcastStatus.PROCESSING ? (
                                    <Loader className={styles.spin} />
                                ) : pod.status === PodcastStatus.ERROR ? (
                                    <AlertTriangle color="#ef4444" />
                                ) : (
                                    <Play fill="currentColor" />
                                )}
                            </div>

                            <div className={styles.cardContent}>
                                <h3 className={styles.cardTitle}>{pod.title}</h3>
                                <div className={styles.cardMeta}>
                                    <span>{new Date(pod.created_at).toLocaleDateString()}</span>
                                    <select
                                        className={styles.folderSelect}
                                        value={normalizeFolder(pod.folder)}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => handleFolderChange(pod.id, e.target.value)}
                                    >
                                        {folders.map(folder => (
                                            <option key={folder} value={folder}>{folder}</option>
                                        ))}
                                    </select>
                                    <span className={styles.statusBadge} data-status={pod.status}>
                                        {pod.status}
                                    </span>
                                </div>
                                {pod.status === PodcastStatus.PROCESSING && pod.progress && (
                                    <p className={styles.progressText}>{pod.progress}</p>
                                )}
                                {pod.status === PodcastStatus.ERROR && (
                                    <p className={styles.errorText}>Error: {pod.error || 'Unknown'}</p>
                                )}
                            </div>

                            <div className={styles.cardActions}>
                                {pod.status !== PodcastStatus.READY && canUseLocalFeatures && (
                                    <button
                                        className={styles.iconButton}
                                        onClick={(e) => { e.stopPropagation(); handleProcess(pod.id); }}
                                        title="Start or retry processing"
                                        disabled={deletingIds.has(pod.id)}
                                    >
                                        <Clock size={18} />
                                    </button>
                                )}
                                {canUseLocalFeatures && (
                                    deleteConfirmId === pod.id ? (
                                        <div className={styles.confirmDelete}>
                                            <button
                                                onClick={(e) => confirmDelete(e, pod.id)}
                                                className={styles.confirmBtn}
                                                disabled={deletingIds.has(pod.id)}
                                            >
                                                {deletingIds.has(pod.id) ? '...' : 'Yes'}
                                            </button>
                                            <button
                                                onClick={cancelDelete}
                                                className={styles.cancelBtn}
                                                disabled={deletingIds.has(pod.id)}
                                            >
                                                No
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            className={styles.iconButton}
                                            onClick={(e) => handleDeleteClick(e, pod.id)}
                                            title="Delete"
                                            disabled={deletingIds.has(pod.id)}
                                        >
                                            {deletingIds.has(pod.id) ? <Loader size={18} className={styles.spin} /> : <Trash2 size={18} />}
                                        </button>
                                    )
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Backend Logs (Python Server) */}
            <div style={{ marginTop: '2rem' }}>
                <LogViewer />
            </div>
        </div>
    );
}
