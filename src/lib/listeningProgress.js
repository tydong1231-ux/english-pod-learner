export const LISTENING_KEY = 'podfluent-listening-progress-v1';
const CHANGED = 'podfluent-listening-progress-changed';
let cachedText;
let cachedRecords = {};

export function listeningKey(source, id) {
    return JSON.stringify([source.replace(/\/$/, ''), String(id)]);
}

export function getListeningSnapshot() {
    let text = null;
    try { text = localStorage.getItem(LISTENING_KEY); } catch { /* Keep this session usable when storage is unavailable. */ }
    if (text !== cachedText) {
        cachedText = text;
        try {
            const value = JSON.parse(text || '{}');
            cachedRecords = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch { cachedRecords = {}; }
    }
    return cachedRecords;
}

export function subscribeListening(listener) {
    const storage = event => { if (!event.key || event.key === LISTENING_KEY) listener(); };
    window.addEventListener(CHANGED, listener);
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener(CHANGED, listener); window.removeEventListener('storage', storage); };
}

export function listeningState(record, fallbackDuration = 0) {
    const duration = Number.isFinite(record?.duration) && record.duration > 0 ? record.duration : fallbackDuration;
    const position = Number.isFinite(record?.position) ? Math.max(0, record.position) : 0;
    const completed = record?.completed === true || (duration > 0 && position >= duration);
    const started = completed || record?.started === true || position > 0;
    return { position, duration, completed, started, percent: completed ? 100 : duration > 0 ? Math.min(99, Math.floor(position / duration * 100)) : 0 };
}

export function saveListeningProgress({ source, id, position, duration, completed = false }) {
    if (id == null || !Number.isFinite(position) || position < 0) return;
    const records = getListeningSnapshot();
    const key = listeningKey(source, id);
    const previous = records[key];
    if (!previous && position === 0 && !completed) return;
    const record = {
        lastPlayedAt: previous?.lastPlayedAt,
        position,
        duration: Number.isFinite(duration) && duration > 0 ? duration : previous?.duration || 0,
        started: previous?.started || position > 0 || completed,
        completed: previous?.completed === true || completed,
        updatedAt: new Date().toISOString(),
    };
    // Synchronous small metadata writes also finish during pagehide on iOS.
    localStorage.setItem(LISTENING_KEY, JSON.stringify({ ...records, [key]: record }));
    window.dispatchEvent(new Event(CHANGED));
}

export function newestUnplayed(episodes, progressFor) {
    return episodes.filter(episode => !listeningState(progressFor(episode)).started)
        .reduce((latest, episode) => !latest || (Date.parse(episode.created_at) || 0) > (Date.parse(latest.created_at) || 0) ? episode : latest, null);
}

export function markLastPlayed(source, id) {
    const records = getListeningSnapshot();
    const key = listeningKey(source, id);
    localStorage.setItem(LISTENING_KEY, JSON.stringify({ ...records, [key]: {
        ...records[key], started: true, lastPlayedAt: new Date().toISOString(),
    } }));
    window.dispatchEvent(new Event(CHANGED));
}

export function mostRecentlyPlayed(episodes, progressFor) {
    let latest = null, timestamp = 0;
    const explicitlyPlayed = episodes.some(episode => progressFor(episode)?.lastPlayedAt);
    for (const episode of episodes) {
        const progress = progressFor(episode);
        if (explicitlyPlayed && !progress?.lastPlayedAt) continue;
        const time = Date.parse(progress?.lastPlayedAt || progress?.updatedAt || progress?.progressUpdatedAt) || 0;
        if (listeningState(progress).started && time > timestamp) { latest = episode; timestamp = time; }
    }
    return latest;
}
