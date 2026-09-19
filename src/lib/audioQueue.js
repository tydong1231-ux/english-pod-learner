// Own the native media element independently of React renders and route loading.
// A prepared handoff calls play() in the ended event, before any UI work.
export class AudioQueue {
    constructor(audio, options) {
        this.audio = audio;
        this.options = options;
        this.entries = new Map();
        this.pending = new Map();
        this.queue = options.queue.map(String);
        this.generation = 0;
        this.listeners = {
            ended: () => this.advance(true),
            loadedmetadata: () => {
                if (this.resume != null) {
                    audio.currentTime = Math.min(this.resume, audio.duration || this.resume);
                    this.resume = null;
                }
            },
            play: () => { this.retry = false; options.onPlay?.(this.active); },
            error: () => options.onError('Audio playback failed. Check your connection and tap Play to retry.'),
            pause: () => this.save(),
            seeked: () => this.save(),
            timeupdate: () => {
                if (options.expired?.()) this.stop();
                if (Date.now() - (this.savedAt || 0) > 3000) this.save();
            },
        };
        for (const [name, callback] of Object.entries(this.listeners)) audio.addEventListener(name, callback);
    }

    prepare(key) {
        if (this.entries.has(key)) return Promise.resolve(this.entries.get(key));
        if (this.pending.has(key)) return this.pending.get(key);
        const task = this.options.load(key).then(entry => {
            if (this.disposed) { entry.dispose?.(); return null; }
            this.entries.set(key, entry);
            return entry;
        }).finally(() => this.pending.delete(key));
        this.pending.set(key, task);
        return task;
    }

    async select(key) {
        if (this.active?.key === key) return;
        const generation = ++this.generation;
        this.retry = false;
        this.save();
        this.audio.pause();
        const entry = await this.prepare(key);
        if (!this.disposed && generation === this.generation && entry) this.activate(entry, false);
    }

    activate(entry, autoplay) {
        const previous = this.active;
        this.active = entry;
        this.resume = autoplay ? 0 : entry.position || 0;
        this.audio.src = entry.url;
        // No promise, transcript request, route transition or React render before play.
        if (autoplay) this.start();
        this.options.onActive(entry);
        if (previous && previous !== entry) {
            this.entries.delete(previous.key);
            previous.dispose?.();
        }
        const index = this.queue.indexOf(entry.key);
        const next = index >= 0 ? this.queue[index + 1] : null;
        if (next) this.prepare(next).catch(() => {}); // Retry at the boundary if preparation failed.
    }

    start() {
        if (this.options.expired?.()) { this.stop(); return; }
        const generation = this.generation;
        this.retry = true;
        this.options.onError('');
        try {
            Promise.resolve(this.audio.play()).then(() => {
                if (generation === this.generation) this.retry = false;
            }).catch(error => {
                if (generation !== this.generation || this.disposed || !this.retry) return;
                this.options.onError(error.name === 'NotAllowedError'
                    ? 'Your browser paused automatic playback. Tap Play to continue.'
                    : 'Playback could not start. Tap Play to retry.');
            });
        } catch { this.options.onError('Playback could not start. Tap Play to retry.'); }
    }

    stop() {
        this.retry = false;
        ++this.generation;
        this.audio.pause();
    }

    advance(ended = false, direction = 1) {
        if (!this.active || this.disposed) return;
        this.save(ended);
        if (ended && this.options.onEnded?.() === false) { this.stop(); return; }
        if (this.options.expired?.()) { this.stop(); return; }
        const index = this.queue.indexOf(this.active.key);
        const key = index >= 0 ? this.queue[index + direction] : null;
        if (!key) { this.retry = false; return; }
        const generation = ++this.generation;
        const prepared = this.entries.get(key);
        if (prepared) this.activate(prepared, true);
        else {
            this.retry = true;
            this.prepare(key).then(entry => {
                if (entry && !this.disposed && generation === this.generation) this.activate(entry, true);
            }).catch(() => this.options.onError('Cannot load the next episode. Check your connection and try again.'));
        }
    }

    save(completed = false) {
        if (!this.active || this.resume != null) return;
        this.savedAt = Date.now();
        this.options.onProgress?.(this.active, completed ? this.audio.duration : this.audio.currentTime, this.audio.duration, completed);
    }

    recover() {
        if (this.options.expired?.()) this.stop();
        else if (this.retry && this.audio.paused) this.start();
    }

    dispose() {
        this.save();
        this.disposed = true;
        this.stop();
        for (const [name, callback] of Object.entries(this.listeners)) this.audio.removeEventListener(name, callback);
        this.audio.removeAttribute('src');
        this.audio.load();
        for (const entry of this.entries.values()) entry.dispose?.();
        this.entries.clear();
    }
}
