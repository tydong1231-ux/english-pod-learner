import { useLiveQuery } from 'dexie-react-hooks';
import { currentSource, hasOfflineContent, listOfflineEpisodes, offlineDb } from '../lib/offlineLibrary';

export function useDownloadedEpisodes() {
    const source = currentSource();
    const ids = useLiveQuery(async () => {
        const [records, audioKeys] = await Promise.all([
            listOfflineEpisodes(), offlineDb.audio.toCollection().primaryKeys(),
        ]);
        const available = new Set(audioKeys);
        return records.filter(record => record.source === source && available.has(record.key) && hasOfflineContent(record))
            .map(record => String(record.podcast.id));
    }, [source], []);
    return new Set(ids);
}
