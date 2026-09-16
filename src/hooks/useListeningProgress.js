import { useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { currentSource, listOfflineEpisodes } from '../lib/offlineLibrary';
import { getListeningSnapshot, listeningKey, subscribeListening } from '../lib/listeningProgress';

export function useListeningProgress() {
    const records = useSyncExternalStore(subscribeListening, getListeningSnapshot);
    const legacy = useLiveQuery(async () => {
        try { return await listOfflineEpisodes(); } catch { return []; }
    }, []);
    const source = currentSource();
    const merged = { ...Object.fromEntries((legacy || []).map(record => [listeningKey(record.source, record.podcast.id), record])), ...records };
    return {
        ready: legacy !== undefined,
        progressFor: (episode, episodeSource = source) => merged[listeningKey(episodeSource, episode.id)],
    };
}
