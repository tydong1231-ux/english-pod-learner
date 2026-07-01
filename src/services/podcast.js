
import { formatSupabaseError, supabase, uploadAudio } from '../lib/supabase';
import { GeminiService } from '../lib/gemini';
import { WhisperXService } from '../lib/whisperx';
import { isLocalEngineDisabled } from '../lib/runtimeConfig';
import { cacheAudioForPodcast, checkAudioCache, saveAudioFileToCache } from '../lib/audioCache';

// Constants for Status using Supabase Strings
export const PodcastStatus = {
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    READY: 'READY',
    ERROR: 'ERROR'
};

const DEFAULT_FOLDER = 'Inbox';

export class PodcastService {
    static async importPodcast(file, options = {}) {
        const folder = normalizeFolder(options.folder);
        // 1. Upload to Supabase Storage
        console.log('Uploading to Supabase Storage...');
        const audioUrl = await uploadAudio(file);

        // 2. Insert into Podcasts Table
        const insertData = {
            title: file.name,
            status: PodcastStatus.PENDING,
            audio_url: audioUrl,
            folder,
        };

        let { data, error } = await supabase
            .from('podcasts')
            .insert(insertData)
            .select()
            .single();

        if (error && isMissingFolderColumnError(error)) {
            const fallback = await supabase
                .from('podcasts')
                .insert({
                    title: file.name,
                    status: PodcastStatus.PENDING,
                    audio_url: audioUrl,
                })
                .select()
                .single();
            data = fallback.data;
            error = fallback.error;
        }

        if (error) {
            throw new Error(`Supabase podcast insert failed: ${formatSupabaseError(error)}`);
        }

        try {
            await saveAudioFileToCache(data.id, audioUrl, file);
        } catch (cacheError) {
            console.warn('[PodcastService] Failed to cache selected audio file:', cacheError);
        }

        return data.id;
    }

    static async updatePodcastFolder(id, folder) {
        const { error } = await supabase
            .from('podcasts')
            .update({ folder: normalizeFolder(folder) })
            .eq('id', id);

        if (error) {
            if (isMissingFolderColumnError(error)) {
                throw new Error('The podcasts.folder column is missing. Run docs/supabase-schema.sql in Supabase SQL Editor.');
            }
            throw error;
        }
    }

    static async moveFolderContents(fromFolder, toFolder) {
        const source = normalizeFolder(fromFolder);
        const target = normalizeFolder(toFolder);
        const { error } = await supabase
            .from('podcasts')
            .update({ folder: target })
            .eq('folder', source);

        if (error) {
            if (isMissingFolderColumnError(error)) {
                throw new Error('The podcasts.folder column is missing. Run docs/supabase-schema.sql in Supabase SQL Editor.');
            }
            throw error;
        }
    }

    static async renameFolder(fromFolder, toFolder) {
        await PodcastService.moveFolderContents(fromFolder, toFolder);
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
                const cached = await checkAudioCache(id, podcast.audio_url);
                if (cached?.audioBlob) {
                    await setProgress('Preparing cached local audio...');
                    audioBlob = cached.audioBlob;
                } else {
                    await setProgress('Downloading audio from Supabase...');
                    audioBlob = await cacheAudioForPodcast(id, podcast.audio_url, async (message) => {
                        await setProgress(message);
                    });
                }
            }

            if (!audioBlob?.size) {
                throw new Error('Audio file is empty or unavailable.');
            }

            console.log(`Processing ${podcast.title}...`);
            let finalTranscript = null;
            const localEngineDisabled = isLocalEngineDisabled();
            const hasGeminiKey = Boolean(apiKey?.trim());

            if (!localEngineDisabled) {
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
                        await setProgress(hasGeminiKey
                            ? 'WhisperX failed, falling back to Gemini...'
                            : 'WhisperX failed and Gemini fallback is not configured.');
                    }
                } else {
                    await setProgress(hasGeminiKey
                        ? 'Local WhisperX unavailable, falling back to Gemini...'
                        : 'Local WhisperX unavailable and Gemini fallback is not configured.');
                }
            } else {
                await setProgress(hasGeminiKey
                    ? 'Local engine disabled, using Gemini...'
                    : 'Local engine disabled and Gemini API key is missing.');
            }

            // Fallback to Gemini only when the user configured a key.
            if (!finalTranscript || !finalTranscript.segments || finalTranscript.segments.length === 0) {
                if (!hasGeminiKey) {
                    if (localEngineDisabled) {
                        throw new Error('Gemini API key is required because Local WhisperX Engine is disabled.');
                    }
                    throw new Error('Local WhisperX did not produce a transcript. Gemini fallback is not configured, so processing stopped.');
                }

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
                .upsert({
                    podcast_id: id,
                    content: finalTranscript.segments
                }, {
                    onConflict: 'podcast_id'
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

export function normalizeFolder(folder) {
    const value = (folder || '').trim();
    return value || DEFAULT_FOLDER;
}

function isMissingFolderColumnError(error) {
    const message = `${error?.message || ''} ${error?.details || ''}`;
    return message.includes('folder') && (message.includes('Could not find') || message.includes('schema cache') || message.includes('column'));
}
