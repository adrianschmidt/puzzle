import type { Point } from '../src/model/types.js';
import { createSeededRandom } from '../src/puzzle/seeded-random.js';

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

function computeRatio(scalex: number, scaley: number, mid: number, neckRatio: number) {
    const halfWidth = 0.17 * scalex;
    const neckHalfWidth = halfWidth * neckRatio;
    const yShift = 0.08 * scaley;
    const pt = (h: number, v: number): Point => ({ x: h, y: v - yShift });
    const path = [
        pt(mid - neckHalfWidth, 0.08 * scaley),
        pt(mid - neckHalfWidth * 0.7, 0.12 * scaley), pt(mid - halfWidth * 1.1, 0.20 * scaley), pt(mid - halfWidth * 0.9, 0.25 * scaley),
        pt(mid - halfWidth * 0.6, 0.32 * scaley), pt(mid - halfWidth * 0.3, 0.33 * scaley), pt(mid, 0.33 * scaley),
        pt(mid + halfWidth * 0.3, 0.33 * scaley), pt(mid + halfWidth * 0.6, 0.32 * scaley), pt(mid + halfWidth * 0.9, 0.25 * scaley),
        pt(mid + halfWidth * 1.1, 0.20 * scaley), pt(mid + neckHalfWidth * 0.7, 0.12 * scaley),
        pt(mid + neckHalfWidth, 0.08 * scaley),
    ];
    const xRange = path[path.length - 1].x - path[0].x;
    const maxY = Math.max(...path.map(p => Math.abs(p.y)));
    return maxY / xRange;
}

function sweep(nrMin: number, nrMax: number, frac: number, edgePx: number) {
    const r = createSeededRandom(42);
    let min = Infinity, max = 0;
    for (let i = 0; i < 500; i++) {
        const ratio = computeRatio(lerp(0.65, 1.0, r()), lerp(0.7, 1.1, r()), lerp(0.38, 0.62, r()), lerp(nrMin, nrMax, r()));
        if (ratio < min) min = ratio;
        if (ratio > max) max = ratio;
    }
    const chord = frac * edgePx;
    console.log(`  frac=${frac.toFixed(2)} nr=[${nrMin},${nrMax}] → chord=${chord}px, height: ${(min*chord).toFixed(0)}-${(max*chord).toFixed(0)}px`);
}

const edge = 200;
console.log(`Target: 15-30px on ${edge}px edge\n`);
for (const frac of [0.08, 0.10, 0.12]) {
    for (const [nrMin, nrMax] of [[0.50, 0.80], [0.60, 0.80], [0.70, 0.80]]) {
        sweep(nrMin, nrMax, frac, edge);
    }
    console.log();
}
