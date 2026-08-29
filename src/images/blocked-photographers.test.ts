import { describe, it, expect } from 'vitest';
import { isBlockedPhotographerUrl } from './blocked-photographers.js';
import source from './blocked-photographers.ts?raw';

describe('module constraints', () => {
    it('imports nothing and never reads import.meta, so tsx can load it', () => {
        const code = source
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
        const specifiers = [...code.matchAll(
            /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g,
        )];
        expect(specifiers).toEqual([]);
        expect(code).not.toContain('import.meta');
    });
});

describe('isBlockedPhotographerUrl', () => {
    it('blocks a blocked photographer profile URL', () => {
        expect(
            isBlockedPhotographerUrl('https://unsplash.com/@silverkblack'),
        ).toBe(true);
    });

    it('blocks the profile URL with referral params appended', () => {
        expect(
            isBlockedPhotographerUrl(
                'https://unsplash.com/@silverkblack?utm_source=puzzle&utm_medium=referral',
            ),
        ).toBe(true);
    });

    it('does not block other photographers', () => {
        expect(
            isBlockedPhotographerUrl(
                'https://unsplash.com/@frostroomhead?utm_source=puzzle&utm_medium=referral',
            ),
        ).toBe(false);
    });

    it('does not block a username that merely starts with a blocked one', () => {
        expect(
            isBlockedPhotographerUrl('https://unsplash.com/@silverkblack2'),
        ).toBe(false);
    });

    it('returns false for a malformed URL', () => {
        expect(isBlockedPhotographerUrl('not a url')).toBe(false);
    });
});
