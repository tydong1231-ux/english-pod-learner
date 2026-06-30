import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, Pause, SkipBack, SkipForward, ArrowLeft, Loader, Volume2 } from 'lucide-react';

import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useStore } from '../../store';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { TranscriptView } from './TranscriptView';
import { VocabService } from '../../services/vocab';
import { getCachedAudioUrl, checkAudioCache } from '../../lib/audioCache';

import styles from './PlayerPage.module.css';

export function PlayerPage() {
    const { id } = useParams();
    const navigate = useNavigate();

    // State for data
    const [podcast, setPodcast] = useState(null);
    const [transcriptRecord, setTranscriptRecord] = useState(null);
    const [loading, setLoading] = useState(isSupabaseConfigured());

    const { audioRef, isPlaying, togglePlay, seek, playFrom, currentTime, duration, checkDuration } = useAudioPlayer();
    const { apiKey, vocabProvider, openaiApiKey, openaiBaseUrl, openaiModel } = useStore();

    const [audioUrl, setAudioUrl] = useState(null);
    const [audioStatus, setAudioStatus] = useState('');
    const [audioError, setAudioError] = useState('');
    const [loadingVocab, setLoadingVocab] = useState(false);
    const [vocabCard, setVocabCard] = useState(null);

    const speak = (text) => {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        window.speechSynthesis.speak(u);
    };

    // Fetch Podcast & Transcript
    useEffect(() => {
        async function fetchData() {
            if (!isSupabaseConfigured()) {
                return;
            }

            try {
                // Get Podcast Metadata
                const { data: pod, error: podError } = await supabase
                    .from('podcasts')
                    .select('*')
                    .eq('id', id)
                    .single();

                if (podError) throw podError;
                setPodcast(pod);

                // Get Transcript
                const { data: trans } = await supabase
                    .from('transcripts')
                    .select('*')
                    .eq('podcast_id', id)
                    .single();

                // It's possible transcript isn't ready yet or failed
                if (trans) {
                    setTranscriptRecord({
                        segments: trans.content // content is JSONB
                    });
                }
            } catch (err) {
                console.error("Failed to load player data", err);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [id]);

    useEffect(() => {
        if (!podcast?.audio_url) return undefined;

        let cancelled = false;
        let revokeCurrent = () => { };

        async function prepareAudio() {
            setAudioStatus('Preparing audio...');
            setAudioError('');

            try {
                // First check if it's already fully cached locally
                const cached = await checkAudioCache(podcast.id, podcast.audio_url);
                if (cached) {
                    const objectUrl = URL.createObjectURL(cached.audioBlob);
                    revokeCurrent = () => URL.revokeObjectURL(objectUrl);
                    if (!cancelled) {
                        setAudioUrl(objectUrl);
                        setAudioStatus('Ready from local cache.');
                    }
                } else {
                    // Not cached! Let's just stream the remote URL directly for fast playback start.
                    if (!cancelled) {
                        setAudioUrl(podcast.audio_url);
                        setAudioStatus('Streaming remote audio. Caching in background...');
                        
                        // Kick off a background download to cache it
                        getCachedAudioUrl(podcast.id, podcast.audio_url, (message) => {
                            // Only update status if we haven't unmounted and haven't encountered an error
                            if (!cancelled && message.includes('Caching')) {
                                setAudioStatus(`Streaming & ${message}`);
                            }
                        }).then(result => {
                            if (cancelled) {
                                result.revoke();
                            } else {
                                // Background caching finished
                                // We keep playing the remote URL so we don't interrupt playback,
                                // but next time they open it, it will be fully cached.
                                revokeCurrent = result.revoke; 
                                setAudioStatus('Streaming (Background caching complete).');
                            }
                        }).catch(err => {
                            console.warn('[AudioCache] Background caching failed:', err);
                            if (!cancelled) {
                                setAudioStatus('Streaming (Background cache failed).');
                            }
                        });
                    }
                }
            } catch (error) {
                console.warn('[AudioCache] Cache check failed:', error);
                if (!cancelled) {
                    setAudioUrl(podcast.audio_url);
                    setAudioError(`Cache check failed: ${error.message}`);
                    setAudioStatus('Using remote audio.');
                }
            }
        }

        prepareAudio();

        return () => {
            cancelled = true;
            revokeCurrent();
        };
    }, [podcast]);

    // When audio URL changes, wait a bit then check duration
    useEffect(() => {
        if (audioUrl) {
            // Give the browser time to load metadata
            const timer = setTimeout(() => {
                checkDuration();
            }, 500);
            return () => clearTimeout(timer);
        }
        return undefined;
    }, [audioUrl, checkDuration]);

    const handleSeek = (e) => {
        const time = parseFloat(e.target.value);
        seek(time);
    };

    const handleWordClick = async (wordObj, sentence) => {
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

    if (loading) return <div className="container" style={{ display: 'flex', justifyContent: 'center', marginTop: 50 }}><Loader className={styles.spin} /></div>;
    if (!isSupabaseConfigured()) {
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
    if (!podcast) return <div className="container">Podcast not found</div>;

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <button className={styles.backBtn} onClick={() => navigate('/')}>
                    <ArrowLeft size={20} />
                    Library
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
                            <button onClick={() => setVocabCard(null)}>×</button>
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
                                <div className={styles.definition}>{vocabCard.definition}</div>
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
                <div className={styles.controls}>
                    <button onClick={() => seek(currentTime - 5)}><SkipBack size={20} /></button>
                    <button onClick={togglePlay} className={styles.playBtn}>
                        {isPlaying ? <Pause fill="white" /> : <Play fill="white" className={styles.playIconOffset} />}
                    </button>
                    <button onClick={() => seek(currentTime + 5)}><SkipForward size={20} /></button>
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

                <audio
                    ref={audioRef}
                    src={audioUrl}
                    preload="auto"
                    onLoadedMetadata={checkDuration}
                    onCanPlay={checkDuration}
                    onLoadedData={checkDuration}
                    crossOrigin="anonymous" // Essential for Supabase URL if needed
                />
            </div>
        </div>
    );
}

function formatTime(s) {
    if (!s) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}
