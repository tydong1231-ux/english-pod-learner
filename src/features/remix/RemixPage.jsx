import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Loader, Sparkles } from 'lucide-react';
import { isSupabaseConfigured } from '../../lib/supabase';
import { RemixService } from '../../services/remix';
import styles from './RemixPage.module.css';

export function RemixPage() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(isSupabaseConfigured());
    const [error, setError] = useState('');
    const [expandedId, setExpandedId] = useState(null);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            if (!isSupabaseConfigured()) return;
            setLoading(true);
            setError('');
            try {
                const data = await RemixService.list();
                if (!cancelled) setItems(data);
            } catch (err) {
                if (!cancelled) setError(err?.message || String(err));
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();
        return () => { cancelled = true; };
    }, []);

    if (!isSupabaseConfigured()) {
        return (
            <div className="container">
                <h1>Remix</h1>
                <p>Configure Supabase in Settings before using Remix.</p>
            </div>
        );
    }

    return (
        <div className="container">
            <header className={styles.header}>
                <div>
                    <div className={styles.titleRow}>
                        <Sparkles size={24} />
                        <h1>Remix</h1>
                    </div>
                    <p className={styles.subtitle}>Reusable phrases and speaking prompts from your podcasts.</p>
                </div>
            </header>

            {loading && (
                <div className={styles.state}><Loader size={18} className={styles.spin} /> Loading Remix items...</div>
            )}

            {error && <div className={styles.error}>{error}</div>}

            {!loading && !error && items.length === 0 && (
                <div className={styles.empty}>
                    Click <strong>Remix</strong> on a podcast sentence to save your first phrase.
                </div>
            )}

            <div className={styles.list}>
                {items.map((item) => {
                    const expanded = expandedId === item.id;
                    return (
                        <article className={styles.card} key={item.id}>
                            <div className={styles.cardTop}>
                                <div>
                                    <div className={styles.phrase}>{item.phrase}</div>
                                    {item.meaning && <div className={styles.meaning}>{item.meaning}</div>}
                                </div>
                                {item.podcasts?.title && <div className={styles.podcast}>{item.podcasts.title}</div>}
                            </div>

                            <div className={styles.question}>{item.question}</div>
                            <div className={styles.source}>{item.source_sentence}</div>

                            <button
                                type="button"
                                className={styles.examplesButton}
                                onClick={() => setExpandedId(expanded ? null : item.id)}
                            >
                                {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                {expanded ? 'Hide examples' : 'Show examples'}
                            </button>

                            {expanded && (
                                <div className={styles.examples}>
                                    {(item.examples || []).map((example, index) => (
                                        <div className={styles.example} key={`${item.id}-${index}`}>
                                            <span>{index + 1}.</span>
                                            <span>{typeof example === 'string' ? example : example.sentence}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </article>
                    );
                })}
            </div>
        </div>
    );
}
