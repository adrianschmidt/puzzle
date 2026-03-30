/**
 * Diagnostic: overlay mating edges to check if they're perfect mirrors.
 * Renders each shared edge pair at high zoom so we can see discrepancies.
 *
 * Run: npx tsx scripts/diag-edge-overlay.ts
 */

import { createSeededRandom } from '../src/puzzle/seeded-random.js';
import { Curve } from '../src/puzzle/topology/curve.js';
import { buildDCEL, getFaceEdges } from '../src/puzzle/topology/dcel.js';
import { facesToPieceDefinitions } from '../src/puzzle/topology/faces-to-pieces.js';
import { classicTabTemplate } from '../src/puzzle/composable/tab-shapes.js';
import { composePuzzle } from '../src/puzzle/composable/compose.js';
import { mergeTabsIntoCuts, DEFAULT_TAB_PLACEMENT } from '../src/puzzle/topology/tab-merge.js';
import type { PieceDefinition, EdgeDefinition } from '../src/puzzle/composable/types.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Point } from '../src/model/types.js';

const SEED = 42;
const COLS = 2;
const ROWS = 2;
const IMAGE_WIDTH = 400;
const IMAGE_HEIGHT = 400;
const H_AMP = 0;
const H_FREQ = 0;
const V_AMP = 0.25;
const V_FREQ = 3.5;

const pieceWidth = IMAGE_WIDTH / COLS;
const pieceHeight = IMAGE_HEIGHT / ROWS;
const hPixelAmp = (H_AMP * pieceHeight) / 2;
const vPixelAmp = (V_AMP * pieceWidth) / 2;

const outDir = join(import.meta.dirname!, 'diag-output');
mkdirSync(outDir, { recursive: true });

const random = createSeededRandom(SEED);

// --- Generate cuts (same as diag-tabs.ts) ---
function generateSineCurve(
    start: { x: number; y: number }, end: { x: number; y: number },
    amplitude: number, frequency: number, phase: number,
): Curve {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const tx = dx / len, ty = dy / len;
    const px = -ty, py = tx;
    const segmentsPerWave = 4;
    const totalSegments = Math.max(4, Math.ceil(frequency * segmentsPerWave));
    const bezierPoints: { x: number; y: number }[] = [];
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

const curves: Curve[] = [];
curves.push(
    Curve.line({ x: 0, y: 0 }, { x: IMAGE_WIDTH, y: 0 }),
    Curve.line({ x: IMAGE_WIDTH, y: 0 }, { x: IMAGE_WIDTH, y: IMAGE_HEIGHT }),
    Curve.line({ x: IMAGE_WIDTH, y: IMAGE_HEIGHT }, { x: 0, y: IMAGE_HEIGHT }),
    Curve.line({ x: 0, y: IMAGE_HEIGHT }, { x: 0, y: 0 }),
);
const rowPhases = Array.from({ length: ROWS + 1 }, () => random() * Math.PI * 2);
const colPhases = Array.from({ length: COLS + 1 }, () => random() * Math.PI * 2);
for (let r = 1; r < ROWS; r++) {
    const y = r * pieceHeight;
    if (hPixelAmp > 0) {
        curves.push(generateSineCurve({ x: 0, y }, { x: IMAGE_WIDTH, y }, hPixelAmp, H_FREQ, rowPhases[r]));
    } else {
        curves.push(Curve.line({ x: 0, y }, { x: IMAGE_WIDTH, y }));
    }
}
for (let c = 1; c < COLS; c++) {
    const x = c * pieceWidth;
    if (vPixelAmp > 0) {
        curves.push(generateSineCurve({ x, y: 0 }, { x, y: IMAGE_HEIGHT }, vPixelAmp, V_FREQ, colPhases[c]));
    } else {
        curves.push(Curve.line({ x, y: 0 }, { x, y: IMAGE_HEIGHT }));
    }
}

// --- Merge tabs ---
const borderIndices = new Set([0, 1, 2, 3]);
const tabRandom = createSeededRandom(SEED + 1);
const tabPlacement = { ...DEFAULT_TAB_PLACEMENT, centreRange: [0.5, 0.5] as [number, number] };
const tabCurves = mergeTabsIntoCuts(curves, borderIndices, classicTabTemplate, tabPlacement, tabRandom);

// --- Build DCEL ---
const dcel = buildDCEL({ curves: tabCurves });
const pieceDefs = facesToPieceDefinitions(dcel);

// --- Also get DCEL half-edge curves directly for comparison ---
console.log('\n=== DCEL Half-Edge Analysis ===\n');

const innerFaces = dcel.faces.filter(f => !f.isOuter);
for (const face of innerFaces) {
    const edges = getFaceEdges(face);
    console.log(`Face ${face.id}:`);
    for (const he of edges) {
        const twinFace = he.twin.face;
        const twinFaceLabel = twinFace?.isOuter ? 'OUTER' : `Face ${twinFace?.id}`;
        console.log(`  HE${he.id} (twin HE${he.twin.id}, ${twinFaceLabel}): ${he.curve.segments.length} segs`);

        // Check endpoint matching with twin
        const heStart = he.curve.start;
        const heEnd = he.curve.end;
        const twinStart = he.twin.curve.start;
        const twinEnd = he.twin.curve.end;
        const startMatch = dist(heStart, twinEnd);
        const endMatch = dist(heEnd, twinStart);
        if (startMatch > 0.01 || endMatch > 0.01) {
            console.log(`    ⚠️ Endpoint mismatch! start↔twinEnd: ${startMatch.toFixed(4)}, end↔twinStart: ${endMatch.toFixed(4)}`);
        }

        // Check if sampling produces identical points (reversed)
        const pts = he.curve.sample(8);
        const twinPts = he.twin.curve.sample(8);
        const twinPtsReversed = [...twinPts].reverse();
        let maxDeviation = 0;
        for (let i = 0; i < Math.min(pts.length, twinPtsReversed.length); i++) {
            const d = dist(pts[i], twinPtsReversed[i]);
            if (d > maxDeviation) maxDeviation = d;
        }
        if (maxDeviation > 0.01) {
            console.log(`    ⚠️ Sample mismatch! max deviation: ${maxDeviation.toFixed(4)}px (${pts.length} vs ${twinPtsReversed.length} points)`);
        }
    }
}

// --- Find shared edge pairs and render overlays ---
console.log('\n=== Shared Edge Pairs ===\n');

type EdgeWithPiece = { edge: EdgeDefinition; pieceId: number; pieceDef: PieceDefinition };
const edgesByKey = new Map<string, EdgeWithPiece[]>();

for (const pd of pieceDefs) {
    for (const e of pd.edges) {
        if (e.sharedEdgeKey) {
            if (!edgesByKey.has(e.sharedEdgeKey)) edgesByKey.set(e.sharedEdgeKey, []);
            edgesByKey.get(e.sharedEdgeKey)!.push({ edge: e, pieceId: pd.id, pieceDef: pd });
        }
    }
}

let pairIndex = 0;
for (const [key, edgePairs] of edgesByKey) {
    if (edgePairs.length !== 2) continue;

    const [a, b] = edgePairs;
    if (!a.edge.curvePoints || !b.edge.curvePoints) continue;

    // Convert to global coordinates
    const aGlobal = a.edge.curvePoints.map(p => ({
        x: p.x - a.pieceDef.imageOffset.x,
        y: p.y - a.pieceDef.imageOffset.y,
    }));
    const bGlobal = b.edge.curvePoints.map(p => ({
        x: p.x - b.pieceDef.imageOffset.x,
        y: p.y - b.pieceDef.imageOffset.y,
    }));

    // Compute bounding box for zoom
    const allPts = [...aGlobal, ...bGlobal];
    const minX = Math.min(...allPts.map(p => p.x)) - 10;
    const minY = Math.min(...allPts.map(p => p.y)) - 10;
    const maxX = Math.max(...allPts.map(p => p.x)) + 10;
    const maxY = Math.max(...allPts.map(p => p.y)) + 10;
    const w = maxX - minX;
    const h = maxY - minY;

    // Check deviation
    const bReversed = [...bGlobal].reverse();
    let maxDev = 0;
    let maxDevIdx = 0;
    const minLen = Math.min(aGlobal.length, bReversed.length);
    for (let i = 0; i < minLen; i++) {
        const d = dist(aGlobal[i], bReversed[i]);
        if (d > maxDev) { maxDev = d; maxDevIdx = i; }
    }

    console.log(`Pair ${key}: P${a.pieceId} edge ${a.edge.id} (${aGlobal.length} pts) ↔ P${b.pieceId} edge ${b.edge.id} (${bGlobal.length} pts)`);
    console.log(`  Max deviation: ${maxDev.toFixed(4)}px at index ${maxDevIdx}`);
    if (aGlobal.length !== bGlobal.length) {
        console.log(`  ⚠️ Different point counts!`);
    }

    // Render overlay SVG
    const scale = Math.min(600 / w, 600 / h, 8);
    const svgW = w * scale + 40;
    const svgH = h * scale + 60;

    let aPath = aGlobal.map((p, i) => `${i === 0 ? 'M' : 'L'} ${((p.x - minX) * scale + 20).toFixed(2)} ${((p.y - minY) * scale + 40).toFixed(2)}`).join(' ');
    let bPath = bGlobal.map((p, i) => `${i === 0 ? 'M' : 'L'} ${((p.x - minX) * scale + 20).toFixed(2)} ${((p.y - minY) * scale + 40).toFixed(2)}`).join(' ');

    // Also draw dots at each sample point
    let aDots = aGlobal.map(p => `<circle cx="${((p.x - minX) * scale + 20).toFixed(2)}" cy="${((p.y - minY) * scale + 40).toFixed(2)}" r="3" fill="red" opacity="0.6"/>`).join('\n  ');
    let bDots = bGlobal.map(p => `<circle cx="${((p.x - minX) * scale + 20).toFixed(2)}" cy="${((p.y - minY) * scale + 40).toFixed(2)}" r="3" fill="blue" opacity="0.6"/>`).join('\n  ');

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}">
  <rect width="100%" height="100%" fill="white"/>
  <text x="${svgW/2}" y="15" text-anchor="middle" font-size="11" fill="#333">Edge pair ${key}: P${a.pieceId} (red) vs P${b.pieceId} (blue)</text>
  <text x="${svgW/2}" y="30" text-anchor="middle" font-size="9" fill="#666">Max deviation: ${maxDev.toFixed(4)}px | Points: ${aGlobal.length} vs ${bGlobal.length}</text>
  <path d="${aPath}" fill="none" stroke="red" stroke-width="2" opacity="0.7"/>
  <path d="${bPath}" fill="none" stroke="blue" stroke-width="2" opacity="0.7"/>
  ${aDots}
  ${bDots}
</svg>`;

    const filename = `edge-pair-${pairIndex}-${key.replace(/[^a-z0-9]/gi, '_')}.svg`;
    writeFileSync(join(outDir, filename), svg);
    console.log(`  → ${filename}`);
    pairIndex++;
}

// --- Also dump the actual Bézier segments for the vertical cut edges ---
console.log('\n=== Bézier Segments for Vertical Cut Edges ===\n');

for (const face of innerFaces) {
    const edges = getFaceEdges(face);
    for (const he of edges) {
        // Only log edges with tabs (more than 4 segments)
        if (he.curve.segments.length > 4) {
            console.log(`Face ${face.id}, HE${he.id} → HE${he.twin.id} (${he.curve.segments.length} segs):`);
            for (let i = 0; i < he.curve.segments.length; i++) {
                const s = he.curve.segments[i];
                console.log(`  seg[${i}]: (${s.p0.x.toFixed(2)},${s.p0.y.toFixed(2)}) → (${s.p3.x.toFixed(2)},${s.p3.y.toFixed(2)})`);
            }
        }
    }
}

function dist(a: Point, b: Point): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

console.log('\n✅ Done');
