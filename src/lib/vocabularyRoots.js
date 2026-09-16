// Both providers use the same contract. The model never controls UI separators.
export function vocabularyPrompt(word, contextSentence) {
    return `Create a vocabulary card for ${JSON.stringify(word)} in this sentence: ${JSON.stringify(contextSentence)}.
Return only valid JSON:
{"word":"${word}","definition":"brief English meaning in context","ipa":"phonetic transcription","translation":"Chinese translation","examples":["short sentence using the word","another short sentence"],"roots":[{"root":"root present in the word","meaning":"brief Chinese root meaning","examples":[{"word":"related word","meaning":"2–5 word English gloss"},{"word":"another related word","meaning":"2–5 word English gloss"}]}]}
Keep definition English-only. For roots, use 0–2 reliable, useful etymological roots actually present in the word. If more than two exist, omit the most common first. Never invent splits, confuse similar spelling with shared origin, or count ordinary inflectional endings as roots. Use [] when no useful root is identifiable.
For each root, supply exactly two distinct words sharing that root and meaning; exclude the target and its inflected forms. Choose moderately common intermediate/advanced words, neither elementary nor obscure. Omit a root if two reliable examples cannot be supplied. No markdown or extra commentary.`;
}

const clean = value => typeof value === 'string' ? value.trim() : '';

export function normalizeRoots(roots, targetWord = '') {
    if (!Array.isArray(roots)) return [];
    const seen = new Set();
    return roots.flatMap(item => {
        const root = clean(item?.root);
        const meaning = clean(item?.meaning);
        if (!root || !meaning || seen.has(root.toLowerCase())) return [];
        const words = new Set([targetWord.toLowerCase()]);
        const examples = (Array.isArray(item.examples) ? item.examples : []).flatMap(example => {
            const word = clean(example?.word);
            const gloss = clean(example?.meaning);
            if (!word || !gloss || words.has(word.toLowerCase())) return [];
            words.add(word.toLowerCase());
            return [{ word, meaning: gloss }];
        }).slice(0, 2);
        if (examples.length !== 2) return [];
        seen.add(root.toLowerCase());
        return [{ root, meaning, examples }];
    }).slice(0, 2);
}

// Persist in the existing text column: no schema migration or old-card rewrite.
// The marker format remains compatible with cards created by the earlier prompt.
export function vocabularyMeaning(card) {
    const definition = clean(card.definition) || clean(card.meaning) || 'No definition available';
    const roots = normalizeRoots(card.roots, card.word);
    if (!roots.length) return definition;
    const english = definition.split('【词根拆解】')[0].trim();
    return `${english}\n\n【词根拆解】 ${roots.map((root, index) =>
        `${index === 0 ? '①' : '②'} ${root.root} (${root.meaning}): ${root.examples.map(example => `${example.word} (${example.meaning})`).join('; ')}`
    ).join('\n')}`;
}
