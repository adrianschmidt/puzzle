/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    PIECE_OUTLINE_COLOR_PRESETS,
    DEFAULT_PIECE_OUTLINE_COLOR_ID,
    PIECE_OUTLINE_COLOR_PREFERENCE_KEY,
    CSS_CUSTOM_PROPERTY,
    getPieceOutlineColorPreset,
    savePieceOutlineColorPreference,
    loadPieceOutlineColorPreference,
    applyPieceOutlineColor,
} from './piece-outline-color.js';

describe('PIECE_OUTLINE_COLOR_PRESETS', () => {
    it('exposes the full palette (140 presets)', () => {
        expect(PIECE_OUTLINE_COLOR_PRESETS.length).toBe(140);
    });

    it('each preset color is a var(--color-…) reference', () => {
        for (const p of PIECE_OUTLINE_COLOR_PRESETS) {
            expect(p.color).toMatch(/^var\(--color-[a-z]+-[a-z0-9-]+\)$/);
        }
    });

    it('the default id is near-black gray-darker-3 and is a real preset', () => {
        expect(DEFAULT_PIECE_OUTLINE_COLOR_ID).toBe('gray-darker-3');
        expect(
            PIECE_OUTLINE_COLOR_PRESETS.some(
                (p) => p.id === DEFAULT_PIECE_OUTLINE_COLOR_ID,
            ),
        ).toBe(true);
    });
});

describe('getPieceOutlineColorPreset', () => {
    it('returns the matching preset', () => {
        const preset = getPieceOutlineColorPreset('blue-default');
        expect(preset.id).toBe('blue-default');
        expect(preset.color).toBe('var(--color-blue-default)');
    });

    it('falls back to the default for an unknown id', () => {
        expect(getPieceOutlineColorPreset('nope').id).toBe(
            DEFAULT_PIECE_OUTLINE_COLOR_ID,
        );
    });
});

describe('loadPieceOutlineColorPreference', () => {
    beforeEach(() => localStorage.clear());

    it('returns the default when nothing is saved', () => {
        expect(loadPieceOutlineColorPreference()).toBe(
            DEFAULT_PIECE_OUTLINE_COLOR_ID,
        );
    });

    it('round-trips a valid id', () => {
        savePieceOutlineColorPreference('green-dark');
        expect(loadPieceOutlineColorPreference()).toBe('green-dark');
    });

    it('falls back to default for an unrecognized value', () => {
        localStorage.setItem(PIECE_OUTLINE_COLOR_PREFERENCE_KEY, 'totally-unknown');
        expect(loadPieceOutlineColorPreference()).toBe(
            DEFAULT_PIECE_OUTLINE_COLOR_ID,
        );
    });
});

describe('applyPieceOutlineColor', () => {
    beforeEach(() => {
        document.documentElement.style.removeProperty(CSS_CUSTOM_PROPERTY);
    });

    it('sets the custom property to the variable reference', () => {
        applyPieceOutlineColor('blue-default');
        expect(
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY),
        ).toBe('var(--color-blue-default)');
    });

    it('falls back to the default preset for an unknown id', () => {
        applyPieceOutlineColor('not-a-color');
        expect(
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY),
        ).toBe(`var(--color-${DEFAULT_PIECE_OUTLINE_COLOR_ID})`);
    });
});
