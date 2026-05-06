/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    FREE_ROTATION_ENABLED_PREFERENCE_KEY,
    loadFreeRotationEnabledPreference,
    saveFreeRotationEnabledPreference,
} from './free-rotation-preference.js';

describe('free rotation preference', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('defaults to false when nothing is saved', () => {
        expect(loadFreeRotationEnabledPreference()).toBe(false);
    });

    it('round-trips through save → load', () => {
        saveFreeRotationEnabledPreference(true);
        expect(loadFreeRotationEnabledPreference()).toBe(true);

        saveFreeRotationEnabledPreference(false);
        expect(loadFreeRotationEnabledPreference()).toBe(false);
    });

    it('writes under the documented localStorage key', () => {
        saveFreeRotationEnabledPreference(true);
        expect(window.localStorage.getItem(FREE_ROTATION_ENABLED_PREFERENCE_KEY))
            .not.toBeNull();
    });
});
