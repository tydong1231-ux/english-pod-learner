import { useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    Check,
    CheckCircle,
    Clock,
    FileAudio,
    Folder,
    FolderOpen,
    Loader,
    Pencil,
    Play,
    Plus,
    Search,
    Trash2,
    Upload,
    X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatSupabaseError, isSupabaseConfigured, supabase } from '../../lib/supabase';
import { canUseLocalFeatures } from '../../lib/env';
import { isLocalEngineDisabled } from '../../lib/runtimeConfig';
import { normalizeFolder, PodcastService, PodcastStatus } from '../../services/podcast';
import { useStore } from '../../store';
import { LogViewer } from '../../components/LogViewer';
import styles from './DashboardPage.module.css';

const ALL_FOLDERS = 'all';
const DEFAULT_FOLDER = 'Inbox';
const CUSTOM_FOLDERS_KEY = 'podfluent-custom-folders';
const UPLOAD_CONCURRENCY = 3;
const RESUMABLE_STATUSES = new Set([PodcastStatus.PENDING, PodcastStatus.PROCESSING]);

export function DashboardPage() {
    const [podcasts, setPodcasts] = useState([]);
    const [loading, setLoading] = useState(isSupabaseConfigured());
    const [connectionError, setConnectionError] = useState(null);
    const [uploadState, setUploadState] = useState({ status: 'idle', message: '' });
    const [deleteState, setDeleteState] = useState({ status: 'idle', message: '' });
    const [folderState, setFolderState] = useState({ status: 'idle', message: '' });
    const [deletingIds, setDeletingIds] = useState(() => new Set());
    const [deleteConfirmId, setDeleteConfirmId] = useState(null);
    const [selectedFolder, setSelectedFolder] = useState(ALL_FOLDERS);
    const [importFolder, setImportFolder] = useState(DEFAULT_FOLDER);
    const [customFolders, setCustomFolders] = useState(readCustomFolders);
    const [newFolderName, setNewFolderName] = useState('');
    const [renamingFolder, setRenamingFolder] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [sortMode, setSortMode] = useState('created_desc');
    const [searchQuery, setSearchQuery] = useState('');
    const { apiKey, geminiModel, transcriptionPrompt } = useStore();
    const fileInputRef = useRef(null);
    const processingQueueRef = useRef([]);
    const processingIdsRef = useRef(new Set());
    const processingActiveRef = useRef(false);
    const settingsRef = useRef({ apiKey, geminiModel, transcriptionPrompt });
    const enqueueProcessingRef = useRef(() => { });
    const navigate = useNavigate();
    enqueueProcessingRef.current = enqueueProcessing;

    const folderCounts = useMemo(() => {
        const counts = new Map();
        counts.set(DEFAULT_FOLDER, 0);
        customFolders.forEach((folder) => counts.set(normalizeFolder(folder), 0));
        podcasts.forEach((podcast) => {
            const folder = normalizeFolder(podcast.folder);
            counts.set(folder, (counts.get(folder) || 0) + 1);
        });
        return counts;
    }, [podcasts, customFolders]);

    const folders = useMemo(() => sortFolders([...folderCounts.keys()]), [folderCounts]);

    const displayedPodcasts = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        const filtered = podcasts.filter((podcast) => {
            const folder = normalizeFolder(podcast.folder);
            const inFolder = selectedFolder === ALL_FOLDERS || folder === selectedFolder;
            if (!inFolder) return false;
            if (!query) return true;

            return [
                podcast.title,
                podcast.status,
                folder,
                podcast.progress,
            ].filter(Boolean).some((value) => `${value}`.toLowerCase().includes(query));
        });

        filtered.sort((a, b) => {
            if (sortMode === 'title_asc') return a.title.localeCompare(b.title);
            if (sortMode === 'title_desc') return b.title.localeCompare(a.title);
            if (sortMode === 'folder_asc') return normalizeFolder(a.folder).localeCompare(normalizeFolder(b.folder)) || compareCreatedDesc(a, b);
            if (sortMode === 'status_asc') return a.status.localeCompare(b.status) || compareCreatedDesc(a, b);
            return compareCreatedDesc(a, b);
        });

        return filtered;
    }, [podcasts, searchQuery, selectedFolder, sortMode]);

    const selectedFolderCount = selectedFolder === ALL_FOLDERS
        ? podcasts.length
        : folderCounts.get(selectedFolder) || 0;
    const selectedTitle = selectedFolder === ALL_FOLDERS ? 'All Podcasts' : selectedFolder;
    const canRenameSelectedFolder = selectedFolder !== ALL_FOLDERS && selectedFolder !== DEFAULT_FOLDER;
    const canDeleteSelectedFolder = selectedFolder !== ALL_FOLDERS && selectedFolder !== DEFAULT_FOLDER;

    useEffect(() => {
        settingsRef.current = { apiKey, geminiModel, transcriptionPrompt };
    }, [apiKey, geminiModel, transcriptionPrompt]);

    useEffect(() => {
        if (selectedFolder !== ALL_FOLDERS && !folders.includes(selectedFolder)) {
            setSelectedFolder(ALL_FOLDERS);
        }
    }, [folders, selectedFolder]);

    useEffect(() => {
        if (selectedFolder !== ALL_FOLDERS) {
            setImportFolder(selectedFolder);
        } else if (!folders.includes(importFolder)) {
            setImportFolder(DEFAULT_FOLDER);
        }
    }, [folders, importFolder, selectedFolder]);

    useEffect(() => {
        if (!isSupabaseConfigured()) {
            return undefined;
        }

        fetchPodcasts();

        const channel = supabase
            .channel('public:podcasts')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'podcasts' }, () => {
                fetchPodcasts();
            })
            .subscribe();

        const pollInterval = setInterval(() => {
            fetchPodcasts();
        }, 3000);

        return () => {
            supabase.removeChannel(channel);
            clearInterval(pollInterval);
        };
    }, []);

    useEffect(() => {
        if (!canUseLocalFeatures || !canProcessAudio(apiKey)) return;

        const resumable = podcasts
            .filter((podcast) => RESUMABLE_STATUSES.has(podcast.status))
            .map((podcast) => ({ id: podcast.id }));

        enqueueProcessingRef.current(resumable);
    }, [podcasts, apiKey]);

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
            console.error('Error fetching podcasts:', err);
            setConnectionError(formatSupabaseError(err));
        } finally {
            setLoading(false);
        }
    }

    function enqueueProcessing(items) {
        if (!Array.isArray(items) || items.length === 0) return;

        let queuedCount = 0;
        items.forEach((item) => {
            const id = typeof item === 'string' ? item : item?.id;
            if (!id || processingIdsRef.current.has(id)) return;

            processingIdsRef.current.add(id);
            processingQueueRef.current.push({
                id,
                file: typeof item === 'string' ? null : item.file || null,
            });
            queuedCount += 1;
        });

        if (queuedCount > 0) {
            runProcessingQueue();
        }
    }

    async function runProcessingQueue() {
        if (processingActiveRef.current) return;
        if (!canProcessAudio(settingsRef.current.apiKey)) return;

        const nextItem = processingQueueRef.current.shift();
        if (!nextItem) return;

        processingActiveRef.current = true;
        const { apiKey: currentApiKey, geminiModel: currentModel, transcriptionPrompt: currentPrompt } = settingsRef.current;

        const updateLocalStatus = (message) => {
            setPodcasts(prev => prev.map(podcast => (
                podcast.id === nextItem.id
                    ? { ...podcast, status: PodcastStatus.PROCESSING, progress: message, error: null }
                    : podcast
            )));
        };

        try {
            await PodcastService.processPodcast(
                nextItem.id,
                currentApiKey,
                currentModel,
                currentPrompt,
                updateLocalStatus,
                nextItem.file
            );
        } catch (err) {
            console.error(err);
            setPodcasts(prev => prev.map(podcast => (
                podcast.id === nextItem.id
                    ? { ...podcast, status: PodcastStatus.ERROR, error: err.message }
                    : podcast
            )));
        } finally {
            await fetchPodcasts();
            processingIdsRef.current.delete(nextItem.id);
            processingActiveRef.current = false;

            if (processingQueueRef.current.length > 0) {
                runProcessingQueue();
            }
        }
    }

    const handleFileSelect = async (event) => {
        const input = event.target;
        const files = Array.from(input.files || []);
        if (files.length === 0) return;
        if (!isSupabaseConfigured()) {
            alert('Supabase is not configured. Open Settings and fill in Supabase URL and anon key.');
            input.value = '';
            return;
        }

        const targetFolder = normalizeFolder(selectedFolder === ALL_FOLDERS ? importFolder : selectedFolder);
        const uploadedItems = new Array(files.length);
        const failures = [];

        try {
            addCustomFolder(targetFolder);

            let completed = 0;
            setUploadState({
                status: 'loading',
                message: files.length === 1
                    ? `Uploading ${files[0].name} to ${targetFolder}...`
                    : `Uploading 0/${files.length} files to ${targetFolder}...`,
            });

            await runWithConcurrency(files, UPLOAD_CONCURRENCY, async (file, index) => {
                try {
                    setUploadState({
                        status: 'loading',
                        message: files.length === 1
                            ? `Uploading ${file.name} to ${targetFolder}...`
                            : `Uploading ${index + 1}/${files.length}: ${file.name}`,
                    });

                    const id = await PodcastService.importPodcast(file, { folder: targetFolder });
                    uploadedItems[index] = { id, file };
                    completed += 1;

                    setUploadState({
                        status: 'loading',
                        message: files.length === 1
                            ? `${file.name} uploaded. Queueing processing...`
                            : `Uploaded ${completed}/${files.length} files. Queueing processing...`,
                    });
                } catch (err) {
                    failures.push({ file, error: err });
                    console.error(`Import failed for ${file.name}`, err);
                }
            });

            await fetchPodcasts();

            const successfulItems = uploadedItems.filter(Boolean);
            if (canProcessAudio(apiKey)) {
                enqueueProcessing(successfulItems);
            } else if (successfulItems.length > 0) {
                alert('Audio uploaded. Enable Local WhisperX Engine or add a Gemini API key in Settings to process it.');
            }

            if (failures.length > 0) {
                const failedNames = failures.map(({ file }) => file.name).join(', ');
                setUploadState({
                    status: 'error',
                    message: `${failures.length} file${failures.length === 1 ? '' : 's'} failed: ${failedNames}`,
                });
                alert(`Some files failed to import:\n\n${failedNames}`);
            } else {
                setUploadState({
                    status: 'success',
                    message: `${successfulItems.length} file${successfulItems.length === 1 ? '' : 's'} uploaded${canProcessAudio(apiKey) ? ' and queued for processing' : ''}.`,
                });
                setTimeout(() => setUploadState({ status: 'idle', message: '' }), 3000);
            }
        } catch (err) {
            console.error('Import failed', err);
            setUploadState({ status: 'error', message: formatSupabaseError(err) });
            alert(`Failed to import podcast.\n\n${formatSupabaseError(err)}\n\nOpen Settings > App Connection and click Test Connection.`);
        } finally {
            input.value = '';
        }
    };

    const handleProcess = (podcastId) => {
        if (!canProcessAudio(apiKey)) {
            navigate('/settings');
            return;
        }

        enqueueProcessing([{ id: podcastId }]);
    };

    const handleCreateFolder = (event) => {
        event?.preventDefault();
        const folder = normalizeFolder(newFolderName);
        addCustomFolder(folder);
        setImportFolder(folder);
        setSelectedFolder(folder);
        setNewFolderName('');
    };

    const handleFolderChange = async (podcastId, folder) => {
        const nextFolder = normalizeFolder(folder);
        setPodcasts(prev => prev.map(podcast => (
            podcast.id === podcastId ? { ...podcast, folder: nextFolder } : podcast
        )));
        addCustomFolder(nextFolder);

        try {
            await PodcastService.updatePodcastFolder(podcastId, nextFolder);
        } catch (err) {
            console.error('Folder update failed', err);
            alert(err.message || 'Failed to update folder.');
            fetchPodcasts();
        }
    };

    const startRenameFolder = () => {
        setRenameValue(selectedFolder);
        setRenamingFolder(true);
    };

    const cancelRenameFolder = () => {
        setRenamingFolder(false);
        setRenameValue('');
    };

    const confirmRenameFolder = async () => {
        if (!canRenameSelectedFolder) return;
        const source = selectedFolder;
        const target = normalizeFolder(renameValue);
        if (!target || target === source) {
            cancelRenameFolder();
            return;
        }
        if (folders.includes(target)) {
            alert('A folder with that name already exists.');
            return;
        }

        setRenamingFolder(false);
        setFolderState({ status: 'loading', message: `Renaming ${source}...` });
        setPodcasts(prev => prev.map(podcast => (
            normalizeFolder(podcast.folder) === source ? { ...podcast, folder: target } : podcast
        )));
        replaceCustomFolder(source, target);
        setSelectedFolder(target);
        if (importFolder === source) setImportFolder(target);

        try {
            await PodcastService.renameFolder(source, target);
            setFolderState({ status: 'success', message: `Renamed to ${target}.` });
            setTimeout(() => setFolderState({ status: 'idle', message: '' }), 2500);
        } catch (err) {
            console.error('Folder rename failed', err);
            setFolderState({ status: 'error', message: err.message || 'Folder rename failed.' });
            fetchPodcasts();
        }
    };

    const handleDeleteFolder = async () => {
        if (!canDeleteSelectedFolder) return;
        const folder = selectedFolder;
        const count = folderCounts.get(folder) || 0;
        const shouldMove = count > 0
            ? window.confirm(`Move ${count} podcast${count === 1 ? '' : 's'} from "${folder}" to Inbox?`)
            : window.confirm(`Delete empty folder "${folder}"?`);
        if (!shouldMove) return;

        setFolderState({ status: 'loading', message: `Moving ${folder} to Inbox...` });
        setPodcasts(prev => prev.map(podcast => (
            normalizeFolder(podcast.folder) === folder ? { ...podcast, folder: DEFAULT_FOLDER } : podcast
        )));
        removeCustomFolder(folder);
        setSelectedFolder(DEFAULT_FOLDER);
        if (importFolder === folder) setImportFolder(DEFAULT_FOLDER);

        try {
            await PodcastService.moveFolderContents(folder, DEFAULT_FOLDER);
            setFolderState({ status: 'success', message: `${folder} moved to Inbox.` });
            setTimeout(() => setFolderState({ status: 'idle', message: '' }), 2500);
        } catch (err) {
            console.error('Folder delete failed', err);
            setFolderState({ status: 'error', message: err.message || 'Folder delete failed.' });
            fetchPodcasts();
        }
    };

    const handleDeleteClick = (event, id) => {
        event.stopPropagation();
        event.preventDefault();
        setDeleteConfirmId(id);
    };

    const confirmDelete = async (event, id) => {
        event.stopPropagation();
        event.preventDefault();
        setDeletingIds(prev => new Set(prev).add(id));
        setDeleteState({ status: 'loading', message: 'Deleting podcast...' });
        try {
            await PodcastService.deletePodcast(id);
            setDeleteConfirmId(null);
            setDeleteState({ status: 'success', message: 'Podcast deleted.' });
            setTimeout(() => setDeleteState({ status: 'idle', message: '' }), 2500);
            setPodcasts(prev => prev.filter(podcast => podcast.id !== id));
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

    const cancelDelete = (event) => {
        event.stopPropagation();
        event.preventDefault();
        setDeleteConfirmId(null);
    };

    function addCustomFolder(folder) {
        persistCustomFolders(prev => sortFolders([...new Set([...prev, normalizeFolder(folder)])]));
    }

    function removeCustomFolder(folder) {
        persistCustomFolders(prev => prev.filter(item => item !== folder));
    }

    function replaceCustomFolder(source, target) {
        persistCustomFolders(prev => sortFolders([...new Set(prev.map(folder => (
            folder === source ? target : folder
        )).concat(target))]));
    }

    function persistCustomFolders(updater) {
        setCustomFolders(prev => {
            const next = sortFolders([...new Set(updater(prev).map(normalizeFolder))]);
            writeCustomFolders(next);
            return next;
        });
    }

    if (loading) {
        return <div className="container" style={{ display: 'flex', justifyContent: 'center', marginTop: '50px' }}><Loader className={styles.spin} /></div>;
    }

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
                    <h1>Library</h1>
                    <p className={styles.subtitle}>{podcasts.length} podcasts across {folders.length} folders</p>
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
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleFileSelect}
                />
            </header>

            <div className={styles.libraryShell}>
                {/* Desktop Tabs */}
                <div className={styles.folderTabs}>
                    <button
                        type="button"
                        className={`${styles.tabItem} ${selectedFolder === ALL_FOLDERS ? styles.tabActive : ''}`}
                        onClick={() => setSelectedFolder(ALL_FOLDERS)}
                    >
                        <FolderOpen size={16} />
                        <span>All Podcasts</span>
                        <span className={styles.tabCount}>{podcasts.length}</span>
                    </button>

                    {folders.map((folder) => {
                        const isActive = selectedFolder === folder;
                        return (
                            <button
                                type="button"
                                key={folder}
                                className={`${styles.tabItem} ${isActive ? styles.tabActive : ''}`}
                                onClick={() => setSelectedFolder(folder)}
                            >
                                {isActive ? <FolderOpen size={16} /> : <Folder size={16} />}
                                <span>{folder}</span>
                                <span className={styles.tabCount}>{folderCounts.get(folder) || 0}</span>
                            </button>
                        );
                    })}

                    <form className={styles.newFolderForm} onSubmit={handleCreateFolder}>
                        <input
                            value={newFolderName}
                            onChange={(event) => setNewFolderName(event.target.value)}
                            placeholder="New folder"
                            aria-label="New folder"
                        />
                        <button
                            type="submit"
                            disabled={!newFolderName.trim()}
                            title="Create folder"
                        >
                            <Plus size={16} />
                        </button>
                    </form>
                </div>

                {/* Mobile Dropdown & New Folder */}
                <div className={styles.mobileFolderControls}>
                    <div className={styles.mobileSelectWrapper}>
                        <FolderOpen size={18} className={styles.mobileSelectIcon} />
                        <select
                            className={styles.mobileSelect}
                            value={selectedFolder}
                            onChange={(e) => setSelectedFolder(e.target.value)}
                        >
                            <option value={ALL_FOLDERS}>All Podcasts ({podcasts.length})</option>
                            {folders.map(folder => (
                                <option key={folder} value={folder}>{folder} ({folderCounts.get(folder) || 0})</option>
                            ))}
                        </select>
                    </div>
                    <form className={styles.mobileNewFolderForm} onSubmit={handleCreateFolder}>
                        <input
                            value={newFolderName}
                            onChange={(event) => setNewFolderName(event.target.value)}
                            placeholder="New folder..."
                            aria-label="New folder"
                        />
                        <button type="submit" disabled={!newFolderName.trim()}>
                            <Plus size={18} />
                        </button>
                    </form>
                </div>

                <section className={styles.contentPane}>
                    <div className={styles.folderToolbar}>
                        <div className={styles.currentFolder}>
                            <div className={styles.currentFolderIcon}>
                                {selectedFolder === ALL_FOLDERS ? <FolderOpen size={22} /> : <Folder size={22} />}
                            </div>

                            {renamingFolder ? (
                                <div className={styles.renameControl}>
                                    <input
                                        value={renameValue}
                                        onChange={(event) => setRenameValue(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') confirmRenameFolder();
                                            if (event.key === 'Escape') cancelRenameFolder();
                                        }}
                                        autoFocus
                                    />
                                    <button type="button" onClick={confirmRenameFolder} title="Save folder name">
                                        <Check size={16} />
                                    </button>
                                    <button type="button" onClick={cancelRenameFolder} title="Cancel rename">
                                        <X size={16} />
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <div className={styles.currentFolderText}>
                                        <h2>{selectedTitle}</h2>
                                        <p>{selectedFolderCount} podcast{selectedFolderCount === 1 ? '' : 's'}</p>
                                    </div>
                                    <div className={styles.folderActions}>
                                        {canRenameSelectedFolder && (
                                            <button type="button" onClick={startRenameFolder} title="Rename folder">
                                                <Pencil size={16} />
                                            </button>
                                        )}
                                        {canDeleteSelectedFolder && (
                                            <button type="button" onClick={handleDeleteFolder} title="Move folder contents to Inbox">
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>

                        <div className={styles.toolbarControls}>
                            <label className={styles.searchBox}>
                                <Search size={16} />
                                <input
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    placeholder="Search"
                                />
                            </label>

                            {canUseLocalFeatures && (
                                <label className={styles.compactField}>
                                    <span>Import to</span>
                                    <select
                                        value={importFolder}
                                        onChange={(event) => setImportFolder(event.target.value)}
                                    >
                                        {folders.map(folder => (
                                            <option key={folder} value={folder}>{folder}</option>
                                        ))}
                                    </select>
                                </label>
                            )}

                            <label className={styles.compactField}>
                                <span>Sort</span>
                                <select
                                    value={sortMode}
                                    onChange={(event) => setSortMode(event.target.value)}
                                >
                                    <option value="created_desc">Newest</option>
                                    <option value="title_asc">Title A-Z</option>
                                    <option value="title_desc">Title Z-A</option>
                                    <option value="folder_asc">Folder</option>
                                    <option value="status_asc">Status</option>
                                </select>
                            </label>
                        </div>
                    </div>

                    {(uploadState.status !== 'idle' || deleteState.status !== 'idle' || folderState.status !== 'idle') && (
                        <div className={styles.operationStatus}>
                            <StatusLine state={uploadState} />
                            <StatusLine state={deleteState} />
                            <StatusLine state={folderState} />
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
                            <p>
                                {searchQuery
                                    ? 'Try a different search.'
                                    : canUseLocalFeatures
                                        ? 'Import an audio file or choose another folder.'
                                        : 'Processed podcasts from Supabase will appear here.'}
                            </p>
                        </div>
                    ) : (
                        <div className={styles.grid}>
                            {displayedPodcasts.map(podcast => (
                                <div
                                    key={podcast.id}
                                    className={styles.card}
                                    onClick={() => podcast.status === PodcastStatus.READY && navigate(`/player/${podcast.id}`)}
                                >
                                    <div className={styles.cardIcon}>
                                        {podcast.status === PodcastStatus.PROCESSING ? (
                                            <Loader className={styles.spin} />
                                        ) : podcast.status === PodcastStatus.ERROR ? (
                                            <AlertTriangle color="#ef4444" />
                                        ) : (
                                            <Play fill="currentColor" />
                                        )}
                                    </div>

                                    <div className={styles.cardContent}>
                                        <h3 className={styles.cardTitle}>{podcast.title}</h3>
                                        <div className={styles.cardMeta}>
                                            <span>{new Date(podcast.created_at).toLocaleDateString()}</span>
                                            <span className={styles.statusBadge} data-status={podcast.status}>
                                                {podcast.status}
                                            </span>
                                        </div>
                                        {podcast.status === PodcastStatus.PROCESSING && podcast.progress && (
                                            <p className={styles.progressText}>{podcast.progress}</p>
                                        )}
                                        {podcast.status === PodcastStatus.ERROR && (
                                            <p className={styles.errorText}>Error: {podcast.error || 'Unknown'}</p>
                                        )}
                                    </div>

                                    <div className={styles.cardActions}>
                                        <div className={styles.moveFieldWrapper} title="Change folder" onClick={(event) => event.stopPropagation()}>
                                            <Folder size={16} />
                                            <select
                                                value={normalizeFolder(podcast.folder)}
                                                onChange={(event) => handleFolderChange(podcast.id, event.target.value)}
                                                className={styles.moveSelect}
                                            >
                                                {folders.map(folder => (
                                                    <option key={folder} value={folder}>{folder}</option>
                                                ))}
                                            </select>
                                        </div>
                                        {podcast.status !== PodcastStatus.READY && canUseLocalFeatures && (
                                            <button
                                                className={styles.iconButton}
                                                onClick={(event) => { event.stopPropagation(); handleProcess(podcast.id); }}
                                                title="Start or retry processing"
                                                disabled={deletingIds.has(podcast.id)}
                                            >
                                                <Clock size={18} />
                                            </button>
                                        )}
                                        {canUseLocalFeatures && (
                                            deleteConfirmId === podcast.id ? (
                                                <div className={styles.confirmDelete}>
                                                    <button
                                                        onClick={(event) => confirmDelete(event, podcast.id)}
                                                        className={styles.confirmBtn}
                                                        disabled={deletingIds.has(podcast.id)}
                                                    >
                                                        {deletingIds.has(podcast.id) ? '...' : 'Yes'}
                                                    </button>
                                                    <button
                                                        onClick={cancelDelete}
                                                        className={styles.cancelBtn}
                                                        disabled={deletingIds.has(podcast.id)}
                                                    >
                                                        No
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    className={styles.iconButton}
                                                    onClick={(event) => handleDeleteClick(event, podcast.id)}
                                                    title="Delete podcast"
                                                    disabled={deletingIds.has(podcast.id)}
                                                >
                                                    {deletingIds.has(podcast.id) ? <Loader size={18} className={styles.spin} /> : <Trash2 size={18} />}
                                                </button>
                                            )
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            {canUseLocalFeatures && (
                <div className={styles.logSection}>
                    <LogViewer />
                </div>
            )}
        </div>
    );
}

function StatusLine({ state }) {
    if (state.status === 'idle') return null;

    return (
        <div className={styles.statusLine} data-status={state.status}>
            {state.status === 'loading' && <Loader size={16} className={styles.spin} />}
            {state.status === 'success' && <CheckCircle size={16} />}
            {state.status === 'error' && <AlertTriangle size={16} />}
            <span>{state.message}</span>
        </div>
    );
}

function readCustomFolders() {
    if (typeof localStorage === 'undefined') return [];

    try {
        const parsed = JSON.parse(localStorage.getItem(CUSTOM_FOLDERS_KEY) || '[]');
        if (!Array.isArray(parsed)) return [];
        return sortFolders([...new Set(parsed.map(normalizeFolder).filter(folder => folder !== DEFAULT_FOLDER))]);
    } catch {
        return [];
    }
}

function writeCustomFolders(folders) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CUSTOM_FOLDERS_KEY, JSON.stringify(sortFolders(folders).filter(folder => folder !== DEFAULT_FOLDER)));
}

function sortFolders(folders) {
    return [...new Set(folders.map(normalizeFolder))]
        .sort((a, b) => {
            if (a === DEFAULT_FOLDER) return -1;
            if (b === DEFAULT_FOLDER) return 1;
            return a.localeCompare(b);
        });
}

function compareCreatedDesc(a, b) {
    return `${b.created_at || ''}`.localeCompare(`${a.created_at || ''}`);
}

async function runWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await worker(items[index], index);
        }
    });

    await Promise.all(workers);
    return results;
}

function canProcessAudio(apiKey) {
    return Boolean(apiKey?.trim()) || !isLocalEngineDisabled();
}
