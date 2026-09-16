// Self-contained so the build can include this exact function in the service worker.
export function createOfflineMediaResponse(request, blob) {
    if (!blob?.size) return new Response('Offline audio not found', { status: 404 });
    const headers = {
        'Content-Type': blob.type || 'audio/mpeg',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
    };
    const range = request.headers.get('range');
    let start = 0;
    let end = blob.size - 1;
    if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${blob.size}` } });
        if (!match[1]) {
            const length = Number(match[2]);
            if (!Number.isSafeInteger(length) || length <= 0) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${blob.size}` } });
            start = Math.max(0, blob.size - length);
        } else {
            start = Number(match[1]);
            end = match[2] ? Math.min(Number(match[2]), end) : end;
        }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= blob.size || end < start) {
            return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${blob.size}` } });
        }
        headers['Content-Range'] = `bytes ${start}-${end}/${blob.size}`;
    }
    headers['Content-Length'] = String(end - start + 1);
    return new Response(request.method === 'HEAD' ? null : blob.slice(start, end + 1, blob.type), { status: range ? 206 : 200, headers });
}
