import { useState, useCallback, useRef } from 'react';

export function useAudioPlayer() {
    const audioElementRef = useRef(null);
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

    const playAudio = useCallback((audio) => {
        return audio.play().catch(err => {
            console.error('Play failed:', err);
            setIsPlaying(false);
        });
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
            audio.pause();
        }
    }, [playAudio]);

    const seek = useCallback((time) => {
        const audio = audioElementRef.current;
        if (audio) {
            const shouldResume = !audio.paused;
            audio.currentTime = Math.max(0, Math.min(time, audio.duration || Infinity));
            setCurrentTime(audio.currentTime);

            if (shouldResume) {
                const resume = () => playAudio(audio);
                if (audio.readyState >= 3) {
                    resume();
                } else {
                    audio.addEventListener('canplay', resume, { once: true });
                }
            }
        }
    }, [playAudio]);

    const playFrom = useCallback((time) => {
        const audio = audioElementRef.current;
        if (!audio) return;

        audio.currentTime = Math.max(0, Math.min(time, audio.duration || Infinity));
        setCurrentTime(audio.currentTime);

        const playWhenReady = () => playAudio(audio);
        if (audio.readyState >= 3) {
            playWhenReady();
        } else {
            audio.addEventListener('canplay', playWhenReady, { once: true });
        }
    }, [playAudio]);

    return {
        audioRef,
        isPlaying,
        currentTime,
        duration,
        togglePlay,
        seek,
        playFrom,
        checkDuration,
    };
}
