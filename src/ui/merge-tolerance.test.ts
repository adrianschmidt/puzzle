/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    MERGE_TOLERANCE_PRESETS,
    DEFAULT_TOLERANCE_ID,
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

        it('each preset has id, label, description, fraction, rotationDegrees, displayOrder', () => {
            for (const preset of MERGE_TOLERANCE_PRESETS) {
                expect(preset.id).toBeTruthy();
                expect(preset.label).toBeTruthy();
                expect(preset.description).toBeTruthy();
                expect(preset.fraction).toBeGreaterThan(0);
                expect(preset.rotationDegrees).toBeGreaterThan(0);
                expect(typeof preset.displayOrder).toBe('number');
            }
        });

        it('uses stable string ids: strict, forgiving, normal', () => {
            const ids = MERGE_TOLERANCE_PRESETS.map((p) => p.id);
            expect(ids).toEqual(['strict', 'forgiving', 'normal']);
        });

        it('default id points to Normal', () => {
            expect(DEFAULT_TOLERANCE_ID).toBe('normal');
        });
    });

    describe('getSortedPresets', () => {
        it('returns presets in display order: Strict, Normal, Forgiving', () => {
            const sorted = getSortedPresets();
            expect(sorted.map((p) => p.label)).toEqual(['Strict', 'Normal', 'Forgiving']);
        });
    });

    describe('getReferencePieceWidth', () => {
        it('computes imageWidth / cols', () => {
            expect(getReferencePieceWidth(1080, 8)).toBe(135);
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
        it('returns the preset matching an id', () => {
            expect(getTolerancePreset('strict').label).toBe('Strict');
            expect(getTolerancePreset('forgiving').label).toBe('Forgiving');
            expect(getTolerancePreset('normal').label).toBe('Normal');
        });

        it('returns the default preset for an unknown id', () => {
            expect(getTolerancePreset('nope').label).toBe('Normal');
        });
    });

    describe('saveTolerancePreference / loadTolerancePreference', () => {
        it('returns default id when nothing is saved', () => {
            expect(loadTolerancePreference()).toBe(DEFAULT_TOLERANCE_ID);
        });

        it('saves and loads an id', () => {
            saveTolerancePreference('strict');
            expect(loadTolerancePreference()).toBe('strict');
        });

        it('migrates legacy integer indices to ids', () => {
            localStorage.setItem(TOLERANCE_PREFERENCE_KEY, '0');
            expect(loadTolerancePreference()).toBe('strict');
            localStorage.setItem(TOLERANCE_PREFERENCE_KEY, '1');
            expect(loadTolerancePreference()).toBe('forgiving');
            localStorage.setItem(TOLERANCE_PREFERENCE_KEY, '2');
            expect(loadTolerancePreference()).toBe('normal');
        });

        it('returns default for unknown stored values', () => {
            localStorage.setItem(TOLERANCE_PREFERENCE_KEY, 'garbage');
            expect(loadTolerancePreference()).toBe(DEFAULT_TOLERANCE_ID);
        });

        it('returns default for out-of-range legacy values', () => {
            localStorage.setItem(TOLERANCE_PREFERENCE_KEY, '99');
            expect(loadTolerancePreference()).toBe(DEFAULT_TOLERANCE_ID);
        });

        it('handles localStorage errors gracefully', () => {
            vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
                throw new Error('storage error');
            });
            expect(loadTolerancePreference()).toBe(DEFAULT_TOLERANCE_ID);
            vi.restoreAllMocks();
        });
    });

    describe('getActiveTolerance', () => {
        it('computes tolerance for the default preset', () => {
            // Normal: fraction 0.333, 1080/8 = 135 → ~45
            const tolerance = getActiveTolerance(1080, 8);
            expect(tolerance).toBeCloseTo(0.333 * 135, 1);
        });

        it('computes tolerance for Strict when saved', () => {
            saveTolerancePreference('strict');
            expect(getActiveTolerance(1080, 8)).toBeCloseTo(0.133 * 135, 1);
        });

        it('computes tolerance for Forgiving when saved', () => {
            saveTolerancePreference('forgiving');
            expect(getActiveTolerance(1080, 8)).toBeCloseTo(0.533 * 135, 1);
        });
    });

    describe('getActiveRotationTolerance', () => {
        it('returns 20 for the default Normal preset', () => {
            expect(getActiveRotationTolerance()).toBe(20);
        });

        it('returns 10 for Strict', () => {
            saveTolerancePreference('strict');
            expect(getActiveRotationTolerance()).toBe(10);
        });

        it('returns 40 for Forgiving', () => {
            saveTolerancePreference('forgiving');
            expect(getActiveRotationTolerance()).toBe(40);
        });
    });
});
