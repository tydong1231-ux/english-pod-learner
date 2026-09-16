import { useState, useCallback, useRef } from 'react';

export function useAudioPlayer() {
    const audioElementRef = useRef(null);
    const playRequestRef = useRef(0);
    const [playbackError, setPlaybackError] = useState('');
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    const handleTimeUpdate = useCallback(() => {
        const audio = audioElementRef.current;
        if (audio) {
            setCurrentTime(audio.currentTime);
        }
    }, []);

    const handleDurationChange = useCallback(() => {
        const audio = audioElementRef.current;
        if (audio && audio.duration && Number.isFinite(audio.duration) && audio.duration > 0) {
            console.log('[Audio] Duration detected:', audio.duration);
            setDuration(audio.duration);
        }
    }, []);

    const handleEnded = useCallback(() => {
        setIsPlaying(false);
    }, []);

    const handlePlay = useCallback(() => {
        console.log('[Audio] Play event');
        setIsPlaying(true);
    }, []);

    const handlePause = useCallback(() => {
        setIsPlaying(false);
    }, []);

    const audioRef = useCallback((audioElement) => {
        if (audioElementRef.current) {
            const old = audioElementRef.current;
            playRequestRef.current++;
            old.pause();
            old.removeEventListener('timeupdate', handleTimeUpdate);
            old.removeEventListener('durationchange', handleDurationChange);
            old.removeEventListener('loadedmetadata', handleDurationChange);
            old.removeEventListener('canplay', handleDurationChange);
            old.removeEventListener('ended', handleEnded);
            old.removeEventListener('play', handlePlay);
            old.removeEventListener('pause', handlePause);
        }

        audioElementRef.current = audioElement;

        if (audioElement) {
            console.log('[Audio] Callback ref called, attaching listeners');
            audioElement.addEventListener('timeupdate', handleTimeUpdate);
            audioElement.addEventListener('durationchange', handleDurationChange);
            audioElement.addEventListener('loadedmetadata', handleDurationChange);
            audioElement.addEventListener('canplay', handleDurationChange);
            audioElement.addEventListener('ended', handleEnded);
            audioElement.addEventListener('play', handlePlay);
            audioElement.addEventListener('pause', handlePause);

            if (audioElement.readyState >= 1 && Number.isFinite(audioElement.duration)) {
                console.log('[Audio] Already loaded on ref attach, duration:', audioElement.duration);
                setDuration(audioElement.duration);
            }
        }
    }, [
        handleDurationChange,
        handleEnded,
        handlePause,
        handlePlay,
        handleTimeUpdate,
    ]);

    const checkDuration = useCallback(() => {
        const audio = audioElementRef.current;
        if (audio && audio.duration && Number.isFinite(audio.duration) && audio.duration > 0) {
            console.log('[Audio] checkDuration called, found duration:', audio.duration);
            setDuration(audio.duration);
        }
    }, []);

    const playAudio = useCallback(async (audio) => {
        const request = ++playRequestRef.current;
        setPlaybackError('');
        try {
            // play() waits for media readiness itself. Calling it now also preserves
            // user activation when playback was requested by a tap.
            await audio.play();
        } catch (error) {
            if (request !== playRequestRef.current || error.name === 'AbortError') return;
            setIsPlaying(false);
            setPlaybackError(error.name === 'NotAllowedError'
                ? 'Your browser paused automatic playback. Tap Play to continue.'
                : 'Playback could not start. Tap Play to retry.');
        }
    }, []);

    const play = useCallback(() => {
        const audio = audioElementRef.current;
        if (audio) return playAudio(audio);
    }, [playAudio]);

    const pauseAudio = useCallback(() => {
        const audio = audioElementRef.current;
        if (!audio) return;

        playRequestRef.current++;
        audio.pause();
        setIsPlaying(false);
    }, []);

    const togglePlay = useCallback(() => {
        const audio = audioElementRef.current;
        if (!audio) {
            console.error('[Audio] togglePlay: No audio element');
            return;
        }

        if (audio.paused) {
            console.log('[Audio] Attempting to play...');
            playAudio(audio);
        } else {
            pauseAudio();
        }
    }, [playAudio, pauseAudio]);

    const seek = useCallback((time) => {
        const audio = audioElementRef.current;
        if (audio) {
            const shouldResume = !audio.paused;
            audio.currentTime = Math.max(0, Math.min(time, audio.duration || Infinity));
            setCurrentTime(audio.currentTime);

            if (shouldResume) {
                playAudio(audio);
            }
        }
    }, [playAudio]);

    const playFrom = useCallback((time) => {
        const audio = audioElementRef.current;
        if (!audio) return;

        audio.currentTime = Math.max(0, Math.min(time, audio.duration || Infinity));
        setCurrentTime(audio.currentTime);

        playAudio(audio);
    }, [playAudio]);

    const reset = useCallback(() => {
        const audio = audioElementRef.current;
        if (audio) {
            pauseAudio();
            audio.currentTime = 0;
        }
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
        setPlaybackError('');
    }, [pauseAudio]);

    return {
        audioRef,
        play,
        playbackError,
        isPlaying,
        currentTime,
        duration,
        togglePlay,
        pauseAudio,
        seek,
        playFrom,
        checkDuration,
        reset,
    };
}
