import { describe, it, expect, vi } from 'vitest';
import { AudioQueue } from './audioQueue';

class Audio extends EventTarget {
    paused = true;
    currentTime = 0;
    duration = 60;
    src = '';
    play = vi.fn(() => { this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); });
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
    load() {}
    removeAttribute() {}
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function setup(options = {}) {
    const audio = new Audio();
    const onActive = vi.fn();
    const onError = vi.fn();
    const queue = new AudioQueue(audio, {
        queue: ['a', 'b', 'c'], load: async key => ({ key, url: key + '.mp3', dispose: vi.fn() }),
        onActive, onError, ...options,
    });
    await queue.select('a');
    audio.dispatchEvent(new Event('loadedmetadata'));
    await tick();
    return { audio, queue, onActive, onError };
}

describe('native background queue', () => {
    it('plays a prepared source synchronously BEFORE the UI callback, over multiple transitions', async () => {
        const { audio, queue, onActive } = await setup();
        onActive.mockImplementation(() => expect(audio.paused).toBe(false));
        audio.dispatchEvent(new Event('ended'));
        expect(audio.src).toBe('b.mp3');
        expect(audio.play).toHaveBeenCalledTimes(1);
        expect(queue.active.key).toBe('b');
        await tick();
        audio.dispatchEvent(new Event('ended'));
        expect(audio.src).toBe('c.mp3');
        expect(audio.play).toHaveBeenCalledTimes(2);
        audio.dispatchEvent(new Event('ended'));
        expect(audio.play).toHaveBeenCalledTimes(2);
        queue.dispose();
    });
    it('does not reset or pause when React catches up to the already-playing route', async () => {
        const { audio, queue } = await setup();
        queue.advance(true);
        await queue.select('b');
        expect(audio.paused).toBe(false);
        expect(audio.play).toHaveBeenCalledTimes(1);
        queue.dispose();
    });
    it('honors a live global two-episode timer across the handoff', async () => {
        let remaining = 2;
        const { audio, queue } = await setup({ onEnded: () => --remaining > 0 });
        audio.dispatchEvent(new Event('ended'));
        expect(queue.active.key).toBe('b');
        await tick();
        audio.dispatchEvent(new Event('ended'));
        expect(queue.active.key).toBe('b');
        expect(audio.paused).toBe(true);
        queue.dispose();
    });
    it('does not advance or resume after a time deadline, but cancellation permits playback', async () => {
        let expired = false;
        const { audio, queue } = await setup({ expired: () => expired });
        expired = true;
        queue.advance(true);
        expect(queue.active.key).toBe('a');
        queue.recover();
        expect(audio.play).not.toHaveBeenCalled();
        expired = false;
        queue.advance(true);
        expect(audio.src).toBe('b.mp3');
        queue.dispose();
    });
    it('retains blocked autoplay intent, retries on recovery, and respects explicit pause', async () => {
        const { audio, queue, onError } = await setup();
        audio.play.mockRejectedValueOnce(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
        queue.advance(true);
        await tick();
        expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('Tap Play'));
        queue.recover();
        expect(audio.paused).toBe(false);
        queue.stop();
        queue.retry = true;
        queue.stop();
        queue.recover();
        expect(audio.play).toHaveBeenCalledTimes(2);
        queue.dispose();
    });
    it('cancels an unresolved handoff when the user pauses', async () => {
        let resolveNext;
        const { audio, queue } = await setup({ load: key => key === 'a' ? Promise.resolve({ key, url: 'a.mp3' }) : new Promise(resolve => { resolveNext = resolve; }) });
        queue.advance(true);
        queue.stop();
        resolveNext({ key: 'b', url: 'b.mp3' });
        await tick();
        expect(queue.active.key).toBe('a');
        expect(audio.play).not.toHaveBeenCalled();
        queue.dispose();
    });
    it('releases pending resources after unmount and never starts detached audio', async () => {
        let resolveNext;
        const { audio, queue } = await setup({ load: key => key === 'a' ? Promise.resolve({ key, url: 'a.mp3' }) : new Promise(resolve => { resolveNext = resolve; }) });
        queue.advance(true);
        queue.dispose();
        const dispose = vi.fn();
        resolveNext({ key: 'b', url: 'b.mp3', dispose });
        await tick();
        expect(dispose).toHaveBeenCalledOnce();
        expect(audio.play).not.toHaveBeenCalled();
    });
});
