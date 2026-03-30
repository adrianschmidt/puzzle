import { createSeededRandom } from '../src/puzzle/seeded-random.js';
import type { Point } from '../src/model/types.js';

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

function makeTab(scalex: number, scaley: number, mid: number, neckRatio: number) {
    const halfWidth = 0.17 * scalex;
    const neckHalfWidth = halfWidth * neckRatio;
    const yShift = 0.08 * scaley;
    const pt = (h: number, v: number): Point => ({ x: h, y: v - yShift });

    const path = [
        pt(mid - neckHalfWidth, 0.08 * scaley),
        pt(mid - neckHalfWidth * 0.7, 0.12 * scaley),
        pt(mid - halfWidth * 1.1, 0.20 * scaley),
        pt(mid - halfWidth * 0.9, 0.25 * scaley),
        pt(mid - halfWidth * 0.6, 0.32 * scaley),
        pt(mid - halfWidth * 0.3, 0.33 * scaley),
        pt(mid, 0.33 * scaley),
        pt(mid + halfWidth * 0.3, 0.33 * scaley),
        pt(mid + halfWidth * 0.6, 0.32 * scaley),
        pt(mid + halfWidth * 0.9, 0.25 * scaley),
        pt(mid + halfWidth * 1.1, 0.20 * scaley),
        pt(mid + neckHalfWidth * 0.7, 0.12 * scaley),
        pt(mid + neckHalfWidth, 0.08 * scaley),
    ];
    const xRange = path[path.length - 1].x - path[0].x;
    const maxY = Math.max(...path.map(p => Math.abs(p.y)));
    return { ratio: maxY / xRange, xRange, maxY };
}

// Find what neckRatio gives ratio ≈ 2.0 at worst case (min scalex, max scaley)
console.log('neckRatio → ratio (worst case: scalex=0.65, scaley=1.1, mid=0.5)');
for (let nr = 0.25; nr <= 0.85; nr += 0.05) {
    const { ratio } = makeTab(0.65, 1.1, 0.5, nr);
    console.log(`  neckRatio=${nr.toFixed(2)} → ratio=${ratio.toFixed(2)}`);
}

console.log('\nWith neckRatio range [0.50, 0.80], stats across 200 random combos:');
let min = Infinity, max = 0, sum = 0, n = 0;
const r = createSeededRandom(42);
for (let i = 0; i < 200; i++) {
    const scalex = lerp(0.65, 1.0, r());
    const scaley = lerp(0.7, 1.1, r());
    const mid = lerp(0.38, 0.62, r());
    const neckRatio = lerp(0.50, 0.80, r());
    const { ratio } = makeTab(scalex, scaley, mid, neckRatio);
    if (ratio < min) min = ratio;
    if (ratio > max) max = ratio;
    sum += ratio; n++;
}
console.log(`  ratio: min=${min.toFixed(2)} avg=${(sum/n).toFixed(2)} max=${max.toFixed(2)}`);
