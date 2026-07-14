/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { classifyImageSource } from './classify-image-source.js';
import { BUNDLED_IMAGE_URL } from './bundled-image.js';

describe('classifyImageSource', () => {
    it('classifies data URLs as blank', () => {
        expect(classifyImageSource('data:image/png;base64,AAAA')).toBe('blank');
    });

    it('classifies the bundled image as bundled', () => {
        expect(classifyImageSource(BUNDLED_IMAGE_URL)).toBe('bundled');
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
});
