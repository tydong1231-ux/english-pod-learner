
import { supabase } from '../lib/supabase';
import { GeminiService } from '../lib/gemini';

export class VocabService {
    static async createVocabCard(word, contextSentence, sourcePodcastId, apiKey) {
        if (!word || !contextSentence || !apiKey) throw new Error("Missing requirements");

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

        const gemini = new GeminiService(apiKey);
        let cardData;
        try {
            cardData = await gemini.generateVocabCard(cleanWord, contextSentence);
            console.log('[VocabService] Gemini returned:', cardData);
        } catch (err) {
            console.error('[VocabService] Gemini API error:', err);
            throw new Error(`Gemini API failed: ${err.message}`);
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
