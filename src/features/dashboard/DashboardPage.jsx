import React, { useRef, useEffect, useState } from 'react';
import { Upload, Play, Trash2, Clock, AlertTriangle, Loader, FileAudio } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { canUseLocalFeatures } from '../../lib/env';
import { PodcastService, PodcastStatus } from '../../services/podcast';
import { useStore } from '../../store';
import { LogViewer } from '../../components/LogViewer';
import styles from './DashboardPage.module.css';

export function DashboardPage() {
    const [podcasts, setPodcasts] = useState([]);
    const [loading, setLoading] = useState(isSupabaseConfigured());
    const { apiKey, geminiModel, transcriptionPrompt } = useStore();
    const fileInputRef = useRef(null);
    const navigate = useNavigate();

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
        } catch (err) {
            console.error("Error fetching podcasts:", err);
        } finally {
            setLoading(false);
        }
    }

    const handleFileSelect = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!isSupabaseConfigured()) {
            alert('Supabase is not configured. Open Settings and fill in Supabase URL and anon key.');
            return;
        }

        try {
            const id = await PodcastService.importPodcast(file);

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

                PodcastService.processPodcast(id, apiKey, geminiModel, transcriptionPrompt, updateLocalStatus)
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
            alert("Failed to import file.");
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

    const [deleteConfirmId, setDeleteConfirmId] = React.useState(null);

    const handleDeleteClick = (e, id) => {
        e.stopPropagation();
        e.preventDefault();
        setDeleteConfirmId(id);
    };

    const confirmDelete = async (e, id) => {
        e.stopPropagation();
        e.preventDefault();
        await PodcastService.deletePodcast(id);
        setDeleteConfirmId(null);
        // Optimistic update or wait for subscription
        setPodcasts(prev => prev.filter(p => p.id !== id));
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
                    >
                        <Upload size={20} />
                        Import Podcast
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

            {podcasts.length === 0 ? (
                <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>
                        <FileAudio size={48} />
                    </div>
                    <h3>No podcasts yet</h3>
                    <p>Import an audio file to start learning.</p>
                </div>
            ) : (
                <div className={styles.grid}>
                    {podcasts.map(pod => (
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
                                {pod.status === PodcastStatus.PENDING && canUseLocalFeatures && (
                                    <button
                                        className={styles.iconButton}
                                        onClick={(e) => { e.stopPropagation(); handleProcess(pod.id); }}
                                        title="Retry Processing"
                                    >
                                        <Clock size={18} />
                                    </button>
                                )}
                                {canUseLocalFeatures && (
                                    deleteConfirmId === pod.id ? (
                                        <div className={styles.confirmDelete}>
                                            <button onClick={(e) => confirmDelete(e, pod.id)} className={styles.confirmBtn}>Yes</button>
                                            <button onClick={cancelDelete} className={styles.cancelBtn}>No</button>
                                        </div>
                                    ) : (
                                        <button
                                            className={styles.iconButton}
                                            onClick={(e) => handleDeleteClick(e, pod.id)}
                                            title="Delete"
                                        >
                                            <Trash2 size={18} />
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
