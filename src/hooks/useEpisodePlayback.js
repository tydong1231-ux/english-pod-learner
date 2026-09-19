import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioQueue } from '../lib/audioQueue';
import { supabase } from '../lib/supabase';
import { useStore } from '../store';
import { cacheAudioForPodcast, checkAudioCache } from '../lib/audioCache';
import { currentSource, episodeKey, getOfflineEpisode, getOfflineEpisodeSummary, hasOfflineContent, saveOfflineProgress } from '../lib/offlineLibrary';
import { getListeningSnapshot, listeningKey, listeningState, markLastPlayed, saveListeningProgress } from '../lib/listeningProgress';
import { offlineAudioUrl } from '../lib/appShell';
import { isRemoteAccess, isWebBuild } from '../lib/env';

async function loadEpisode(key, offline) {
    let pod, record, source, url, savedRecord, objectUrl;
    if (offline) {
        record = await getOfflineEpisode(key);
        if (!hasOfflineContent(record)) throw new Error('Offline download unavailable. Download this episode again online.');
        pod = record.podcast;
        source = record.source;
        url = offlineAudioUrl(key) || (objectUrl = URL.createObjectURL(record.audioBlob));
        savedRecord = record;
    } else {
        const result = await supabase.from('podcasts').select('*').eq('id', key).single();
        if (result.error || !result.data) throw new Error('Cannot load this episode. Check your connection or open Offline.');
        pod = result.data;
        source = currentSource();
        url = isRemoteAccess && !isWebBuild ? `/audio-proxy?url=${encodeURIComponent(pod.audio_url)}` : pod.audio_url;
        try {
            const cached = await checkAudioCache(pod.id, pod.audio_url);
            if (cached) url = objectUrl = URL.createObjectURL(cached.audioBlob);
            savedRecord = await getOfflineEpisodeSummary(await episodeKey(source, pod.id));
        } catch { /* Streaming remains usable without device storage. */ }
    }
    const saved = listeningState(getListeningSnapshot()[listeningKey(source, pod.id)] || savedRecord);
    let disposed = false;
    const entry = {
        key, podcast: pod, source, offline, url, record,
        position: saved.completed ? 0 : saved.position,
        dispose: () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); },
    };
    // Warm the upcoming audio while this episode is still playing. Only change
    // the prepared URL, never the source already attached to the media element.
    if (!offline && !objectUrl) cacheAudioForPodcast(pod.id, pod.audio_url).then(blob => {
        if (disposed || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        entry.url = objectUrl;
    }).catch(() => {});
    return entry;
}

function readQueue(offline) {
    try {
        const value = offline ? JSON.parse(sessionStorage.getItem('podfluent-offline-queue') || '[]')
            : JSON.parse(localStorage.getItem('podfluent-playback-context') || '{}').orderedIds;
        return Array.isArray(value) ? value : [];
    } catch { return []; }
}

export function useEpisodePlayback({ audioElementRef, id, offlineKey, navigate }) {
    const engineRef = useRef(null);
    const navigateRef = useRef(navigate);
    useEffect(() => { navigateRef.current = navigate; }, [navigate]);
    const [entry, setEntry] = useState(null);
    const [transcriptRecord, setTranscriptRecord] = useState(null);
    const [audioError, setAudioError] = useState('');
    const [playbackError, setPlaybackError] = useState('');
    const offline = Boolean(offlineKey);
    useEffect(() => {
        const audio = audioElementRef.current;
        const expired = () => {
            const state = useStore.getState();
            if (state.sleepTimer?.type !== 'time' || Number(state.sleepTimer.deadline) > Date.now()) return false;
            state.clearSleepTimer();
            return true;
        };
        const engine = new AudioQueue(audio, {
            queue: readQueue(offline), load: key => loadEpisode(key, offline), expired,
            onError: setPlaybackError,
            onActive: next => {
                setEntry(next);
                setTranscriptRecord(next.offline ? { segments: next.record.segments } : null);
                setAudioError('');
                setPlaybackError('');
                navigateRef.current((offline ? '/offline/player/' : '/player/') + next.key, { replace: true });
                if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
                    try { navigator.mediaSession.metadata = new MediaMetadata({ title: next.podcast.title, artist: 'PodFluent', album: next.podcast.folder || 'Library' }); } catch { /* Metadata is optional, playback is not. */ }
                }
            },
            onPlay: active => {
                setPlaybackError('');
                if (active) { try { markLastPlayed(active.source, active.podcast.id); } catch { /* Playback must remain usable. */ } }
            },
            onProgress: (active, position, duration, completed) => {
                try { saveListeningProgress({ source: active.source, id: active.podcast.id, position, duration, completed }); }
                catch { setAudioError('Could not save listening progress. Check available website storage.'); }
                if (active.offline) saveOfflineProgress(active.key, position).catch(() => {});
            },
            onEnded: () => {
                const state = useStore.getState();
                const timer = state.sleepTimer;
                if (timer?.type !== 'episodes') return true;
                if (timer.remainingEpisodes <= 1) { state.clearSleepTimer(); return false; }
                state.setSleepTimer({ ...timer, remainingEpisodes: timer.remainingEpisodes - 1 });
                return true;
            },
        });
        engineRef.current = engine;
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* Optional Safari API. */ }
        const actions = {
            play: () => engine.start(), pause: () => engine.stop(),
            nexttrack: () => engine.advance(), previoustrack: () => engine.advance(false, -1),
            seekbackward: details => { audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10)); },
            seekforward: details => { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (details.seekOffset || 10)); },
            seekto: details => { audio.currentTime = details.seekTime; },
        };
        for (const [action, handler] of Object.entries(actions)) {
            try { navigator.mediaSession?.setActionHandler(action, handler); } catch { /* Unsupported action. */ }
        }
        const updateMediaState = () => {
            try { if (navigator.mediaSession) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing'; } catch { /* Optional. */ }
        };
        audio.addEventListener('play', updateMediaState);
        audio.addEventListener('pause', updateMediaState);
        const visibility = () => { engine.save(); if (document.visibilityState === 'visible') engine.recover(); };
        const save = () => engine.save();
        document.addEventListener('visibilitychange', visibility);
        window.addEventListener('pagehide', save);
        let timer;
        const schedule = () => {
            clearTimeout(timer);
            const value = useStore.getState().sleepTimer;
            if (value?.type === 'time') timer = setTimeout(() => { if (expired()) engine.stop(); }, Math.max(0, Number(value.deadline) - Date.now()));
        };
        const unsubscribe = useStore.subscribe((state, previous) => { if (state.sleepTimer !== previous.sleepTimer) schedule(); });
        schedule();
        return () => {
            unsubscribe(); clearTimeout(timer);
            audio.removeEventListener('play', updateMediaState);
            audio.removeEventListener('pause', updateMediaState);
            document.removeEventListener('visibilitychange', visibility);
            window.removeEventListener('pagehide', save);
            for (const action of Object.keys(actions)) { try { navigator.mediaSession?.setActionHandler(action, null); } catch { /* Optional. */ } }
            engine.dispose(); engineRef.current = null;
            try { if (navigator.mediaSession) navigator.mediaSession.playbackState = 'none'; } catch { /* Optional. */ }
        };
    }, [audioElementRef, offline]);

    useEffect(() => {
        let cancelled = false;
        engineRef.current?.select(String(offlineKey || id)).catch(error => { if (!cancelled) setAudioError(error.message); });
        return () => { cancelled = true; };
    }, [id, offlineKey]);

    useEffect(() => {
        let cancelled = false;
        if (entry && !entry.offline) {
            supabase.from('transcripts').select('*').eq('podcast_id', entry.podcast.id).single().then(({ data }) => {
                if (!cancelled && data) setTranscriptRecord({ segments: data.content });
            }).catch(() => {});
        }
        return () => { cancelled = true; };
    }, [entry]);

    const togglePlay = useCallback(() => {
        const engine = engineRef.current;
        if (engine) { if (engine.audio.paused) engine.start(); else engine.stop(); }
    }, []);
    return {
        podcast: entry?.podcast, transcriptRecord,
        loading: !audioError && entry?.key !== String(offlineKey || id),
        audioError, playbackError, togglePlay,
        audioStatus: offline ? 'Playing offline · audio and subtitles stored on this device.' : 'Ready · next episode prepared automatically.',
    };
}
