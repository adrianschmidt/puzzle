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
    getActiveRotationTolerance,
    getSortedPresets,
    getReferencePieceWidth,
    getStyleSnapMultiplier,
} from './merge-tolerance.js';

describe('merge-tolerance', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    describe('MERGE_TOLERANCE_PRESETS', () => {
        it('has at least three presets', () => {
            expect(MERGE_TOLERANCE_PRESETS.length).toBeGreaterThanOrEqual(3);
        });

        it('each preset has a label, description, fraction, rotationDegrees, and displayOrder', () => {
            for (const preset of MERGE_TOLERANCE_PRESETS) {
                expect(preset.label).toBeTruthy();
                expect(preset.description).toBeTruthy();
                expect(preset.fraction).toBeGreaterThan(0);
                expect(preset.rotationDegrees).toBeGreaterThan(0);
                expect(typeof preset.displayOrder).toBe('number');
            }
        });

        it('Strict has a smaller fraction than Normal', () => {
            const strict = MERGE_TOLERANCE_PRESETS[0];
            const normal = MERGE_TOLERANCE_PRESETS[2];
            expect(strict.fraction).toBeLessThan(normal.fraction);
        });

        it('Forgiving has a larger fraction than Normal', () => {
            const forgiving = MERGE_TOLERANCE_PRESETS[1];
            const normal = MERGE_TOLERANCE_PRESETS[2];
            expect(forgiving.fraction).toBeGreaterThan(normal.fraction);
        });

        it('default index points to Normal', () => {
            expect(MERGE_TOLERANCE_PRESETS[DEFAULT_TOLERANCE_INDEX].label).toBe(
                'Normal',
            );
        });

        it('Strict preset has rotationDegrees = 10', () => {
            expect(MERGE_TOLERANCE_PRESETS[0].rotationDegrees).toBe(10);
        });

        it('Forgiving preset has rotationDegrees = 40', () => {
            expect(MERGE_TOLERANCE_PRESETS[1].rotationDegrees).toBe(40);
        });

        it('Normal preset has rotationDegrees = 20', () => {
            expect(MERGE_TOLERANCE_PRESETS[2].rotationDegrees).toBe(20);
        });
    });

    describe('getSortedPresets', () => {
        it('returns presets in display order: Strict, Normal, Forgiving', () => {
            const sorted = getSortedPresets();
            expect(sorted.map((s) => s.preset.label)).toEqual([
                'Strict',
                'Normal',
                'Forgiving',
            ]);
        });

        it('preserves the correct storage indices', () => {
            const sorted = getSortedPresets();
            // Strict is at storage index 0, Normal at 2, Forgiving at 1
            expect(sorted[0].storageIndex).toBe(0);
            expect(sorted[1].storageIndex).toBe(2);
            expect(sorted[2].storageIndex).toBe(1);
        });
    });

    describe('getReferencePieceWidth', () => {
        it('computes imageWidth / cols', () => {
            expect(getReferencePieceWidth(1080, 8)).toBe(135);
            expect(getReferencePieceWidth(800, 6)).toBeCloseTo(133.33, 1);
        });
    });

    describe('getStyleSnapMultiplier', () => {
        it('returns 1.0 for all known styles', () => {
            expect(getStyleSnapMultiplier('classic')).toBe(1.0);
            expect(getStyleSnapMultiplier('fractal')).toBe(1.0);
            expect(getStyleSnapMultiplier('composable')).toBe(1.0);
        });

        it('returns 1.0 for unknown styles', () => {
            expect(getStyleSnapMultiplier('unknown')).toBe(1.0);
        });
    });

    describe('getTolerancePreset', () => {
        it('returns the preset at the given index', () => {
            expect(getTolerancePreset(0)).toBe(MERGE_TOLERANCE_PRESETS[0]);
            expect(getTolerancePreset(1)).toBe(MERGE_TOLERANCE_PRESETS[1]);
            expect(getTolerancePreset(2)).toBe(MERGE_TOLERANCE_PRESETS[2]);
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
        it('computes tolerance as fraction × pieceWidth for default preset', () => {
            // Default is Normal (index 2, fraction 0.333)
            // With 1080px image, 8 cols → pieceWidth = 135
            const tolerance = getActiveTolerance(1080, 8);
            const expected = 0.333 * 135;
            expect(tolerance).toBeCloseTo(expected, 1);
        });

        it('computes tolerance for Strict when preference is set', () => {
            saveTolerancePreference(0); // Strict, fraction 0.133
            const tolerance = getActiveTolerance(1080, 8);
            const expected = 0.133 * 135;
            expect(tolerance).toBeCloseTo(expected, 1);
        });

        it('computes tolerance for Forgiving when preference is set', () => {
            saveTolerancePreference(1); // Forgiving, fraction 0.533
            const tolerance = getActiveTolerance(1080, 8);
            const expected = 0.533 * 135;
            expect(tolerance).toBeCloseTo(expected, 1);
        });

        it('scales with image width and column count', () => {
            // Smaller pieces (more cols) → smaller absolute tolerance
            const toleranceFew = getActiveTolerance(1080, 6);
            const toleranceMany = getActiveTolerance(1080, 16);
            expect(toleranceFew).toBeGreaterThan(toleranceMany);
        });

        it('applies style multiplier', () => {
            // All multipliers are 1.0 for now, so result should be the same
            const classic = getActiveTolerance(1080, 8, 'classic');
            const fractal = getActiveTolerance(1080, 8, 'fractal');
            expect(classic).toBe(fractal);
        });
    });

    describe('getActiveRotationTolerance', () => {
        it('returns 20 for the default Normal preset', () => {
            // Default index is Normal (2), rotationDegrees = 20
            expect(getActiveRotationTolerance()).toBe(20);
        });

        it('returns 10 for the Strict preset', () => {
            saveTolerancePreference(0);
            expect(getActiveRotationTolerance()).toBe(10);
        });

        it('returns 40 for the Forgiving preset', () => {
            saveTolerancePreference(1);
            expect(getActiveRotationTolerance()).toBe(40);
        });

        it('returns Normal value after round-trip save/load', () => {
            saveTolerancePreference(2); // Normal
            expect(getActiveRotationTolerance()).toBe(20);
        });
    });
});
