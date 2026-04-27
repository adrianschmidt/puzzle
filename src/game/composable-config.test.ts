/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    COMPOSABLE_CONFIG_KEY,
    saveComposableConfigPreference,
    loadComposableConfigPreference,
} from './composable-config.js';

describe('saveComposableConfigPreference / loadComposableConfigPreference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    const sampleConfig = {
        horizontalAmplitude: 0.25,
        horizontalFrequency: 3.0,
        verticalAmplitude: 0.1,
        verticalFrequency: 5.0,
        disableTabs: true,
    };

    it('returns undefined when nothing is saved', () => {
        expect(loadComposableConfigPreference()).toBeUndefined();
    });

    it('round-trips a saved config', () => {
        saveComposableConfigPreference(sampleConfig);
        expect(loadComposableConfigPreference()).toEqual(sampleConfig);
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
                disableTabs: false,
            }),
        );
        const loaded = loadComposableConfigPreference();
        expect(loaded?.horizontalAmplitude).toBe(0.2);
        expect(typeof loaded?.horizontalAmplitude).toBe('number');
    });
});
