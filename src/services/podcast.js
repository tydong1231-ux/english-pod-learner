
import { formatSupabaseError, supabase, uploadAudio } from '../lib/supabase';
import { GeminiService } from '../lib/gemini';
import { WhisperXService } from '../lib/whisperx';
import { isLocalEngineDisabled } from '../lib/runtimeConfig';

// Constants for Status using Supabase Strings
export const PodcastStatus = {
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    READY: 'READY',
    ERROR: 'ERROR'
};

const AUDIO_DOWNLOAD_TIMEOUT_MS = 60000;

function fetchWithTimeout(resource, options = {}, timeoutMs = AUDIO_DOWNLOAD_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    return fetch(resource, {
        ...options,
        signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
}

async function downloadAudioFromSupabase(audioUrl) {
    try {
        const response = await fetchWithTimeout(audioUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const audioBlob = await response.blob();
        if (!audioBlob.size) {
            throw new Error('Downloaded audio file is empty.');
        }

        audioBlob.name = 'audio.mp3';
        return audioBlob;
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error('Downloading audio from Supabase timed out after 60 seconds.');
        }
        throw new Error(`Could not download audio from Supabase public URL: ${error.message}`);
    }
}

export class PodcastService {
    static async importPodcast(file) {
        // 1. Upload to Supabase Storage
        console.log('Uploading to Supabase Storage...');
        const audioUrl = await uploadAudio(file);

        // 2. Insert into Podcasts Table
        const { data, error } = await supabase
            .from('podcasts')
            .insert({
                title: file.name,
                status: PodcastStatus.PENDING,
                audio_url: audioUrl,
                // duration: null, // Will be updated later
            })
            .select()
            .single();

        if (error) {
            throw new Error(`Supabase podcast insert failed: ${formatSupabaseError(error)}`);
        }
        return data.id;
    }

    /**
     * Process podcast with WhisperX (primary) or Gemini (fallback)
     */
    static async processPodcast(id, apiKey, modelName, customPrompt, onStatusUpdate, sourceFile = null) {
        if (typeof customPrompt === 'function') {
            onStatusUpdate = customPrompt;
            customPrompt = '';
        }

        try {
            const setProgress = async (message) => {
                if (onStatusUpdate) onStatusUpdate(message);
                const { error } = await supabase
                    .from('podcasts')
                    .update({ status: PodcastStatus.PROCESSING, progress: message, error: null })
                    .eq('id', id);
                if (error) {
                    console.warn('[PodcastService] Failed to update progress:', error);
                }
            };

            await setProgress('Starting...');
            await setProgress('Loading podcast metadata...');

            // Get podcast metadata (we need audio_url)
            const { data: podcast, error: fetchError } = await supabase
                .from('podcasts')
                .select('*')
                .eq('id', id)
                .single();

            if (fetchError || !podcast) throw new Error("Podcast not found");

            let audioBlob;
            if (sourceFile) {
                await setProgress('Preparing selected audio file...');
                audioBlob = sourceFile;
            } else {
                await setProgress('Downloading audio from Supabase...');
                audioBlob = await downloadAudioFromSupabase(podcast.audio_url);
            }

            console.log(`Processing ${podcast.title}...`);
            let finalTranscript = null;

            if (!isLocalEngineDisabled()) {
                // Try WhisperX first
                await setProgress('Checking WhisperX server...');

                // Retry WhisperX check a few times (Server might be starting up)
                // Heavy models can take 30-40s to load on GPU
                let whisperXAvailable = false;
                const MAX_RETRIES = 30; // 30 * 2s = 60s
                for (let i = 0; i < MAX_RETRIES; i++) {
                    whisperXAvailable = await WhisperXService.isAvailable();
                    if (whisperXAvailable) break;

                    if (i < MAX_RETRIES - 1) {
                        const msg = `Waiting for local engine (${i + 1}/${MAX_RETRIES})...`;
                        console.log(msg);
                        await setProgress(msg);
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }

                if (whisperXAvailable) {
                    try {
                        await setProgress('Transcribing with WhisperX...');

                        finalTranscript = await WhisperXService.transcribe(audioBlob, (msg) => {
                            console.log('[WhisperX]', msg);
                            setProgress(msg);
                        });
                    } catch (whisperError) {
                        console.error('[WhisperX] Failed:', whisperError);
                        await setProgress('WhisperX failed, falling back to Gemini...');
                    }
                }
            } else {
                await setProgress('Local engine disabled, using Gemini...');
            }

            // Fallback to Gemini
            if (!finalTranscript || !finalTranscript.segments || finalTranscript.segments.length === 0) {
                await setProgress('Transcribing with Gemini...');

                const gemini = new GeminiService(apiKey, modelName);
                finalTranscript = await gemini.generateTranscript(audioBlob, customPrompt, async (msg) => {
                    await setProgress(msg);
                });
            }

            // Validation
            if (!finalTranscript || !finalTranscript.segments) {
                throw new Error("Transcription returned no segments");
            }

            // Save Transcript to Supabase
            const { error: transcriptError } = await supabase
                .from('transcripts')
                .insert({
                    podcast_id: id,
                    content: finalTranscript.segments
                });

            if (transcriptError) throw transcriptError;

            // Update status
            await supabase
                .from('podcasts')
                .update({ status: PodcastStatus.READY, progress: 'Completed' })
                .eq('id', id);

            console.log(`Transcription complete for ${podcast.title}`);

        } catch (error) {
            console.error("Processing failed", error);
            await supabase
                .from('podcasts')
                .update({ status: PodcastStatus.ERROR, error: error.message })
                .eq('id', id);
            throw error;
        }
    }

    static async deletePodcast(id) {
        // 1. Get the podcast to find the audio_url
        const { data: podcast } = await supabase
            .from('podcasts')
            .select('audio_url')
            .eq('id', id)
            .single();

        if (podcast && podcast.audio_url) {
            try {
                // Extract path from public URL
                // Format: .../storage/v1/object/public/audio-files/[filename]
                const pathParts = podcast.audio_url.split('/audio-files/');
                if (pathParts.length > 1) {
                    const fileName = pathParts[1];
                    console.log('Deleting audio file from storage:', fileName);
                    await supabase.storage.from('audio-files').remove([fileName]);
                }
            } catch (storageError) {
                console.warn('Failed to delete audio file from storage', storageError);
            }
        }

        // 2. Delete database record (cascades to transcripts)
        const { error } = await supabase
            .from('podcasts')
            .delete()
            .eq('id', id);

        if (error) throw error;
    }
}
