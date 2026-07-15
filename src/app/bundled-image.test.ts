import { describe, it, expect } from 'vitest';
import {
    BUNDLED_IMAGE_URL,
    BUNDLED_IMAGE_SIZE,
    BUNDLED_IMAGE_ATTRIBUTION,
    BUNDLED_PORTRAIT_IMAGE_URL,
    BUNDLED_PORTRAIT_IMAGE_SIZE,
    BUNDLED_PORTRAIT_IMAGE_ATTRIBUTION,
    pickBundledImage,
} from './bundled-image.js';

describe('pickBundledImage', () => {
    it('returns the landscape asset for landscape', () => {
        expect(pickBundledImage('landscape')).toEqual({
            url: BUNDLED_IMAGE_URL,
            size: BUNDLED_IMAGE_SIZE,
            attribution: BUNDLED_IMAGE_ATTRIBUTION,
        });
    });

    it('returns the portrait asset for portrait', () => {
        expect(pickBundledImage('portrait')).toEqual({
            url: BUNDLED_PORTRAIT_IMAGE_URL,
            size: BUNDLED_PORTRAIT_IMAGE_SIZE,
            attribution: BUNDLED_PORTRAIT_IMAGE_ATTRIBUTION,
        });
    });

    it('ships a genuinely portrait bundled image', () => {
        expect(BUNDLED_PORTRAIT_IMAGE_SIZE.height).toBeGreaterThan(
            BUNDLED_PORTRAIT_IMAGE_SIZE.width,
        );
    });
});
