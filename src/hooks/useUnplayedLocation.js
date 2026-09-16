import { useEffect, useRef } from 'react';
import { newestUnplayed } from '../lib/listeningProgress';

export function useUnplayedLocation(episodes, progressFor, ready) {
    const listRef = useRef(null);
    const located = useRef(false);
    useEffect(() => {
        if (!ready || located.current || !listRef.current) return;
        located.current = true;
        const target = newestUnplayed(episodes, progressFor);
        if (!target) return;
        const row = [...listRef.current.querySelectorAll('[data-episode-id]')].find(node => node.dataset.episodeId === String(target.id));
        if (!row) return;
        row.dataset.nextUnplayed = 'true';
        row.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }, [episodes, progressFor, ready]);
    return listRef;
}
