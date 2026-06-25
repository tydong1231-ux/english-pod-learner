
import { supabase, uploadAudio } from '../lib/supabase';
import { GeminiService } from '../lib/gemini';
import { WhisperXService } from '../lib/whisperx';
import { disableLocalEngine } from '../lib/env';

// Constants for Status using Supabase Strings
export const PodcastStatus = {
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    READY: 'READY',
    ERROR: 'ERROR'
};

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

        if (error) throw error;
        return data.id;
    }

    /**
     * Process podcast with WhisperX (primary) or Gemini (fallback)
     */
    static async processPodcast(id, apiKey, modelName, customPrompt, onStatusUpdate) {
        if (typeof customPrompt === 'function') {
            onStatusUpdate = customPrompt;
            customPrompt = '';
        }

        try {
            await supabase
                .from('podcasts')
                .update({ status: PodcastStatus.PROCESSING, progress: 'Starting...' })
                .eq('id', id);

            // Get podcast metadata (we need audio_url)
            const { data: podcast, error: fetchError } = await supabase
                .from('podcasts')
                .select('*')
                .eq('id', id)
                .single();

            if (fetchError || !podcast) throw new Error("Podcast not found");

            // Fetch the file as Blob for processing (since WhisperX runs locally)
            // Note: In Windows Electron app, we might pass the file path directly
            const response = await fetch(podcast.audio_url);
            const audioBlob = await response.blob();
            // Add name property to blob to mock File object
            audioBlob.name = 'audio.mp3';

            console.log(`Processing ${podcast.title}...`);
            let finalTranscript = null;

            if (!disableLocalEngine) {
                // Try WhisperX first
                if (onStatusUpdate) onStatusUpdate('Checking WhisperX server...');
                await supabase.from('podcasts').update({ progress: 'Checking WhisperX server...' }).eq('id', id);

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
                        if (onStatusUpdate) onStatusUpdate(msg);
                        await supabase.from('podcasts').update({ progress: msg }).eq('id', id);
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }

                if (whisperXAvailable) {
                    try {
                        if (onStatusUpdate) onStatusUpdate('Transcribing with WhisperX...');
                        await supabase.from('podcasts').update({ progress: 'Transcribing with WhisperX...' }).eq('id', id);

                        finalTranscript = await WhisperXService.transcribe(audioBlob, (msg) => {
                            console.log('[WhisperX]', msg);
                            supabase.from('podcasts').update({ progress: msg }).eq('id', id);
                            if (onStatusUpdate) onStatusUpdate(msg);
                        });
                    } catch (whisperError) {
                        console.error('[WhisperX] Failed:', whisperError);
                        if (onStatusUpdate) onStatusUpdate('WhisperX failed, falling back to Gemini...');
                    }
                }
            } else {
                const msg = 'Local engine disabled, using Gemini...';
                if (onStatusUpdate) onStatusUpdate(msg);
                await supabase.from('podcasts').update({ progress: msg }).eq('id', id);
            }

            // Fallback to Gemini
            if (!finalTranscript || !finalTranscript.segments || finalTranscript.segments.length === 0) {
                if (onStatusUpdate) onStatusUpdate('Transcribing with Gemini...');
                await supabase.from('podcasts').update({ progress: 'Transcribing with Gemini...' }).eq('id', id);

                const gemini = new GeminiService(apiKey, modelName);
                finalTranscript = await gemini.generateTranscript(audioBlob, customPrompt, async (msg) => {
                    await supabase.from('podcasts').update({ progress: msg }).eq('id', id);
                    if (onStatusUpdate) onStatusUpdate(msg);
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
