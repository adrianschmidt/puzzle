import { describe, it, expect } from 'vitest';
import { rgbToOklab, quantize } from './quantize.js';
import type { Raster } from './types.js';

/** Build a raster from a rows-of-hex-colors spec, e.g. ['rrggbb', ...] per pixel. */
function raster(width: number, height: number, fill: (x: number, y: number) => [number, number, number]): Raster {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [r, g, b] = fill(x, y);
            const i = (y * width + x) * 4;
            data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
        }
    }
    return { width, height, data };
}

describe('rgbToOklab', () => {
    it('maps black below white in lightness', () => {
        expect(rgbToOklab(0, 0, 0)[0]).toBeLessThan(rgbToOklab(255, 255, 255)[0]);
    });
    it('is deterministic', () => {
        expect(rgbToOklab(120, 30, 200)).toEqual(rgbToOklab(120, 30, 200));
    });
});

describe('quantize', () => {
    it('separates two clearly distinct colors into two labels', () => {
        // Left half red, right half blue.
        const r = raster(8, 4, x => (x < 4 ? [220, 30, 30] : [30, 30, 220]));
        const { labels, palette } = quantize(r, 2);
        expect(palette.length).toBe(2);
        expect(labels[0]).not.toBe(labels[7]);           // red vs blue pixel
        expect(labels[0]).toBe(labels[3]);               // within red half
        expect(labels[4]).toBe(labels[7]);               // within blue half
    });
    it('is deterministic for identical input', () => {
        const r = raster(16, 16, (x, y) => [x * 15, y * 15, (x + y) * 7]);
        const a = quantize(r, 8);
        const b = quantize(r, 8);
        expect(Array.from(a.labels)).toEqual(Array.from(b.labels));
    });
    it('caps the palette at the requested level count', () => {
        const r = raster(16, 16, (x, y) => [x * 15, y * 15, 0]);
        expect(quantize(r, 4).palette.length).toBeLessThanOrEqual(4);
    });
});
