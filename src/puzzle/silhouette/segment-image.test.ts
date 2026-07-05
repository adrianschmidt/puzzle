import { describe, it, expect } from 'vitest';
import { segmentImage, silhouetteParamsFromConfig } from './segment-image.js';
import { DEFAULT_SILHOUETTE_PARAMS } from './types.js';
import type { Raster } from './types.js';

/** 64×48 gray background with a 16×12 red block at (24, 18). */
function testRaster(): Raster {
    const width = 64, height = 48;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const red = x >= 24 && x < 40 && y >= 18 && y < 30;
            const i = (y * width + x) * 4;
            data[i] = red ? 220 : 128;
            data[i + 1] = red ? 30 : 128;
            data[i + 2] = red ? 30 : 128;
            data[i + 3] = 255;
        }
    }
    return { width, height, data };
}

describe('segmentImage', () => {
    const frame = { width: 640, height: 480 };  // 10× raster scale
    const params = { ...DEFAULT_SILHOUETTE_PARAMS, colorLevels: 2, maxRegions: 3, smoothing: 0 };

    it('finds the red block and scales it to frame coordinates', () => {
        const outlines = segmentImage(testRaster(), frame, params);
        expect(outlines.length).toBe(1);
        const [o] = outlines;
        // Raster block corners (24,18)-(40,30) → frame (240,180)-(400,300).
        const xs = o.polygon.map(p => p.x), ys = o.polygon.map(p => p.y);
        expect(Math.min(...xs)).toBeCloseTo(240, 0);
        expect(Math.max(...xs)).toBeCloseTo(400, 0);
        expect(Math.min(...ys)).toBeCloseTo(180, 0);
        expect(Math.max(...ys)).toBeCloseTo(300, 0);
        expect(o.area).toBeCloseTo(160 * 120, -2);
        // Closed Bézier path in fromBezierPath format.
        expect((o.path.length - 1) % 3).toBe(0);
        expect(o.path[0]).toEqual(o.path[o.path.length - 1]);
    });

    it('returns [] for a uniform raster', () => {
        const flat: Raster = testRaster();
        flat.data.fill(128);
        for (let i = 3; i < flat.data.length; i += 4) flat.data[i] = 255;
        expect(segmentImage(flat, frame, params)).toEqual([]);
    });

    it('is deterministic', () => {
        const a = segmentImage(testRaster(), frame, params);
        const b = segmentImage(testRaster(), frame, params);
        expect(a).toEqual(b);
    });
});

describe('silhouetteParamsFromConfig', () => {
    it('applies defaults for missing fields', () => {
        expect(silhouetteParamsFromConfig(undefined)).toEqual(DEFAULT_SILHOUETTE_PARAMS);
        expect(silhouetteParamsFromConfig({})).toEqual(DEFAULT_SILHOUETTE_PARAMS);
    });
    it('reads compact keys and clamps hostile values', () => {
        const p = silhouetteParamsFromConfig({
            cl: 999, mr: -5, mnf: 2, mxf: -1, aa: true, st: 0.001, sm: 7,
        });
        expect(p.colorLevels).toBe(32);
        expect(p.maxRegions).toBe(0);
        expect(p.minRegionFrac).toBe(1);
        expect(p.maxRegionFrac).toBe(0);
        expect(p.allowAdjacent).toBe(true);
        expect(p.simplifyTolerancePx).toBe(2);   // hard floor
        expect(p.smoothing).toBe(1);
    });
});
