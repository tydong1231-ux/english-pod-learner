import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { RemixGemini } from '../lib/remixGemini';

const CANDIDATE_SAMPLE_SIZE = 5;
const CANDIDATE_QUERY_LIMIT = 200;
const MAX_GENERATION_ATTEMPTS = 2;

export class RemixService {
    static async getBySource(sourcePodcastId, sourceSegmentIndex) {
        ensureSupabase();
        const { data, error } = await supabase
            .from('remix_items')
            .select('*')
            .eq('source_podcast_id', sourcePodcastId)
            .eq('source_segment_index', sourceSegmentIndex)
            .maybeSingle();

        if (error) throw friendlyRemixError(error);
        return data;
    }

    static async list() {
        ensureSupabase();
        const { data, error } = await supabase
            .from('remix_items')
            .select('*, podcasts(title)')
            .order('updated_at', { ascending: false });

        if (error) throw friendlyRemixError(error);
        return data || [];
    }

    static async generate({
        sourcePodcastId,
        sourceSegmentIndex,
        segment,
        apiKey,
        modelName,
        excludedPhrases = [],
    }) {
        ensureSupabase();
        const candidates = await loadCandidates(excludedPhrases);
        const gemini = new RemixGemini(apiKey, modelName);
        let generated;

        for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
            try {
                generated = await gemini.generateExercise({
                    sourceSentence: segment.text,
                    excludedPhrases,
                    vocabulary: candidates.vocabulary,
                    previousPhrases: candidates.previousPhrases,
                });
                break;
            } catch (error) {
                const repeatedExcludedPhrase = error?.message?.includes('repeated an excluded Remix phrase');
                if (!repeatedExcludedPhrase || attempt === MAX_GENERATION_ATTEMPTS) throw error;
            }
        }

        if (generated.noAlternative) return generated;

        const payload = {
            source_podcast_id: sourcePodcastId,
            source_segment_index: sourceSegmentIndex,
            source_sentence: segment.text,
            source_start: Number.isFinite(segment.start) ? segment.start : null,
            source_end: Number.isFinite(segment.end) ? segment.end : null,
            phrase: generated.phrase,
            meaning: generated.meaning || null,
            question: generated.question,
            examples: generated.examples,
            updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
            .from('remix_items')
            .upsert(payload, { onConflict: 'source_podcast_id,source_segment_index' })
            .select()
            .single();

        if (error) throw friendlyRemixError(error);
        return { ...data, noAlternative: false };
    }

    static async regenerateQuestion(item, apiKey, modelName) {
        ensureSupabase();
        const gemini = new RemixGemini(apiKey, modelName);
        const question = await gemini.regenerateQuestion({
            phrase: item.phrase,
            sourceSentence: item.source_sentence,
            previousQuestion: item.question,
        });

        const { data, error } = await supabase
            .from('remix_items')
            .update({ question, updated_at: new Date().toISOString() })
            .eq('id', item.id)
            .select()
            .single();

        if (error) throw friendlyRemixError(error);
        return data;
    }
}

async function loadCandidates(excludedPhrases = []) {
    const [vocabularyResult, remixResult] = await Promise.all([
        supabase
            .from('vocabulary')
            .select('word')
            .limit(CANDIDATE_QUERY_LIMIT),
        supabase
            .from('remix_items')
            .select('phrase')
            .order('updated_at', { ascending: false })
            .limit(CANDIDATE_QUERY_LIMIT),
    ]);

    if (vocabularyResult.error) throw friendlyRemixError(vocabularyResult.error);
    if (remixResult.error) throw friendlyRemixError(remixResult.error);

    const vocabulary = sampleUnique(
        (vocabularyResult.data || []).map((item) => item.word),
        CANDIDATE_SAMPLE_SIZE,
    );
    const previousPhrases = sampleUnique(
        filterExcludedPhrases(
            (remixResult.data || []).map((item) => item.phrase),
            excludedPhrases,
        ),
        CANDIDATE_SAMPLE_SIZE,
    );

    return { vocabulary, previousPhrases };
}

export function filterExcludedPhrases(values, excludedPhrases = []) {
    const excluded = new Set(excludedPhrases.map(normalizeText).filter(Boolean));
    return values.filter((value) => !excluded.has(normalizeText(value)));
}

function sampleUnique(values, count) {
    const pool = [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];

    for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    return pool.slice(0, count);
}

function normalizeText(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim();
}

function ensureSupabase() {
    if (!isSupabaseConfigured()) {
        throw new Error('Supabase is not configured. Open Settings first.');
    }
}

function friendlyRemixError(error) {
    const message = error?.message || String(error);
    if (message.includes('remix_items') || message.includes('schema cache') || error?.code === 'PGRST205') {
        return new Error('Remix database table is missing. Apply the latest docs/supabase-schema.sql first.');
    }
    return error instanceof Error ? error : new Error(message);
}
