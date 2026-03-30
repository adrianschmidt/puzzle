/**
 * Diagnostic: trace actual tab chord lengths and positions
 * on a real puzzle to understand size variation.
 */

import { createSeededRandom } from '../src/puzzle/seeded-random.js';
import { Curve } from '../src/puzzle/topology/curve.js';
import { mergeTabsIntoCuts, DEFAULT_TAB_PLACEMENT, computeTabPlacement, mergeTabIntoCurve } from '../src/puzzle/topology/tab-merge.js';
import { classicTabTemplate } from '../src/puzzle/composable/tab-shapes.js';
import type { Point } from '../src/model/types.js';

// Simulate a 2x2 grid puzzle (what Adrian is seeing on /dev/)
const SEED = 42;
const COLS = 2, ROWS = 2;
const IMAGE_WIDTH = 400, IMAGE_HEIGHT = 400;

// Default params from the topology generator
const pieceWidth = IMAGE_WIDTH / COLS;
const pieceHeight = IMAGE_HEIGHT / ROWS;

const random = createSeededRandom(SEED);

// Generate grid cuts (straight lines for classic style)
function generateCuts(): Curve[] {
    const curves: Curve[] = [];
    // Borders
    curves.push(
        Curve.line({ x: 0, y: 0 }, { x: IMAGE_WIDTH, y: 0 }),
        Curve.line({ x: IMAGE_WIDTH, y: 0 }, { x: IMAGE_WIDTH, y: IMAGE_HEIGHT }),
        Curve.line({ x: IMAGE_WIDTH, y: IMAGE_HEIGHT }, { x: 0, y: IMAGE_HEIGHT }),
        Curve.line({ x: 0, y: IMAGE_HEIGHT }, { x: 0, y: 0 }),
    );
    // Horizontal internal cut
    for (let r = 1; r < ROWS; r++) {
        curves.push(Curve.line({ x: 0, y: r * pieceHeight }, { x: IMAGE_WIDTH, y: r * pieceHeight }));
    }
    // Vertical internal cut
    for (let c = 1; c < COLS; c++) {
        curves.push(Curve.line({ x: c * pieceWidth, y: 0 }, { x: c * pieceWidth, y: IMAGE_HEIGHT }));
    }
    return curves;
}

const curves = generateCuts();
const borderIndices = new Set([0, 1, 2, 3]);

console.log('=== Curves before tab merge ===');
for (let i = 0; i < curves.length; i++) {
    const len = curves[i].arcLength();
    console.log(`  Curve ${i}: ${curves[i].segments.length} segs, len=${len.toFixed(1)}px, ${borderIndices.has(i) ? 'BORDER' : 'INTERNAL'}`);
}

// Now trace tab placement for each internal curve
console.log('\n=== Tab placement per edge segment ===');
const traceRandom = createSeededRandom(SEED + 1);

for (let i = 0; i < curves.length; i++) {
    if (borderIndices.has(i)) continue;

    // Find split parameters (intersections with other curves)
    const splitTs: number[] = [];
    for (let j = 0; j < curves.length; j++) {
        if (j === i) continue;
        const ixns = curves[i].intersect(curves[j]);
        for (const ix of ixns) splitTs.push(ix.tSelf);
        // T-junctions
        for (const ep of [curves[j].start, curves[j].end]) {
            const t = curves[i].nearestT(ep);
            const p = curves[i].pointAt(t);
            const d = Math.sqrt((p.x - ep.x) ** 2 + (p.y - ep.y) ** 2);
            if (d < 3 && t > 0.01 && t < 0.99) splitTs.push(t);
        }
    }
    const uniqueTs = [...new Set(splitTs.map(t => Math.round(t * 1e4) / 1e4))]
        .sort((a, b) => a - b)
        .filter(t => t > 0.01 && t < 0.99);

    console.log(`\nCurve ${i}: splits at ${uniqueTs.map(t => t.toFixed(4)).join(', ')}`);

    // Split into segments
    const segments: Curve[] = [];
    let remaining = curves[i];
    let consumed = 0;
    for (const t of uniqueTs) {
        const remapped = (t - consumed) / (1 - consumed);
        if (remapped <= 0.01 || remapped >= 0.99) continue;
        const [left, right] = remaining.splitAt(remapped);
        segments.push(left);
        remaining = right;
        consumed = t;
    }
    segments.push(remaining);

    for (let s = 0; s < segments.length; s++) {
        const seg = segments[s];
        const len = seg.arcLength();
        const placement = computeTabPlacement(seg, DEFAULT_TAB_PLACEMENT, traceRandom);
        if (placement) {
            // Simulate bisectForChord
            const tCenter = placement.tCenter;
            let lo = 0, hi = 0.5;
            for (let iter = 0; iter < 30; iter++) {
                const mid = (lo + hi) / 2;
                const pL = seg.pointAt(Math.max(0, tCenter - mid));
                const pR = seg.pointAt(Math.min(1, tCenter + mid));
                const chord = Math.sqrt((pR.x - pL.x) ** 2 + (pR.y - pL.y) ** 2);
                if (chord < 35) lo = mid; else hi = mid;
            }
            const delta = (lo + hi) / 2;
            const tL = Math.max(0.001, tCenter - delta);
            const tR = Math.min(0.999, tCenter + delta);
            const pL = seg.pointAt(tL);
            const pR = seg.pointAt(tR);
            const actualChord = Math.sqrt((pR.x - pL.x) ** 2 + (pR.y - pL.y) ** 2);

            console.log(`  Segment ${s}: len=${len.toFixed(1)}px, tab at t=${tCenter.toFixed(3)}, isTab=${placement.isTab}`);
            console.log(`    delta=${delta.toFixed(4)}, tL=${tL.toFixed(4)}, tR=${tR.toFixed(4)}`);
            console.log(`    chord=${actualChord.toFixed(2)}px`);
            console.log(`    pL=(${pL.x.toFixed(1)}, ${pL.y.toFixed(1)}), pR=(${pR.x.toFixed(1)}, ${pR.y.toFixed(1)})`);
        } else {
            console.log(`  Segment ${s}: len=${len.toFixed(1)}px — NO TAB (too short)`);
        }
    }
}

// Now look at what the ACTUAL game generates
// The dev preview uses whatever cut style the user has selected
// Let's check what the topology generator does with default params
console.log('\n\n=== Check tab template height ===');
const testRandom = createSeededRandom(123);
const path = classicTabTemplate.generate(testRandom);
console.log('Tab template points:');
for (const p of path) {
    console.log(`  (${p.x.toFixed(4)}, ${p.y.toFixed(4)})`);
}
const xMin = path[0].x;
const xMax = path[path.length - 1].x;
const xRange = xMax - xMin;
const maxY = Math.max(...path.map(p => Math.abs(p.y)));
console.log(`xRange: ${xRange.toFixed(4)}, maxY: ${maxY.toFixed(4)}, aspect ratio (maxY/xRange): ${(maxY / xRange).toFixed(4)}`);
console.log(`With 35px chord, tab protrudes ~${(maxY / xRange * 35).toFixed(1)}px`);
