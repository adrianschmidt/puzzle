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
        tabGenerator: 'none' as const,
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
