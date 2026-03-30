/**
 * Trace the exact split points in mergeTabIntoCurve to find
 * why the removed segment doesn't match the tab gap.
 */

import { createSeededRandom } from '../src/puzzle/seeded-random.js';
import { Curve } from '../src/puzzle/topology/curve.js';
import { mergeTabsIntoCuts, DEFAULT_TAB_PLACEMENT, mergeTabIntoCurve, computeTabPlacement } from '../src/puzzle/topology/tab-merge.js';
import { classicTabTemplate } from '../src/puzzle/composable/tab-shapes.js';
import type { Point } from '../src/model/types.js';

const SEED = 42;
const COLS = 2, ROWS = 2;
const IMAGE_WIDTH = 400, IMAGE_HEIGHT = 400;
const V_AMP = 0.25, V_FREQ = 3.5;
const pieceWidth = IMAGE_WIDTH / COLS;
const vPixelAmp = (V_AMP * pieceWidth) / 2;

const random = createSeededRandom(SEED);

// Generate the vertical sine curve (same as generator)
function generateSineCurve(
    start: Point, end: Point, amplitude: number, frequency: number, phase: number,
): Curve {
    const dx = end.x - start.x, dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const tx = dx / len, ty = dy / len, px = -ty, py = tx;
    const totalSegments = Math.max(4, Math.ceil(frequency * 4));
    const bezierPoints: Point[] = [];
    const evalSine = (t: number) => {
        const angle = 2 * Math.PI * frequency * t + phase;
        const s = amplitude * Math.sin(angle);
        const ds = amplitude * 2 * Math.PI * frequency * Math.cos(angle);
        return { x: start.x + t * dx + s * px, y: start.y + t * dy + s * py, tx: dx + ds * px, ty: dy + ds * py };
    };
    for (let i = 0; i < totalSegments; i++) {
        const t0 = i / totalSegments, t1 = (i + 1) / totalSegments, dt = t1 - t0;
        const p0 = evalSine(t0), p1 = evalSine(t1);
        if (i === 0) bezierPoints.push({ x: p0.x, y: p0.y });
        bezierPoints.push(
            { x: p0.x + p0.tx * dt / 3, y: p0.y + p0.ty * dt / 3 },
            { x: p1.x - p1.tx * dt / 3, y: p1.y - p1.ty * dt / 3 },
            { x: p1.x, y: p1.y },
        );
    }
    return Curve.fromBezierPath(bezierPoints);
}

// Consume random state same as main script
const rowPhases = Array.from({ length: ROWS + 1 }, () => random() * Math.PI * 2);
const colPhases = Array.from({ length: COLS + 1 }, () => random() * Math.PI * 2);

const verticalCurve = generateSineCurve(
    { x: pieceWidth, y: 0 }, { x: pieceWidth, y: IMAGE_HEIGHT },
    vPixelAmp, V_FREQ, colPhases[1],
);

console.log(`Vertical curve: ${verticalCurve.segments.length} segments`);
console.log(`  Start: (${verticalCurve.start.x.toFixed(2)}, ${verticalCurve.start.y.toFixed(2)})`);
console.log(`  End: (${verticalCurve.end.x.toFixed(2)}, ${verticalCurve.end.y.toFixed(2)})`);

// Now trace what happens when we try to split at specific t values
// The intersection with the horizontal cut at y=200 determines the split
// Let's find that t
for (let t = 0; t <= 1; t += 0.001) {
    const p = verticalCurve.pointAt(t);
    if (Math.abs(p.y - 200) < 0.5) {
        console.log(`  t=${t.toFixed(3)} → (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
        break;
    }
}

// Now simulate what mergeTabIntoCurve does with the upper half
// The curve gets split at intersection → two halves
// Let's work with a half-curve and trace the split
console.log('\n--- Simulating mergeTabIntoCurve ---');

// Use the full curve and try tab placement at center
const tCenter = 0.5;
const chordLength = DEFAULT_TAB_PLACEMENT.tabChordLength;

console.log(`tCenter: ${tCenter}, chordLength: ${chordLength}`);

// Bisect for chord
let lo = 0, hi = 0.5;
for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const pL = verticalCurve.pointAt(Math.max(0, tCenter - mid));
    const pR = verticalCurve.pointAt(Math.min(1, tCenter + mid));
    const dx = pR.x - pL.x, dy = pR.y - pL.y;
    const chord = Math.sqrt(dx * dx + dy * dy);
    if (chord < chordLength) lo = mid; else hi = mid;
}
const delta = (lo + hi) / 2;
const tLeft = Math.max(0.001, tCenter - delta);
const tRight = Math.min(0.999, tCenter + delta);

const pLeft = verticalCurve.pointAt(tLeft);
const pRight = verticalCurve.pointAt(tRight);

console.log(`delta: ${delta.toFixed(6)}`);
console.log(`tLeft: ${tLeft.toFixed(6)}, tRight: ${tRight.toFixed(6)}`);
console.log(`pLeft: (${pLeft.x.toFixed(2)}, ${pLeft.y.toFixed(2)})`);
console.log(`pRight: (${pRight.x.toFixed(2)}, ${pRight.y.toFixed(2)})`);

// Now do the split
const [before, rest] = verticalCurve.splitAt(tLeft);
console.log(`\nbefore: ${before.segments.length} segs, end=(${before.end.x.toFixed(2)}, ${before.end.y.toFixed(2)})`);
console.log(`rest: ${rest.segments.length} segs, start=(${rest.start.x.toFixed(2)}, ${rest.start.y.toFixed(2)})`);
console.log(`  before.end matches pLeft? ${dist(before.end, pLeft).toFixed(6)}`);

// Second split
const tRightRemapped = (tRight - tLeft) / (1 - tLeft);
console.log(`\ntRightRemapped: ${tRightRemapped.toFixed(6)}`);

// Where does tRightRemapped actually point on rest?
const actualSplitPoint = rest.pointAt(tRightRemapped);
console.log(`rest.pointAt(tRightRemapped): (${actualSplitPoint.x.toFixed(2)}, ${actualSplitPoint.y.toFixed(2)})`);
console.log(`Expected (pRight): (${pRight.x.toFixed(2)}, ${pRight.y.toFixed(2)})`);
console.log(`DEVIATION: ${dist(actualSplitPoint, pRight).toFixed(4)}px`);

const [middle, after] = rest.splitAt(tRightRemapped);
console.log(`\nmiddle: ${middle.segments.length} segs`);
console.log(`  start: (${middle.start.x.toFixed(2)}, ${middle.start.y.toFixed(2)})`);
console.log(`  end: (${middle.end.x.toFixed(2)}, ${middle.end.y.toFixed(2)})`);
console.log(`after: ${after.segments.length} segs`);
console.log(`  start: (${after.start.x.toFixed(2)}, ${after.start.y.toFixed(2)})`);
console.log(`  end: (${after.end.x.toFixed(2)}, ${after.end.y.toFixed(2)})`);

// What SHOULD the middle be?
console.log('\n--- Expected vs Actual ---');
console.log(`Expected middle: from pLeft(${pLeft.x.toFixed(2)},${pLeft.y.toFixed(2)}) to pRight(${pRight.x.toFixed(2)},${pRight.y.toFixed(2)})`);
console.log(`Actual middle: from (${middle.start.x.toFixed(2)},${middle.start.y.toFixed(2)}) to (${middle.end.x.toFixed(2)},${middle.end.y.toFixed(2)})`);
console.log(`Actual after.start: (${after.start.x.toFixed(2)},${after.start.y.toFixed(2)})`);
console.log(`Deviation at right split: ${dist(after.start, pRight).toFixed(4)}px`);

// Segment-level analysis
console.log('\n--- Segment-level analysis ---');
const nSegs = verticalCurve.segments.length;
console.log(`Original curve: ${nSegs} segments`);

// Where does tLeft fall in segment terms?
const tLeftScaled = tLeft * nSegs;
const tLeftSeg = Math.floor(tLeftScaled);
const tLeftLocal = tLeftScaled - tLeftSeg;
console.log(`tLeft=${tLeft.toFixed(4)} → segment ${tLeftSeg}, local t=${tLeftLocal.toFixed(4)}`);

// Where does tRight fall?
const tRightScaled = tRight * nSegs;
const tRightSeg = Math.floor(Math.min(tRightScaled, nSegs - 1));
const tRightLocal = tRightScaled - tRightSeg;
console.log(`tRight=${tRight.toFixed(4)} → segment ${tRightSeg}, local t=${tRightLocal.toFixed(4)}`);

// After first split, rest has how many segments?
console.log(`\nAfter first split at segment ${tLeftSeg}:`);
console.log(`  rest has ${rest.segments.length} segments`);
console.log(`  rest seg 0 is the RIGHT portion of original seg ${tLeftSeg}`);

// Where does tRightRemapped fall in rest's segment terms?
const remappedScaled = tRightRemapped * rest.segments.length;
const remappedSeg = Math.floor(Math.min(remappedScaled, rest.segments.length - 1));
const remappedLocal = remappedScaled - remappedSeg;
console.log(`\ntRightRemapped=${tRightRemapped.toFixed(4)} → rest segment ${remappedSeg}, local t=${remappedLocal.toFixed(4)}`);

// What segment in the ORIGINAL curve does this correspond to?
const origSegFromRest = (remappedSeg === 0) ? tLeftSeg : tLeftSeg + remappedSeg;
console.log(`This maps to original segment ~${origSegFromRest}`);
console.log(`But tRight should be in original segment ${tRightSeg}!`);
if (origSegFromRest !== tRightSeg) {
    console.log(`⚠️ SEGMENT MISMATCH — splitting at wrong point!`);
}

function dist(a: Point, b: Point): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
