import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, Pause, SkipBack, SkipForward, ArrowLeft, Loader, Volume2, X, Timer } from 'lucide-react';

import { isSupabaseConfigured } from '../../lib/supabase';
import { useEpisodePlayback } from '../../hooks/useEpisodePlayback';
import { useStore } from '../../store';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { VocabularyDefinition } from '../../components/VocabularyDefinition';
import { TranscriptView } from './TranscriptView';
import { VocabService } from '../../services/vocab';

import styles from './PlayerPage.module.css';

const EPISODE_TIMER_OPTIONS = [1, 2, 3, 5];
const MINUTE_TIMER_OPTIONS = [30, 60, 90, 120];

export function PlayerPage() {
    const { id, offlineKey } = useParams();
    const navigate = useNavigate();

    const { audioRef, audioElementRef, isPlaying, seek, playFrom, currentTime, duration, playbackError: controlError } = useAudioPlayer();
    const { podcast, transcriptRecord, loading, audioStatus, audioError, playbackError: queueError, togglePlay } =
        useEpisodePlayback({ audioElementRef, id, offlineKey, navigate });
    const playbackError = queueError || controlError;
    const { apiKey, vocabProvider, openaiApiKey, openaiBaseUrl, openaiModel, sleepTimer, setSleepTimer, clearSleepTimer } = useStore();
    const [loadingVocab, setLoadingVocab] = useState(false);
    const [vocabCard, setVocabCard] = useState(null);
    const [timerNow, setTimerNow] = useState(Date.now);
    useEffect(() => {
        if (sleepTimer?.type !== 'time') return;
        const ticker = setInterval(() => setTimerNow(Date.now()), 1000);
        return () => clearInterval(ticker);
    }, [sleepTimer]);
    const speak = text => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        window.speechSynthesis.speak(utterance);
    };

    const handleSleepTimerChange = (event) => {
        const [type, rawAmount] = event.target.value.split(':');
        const amount = Number.parseInt(rawAmount, 10);
        if (!Number.isFinite(amount) || amount <= 0) return;

        setTimerNow(Date.now());
        if (type === 'episodes') {
            setSleepTimer({
                type: 'episodes',
                remainingEpisodes: amount,
                startedAt: Date.now(),
            });
        } else if (type === 'minutes') {
            setSleepTimer({
                type: 'time',
                deadline: Date.now() + amount * 60 * 1000,
                minutes: amount,
                startedAt: Date.now(),
            });
        }
    };

    const handleCancelSleepTimer = () => {
        clearSleepTimer();
        setTimerNow(Date.now());
    };

    const sleepTimerLabel = formatSleepTimerLabel(sleepTimer, timerNow);

    const handleSeek = (e) => {
        const time = parseFloat(e.target.value);
        seek(time);
    };

    const handleWordClick = async (wordObj, sentence) => {
        if (offlineKey) {
            if (wordObj.start !== undefined) seek(wordObj.start);
            return;
        }
        if (vocabProvider === 'openai' && !openaiApiKey) {
            alert("Please set OpenAI-compatible API key to generate vocabulary.");
            return;
        }

        if (vocabProvider !== 'openai' && !apiKey) {
            alert("Please set Gemini API key to generate vocabulary.");
            return;
        }

        // Seek to word start
        if (wordObj.start !== undefined) {
            seek(wordObj.start);
        }

        // Stop playback
        if (isPlaying) togglePlay();

        setLoadingVocab(true);
        setVocabCard(null); // Clear previous

        try {
            const wordText = typeof wordObj === 'string' ? wordObj : wordObj.word;
            const card = await VocabService.createVocabCard(wordText, sentence, id, apiKey, {
                provider: vocabProvider,
                openaiApiKey,
                openaiBaseUrl,
                openaiModel,
            });
            setVocabCard(card);
        } catch (err) {
            console.error(err);
            const message = err?.message || String(err);
            alert(`Failed to generate definition.\n\n${message}`);
        } finally {
            setLoadingVocab(false);
        }
    };

    const renderContent = () => {
        if (loading) return <div className="container" role="status" style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 50 }}><Loader className={styles.spin} />Loading episode...</div>;
        if (!offlineKey && !isSupabaseConfigured()) {
            return (
                <div className="container">
                    <button className={styles.backBtn} onClick={() => navigate('/')}>
                        <ArrowLeft size={20} />
                        Library
                    </button>
                    <p>Supabase is not configured. Open Settings and fill in Supabase URL and anon key.</p>
                </div>
            );
        }
        if (!podcast) return <div className="container"><p>{audioError || 'Podcast not found'}</p><button className="offline-button" onClick={() => navigate('/offline')}>Open Offline</button></div>;

        return (
            <div className={styles.page}>
                <header className={styles.header}>
                    <button className={styles.backBtn} onClick={() => navigate(offlineKey ? '/offline' : '/')}>
                        <ArrowLeft size={20} />
                        {offlineKey ? 'Offline' : 'Library'}
                    </button>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span className={styles.title}>{podcast.title}</span>
                        <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>
                            Status: {podcast.status} |
                            Dur: {formatTime(duration)}
                        </span>
                        {audioStatus && (
                            <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>
                                {audioStatus}
                            </span>
                        )}
                        {audioError && (
                            <span style={{ fontSize: '0.75rem', color: '#f59e0b' }}>
                                {audioError}
                            </span>
                        )}
                        {playbackError && (
                            <span role="alert" style={{ fontSize: '0.85rem', color: '#f59e0b' }}>
                                {playbackError}
                            </span>
                        )}
                    </div>
                </header>

                <div className={styles.content}>
                    <div className={styles.mainPanel}>
                        {transcriptRecord ? (
                            <TranscriptView
                                transcript={transcriptRecord}
                                currentTime={currentTime}
                                onSeek={seek}
                                onPlaySegment={playFrom}
                                onWordClick={handleWordClick}
                            />
                        ) : (
                            <div className={styles.noTranscript}>
                                <p>No transcript available.</p>
                            </div>
                        )}
                    </div>

                    {/* Helper/Vocab Sidebar (Temporary Overlay) */}
                    {(vocabCard || loadingVocab) && (
                        <div className={styles.vocabPanel}>
                            <div className={styles.vocabHeader}>
                                <h3>Vocabulary</h3>
                                <button type="button" onClick={() => setVocabCard(null)} title="Close vocabulary">
                                    <X size={18} />
                                </button>
                            </div>

                            {loadingVocab ? (
                                <div className={styles.loading}>
                                    <Loader className={styles.spin} /> Generating...
                                </div>
                            ) : (
                                <div className={styles.vocabCard}>
                                    <div className={styles.wordHeader}>
                                        <h2 className={styles.vocabWord}>{vocabCard.word}</h2>
                                        <Volume2 className={styles.speaker} onClick={() => speak(vocabCard.word)} size={20} />
                                    </div>
                                    <div className={styles.phonetic}>/{vocabCard.ipa}/</div>
                                    <VocabularyDefinition className={styles.definition} text={vocabCard.definition || vocabCard.meaning} />
                                    <div className={styles.translation}>{vocabCard.translation}</div>

                                    <div className={styles.examples}>
                                        <h4>Examples</h4>
                                        <ul>
                                            {(vocabCard.examples || []).map((ex, i) => (
                                                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    {ex}
                                                    <Volume2 size={14} onClick={() => speak(ex)} style={{ cursor: 'pointer', opacity: 0.7 }} />
                                                </li>
                                            ))}
                                        </ul>
                                    </div>

                                    <div className={styles.originalContext}>
                                        <strong>Context:</strong> "{vocabCard.context_sentence || vocabCard.originalSentence}"
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className={styles.playerBar}>
                    <div className={styles.controlRow}>
                        <div className={styles.sleepTimerControl}>
                            <label
                                className={[styles.sleepTimerPicker, sleepTimer ? styles.sleepTimerActive : ''].filter(Boolean).join(' ')}
                                title="Set sleep timer"
                            >
                                <Timer size={19} />
                                <select
                                    value=""
                                    onChange={handleSleepTimerChange}
                                    aria-label="Set sleep timer"
                                >
                                    <option value="" disabled>Sleep timer</option>
                                    <optgroup label="Episodes">
                                        {EPISODE_TIMER_OPTIONS.map((count) => (
                                            <option key={'episodes-' + count} value={'episodes:' + count}>
                                                {count} {count === 1 ? 'episode' : 'episodes'}
                                            </option>
                                        ))}
                                    </optgroup>
                                    <optgroup label="Minutes">
                                        {MINUTE_TIMER_OPTIONS.map((minutes) => (
                                            <option key={'minutes-' + minutes} value={'minutes:' + minutes}>
                                                {minutes} minutes
                                            </option>
                                        ))}
                                    </optgroup>
                                </select>
                            </label>

                            {sleepTimer && (
                                <>
                                    <span className={styles.sleepTimerStatus} aria-live="polite">
                                        {sleepTimerLabel}
                                    </span>
                                    <button
                                        type="button"
                                        className={styles.sleepTimerCancel}
                                        onClick={handleCancelSleepTimer}
                                        aria-label="Cancel sleep timer"
                                        title="Cancel sleep timer"
                                    >
                                        <X size={16} />
                                    </button>
                                </>
                            )}
                        </div>

                        <div className={styles.controls}>
                            <button onClick={() => seek(currentTime - 5)} aria-label="Back 5 seconds"><SkipBack size={20} /></button>
                            <button onClick={togglePlay} className={styles.playBtn} aria-label={isPlaying ? 'Pause' : 'Play'}>
                                {isPlaying ? <Pause fill="white" /> : <Play fill="white" className={styles.playIconOffset} />}
                            </button>
                            <button onClick={() => seek(currentTime + 5)} aria-label="Forward 5 seconds"><SkipForward size={20} /></button>
                        </div>

                        <div className={styles.controlSpacer} />
                    </div>

                    <div className={styles.progress}>
                        <span>{formatTime(currentTime)}</span>
                        <input
                            type="range"
                            min="0"
                            max={duration || 100}
                            value={currentTime}
                            onChange={handleSeek}
                            className={styles.seekBar}
                        />
                        <span>{formatTime(duration)}</span>
                    </div>

                </div>
            </div>
        );
    };

    // Keep the same media element across route loading states and episodes.
    // Replacing it discards the browser's playback permission for that element.
    return (
        <>
            <audio ref={audioRef} preload="auto" playsInline />
            {renderContent()}
        </>
    );
}

function formatTime(s) {
    if (!s) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

function formatSleepTimerLabel(timer, now) {
    if (timer?.type === 'episodes') {
        const count = Math.max(1, Number(timer.remainingEpisodes) || 1);
        return count + (count === 1 ? ' ep' : ' eps');
    }

    if (timer?.type === 'time') {
        const seconds = Math.max(0, Math.ceil((Number(timer.deadline) - now) / 1000));
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;

        if (hours > 0) {
            return hours + ':' + minutes.toString().padStart(2, '0') + ':' + remainingSeconds.toString().padStart(2, '0');
        }
        return minutes + ':' + remainingSeconds.toString().padStart(2, '0');
    }

    return '';
}
