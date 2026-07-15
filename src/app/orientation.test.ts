import { describe, it, expect } from 'vitest';
import {
    orientationForViewport,
    orientGridSize,
    blankSizeForOrientation,
} from './orientation.js';

describe('orientationForViewport', () => {
    it('is landscape when wider than tall', () => {
        expect(orientationForViewport({ width: 1000, height: 600 })).toBe('landscape');
    });

    it('is portrait when taller than wide', () => {
        expect(orientationForViewport({ width: 600, height: 1000 })).toBe('portrait');
    });

    it('treats a square viewport as landscape', () => {
        expect(orientationForViewport({ width: 800, height: 800 })).toBe('landscape');
    });

    it('treats a degenerate 0x0 viewport as landscape', () => {
        expect(orientationForViewport({ width: 0, height: 0 })).toBe('landscape');
    });
});

describe('orientGridSize', () => {
    it('keeps the long axis horizontal for landscape', () => {
        expect(orientGridSize({ cols: 6, rows: 4 }, 'landscape')).toEqual({ cols: 6, rows: 4 });
    });

    it('transposes a landscape preset to portrait', () => {
        expect(orientGridSize({ cols: 6, rows: 4 }, 'portrait')).toEqual({ cols: 4, rows: 6 });
    });

    it('normalizes an already-portrait grid to landscape', () => {
        expect(orientGridSize({ cols: 4, rows: 6 }, 'landscape')).toEqual({ cols: 6, rows: 4 });
    });

    it('leaves an already-portrait grid portrait', () => {
        expect(orientGridSize({ cols: 4, rows: 6 }, 'portrait')).toEqual({ cols: 4, rows: 6 });
    });
});

describe('blankSizeForOrientation', () => {
    it('returns a landscape canvas (wider than tall) for landscape', () => {
        const size = blankSizeForOrientation('landscape');
        expect(size).toEqual({ width: 1080, height: 720 });
        expect(size.width).toBeGreaterThan(size.height);
    });

    it('returns a portrait canvas (taller than wide) for portrait', () => {
        const size = blankSizeForOrientation('portrait');
        expect(size).toEqual({ width: 720, height: 1080 });
        expect(size.height).toBeGreaterThan(size.width);
    });
});
