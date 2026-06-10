/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    loadMarqueeContainPreference,
    saveMarqueeContainPreference,
    MARQUEE_CONTAIN_KEY,
} from './marquee-contain.js';

describe('marquee-contain', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('defaults to disabled (intersect) when nothing is saved', () => {
        expect(loadMarqueeContainPreference()).toBe(false);
    });

    it('returns true when saved as "true"', () => {
        localStorage.setItem(MARQUEE_CONTAIN_KEY, 'true');
        expect(loadMarqueeContainPreference()).toBe(true);
    });

    it('saves and loads round-trip', () => {
        saveMarqueeContainPreference(true);
        expect(loadMarqueeContainPreference()).toBe(true);

        saveMarqueeContainPreference(false);
        expect(loadMarqueeContainPreference()).toBe(false);
    });
});
