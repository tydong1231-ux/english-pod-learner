import { useState, useEffect } from 'react';
import { getRemoteAccessPassword, RUNTIME_CONFIG_CHANGED } from '../lib/runtimeConfig';
import styles from './PasswordGate.module.css';

const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 5 * 60 * 1000;

export function PasswordGate({ children }) {
    const [initialLockout] = useState(readStoredLockout);
    const [isUnlocked, setIsUnlocked] = useState(readSessionAuth);
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [attempts, setAttempts] = useState(initialLockout.attempts);
    const [lockedUntil, setLockedUntil] = useState(initialLockout.lockedUntil);
    const [remainingTime, setRemainingTime] = useState(0);
    const [configuredPassword, setConfiguredPassword] = useState(getRemoteAccessPassword);

    const isConfigured = configuredPassword.trim().length > 0;

    useEffect(() => {
        const handleConfigChange = () => {
            setConfiguredPassword(getRemoteAccessPassword());
        };

        window.addEventListener(RUNTIME_CONFIG_CHANGED, handleConfigChange);
        return () => window.removeEventListener(RUNTIME_CONFIG_CHANGED, handleConfigChange);
    }, []);

    useEffect(() => {
        if (!lockedUntil) return undefined;

        const updateRemaining = () => {
            const remaining = Math.max(0, lockedUntil - Date.now());
            setRemainingTime(remaining);
            if (remaining === 0) {
                setLockedUntil(null);
                setAttempts(0);
                localStorage.removeItem('podfluent_lockout');
                localStorage.removeItem('podfluent_attempts');
            }
        };

        const immediate = setTimeout(updateRemaining, 0);
        const timer = setInterval(updateRemaining, 1000);
        return () => {
            clearTimeout(immediate);
            clearInterval(timer);
        };
    }, [lockedUntil]);

    const isLocked = Boolean(lockedUntil);

    const handleSubmit = (event) => {
        event.preventDefault();

        if (isLocked || !isConfigured) return;

        if (password === configuredPassword) {
            setIsUnlocked(true);
            sessionStorage.setItem('podfluent_auth', 'true');
            setError('');
            setAttempts(0);
            localStorage.removeItem('podfluent_attempts');
        } else {
            const newAttempts = attempts + 1;
            setAttempts(newAttempts);
            localStorage.setItem('podfluent_attempts', newAttempts.toString());

            if (newAttempts >= MAX_ATTEMPTS) {
                const lockoutTime = Date.now() + LOCKOUT_DURATION;
                setLockedUntil(lockoutTime);
                setRemainingTime(LOCKOUT_DURATION);
                localStorage.setItem('podfluent_lockout', lockoutTime.toString());
                setError('Too many incorrect attempts. Remote access is locked for 5 minutes.');
            } else {
                setError(`Incorrect password. ${MAX_ATTEMPTS - newAttempts} attempts remaining.`);
            }
        }
        setPassword('');
    };

    const formatTime = (ms) => {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    };

    if (isUnlocked) {
        return children;
    }

    if (!isConfigured) {
        return (
            <div className={styles.container}>
                <div className={styles.card}>
                    <h1 className={styles.title}>PodFluent</h1>
                    <p className={styles.subtitle}>Remote access is not configured.</p>
                    <p className={styles.hint}>
                        Set VITE_REMOTE_ACCESS_PASSWORD in your environment before publishing the web build.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <h1 className={styles.title}>PodFluent</h1>
                <p className={styles.subtitle}>Enter the remote access password.</p>

                <form onSubmit={handleSubmit} className={styles.form}>
                    <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Access password"
                        className={styles.input}
                        disabled={isLocked}
                        autoFocus
                    />
                    <button
                        type="submit"
                        className={styles.button}
                        disabled={isLocked || !password}
                    >
                        {isLocked ? `Locked ${formatTime(remainingTime)}` : 'Enter'}
                    </button>
                </form>

                {error && <p className={styles.error}>{error}</p>}

                <p className={styles.hint}>Authorized users only.</p>
            </div>
        </div>
    );
}

function readSessionAuth() {
    try {
        return sessionStorage.getItem('podfluent_auth') === 'true';
    } catch {
        return false;
    }
}

function readStoredLockout() {
    try {
        const storedLockout = localStorage.getItem('podfluent_lockout');
        const storedAttempts = localStorage.getItem('podfluent_attempts');
        return {
            lockedUntil: storedLockout ? Number.parseInt(storedLockout, 10) : null,
            attempts: storedAttempts ? Number.parseInt(storedAttempts, 10) : 0,
        };
    } catch {
        return { lockedUntil: null, attempts: 0 };
    }
}
