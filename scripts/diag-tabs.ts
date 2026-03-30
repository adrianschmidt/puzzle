/**
 * Diagnostic script: generate a 2x2 puzzle with tabs enabled,
 * log curves at each pipeline stage, and render as SVG.
 *
 * Run: npx tsx scripts/diag-tabs.ts
 * Output: scripts/diag-output/
 */

import { createSeededRandom } from '../src/puzzle/seeded-random.js';
import { Curve } from '../src/puzzle/topology/curve.js';
import { buildDCEL, getFaceEdges } from '../src/puzzle/topology/dcel.js';
import { facesToPieceDefinitions } from '../src/puzzle/topology/faces-to-pieces.js';
import { classicTabTemplate } from '../src/puzzle/composable/tab-shapes.js';
import { composePuzzle } from '../src/puzzle/composable/compose.js';
import { mergeTabsIntoCuts, DEFAULT_TAB_PLACEMENT } from '../src/puzzle/topology/tab-merge.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SEED = 42;
const COLS = 2;
const ROWS = 2;
const IMAGE_WIDTH = 400;
const IMAGE_HEIGHT = 400;

const H_AMP = 0;      // flat horizontal cut
const H_FREQ = 0;
const V_AMP = 0.25;   // wavy vertical cut
const V_FREQ = 3.5;

const pieceWidth = IMAGE_WIDTH / COLS;
const pieceHeight = IMAGE_HEIGHT / ROWS;
const hPixelAmp = (H_AMP * pieceHeight) / 2;
const vPixelAmp = (V_AMP * pieceWidth) / 2;

const outDir = join(import.meta.dirname!, 'diag-output');
mkdirSync(outDir, { recursive: true });

const random = createSeededRandom(SEED);

// ---------------------------------------------------------------------------
// Step 1: Generate cuts (same logic as generator.ts)
// ---------------------------------------------------------------------------

function generateSineCurve(
    start: { x: number; y: number },
    end: { x: number; y: number },
    amplitude: number,
    frequency: number,
    phase: number,
): Curve {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const tx = dx / len;
    const ty = dy / len;
    const px = -ty;
    const py = tx;
    const segmentsPerWave = 4;
    const totalSegments = Math.max(4, Math.ceil(frequency * segmentsPerWave));

    const bezierPoints: { x: number; y: number }[] = [];
    const evalSine = (t: number) => {
        const angle = 2 * Math.PI * frequency * t + phase;
        const s = amplitude * Math.sin(angle);
        const ds = amplitude * 2 * Math.PI * frequency * Math.cos(angle);
        return {
            x: start.x + t * dx + s * px,
            y: start.y + t * dy + s * py,
            tx: dx + ds * px,
            ty: dy + ds * py,
        };
    };

    for (let i = 0; i < totalSegments; i++) {
        const t0 = i / totalSegments;
        const t1 = (i + 1) / totalSegments;
        const dt = t1 - t0;
        const p0 = evalSine(t0);
        const p1 = evalSine(t1);
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

// Border (indices 0-3)
curves.push(
    Curve.line({ x: 0, y: 0 }, { x: IMAGE_WIDTH, y: 0 }),
    Curve.line({ x: IMAGE_WIDTH, y: 0 }, { x: IMAGE_WIDTH, y: IMAGE_HEIGHT }),
    Curve.line({ x: IMAGE_WIDTH, y: IMAGE_HEIGHT }, { x: 0, y: IMAGE_HEIGHT }),
    Curve.line({ x: 0, y: IMAGE_HEIGHT }, { x: 0, y: 0 }),
);

// Random phases
const rowPhases = Array.from({ length: ROWS + 1 }, () => random() * Math.PI * 2);
const colPhases = Array.from({ length: COLS + 1 }, () => random() * Math.PI * 2);

// Internal horizontal cuts
for (let r = 1; r < ROWS; r++) {
    const y = r * pieceHeight;
    curves.push(generateSineCurve(
        { x: 0, y }, { x: IMAGE_WIDTH, y },
        hPixelAmp, H_FREQ, rowPhases[r],
    ));
}

// Internal vertical cuts
for (let c = 1; c < COLS; c++) {
    const x = c * pieceWidth;
    curves.push(generateSineCurve(
        { x, y: 0 }, { x, y: IMAGE_HEIGHT },
        vPixelAmp, V_FREQ, colPhases[c],
    ));
}

console.log(`Generated ${curves.length} curves (4 border + ${curves.length - 4} internal)`);

// ---------------------------------------------------------------------------
// Helper: render curves as SVG
// ---------------------------------------------------------------------------
function curvesToSvg(curvesArr: Curve[], filename: string, label: string): void {
    const margin = 20;
    const w = IMAGE_WIDTH + margin * 2;
    const h = IMAGE_HEIGHT + margin * 2;

    let paths = '';
    const colors = ['#e74c3c', '#2ecc71', '#3498db', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];

    for (let i = 0; i < curvesArr.length; i++) {
        const c = curvesArr[i];
        const color = colors[i % colors.length];
        const segs = c.segments;
        let d = `M ${segs[0].p0.x} ${segs[0].p0.y}`;
        for (const s of segs) {
            d += ` C ${s.cp1.x} ${s.cp1.y}, ${s.cp2.x} ${s.cp2.y}, ${s.p3.x} ${s.p3.y}`;
        }
        paths += `  <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.8"/>\n`;
        // Start/end markers
        paths += `  <circle cx="${c.start.x}" cy="${c.start.y}" r="3" fill="${color}"/>\n`;
        paths += `  <circle cx="${c.end.x}" cy="${c.end.y}" r="3" fill="none" stroke="${color}" stroke-width="1"/>\n`;
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-margin} ${-margin} ${w} ${h}" width="${w}" height="${h}">
  <rect x="0" y="0" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" fill="#f5f5f5" stroke="#ccc"/>
  <text x="${IMAGE_WIDTH / 2}" y="${-5}" text-anchor="middle" font-size="10" fill="#666">${label} (${curvesArr.length} curves)</text>
${paths}
</svg>`;

    writeFileSync(join(outDir, filename), svg);
    console.log(`  → ${filename}`);
}

// ---------------------------------------------------------------------------
// Helper: render pieces as SVG
// ---------------------------------------------------------------------------
function piecesToSvg(pieces: ReturnType<typeof composePuzzle>, filename: string, label: string): void {
    const margin = 20;
    const w = IMAGE_WIDTH + margin * 2;
    const h = IMAGE_HEIGHT + margin * 2;
    const colors = ['#e74c3c', '#2ecc71', '#3498db', '#f39c12'];

    let content = '';
    for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i];
        const color = colors[i % colors.length];
        const ox = -piece.imageOffset.x;
        const oy = -piece.imageOffset.y;

        // Transform shape path to global coords
        content += `  <g transform="translate(${ox}, ${oy})">\n`;
        content += `    <path d="${piece.shape}" fill="${color}" fill-opacity="0.3" stroke="${color}" stroke-width="1.5"/>\n`;
        content += `    <text x="${-ox + pieceWidth/2}" y="${-oy + pieceHeight/2}" text-anchor="middle" dominant-baseline="middle" font-size="14" fill="${color}" font-weight="bold">P${piece.id}</text>\n`;
        content += `  </g>\n`;
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-margin} ${-margin} ${w} ${h}" width="${w}" height="${h}">
  <rect x="0" y="0" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" fill="white" stroke="#ccc"/>
  <text x="${IMAGE_WIDTH / 2}" y="${-5}" text-anchor="middle" font-size="10" fill="#666">${label}</text>
${content}
</svg>`;

    writeFileSync(join(outDir, filename), svg);
    console.log(`  → ${filename}`);
}

// ---------------------------------------------------------------------------
// Step 1 output
// ---------------------------------------------------------------------------
console.log('\n--- Step 1: Raw cuts ---');
curvesToSvg(curves, '01-raw-cuts.svg', 'Step 1: Raw cuts');

// Log curve details
for (let i = 0; i < curves.length; i++) {
    const c = curves[i];
    console.log(`  Curve ${i}: ${c.segments.length} segments, start=(${c.start.x.toFixed(1)}, ${c.start.y.toFixed(1)}) end=(${c.end.x.toFixed(1)}, ${c.end.y.toFixed(1)})`);
}

// ---------------------------------------------------------------------------
// Step 2: Merge tabs
// ---------------------------------------------------------------------------
console.log('\n--- Step 2: Merge tabs ---');
const borderIndices = new Set([0, 1, 2, 3]);
const tabRandom = createSeededRandom(SEED + 1); // separate seed for tabs
const tabPlacement = { ...DEFAULT_TAB_PLACEMENT, centreRange: [0.5, 0.5] as [number, number] };
const tabCurves = mergeTabsIntoCuts(
    curves, borderIndices, classicTabTemplate, tabPlacement, tabRandom,
);

curvesToSvg(tabCurves, '02-after-tabs.svg', 'Step 2: After tab merge');

for (let i = 0; i < tabCurves.length; i++) {
    const c = tabCurves[i];
    const changed = c !== curves[i] ? ' [MODIFIED]' : '';
    console.log(`  Curve ${i}: ${c.segments.length} segments${changed}`);
}

// ---------------------------------------------------------------------------
// Step 3: DCEL
// ---------------------------------------------------------------------------
console.log('\n--- Step 3: Build DCEL ---');
const dcel = buildDCEL({ curves: tabCurves });
console.log(`  Vertices: ${dcel.vertices.length}`);
console.log(`  Half-edges: ${dcel.halfEdges.length}`);
console.log(`  Faces: ${dcel.faces.length} (${dcel.faces.filter(f => !f.isOuter).length} inner)`);

// Log face details
for (const face of dcel.faces) {
    const edges = getFaceEdges(face);
    const label = face.isOuter ? 'OUTER' : `inner`;
    console.log(`  Face ${face.id} (${label}): ${edges.length} edges`);
    for (const he of edges) {
        const o = he.origin.position;
        const t = he.twin.origin.position;
        console.log(`    HE${he.id}: (${o.x.toFixed(1)},${o.y.toFixed(1)}) → (${t.x.toFixed(1)},${t.y.toFixed(1)}) [${he.curve.segments.length} segs]`);
    }
}

// ---------------------------------------------------------------------------
// Step 4: Faces to PieceDefinitions
// ---------------------------------------------------------------------------
console.log('\n--- Step 4: PieceDefinitions ---');
const pieceDefs = facesToPieceDefinitions(dcel);
console.log(`  Pieces: ${pieceDefs.length}`);

for (const pd of pieceDefs) {
    console.log(`  Piece ${pd.id}: ${pd.edges.length} edges, offset=(${pd.imageOffset.x.toFixed(1)}, ${pd.imageOffset.y.toFixed(1)})`);
    for (const e of pd.edges) {
        const hasCurve = e.curvePoints ? `${e.curvePoints.length} pts` : 'straight';
        const mate = e.matePieceId >= 0 ? `mate=P${e.matePieceId}` : 'border';
        console.log(`    Edge ${e.id}: ${mate}, ${hasCurve}, shared=${e.sharedEdgeKey ?? 'none'}`);
    }
}

// ---------------------------------------------------------------------------
// Step 5: Compose (tabs disabled — already in geometry)
// ---------------------------------------------------------------------------
console.log('\n--- Step 5: Compose ---');
const pieces = composePuzzle(pieceDefs, classicTabTemplate, createSeededRandom(SEED + 2), { disableTabs: true });
console.log(`  Final pieces: ${pieces.length}`);

piecesToSvg(pieces, '03-final-pieces.svg', 'Step 5: Final pieces');

// Also dump the SVG shape paths
for (const p of pieces) {
    console.log(`\n  Piece ${p.id} shape path:`);
    console.log(`    ${p.shape.substring(0, 200)}${p.shape.length > 200 ? '...' : ''}`);
    writeFileSync(join(outDir, `piece-${p.id}-shape.txt`), p.shape);
}

// ---------------------------------------------------------------------------
// Step 2b: Also render WITHOUT tabs for comparison
// ---------------------------------------------------------------------------
console.log('\n--- Comparison: No tabs ---');
const dcelNoTabs = buildDCEL({ curves });
const pieceDefsNoTabs = facesToPieceDefinitions(dcelNoTabs);
const piecesNoTabs = composePuzzle(pieceDefsNoTabs, classicTabTemplate, createSeededRandom(SEED + 2), { disableTabs: true });
piecesToSvg(piecesNoTabs, '04-no-tabs.svg', 'Comparison: No tabs');

console.log('\n✅ Done! Output in scripts/diag-output/');
