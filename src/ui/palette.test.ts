/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import paletteCss from '../palette.css?raw';
import {
    PALETTE_HUES,
    PALETTE_TONES,
    PALETTE_SWATCHES,
    onColorSchemeChange,
} from './palette.js';

describe('PALETTE_SWATCHES', () => {
    it('contains one entry per hue × tone (100)', () => {
        expect(PALETTE_HUES.length).toBe(20);
        expect(PALETTE_TONES.length).toBe(5);
        expect(PALETTE_SWATCHES.length).toBe(100);
    });

    it('uses "<hue>-<tone>" ids, "<hue> <tone>" labels, var() values', () => {
        const blue = PALETTE_SWATCHES.find((s) => s.id === 'blue-default');
        expect(blue).toBeDefined();
        expect(blue?.label).toBe('blue default');
        expect(blue?.value).toBe('var(--color-blue-default)');
    });

    it('has unique ids', () => {
        const ids = new Set(PALETTE_SWATCHES.map((s) => s.id));
        expect(ids.size).toBe(PALETTE_SWATCHES.length);
    });

    it('is ordered tone-major (rows = tones, columns = hues)', () => {
        const firstRow = PALETTE_SWATCHES.slice(0, 20);
        expect(firstRow.every((s) => s.id.endsWith('-lighter'))).toBe(true);
        expect(firstRow[0].id).toBe(`${PALETTE_HUES[0]}-lighter`);
    });
});

describe('palette.css', () => {
    const lightBlock = paletteCss.slice(0, paletteCss.indexOf('@media'));
    const darkBlock = paletteCss.slice(paletteCss.indexOf('prefers-color-scheme'));

    it('defines every swatch variable in :root (light)', () => {
        for (const s of PALETTE_SWATCHES) {
            const name = s.value.slice('var('.length, -1); // --color-<id>
            expect(lightBlock).toContain(`${name}:`);
        }
    });

    it('redefines every swatch variable in the dark-mode block', () => {
        expect(paletteCss).toContain('prefers-color-scheme: dark');
        for (const s of PALETTE_SWATCHES) {
            const name = s.value.slice('var('.length, -1);
            expect(darkBlock).toContain(`${name}:`);
        }
    });
});

describe('onColorSchemeChange', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('subscribes/unsubscribes to the change event', () => {
        const add = vi.fn();
        const remove = vi.fn();
        vi.stubGlobal('matchMedia', () => ({
            matches: false,
            addEventListener: add,
            removeEventListener: remove,
        }));
        const cb = vi.fn();
        const off = onColorSchemeChange(cb);
        expect(add).toHaveBeenCalledWith('change', cb);
        expect(add).toHaveBeenCalledTimes(1);
        off();
        expect(remove).toHaveBeenCalledWith('change', cb);
        expect(remove).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when matchMedia is unavailable', () => {
        vi.stubGlobal('matchMedia', undefined);
        const off = onColorSchemeChange(vi.fn());
        expect(() => off()).not.toThrow();
    });
});
