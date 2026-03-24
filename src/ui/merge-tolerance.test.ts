/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    MERGE_TOLERANCE_PRESETS,
    DEFAULT_TOLERANCE_INDEX,
    TOLERANCE_PREFERENCE_KEY,
    getTolerancePreset,
    saveTolerancePreference,
    loadTolerancePreference,
    getActiveTolerance,
} from './merge-tolerance.js';
import { MERGE_TOLERANCE_PX } from '../game/merge-detection.js';

describe('merge-tolerance', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    describe('MERGE_TOLERANCE_PRESETS', () => {
        it('has at least two presets', () => {
            expect(MERGE_TOLERANCE_PRESETS.length).toBeGreaterThanOrEqual(2);
        });

        it('first preset (Normal) uses the default merge tolerance', () => {
            expect(MERGE_TOLERANCE_PRESETS[0].tolerance).toBe(MERGE_TOLERANCE_PX);
        });

        it('Forgiving preset has a larger tolerance than Normal', () => {
            const normal = MERGE_TOLERANCE_PRESETS[0];
            const forgiving = MERGE_TOLERANCE_PRESETS[1];
            expect(forgiving.tolerance).toBeGreaterThan(normal.tolerance);
        });

        it('each preset has a label and description', () => {
            for (const preset of MERGE_TOLERANCE_PRESETS) {
                expect(preset.label).toBeTruthy();
                expect(preset.description).toBeTruthy();
            }
        });
    });

    describe('getTolerancePreset', () => {
        it('returns the preset at the given index', () => {
            expect(getTolerancePreset(0)).toBe(MERGE_TOLERANCE_PRESETS[0]);
            expect(getTolerancePreset(1)).toBe(MERGE_TOLERANCE_PRESETS[1]);
        });

        it('returns default preset for out-of-range index', () => {
            expect(getTolerancePreset(-1)).toBe(
                MERGE_TOLERANCE_PRESETS[DEFAULT_TOLERANCE_INDEX],
            );
            expect(getTolerancePreset(99)).toBe(
                MERGE_TOLERANCE_PRESETS[DEFAULT_TOLERANCE_INDEX],
            );
        });
    });

    describe('saveTolerancePreference / loadTolerancePreference', () => {
        it('returns default index when nothing is saved', () => {
            expect(loadTolerancePreference()).toBe(DEFAULT_TOLERANCE_INDEX);
        });

        it('saves and loads the preference', () => {
            saveTolerancePreference(1);
            expect(loadTolerancePreference()).toBe(1);
        });

        it('returns default for invalid stored values', () => {
            localStorage.setItem(TOLERANCE_PREFERENCE_KEY, 'garbage');
            expect(loadTolerancePreference()).toBe(DEFAULT_TOLERANCE_INDEX);
        });

        it('returns default for out-of-range stored values', () => {
            localStorage.setItem(TOLERANCE_PREFERENCE_KEY, '99');
            expect(loadTolerancePreference()).toBe(DEFAULT_TOLERANCE_INDEX);
        });

        it('returns default for negative stored values', () => {
            localStorage.setItem(TOLERANCE_PREFERENCE_KEY, '-1');
            expect(loadTolerancePreference()).toBe(DEFAULT_TOLERANCE_INDEX);
        });

        it('handles localStorage errors gracefully', () => {
            vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
                throw new Error('Storage error');
            });

            expect(loadTolerancePreference()).toBe(DEFAULT_TOLERANCE_INDEX);

            vi.restoreAllMocks();
        });
    });

    describe('getActiveTolerance', () => {
        it('returns Normal tolerance by default', () => {
            expect(getActiveTolerance()).toBe(MERGE_TOLERANCE_PX);
        });

        it('returns Forgiving tolerance when preference is set', () => {
            saveTolerancePreference(1);
            expect(getActiveTolerance()).toBe(MERGE_TOLERANCE_PRESETS[1].tolerance);
        });
    });
});
