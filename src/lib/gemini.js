import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Uploads a file to Gemini using the File API.
 * Note: Browser-based file api support in SDK is limited for large files or requires specific handling.
 * We will convert File to Base64 for the 'inlineData' approach for smaller files, 
 * or use the File API if supported via a proxy. 
 * HOWEVER, the JS SDK now supports the Files API directly via `GoogleAIFileManager` (node only) 
 * or generally via inline data for images/audio in the browser. 
 * 
 * For this "local tool", we will use INLINE DATA (Base64) for simplicity if file size permits (< 20MB),
 * otherwise we might need a different approach.
 * For podcasts (often 20-50MB), sending as inline data might hit limits.
 * 
 * Update: user wants "Download podcast, transfer to software".
 * We'll start with Base64. A 30min mp3 at 64kbps is ~15MB. It usually fits.
 */

const fileToGenerativePart = async (file) => {
  const base64EncodedDataPromise = new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
  };
};

export class GeminiService {
  constructor(apiKey, modelName = "gemini-2.0-flash-exp") {
    if (!apiKey) throw new Error("API Key is required");
    this.apiKey = apiKey;
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 65536,
        // Disable "thinking" for faster responses (no chain-of-thought needed for transcription)
        thinkingConfig: { thinkingBudget: 0 }
      }
    });
  }

  async generateTranscript(file, customPrompt, onProgress) {
    if (this.apiKey === 'DEMO_KEY') {
      // Demo code...
      return {
        segments: [
          { start: 0, end: 3, text: "Welcome to the PodFluent demo.", words: [{ word: "Welcome", start: 0, end: 0.5 }, { word: "to", start: 0.5, end: 1 }, { word: "the", start: 1, end: 1.5 }, { word: "PodFluent", start: 1.5, end: 2.5 }, { word: "demo", start: 2.5, end: 3 }] }
        ]
      };
    }

    // 10MB Chunks - larger chunks = fewer boundaries = less timestamp drift
    // This will result in ~3 chunks for a 30MB file instead of ~15
    const CHUNK_SIZE = 10 * 1024 * 1024;
    // Add 200KB overlap to prevent word splits at chunk boundaries
    const OVERLAP_SIZE = 200 * 1024;

    // Preserve the original MIME type for all chunks
    const mimeType = file.type || 'audio/mpeg'; // Fallback to common audio type

    if (file.size <= CHUNK_SIZE) {
      return this.processSingleChunk(file, customPrompt, 0, mimeType);
    }

    // Chunking with Overlap - each chunk starts slightly before where the previous one ended
    const chunks = [];
    let offset = 0;
    while (offset < file.size) {
      const end = Math.min(offset + CHUNK_SIZE, file.size);
      const slicedBlob = file.slice(offset, end);
      const typedChunk = new Blob([slicedBlob], { type: mimeType });
      chunks.push({ blob: typedChunk, startOffset: offset });

      // Move forward, but start next chunk with some overlap
      const nextOffset = end - OVERLAP_SIZE;
      if (nextOffset <= offset) {
        // Prevent infinite loop if OVERLAP_SIZE >= CHUNK_SIZE
        offset = end;
      } else {
        offset = nextOffset;
      }
      if (offset >= file.size) break;
    }

    console.log(`File size ${file.size} bytes. Split into ${chunks.length} chunks.`);
    if (onProgress) onProgress(`Split into ${chunks.length} parts (with overlap). Processing...`);

    let combinedSegments = [];
    let timeOffset = 0;
    const errors = [];

    // Estimate audio duration per chunk based on file size
    // Average MP3 bitrate assumption: 128kbps = 16KB/s
    const BYTES_PER_SECOND = 16 * 1024;
    // Effective chunk duration (excluding overlap from subsequent chunks)
    const effectiveChunkSize = CHUNK_SIZE - OVERLAP_SIZE;
    const estimatedChunkDuration = effectiveChunkSize / BYTES_PER_SECOND;

    for (let i = 0; i < chunks.length; i++) {
      if (onProgress) onProgress(`Processing part ${i + 1} of ${chunks.length}...`);

      console.log(`Processing chunk ${i + 1}/${chunks.length}, timeOffset: ${timeOffset.toFixed(2)}s`);

      try {
        // Process chunk - note: use chunks[i].blob now
        const result = await this.processSingleChunk(chunks[i].blob, customPrompt, i, mimeType);

        // Adjust timestamps and interpolate words if missing
        if (result && result.segments && result.segments.length > 0) {
          const adjusted = result.segments.map(seg => {
            const adjustedSeg = {
              ...seg,
              start: seg.start + timeOffset,
              end: seg.end + timeOffset,
            };

            // Interpolate words if not provided by API
            if (!seg.words || seg.words.length === 0) {
              adjustedSeg.words = this.interpolateWords(seg.text, adjustedSeg.start, adjustedSeg.end);
            } else {
              adjustedSeg.words = seg.words.map(w => ({
                ...w,
                start: w.start + timeOffset,
                end: w.end + timeOffset
              }));
            }

            return adjustedSeg;
          });

          // Smart Deduplication for overlap regions
          if (combinedSegments.length > 0 && i > 0) {
            // Get last few segments from previous chunk to compare
            const lastFewSegments = combinedSegments.slice(-5);
            const lastSegTexts = lastFewSegments.map(s => s.text.toLowerCase().trim());

            const deduped = [];
            let foundNewContent = false;

            for (const seg of adjusted) {
              const thisText = seg.text.toLowerCase().trim();

              // Once we find new content, keep everything after
              if (foundNewContent) {
                deduped.push(seg);
                continue;
              }

              // Check if this is a duplicate
              const isDuplicate = lastSegTexts.some(lastText => {
                // Exact match
                if (lastText === thisText) return true;
                // One contains the other (partial match)
                if (lastText.includes(thisText) || thisText.includes(lastText)) return true;
                // Similar enough (first 30 chars match)
                if (lastText.length > 30 && thisText.length > 30) {
                  if (lastText.substring(0, 30) === thisText.substring(0, 30)) return true;
                }
                return false;
              });

              if (isDuplicate) {
                console.log(`[Dedup] Skipping: "${seg.text.substring(0, 40)}..."`);
              } else {
                // Found new content - keep this and everything after
                foundNewContent = true;
                deduped.push(seg);
              }
            }

            // If we found deduped segments, we need to adjust their timestamps
            // because they should continue from where the last combined segment ended
            if (deduped.length > 0) {
              const lastCombinedEnd = combinedSegments[combinedSegments.length - 1].end;
              const firstDedupedStart = deduped[0].start;
              const timestampShift = lastCombinedEnd - firstDedupedStart;

              if (Math.abs(timestampShift) > 1) { // Only adjust if difference is > 1 second
                console.log(`[Dedup] Adjusting timestamps by ${timestampShift.toFixed(2)}s`);
                deduped.forEach(seg => {
                  seg.start += timestampShift;
                  seg.end += timestampShift;
                  if (seg.words) {
                    seg.words.forEach(w => {
                      w.start += timestampShift;
                      w.end += timestampShift;
                    });
                  }
                });
              }
            }

            combinedSegments = combinedSegments.concat(deduped);
          } else {
            combinedSegments = combinedSegments.concat(adjusted);
          }
        }

        // Use estimated chunk duration for offset
        timeOffset += estimatedChunkDuration;

      } catch (err) {
        console.error(`Error processing chunk ${i + 1}`, err);
        errors.push(`Part ${i + 1}: ${err.message}`);
        if (onProgress) onProgress(`Error in part ${i + 1}: ${err.message}. Continuing...`);
        // Still advance the time offset even on error
        timeOffset += estimatedChunkDuration;
      }
    }

    // If we have ZERO segments but had chunks, throw the specific errors
    if (combinedSegments.length === 0 && chunks.length > 0) {
      throw new Error(`All chunks failed. Details: ${errors.join(' | ')}`);
    }

    return { segments: combinedSegments };
  }

  async processSingleChunk(blob, customPrompt, chunkIndex, mimeType) {
    // 1. Prepare audio part - Ensure the blob has correct MIME type
    const safeBlob = blob.type ? blob : new Blob([blob], { type: mimeType || 'audio/mpeg' });
    const audioPart = await fileToGenerativePart(safeBlob);

    // 2. Prompt with speaker diarization
    const defaultPrompt = `
      Transcribe this audio VERBATIM with speaker identification.
      Identify different speakers and label them (e.g., "Speaker 1", "Speaker 2", or use names if mentioned).
      Group consecutive sentences by the same speaker into one segment.
      Return JSON:
      {
        "segments": [
          { "start": 0.0, "end": 5.2, "speaker": "Speaker 1", "text": "What the speaker said." },
          { "start": 5.3, "end": 10.1, "speaker": "Speaker 2", "text": "Response from another speaker." }
        ]
      }
      Do NOT include word-level timestamps. Just segments with speaker, start/end times, and text.
    `;

    const promptToUse = customPrompt && customPrompt.trim().length > 0 ? customPrompt : defaultPrompt;

    // Retry logic for single chunk with TIMEOUT for debugging
    let retries = 2;
    let lastError;

    const TIMEOUT_MS = 120000; // 120 seconds max per chunk

    while (retries > 0) {
      try {
        console.log(`[Chunk ${chunkIndex}] Starting API call...`);
        const startTime = Date.now();

        // Race between API call and timeout
        const result = await Promise.race([
          this.model.generateContent([promptToUse, audioPart]),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`TIMEOUT after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)
          )
        ]);

        console.log(`[Chunk ${chunkIndex}] API returned in ${(Date.now() - startTime) / 1000}s`);

        const response = await result.response;
        const text = response.text();

        console.log(`[Chunk ${chunkIndex}] Response text length: ${text.length}`);

        try {
          let parsed = JSON.parse(text);
          // Normalize: Gemini sometimes returns [{"segments":[...]}] instead of {"segments":[...]}
          if (Array.isArray(parsed)) {
            console.log(`[Chunk ${chunkIndex}] Response was array, extracting first element`);
            parsed = parsed[0];
          }
          // Also handle case where segments is at top level
          if (parsed.segments) {
            return parsed;
          } else if (Array.isArray(parsed)) {
            // If it's an array of segments directly
            return { segments: parsed };
          } else {
            console.error(`[Chunk ${chunkIndex}] Unexpected response structure:`, parsed);
            return { segments: [] };
          }
        } catch {
          const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
          let parsed = JSON.parse(clean);
          // Same normalization for cleaned text
          if (Array.isArray(parsed)) {
            parsed = parsed[0];
          }
          if (parsed.segments) {
            return parsed;
          } else if (Array.isArray(parsed)) {
            return { segments: parsed };
          }
          return parsed;
        }
      } catch (e) {
        console.error(`[Chunk ${chunkIndex}] Attempt failed:`, e.message || e);
        lastError = e;
        retries--;
        if (retries > 0) {
          console.log(`[Chunk ${chunkIndex}] Retrying in 2s...`);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    throw lastError || new Error("Chunk processing failed after retries");
  }

  /**
   * Interpolate word-level timestamps from sentence timestamps.
   * Distributes time evenly based on word character length.
   */
  interpolateWords(text, startTime, endTime) {
    if (!text) return [];
    const wordsArray = text.trim().split(/\s+/);
    if (wordsArray.length === 0) return [];

    const totalChars = wordsArray.reduce((sum, w) => sum + w.length, 0);
    const duration = endTime - startTime;

    let currentTime = startTime;
    return wordsArray.map(word => {
      const wordDuration = (word.length / totalChars) * duration;
      const wordStart = currentTime;
      const wordEnd = currentTime + wordDuration;
      currentTime = wordEnd;
      return {
        word: word,
        start: parseFloat(wordStart.toFixed(2)),
        end: parseFloat(wordEnd.toFixed(2))
      };
    });
  }

  async generateVocabCard(word, contextSentence) {
    if (this.apiKey === 'DEMO_KEY') {
      return new Promise(resolve => setTimeout(() => resolve({
        word: word,
        definition: "A demonstration or example of a product or concept.",
        ipa: "demo",
        examples: ["This is a demo of the new software.", "I will show you a quick demo."],
        translation: "demonstration"
      }), 1000));
    }

    // Use a simpler model config for vocab (no JSON mode - let model output freely)
    const vocabModel = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
      generationConfig: {
        maxOutputTokens: 1024,
      }
    });

    const prompt = `Create a vocabulary card for the word "${word}" in the context of this sentence: "${contextSentence}".

Return ONLY valid JSON (no markdown, no explanation):
{"word": "${word}", "definition": "concise English definition", "ipa": "phonetic transcription", "examples": ["sentence 1", "sentence 2"], "translation": "Chinese translation"}`;

    try {
      console.log('[Gemini] Generating vocab card for:', word);
      const result = await vocabModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      console.log('[Gemini] Raw response:', text);

      // Try to parse JSON, handling markdown code blocks
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Try removing markdown code blocks
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        console.log('[Gemini] Cleaned response:', clean);
        parsed = JSON.parse(clean);
      }

      // Validate required fields
      if (!parsed.definition) {
        console.error('[Gemini] Missing definition in response:', parsed);
        throw new Error('Gemini response missing definition field');
      }

      return parsed;
    } catch (err) {
      console.error('[Gemini] generateVocabCard error:', err);
      throw new Error(`Gemini API error: ${err.message}`);
    }
  }
}
