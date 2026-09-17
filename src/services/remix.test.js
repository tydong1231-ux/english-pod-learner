import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({
    supabase: { from: vi.fn() },
    isSupabaseConfigured: () => true,
}));

import { filterExcludedPhrases } from './remix';

describe('Remix candidate filtering', () => {
    it('removes already shown phrases before sampling previous Remix candidates', () => {
        expect(filterExcludedPhrases(
            ['what we found was that', 'it comes down to', 'One Thing We Underestimated Was'],
            ['What we found was that', 'one thing we underestimated was'],
        )).toEqual(['it comes down to']);
    });
});
