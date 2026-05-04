/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    ROTATION_ENABLED_PREFERENCE_KEY,
    saveRotationEnabledPreference,
    loadRotationEnabledPreference,
} from './rotation-preference.js';

describe('rotation-preference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('defaults to false when nothing is saved', () => {
        expect(loadRotationEnabledPreference()).toBe(false);
    });

    it('round-trips true', () => {
        saveRotationEnabledPreference(true);
        expect(loadRotationEnabledPreference()).toBe(true);
    });

    it('round-trips false', () => {
        saveRotationEnabledPreference(false);
        expect(loadRotationEnabledPreference()).toBe(false);
    });

    it('returns false for unparseable values', () => {
        localStorage.setItem(ROTATION_ENABLED_PREFERENCE_KEY, 'banana');
        expect(loadRotationEnabledPreference()).toBe(false);
    });

    it('persists under the documented key', () => {
        saveRotationEnabledPreference(true);
        expect(localStorage.getItem(ROTATION_ENABLED_PREFERENCE_KEY)).toBe('true');
    });
});
