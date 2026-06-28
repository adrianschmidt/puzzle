/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    COMPOSABLE_CONFIG_KEY,
    saveComposableConfigPreference,
    loadComposableConfigPreference,
    composableSliderToGeneratorConfig,
} from './composable-config.js';

describe('saveComposableConfigPreference / loadComposableConfigPreference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    const sampleConfig = {
        baseCut: 'sine' as const,
        horizontalAmplitude: 0.25,
        horizontalFrequency: 3.0,
        verticalAmplitude: 0.1,
        verticalFrequency: 5.0,
        tabGenerator: 'none' as const,
        borderless: false,
        jitter: 0.15,
    };

    it('returns undefined when nothing is saved', () => {
        expect(loadComposableConfigPreference()).toBeUndefined();
    });

    it('round-trips a saved config', () => {
        saveComposableConfigPreference(sampleConfig);
        expect(loadComposableConfigPreference()).toEqual(sampleConfig);
    });

    it('round-trips a config with tabGenerator: traced', () => {
        const traced = { ...sampleConfig, tabGenerator: 'traced' as const };
        saveComposableConfigPreference(traced);
        expect(loadComposableConfigPreference()).toEqual(traced);
    });

    it('returns undefined for invalid JSON', () => {
        localStorage.setItem(COMPOSABLE_CONFIG_KEY, 'not-json');
        expect(loadComposableConfigPreference()).toBeUndefined();
    });

    it('returns undefined for JSON missing required fields', () => {
        localStorage.setItem(
            COMPOSABLE_CONFIG_KEY,
            JSON.stringify({ horizontalAmplitude: 0.5 }),
        );
        expect(loadComposableConfigPreference()).toBeUndefined();
    });

    it('coerces numeric string values to numbers', () => {
        localStorage.setItem(
            COMPOSABLE_CONFIG_KEY,
            JSON.stringify({
                horizontalAmplitude: '0.2',
                horizontalFrequency: '1.5',
                verticalAmplitude: '0.3',
                verticalFrequency: '2.0',
                tabGenerator: 'classic',
            }),
        );
        const loaded = loadComposableConfigPreference();
        expect(loaded?.horizontalAmplitude).toBe(0.2);
        expect(typeof loaded?.horizontalAmplitude).toBe('number');
    });

    it('migrates legacy { disableTabs: true } to { tabGenerator: "none" }', () => {
        localStorage.setItem(
            COMPOSABLE_CONFIG_KEY,
            JSON.stringify({
                horizontalAmplitude: 0.15,
                horizontalFrequency: 1.5,
                verticalAmplitude: 0.15,
                verticalFrequency: 1.5,
                disableTabs: true,
            }),
        );
        expect(loadComposableConfigPreference()?.tabGenerator).toBe('none');
    });

    it('migrates legacy { disableTabs: false } to { tabGenerator: "classic" }', () => {
        localStorage.setItem(
            COMPOSABLE_CONFIG_KEY,
            JSON.stringify({
                horizontalAmplitude: 0.15,
                horizontalFrequency: 1.5,
                verticalAmplitude: 0.15,
                verticalFrequency: 1.5,
                disableTabs: false,
            }),
        );
        expect(loadComposableConfigPreference()?.tabGenerator).toBe('classic');
    });
});

describe('composable borderless preference', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips borderless: true', () => {
        saveComposableConfigPreference({
            baseCut: 'sine', jitter: 0.15,
            horizontalAmplitude: 0.15, horizontalFrequency: 1.5,
            verticalAmplitude: 0.15, verticalFrequency: 1.5,
            tabGenerator: 'classic', borderless: true,
        });
        expect(loadComposableConfigPreference()?.borderless).toBe(true);
    });

    it('defaults borderless to false when the saved config omits it', () => {
        saveComposableConfigPreference({
            horizontalAmplitude: 0.15, horizontalFrequency: 1.5,
            verticalAmplitude: 0.15, verticalFrequency: 1.5,
            tabGenerator: 'classic',
        } as never);
        expect(loadComposableConfigPreference()?.borderless).toBe(false);
    });
});

describe('composable base-cut + jitter', () => {
    beforeEach(() => localStorage.clear());

    it('defaults baseCut to sine and jitter to 0.15 for legacy saved configs', () => {
        // A pre-existing preference written before baseCut/jitter existed.
        localStorage.setItem(COMPOSABLE_CONFIG_KEY, JSON.stringify({
            horizontalAmplitude: 0.2,
            horizontalFrequency: 1,
            verticalAmplitude: 0.2,
            verticalFrequency: 1,
            tabGenerator: 'classic',
            borderless: false,
        }));
        const loaded = loadComposableConfigPreference();
        expect(loaded?.baseCut).toBe('sine');
        expect(loaded?.jitter).toBe(0.15);
    });

    it('clamps an out-of-range jitter to the [0, 0.5] slider range', () => {
        // A hand-edited or stale localStorage value must not smuggle an
        // out-of-range jitter back into the UI; parseComposableConfig clamps it.
        localStorage.setItem(COMPOSABLE_CONFIG_KEY, JSON.stringify({
            baseCut: 'triangular',
            horizontalAmplitude: 0.15,
            horizontalFrequency: 1.5,
            verticalAmplitude: 0.15,
            verticalFrequency: 1.5,
            tabGenerator: 'classic',
            borderless: false,
            jitter: 5,
        }));
        expect(loadComposableConfigPreference()?.jitter).toBe(0.5);

        localStorage.setItem(COMPOSABLE_CONFIG_KEY, JSON.stringify({
            baseCut: 'triangular',
            horizontalAmplitude: 0.15,
            horizontalFrequency: 1.5,
            verticalAmplitude: 0.15,
            verticalFrequency: 1.5,
            tabGenerator: 'classic',
            borderless: false,
            jitter: -2,
        }));
        expect(loadComposableConfigPreference()?.jitter).toBe(0);
    });

    it('round-trips a triangular preference', () => {
        const tri = {
            baseCut: 'triangular' as const,
            horizontalAmplitude: 0.15,
            horizontalFrequency: 1.5,
            verticalAmplitude: 0.15,
            verticalFrequency: 1.5,
            tabGenerator: 'classic' as const,
            borderless: false,
            jitter: 0.3,
        };
        saveComposableConfigPreference(tri);
        expect(loadComposableConfigPreference()).toEqual(tri);
    });

    it('translates a sine slider config to a sine generator config', () => {
        const cfg = composableSliderToGeneratorConfig({
            baseCut: 'sine',
            horizontalAmplitude: 0.2,
            horizontalFrequency: 3,
            verticalAmplitude: 0.1,
            verticalFrequency: 4,
            tabGenerator: 'classic',
            borderless: true,
            jitter: 0.3,
        });
        expect(cfg).toEqual({
            baseCutGenerator: 'sine',
            baseCutConfig: { ha: 0.2, hf: 3, va: 0.1, vf: 4 },
            tabGenerator: 'classic',
            tabConfig: {},
            borderless: true,
        });
    });

    it('translates a triangular slider config to a triangular generator config', () => {
        const cfg = composableSliderToGeneratorConfig({
            baseCut: 'triangular',
            horizontalAmplitude: 0.2,
            horizontalFrequency: 3,
            verticalAmplitude: 0.1,
            verticalFrequency: 4,
            tabGenerator: 'traced',
            borderless: true,
            jitter: 0.3,
        });
        expect(cfg).toEqual({
            baseCutGenerator: 'triangular',
            baseCutConfig: { jitter: 0.3 },
            tabGenerator: 'traced',
            tabConfig: {},
            borderless: false,
        });
    });
});
