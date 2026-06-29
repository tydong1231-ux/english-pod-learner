
import { supabase } from '../lib/supabase';
import { GeminiService } from '../lib/gemini';
import { OpenAIVocabService } from '../lib/openaiVocab';

export class VocabService {
    static async createVocabCard(word, contextSentence, sourcePodcastId, apiKey, options = {}) {
        if (!word || !contextSentence) throw new Error("Missing requirements");

        const cleanWord = word
            .trim()
            .replace(/^[^\w']+|[^\w']+$/g, '')
            .toLowerCase();

        if (!cleanWord) throw new Error("Invalid word");

        // Check if exists in Supabase (use maybeSingle to avoid error on 0 rows)
        const { data: existing } = await supabase
            .from('vocabulary')
            .select('*')
            .eq('word', cleanWord)
            .eq('source_podcast_id', sourcePodcastId)
            .maybeSingle();

        if (existing) return existing;

        const provider = options.provider || 'gemini';
        let cardData;
        try {
            if (provider === 'openai') {
                const openai = new OpenAIVocabService({
                    apiKey: options.openaiApiKey,
                    baseUrl: options.openaiBaseUrl,
                    model: options.openaiModel,
                });
                cardData = await openai.generateVocabCard(cleanWord, contextSentence);
                console.log('[VocabService] OpenAI-compatible provider returned:', cardData);
            } else {
                if (!apiKey) throw new Error('Gemini API key is required');
                const gemini = new GeminiService(apiKey);
                cardData = await gemini.generateVocabCard(cleanWord, contextSentence);
                console.log('[VocabService] Gemini returned:', cardData);
            }
        } catch (err) {
            console.error('[VocabService] Vocabulary API error:', err);
            throw new Error(`Vocabulary API failed: ${err.message}`);
        }

        // Prepare insert data
        const baseInsertData = {
            word: cleanWord,
            meaning: cardData.definition || cardData.meaning || 'No definition available',
            context_sentence: contextSentence,
            source_podcast_id: sourcePodcastId,
        };

        const richInsertData = {
            ...baseInsertData,
            ipa: cardData.ipa || null,
            translation: cardData.translation || null,
            examples: cardData.examples || [],
        };

        console.log('[VocabService] Inserting into Supabase:', richInsertData);

        let { data: newCard, error } = await supabase
            .from('vocabulary')
            .insert(richInsertData)
            .select()
            .single();

        if (error && isMissingColumnError(error)) {
            console.warn('[VocabService] Extended vocabulary columns missing, retrying with base schema.');
            const fallback = await supabase
                .from('vocabulary')
                .insert(baseInsertData)
                .select()
                .single();

            newCard = fallback.data;
            error = fallback.error;
        }

        if (error) {
            console.error('[VocabService] Supabase insert error:', error);
            throw error;
        }

        console.log('[VocabService] Inserted successfully:', newCard);

        // Return combined data for UI display
        return { ...newCard, ...cardData };
    }

    static async deleteVocab(id) {
        const { error } = await supabase
            .from('vocabulary')
            .delete()
            .eq('id', id);

        if (error) throw error;
        return true;
    }
}

function isMissingColumnError(error) {
    const message = `${error?.message || ''} ${error?.details || ''}`;
    return message.includes('Could not find') || message.includes('column');
}
