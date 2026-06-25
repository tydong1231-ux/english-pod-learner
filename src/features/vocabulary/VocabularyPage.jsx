import React, { useState, useEffect } from 'react';
import { Search, Volume2, Trash2, AlertTriangle } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { VocabService } from '../../services/vocab';
import styles from './VocabularyPage.module.css';

export function VocabularyPage() {
    const [words, setWords] = useState([]);
    const [loading, setLoading] = useState(isSupabaseConfigured);
    const [filter, setFilter] = useState('');
    const [expandedId, setExpandedId] = useState(null);

    useEffect(() => {
        if (!isSupabaseConfigured) {
            return undefined;
        }

        const fetchVocab = async () => {
            const { data } = await supabase
                .from('vocabulary')
                .select('*')
                .order('created_at', { ascending: false });

            if (data) setWords(data);
            setLoading(false);
        };

        fetchVocab();

        // Subscribe to changes
        const channel = supabase
            .channel('public:vocabulary')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'vocabulary' }, () => {
                fetchVocab();
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, []);

    const filteredWords = words.filter(w =>
        (w.word || '').toLowerCase().includes(filter.toLowerCase()) ||
        (w.meaning || '').toLowerCase().includes(filter.toLowerCase())
    );

    const speak = (text, e) => {
        e?.stopPropagation();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        window.speechSynthesis.speak(u);
    };

    const handleDelete = async (e, id) => {
        e.stopPropagation();
        if (confirm("Remove this word from your notebook?")) {
            await VocabService.deleteVocab(id);
            // Optimistic Update
            setWords(prev => prev.filter(w => w.id !== id));
        }
    };

    if (loading) return <div className="container">Loading...</div>;
    if (!isSupabaseConfigured) {
        return (
            <div className="container">
                <header className={styles.header}>
                    <div>
                        <h1>Setup Required</h1>
                        <p className={styles.subtitle}>Configure Supabase before using vocabulary.</p>
                    </div>
                </header>
                <div className={styles.empty}>
                    <AlertTriangle size={32} />
                    <p>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your local .env file.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <header className={styles.header}>
                <div>
                    <h1>Vocabulary</h1>
                    <p className={styles.subtitle}>{words.length} Saved Words</p>
                </div>
                <div className={styles.searchBox}>
                    <Search size={18} className={styles.searchIcon} />
                    <input
                        type="text"
                        placeholder="Search words..."
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className={styles.searchInput}
                    />
                </div>
            </header>

            <div className={styles.grid}>
                {filteredWords.map(item => (
                    <div
                        key={item.id}
                        className={`${styles.card} ${expandedId === item.id ? styles.expanded : ''}`}
                        onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    >
                        <div className={styles.cardHeader}>
                            <h3 className={styles.word}>{item.word}</h3>
                            {/* item.ipa might need to be added to DB if we want it preserved */}
                            {item.ipa && <span className={styles.ipa}>/{item.ipa}/</span>}
                            <div className={styles.actions}>
                                <button
                                    onClick={(e) => speak(item.word, e)}
                                    className={styles.iconBtn}
                                    title="Listen"
                                >
                                    <Volume2 size={18} />
                                </button>
                                <button
                                    onClick={(e) => handleDelete(e, item.id)}
                                    className={styles.iconBtn}
                                    title="Delete"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>

                        <div className={styles.definition}>{item.meaning}</div>

                        {expandedId === item.id && (
                            <div className={styles.details}>
                                {item.translation && (
                                    <div className={styles.translation}>{item.translation}</div>
                                )}

                                {Array.isArray(item.examples) && item.examples.length > 0 && (
                                    <div className={styles.examples}>
                                        <ul>
                                            {item.examples.map((example, index) => (
                                                <li key={`${item.id}-${index}`}>{example}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                <div className={styles.context}>
                                    <strong>Source Context:</strong> "{item.context_sentence}"
                                </div>
                            </div>
                        )}
                    </div>
                ))}

                {filteredWords.length === 0 && (
                    <div className={styles.empty}>
                        No words found. Go to a podcast and click words to add them!
                    </div>
                )}
            </div>
        </div >
    );
}
