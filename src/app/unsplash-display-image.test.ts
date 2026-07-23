/**
 * Tests for the shared Unsplash-result → display-model mapper.
 */

import { describe, it, expect } from 'vitest';
import type { UnsplashImageResult } from '../images/index.js';
import { toDisplayImage } from './unsplash-display-image.js';

function makeResult(): UnsplashImageResult {
    return {
        imageUrl: 'https://images.unsplash.com/photo-1?w=1080',
        thumbUrl: 'https://images.unsplash.com/photo-1?w=400',
        width: 4000,
        height: 2667,
        photographerName: 'Jane Doe',
        photographerUrl: 'https://unsplash.com/@janedoe',
        photoUrl: 'https://unsplash.com/photos/1',
        downloadLocation: 'https://api.unsplash.com/photos/1/download',
        description: 'a photo',
    };
}

describe('toDisplayImage', () => {
    it('maps to a 1080-wide display size with aspect-scaled height', () => {
        const display = toDisplayImage(makeResult());

        expect(display).toEqual({
            imageUrl: 'https://images.unsplash.com/photo-1?w=1080',
            imageSize: { width: 1080, height: Math.round(1080 * (2667 / 4000)) },
            attribution: {
                photographerName: 'Jane Doe',
                photographerUrl: 'https://unsplash.com/@janedoe',
                photoUrl: 'https://unsplash.com/photos/1',
            },
            downloadLocation: 'https://api.unsplash.com/photos/1/download',
        });
    });
});
