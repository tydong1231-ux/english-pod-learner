import React, { useEffect, useState } from 'react';
import { Loader, RefreshCw, Shuffle, Sparkles, X } from 'lucide-react';
import { useStore } from '../../store';
import { RemixService } from '../../services/remix';
import styles from './RemixPanel.module.css';

export function RemixPanel({ podcastId, segmentIndex, segment, onClose }) {
    const { openaiApiKey, openaiBaseUrl, openaiModel } = useStore();
    const providerConfig = { openaiApiKey, openaiBaseUrl, openaiModel };
    const [item, setItem] = useState(null);
    const [excludedPhrases, setExcludedPhrases] = useState([]);
    const [loading, setLoading] = useState(true);
    const [action, setAction] = useState('');
    const [error, setError] = useState('');
    const [showExamples, setShowExamples] = useState(false);
    const [noAlternative, setNoAlternative] = useState(false);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            setError('');
            setItem(null);
            setShowExamples(false);
            setNoAlternative(false);
            setExcludedPhrases([]);

            try {
                const existing = await RemixService.getBySource(podcastId, segmentIndex);
                if (cancelled) return;

                if (existing) {
                    setItem(existing);
                    setExcludedPhrases(existing.phrase ? [existing.phrase] : []);
                    return;
                }

                if (!openaiApiKey?.trim()) {
                    throw new Error('Set an OpenAI Compatible API Key in Settings to create a Remix.');
                }

                const created = await RemixService.generate({
                    sourcePodcastId: podcastId,
                    sourceSegmentIndex: segmentIndex,
                    segment,
                    ...providerConfig,
                    excludedPhrases: [],
                });

                if (cancelled) return;
                if (created.noAlternative) {
                    setNoAlternative(true);
                    setError('No reusable phrase was found in this sentence.');
                    return;
                }

                setItem(created);
                setExcludedPhrases([created.phrase]);
            } catch (err) {
                if (!cancelled) setError(err?.message || String(err));
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();
        return () => { cancelled = true; };
    }, [openaiApiKey, openaiBaseUrl, openaiModel, podcastId, segment, segmentIndex]);

    const handleSwitch = async () => {
        if (!item || !openaiApiKey?.trim() || action) return;
        const nextExcluded = [...new Set([...excludedPhrases, item.phrase].filter(Boolean))];
        setAction('switch');
        setError('');
        setShowExamples(false);

        try {
            const next = await RemixService.generate({
                sourcePodcastId: podcastId,
                sourceSegmentIndex: segmentIndex,
                segment,
                ...providerConfig,
                excludedPhrases: nextExcluded,
            });
            if (next.noAlternative) {
                setNoAlternative(true);
                return;
            }
            setItem(next);
            setExcludedPhrases([...nextExcluded, next.phrase]);
            setNoAlternative(false);
        } catch (err) {
            setError(err?.message || String(err));
        } finally {
            setAction('');
        }
    };

    const handleRegenerateQuestion = async () => {
        if (!item || !openaiApiKey?.trim() || action) return;
        setAction('question');
        setError('');
        try {
            const updated = await RemixService.regenerateQuestion(item, providerConfig);
            setItem(updated);
        } catch (err) {
            setError(err?.message || String(err));
        } finally {
            setAction('');
        }
    };

    return (
        <div className={styles.scrim} onMouseDown={onClose}>
            <aside className={styles.panel} onMouseDown={(event) => event.stopPropagation()}>
                <header className={styles.header}>
                    <div className={styles.titleWrap}><Sparkles size={18} /><strong>Remix</strong></div>
                    <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close Remix"><X size={18} /></button>
                </header>

                <div className={styles.body}>
                    <div className={styles.source}>{segment.text}</div>
                    {loading ? (
                        <div className={styles.loading}><Loader size={18} className={styles.spin} /> Creating Remix...</div>
                    ) : item ? (
                        <>
                            <section className={styles.section}>
                                <div className={styles.label}>Target phrase</div>
                                <div className={styles.phraseRow}>
                                    <div>
                                        <div className={styles.phrase}>{item.phrase}</div>
                                        {item.meaning && <div className={styles.meaning}>{item.meaning}</div>}
                                    </div>
                                    <button type="button" className={styles.secondaryButton} onClick={handleSwitch} disabled={!openaiApiKey?.trim() || Boolean(action) || noAlternative}>
                                        {action === 'switch' ? <Loader size={14} className={styles.spin} /> : <Shuffle size={14} />}
                                        {noAlternative ? 'No alternative' : 'Switch'}
                                    </button>
                                </div>
                            </section>

                            <section className={styles.questionCard}>
                                <div className={styles.label}>Your question</div>
                                <div className={styles.question}>{item.question}</div>
                            </section>

                            <div className={styles.actions}>
                                <button type="button" className={styles.secondaryButton} onClick={handleRegenerateQuestion} disabled={!openaiApiKey?.trim() || Boolean(action)}>
                                    {action === 'question' ? <Loader size={14} className={styles.spin} /> : <RefreshCw size={14} />}
                                    Regenerate question
                                </button>
                                <button type="button" className={styles.primaryButton} onClick={() => setShowExamples((value) => !value)}>
                                    {showExamples ? 'Hide examples' : 'Show examples'}
                                </button>
                            </div>

                            {showExamples && (
                                <section className={styles.examples}>
                                    {(item.examples || []).map((example, index) => (
                                        <div className={styles.example} key={`${item.id || item.phrase}-${index}`}>
                                            <span className={styles.exampleNumber}>{index + 1}</span>
                                            <span>{typeof example === 'string' ? example : example.sentence}</span>
                                        </div>
                                    ))}
                                </section>
                            )}
                        </>
                    ) : null}
                    {error && <div className={styles.error}>{error}</div>}
                </div>
            </aside>
        </div>
    );
}
