import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getListeningSnapshot, listeningKey, listeningState, newestUnplayed, saveListeningProgress, LISTENING_KEY } from './listeningProgress';

beforeEach(() => {
    const items = new Map();
    vi.stubGlobal('localStorage', { getItem: key => items.get(key) || null, setItem: (key, value) => items.set(key, value) });
    vi.stubGlobal('window', new EventTarget());
    localStorage.setItem(LISTENING_KEY, '{}');
    getListeningSnapshot();
});
afterEach(() => vi.unstubAllGlobals());
const target = { source: 'https://example.test', id: 'one', position: 25, duration: 100 };
const read = () => getListeningSnapshot()[listeningKey(target.source, target.id)];

describe('local listening history', () => {
    it('does not mark an episode heard just by opening it', () => {
        saveListeningProgress({ ...target, position: 0 });
        expect(read()).toBeUndefined();
    });
    it('persists progress and retains heard status after rewinding', () => {
        saveListeningProgress(target);
        expect(listeningState(read()).percent).toBe(25);
        expect(JSON.parse(localStorage.getItem(LISTENING_KEY))[listeningKey(target.source, target.id)].position).toBe(25);
        saveListeningProgress({ ...target, position: 0 });
        expect(listeningState(read()).started).toBe(true);
    });
    it('keeps completion when replayed and separates sources', () => {
        saveListeningProgress({ ...target, position: 100, completed: true });
        saveListeningProgress({ ...target, position: 4 });
        expect(listeningState(read())).toMatchObject({ completed: true, percent: 100, position: 4 });
        saveListeningProgress({ ...target, source: 'https://another.test' });
        expect(Object.keys(getListeningSnapshot())).toHaveLength(2);
        expect(listeningKey(target.source + '/', target.id)).toBe(listeningKey(target.source, target.id));
    });
    it('tolerates damaged storage and rejects invalid positions', () => {
        localStorage.setItem(LISTENING_KEY, 'broken');
        expect(getListeningSnapshot()).toEqual({});
        for (const position of [NaN, Infinity, -1]) saveListeningProgress({ ...target, position });
        expect(getListeningSnapshot()).toEqual({});
    });
    it('supports legacy offline progress and unknown duration', () => {
        expect(listeningState({ position: 100, duration: 100 }).completed).toBe(true);
        expect(listeningState({ position: 25 }, 100).percent).toBe(25);
        expect(listeningState({ position: 25 }).started).toBe(true);
    });
    it('finds newest unheard by date regardless of list sort, skips started and completed', () => {
        const episodes = [
            { id: 'a', created_at: '2026-09-01' },
            { id: 'b', created_at: '2026-09-04', position: 12 },
            { id: 'c', created_at: '2026-09-03' },
            { id: 'd', created_at: '2026-09-05', completed: true },
        ];
        expect(newestUnplayed(episodes, episode => episode).id).toBe('c');
        expect(newestUnplayed(episodes.slice(1, 2), episode => episode)).toBeNull();
        expect(newestUnplayed([], () => null)).toBeNull();
    });
});
