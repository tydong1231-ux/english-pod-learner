export async function blobDigest(blob) {
    const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function validSubtitles(segments) {
    return Array.isArray(segments) && segments.length > 0 && segments.every(segment =>
        segment && typeof segment.text === 'string'
        && Number.isFinite(segment.start) && Number.isFinite(segment.end)
        && segment.start >= 0 && segment.end >= segment.start
        && (segment.speaker == null || typeof segment.speaker === 'string')
        && (segment.words == null || (Array.isArray(segment.words) && segment.words.every(word =>
            word && typeof word.word === 'string'
            && (word.start == null || (Number.isFinite(word.start) && word.start >= 0))
            && (word.end == null || Number.isFinite(word.end))
        )))
    );
}

export function audioDuration(blob, sourceUrl, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(signal.reason); return; }
        const audio = document.createElement('audio');
        const url = sourceUrl || URL.createObjectURL(blob);
        let finished = false;
        const timer = setTimeout(() => finish(new Error('Audio could not be checked on this device. Please retry.')), 20000);
        const aborted = () => finish(signal.reason);
        function finish(error) {
            if (finished) return;
            finished = true;
            const duration = audio.duration;
            clearTimeout(timer);
            signal?.removeEventListener('abort', aborted);
            audio.onloadedmetadata = null;
            audio.onerror = null;
            audio.removeAttribute('src');
            audio.load();
            if (!sourceUrl) URL.revokeObjectURL(url);
            if (error) reject(error); else resolve(duration);
        }
        audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration > 0 ? null : new Error('Audio duration is invalid. Use a complete MP3, M4A or WAV file.'));
        audio.onerror = () => finish(new Error('This device cannot read the downloaded audio format.'));
        audio.preload = 'metadata';
        signal?.addEventListener('abort', aborted, { once: true });
        audio.src = url;
        audio.load();
    });
}
