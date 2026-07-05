import { describe, it, expect } from 'vitest';
import { selectRegions } from './select.js';
import type { Region } from './regions.js';
import { DEFAULT_SILHOUETTE_PARAMS } from './types.js';

function region(partial: Partial<Region> & { id: number }): Region {
    return {
        area: 100, meanColor: [0.5, 0, 0], touchesFrame: false,
        neighbors: new Set(), contrast: 0.1, ...partial,
    };
}

const params = { ...DEFAULT_SILHOUETTE_PARAMS, maxRegions: 2, minRegionFrac: 0.01, maxRegionFrac: 0.5 };
const RASTER_AREA = 10_000;

describe('selectRegions', () => {
    it('drops frame-touching regions', () => {
        const picked = selectRegions([
            region({ id: 0, touchesFrame: true, contrast: 1 }),
            region({ id: 1 }),
        ], RASTER_AREA, params);
        expect(picked.map(r => r.id)).toEqual([1]);
    });

    it('enforces min/max area bounds', () => {
        const picked = selectRegions([
            region({ id: 0, area: 50 }),      // 0.5% < 1% min
            region({ id: 1, area: 6000 }),    // 60% > 50% max
            region({ id: 2, area: 500 }),
        ], RASTER_AREA, params);
        expect(picked.map(r => r.id)).toEqual([2]);
    });

    it('ranks by area × contrast', () => {
        const picked = selectRegions([
            region({ id: 0, area: 400, contrast: 0.05 }),  // score 20
            region({ id: 1, area: 300, contrast: 0.2 }),   // score 60
        ], RASTER_AREA, params);
        expect(picked[0].id).toBe(1);
    });

    it('skips regions adjacent to an already-picked one when allowAdjacent is false', () => {
        const a = region({ id: 0, contrast: 0.3, neighbors: new Set([1]) });
        const b = region({ id: 1, contrast: 0.2, neighbors: new Set([0]) });
        const c = region({ id: 2, contrast: 0.1 });
        expect(selectRegions([a, b, c], RASTER_AREA, params).map(r => r.id)).toEqual([0, 2]);
        expect(selectRegions([a, b, c], RASTER_AREA, { ...params, allowAdjacent: true })
            .map(r => r.id)).toEqual([0, 1]);
    });

    it('caps at maxRegions', () => {
        const rs = [0, 1, 2, 3].map(id => region({ id, contrast: 0.1 + id * 0.01 }));
        expect(selectRegions(rs, RASTER_AREA, params).length).toBe(2);
    });
});
