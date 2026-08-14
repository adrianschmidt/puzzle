/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import {
    classifyImageSource,
    resolveNewGameImageSource,
} from './classify-image-source.js';
import { BUNDLED_IMAGE_URL, BUNDLED_PORTRAIT_IMAGE_URL } from './bundled-image.js';

describe('classifyImageSource', () => {
    it('classifies the bundled image as bundled', () => {
        expect(classifyImageSource(BUNDLED_IMAGE_URL)).toBe('bundled');
    });

    it('classifies the portrait bundled image as bundled', () => {
        expect(classifyImageSource(BUNDLED_PORTRAIT_IMAGE_URL)).toBe('bundled');
    });

    it('classifies Unsplash URLs as unsplash', () => {
        expect(
            classifyImageSource('https://images.unsplash.com/photo-123?w=1080'),
        ).toBe('unsplash');
    });

    it('classifies the legacy fallback image as fallback', () => {
        expect(classifyImageSource('puzzle-image.jpg')).toBe('fallback');
    });

    it('classifies other hosts and malformed URLs as fallback', () => {
        expect(classifyImageSource('https://example.com/x.jpg')).toBe('fallback');
        expect(classifyImageSource('http://[malformed')).toBe('fallback');
    });

    it('classifies a null imageUrl as blank', () => {
        expect(classifyImageSource(null)).toBe('blank');
    });

    it('classifies a data: URL as fallback, not blank', () => {
        // Nothing produces one any more — deserialize and the share-link
        // load path both map it to null.
        expect(classifyImageSource('data:image/png;base64,AAAA')).toBe('fallback');
    });
});

describe('resolveNewGameImageSource', () => {
    it('returns first-run for the sentinel, regardless of the URL', () => {
        // The first-run start reuses the bundled URL, which would classify as
        // 'bundled' — the sentinel wins.
        expect(resolveNewGameImageSource('first-run', BUNDLED_IMAGE_URL)).toBe('first-run');
    });

    it('classifies by URL when the source is not the first-run sentinel', () => {
        // A fallback-after-failed-fetch reuses the bundled URL but is NOT
        // first-run, so it classifies as 'bundled'.
        expect(resolveNewGameImageSource('random', BUNDLED_IMAGE_URL)).toBe('bundled');
        expect(resolveNewGameImageSource(undefined, BUNDLED_IMAGE_URL)).toBe('bundled');
        expect(
            resolveNewGameImageSource('random', 'https://images.unsplash.com/photo-1?w=1080'),
        ).toBe('unsplash');
        expect(resolveNewGameImageSource('blank', null)).toBe('blank');
    });
});
