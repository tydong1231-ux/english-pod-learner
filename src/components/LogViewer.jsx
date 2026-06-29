import { useEffect, useState, useRef } from 'react';
import { ChevronDown, Terminal, Check, Loader, AlertCircle } from 'lucide-react';
import styles from './LogViewer.module.css';

export function LogViewer({ defaultCollapsed = true }) {
    const [logs, setLogs] = useState([]);
    const [collapsed, setCollapsed] = useState(defaultCollapsed);
    const [backendStatus, setBackendStatus] = useState({
        phase: 'starting',
        message: 'Starting Python backend...',
        ready: false
    });
    const endRef = useRef(null);

    useEffect(() => {
        // Electron IPC listener
        // Since contextIsolation is false, we can use window.require
        let ipcRenderer;
        try {
            const electron = window.require('electron');
            ipcRenderer = electron.ipcRenderer;
        } catch {
            console.warn('Electron IPC not available');
            return;
        }

        const handleLog = (event, { message, type }) => {
            setLogs(prev => [...prev.slice(-99), { message, type, timestamp: new Date() }]);
        };

        const handleStatus = (event, status) => {
            setBackendStatus(status);
        };

        ipcRenderer.on('server-log', handleLog);
        ipcRenderer.on('backend-status', handleStatus);
        ipcRenderer.invoke('get-backend-status')
            .then((status) => {
                if (status) setBackendStatus(status);
            })
            .catch(() => {
                // Older builds may not expose this helper yet.
            });

        return () => {
            ipcRenderer.removeListener('server-log', handleLog);
            ipcRenderer.removeListener('backend-status', handleStatus);
        };
    }, []);

    // Auto-scroll when not collapsed
    useEffect(() => {
        if (!collapsed) {
            endRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, collapsed]);

    const getStatusIcon = () => {
        if (backendStatus.phase === 'error') {
            return <AlertCircle size={14} className={styles.statusIconError} />;
        }
        if (backendStatus.ready) {
            return <Check size={14} className={styles.statusIconReady} />;
        }
        return <Loader size={14} className={styles.statusIconLoading} />;
    };

    const getStatusClass = () => {
        if (backendStatus.phase === 'error') return styles.statusError;
        if (backendStatus.ready) return styles.statusReady;
        return styles.statusLoading;
    };

    const handleClear = (e) => {
        e.stopPropagation();
        setLogs([]);
    };

    return (
        <div className={`${styles.container} ${collapsed ? styles.collapsed : ''}`}>
            <button
                className={styles.header}
                onClick={() => setCollapsed(!collapsed)}
                type="button"
            >
                <div className={styles.headerLeft}>
                    <ChevronDown
                        size={16}
                        className={`${styles.chevron} ${collapsed ? styles.chevronCollapsed : ''}`}
                    />
                    <Terminal size={16} className={styles.terminalIcon} />
                    <span className={styles.title}>Backend Logs</span>
                </div>
                <div className={styles.headerRight}>
                    <span className={`${styles.statusBadge} ${getStatusClass()}`}>
                        {getStatusIcon()}
                        <span>{backendStatus.message}</span>
                    </span>
                    {!collapsed && (
                        <button
                            onClick={handleClear}
                            className={styles.clearBtn}
                            type="button"
                        >
                            Clear
                        </button>
                    )}
                </div>
            </button>

            <div className={styles.logWindowWrapper}>
                <div className={styles.logWindow}>
                    {logs.length === 0 && (
                        <div className={styles.empty}>Waiting for logs...</div>
                    )}
                    {logs.map((log, i) => (
                        <div
                            key={i}
                            className={`${styles.logLine} ${log.type === 'error' ? styles.error : ''}`}
                        >
                            <span className={styles.timestamp}>
                                {log.timestamp.toLocaleTimeString()}
                            </span>
                            <span className={styles.message}>{log.message}</span>
                        </div>
                    ))}
                    <div ref={endRef} />
                </div>
            </div>
        </div>
    );
}
