/**
 * WhisperX Service
 * Communicates with local Python server for transcription and alignment.
 */

const WHISPERX_SERVER = 'http://localhost:8765';

export class WhisperXService {
    /**
     * Check if the WhisperX server is running
     */
    static async isAvailable() {
        try {
            const response = await fetch(`${WHISPERX_SERVER}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });
            return response.ok;
        } catch (e) {
            console.log('[WhisperX] Server not available:', e.message);
            return false;
        }
    }

    /**
     * Get server status info
     */
    static async getStatus() {
        try {
            const response = await fetch(`${WHISPERX_SERVER}/health`);
            if (response.ok) {
                return await response.json();
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Full transcription with word-level timestamps and optional speaker diarization
     * @param {Blob} audioFile - The audio file
     * @param {Function} onProgress - Progress callback
     * @returns {Promise<Object>} - Transcript with word-level timestamps
     */
    static async transcribe(audioFile, onProgress) {
        console.log('[WhisperX] Starting full transcription...');
        if (onProgress) onProgress('Sending to WhisperX server...');

        const formData = new FormData();
        formData.append('audio', audioFile, 'audio.mp3');

        const response = await fetch(`${WHISPERX_SERVER}/transcribe`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Transcription failed');
        }

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Transcription failed');
        }

        console.log(`[WhisperX] Transcription complete! ${result.segments.length} segments`);
        return { segments: result.segments };
    }

    /**
     * Align audio with existing transcript (legacy)
     * @param {Blob} audioFile - The audio file
     * @param {Object} transcript - Transcript object with segments array
     * @returns {Promise<Object>} - Aligned transcript with word-level timestamps
     */
    static async align(audioFile, transcript) {
        console.log('[WhisperX] Starting alignment...');

        const formData = new FormData();
        formData.append('audio', audioFile, 'audio.mp3');
        formData.append('transcript', JSON.stringify(transcript));

        const response = await fetch(`${WHISPERX_SERVER}/align`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Alignment failed');
        }

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Alignment failed');
        }

        console.log(`[WhisperX] Alignment complete! ${result.segments.length} segments aligned.`);
        return { segments: result.segments };
    }
}
