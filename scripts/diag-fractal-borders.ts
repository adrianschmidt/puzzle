/**
 * Diagnostic: render fractal-puzzle outer borders for multiple sizes/seeds
 * and verify programmatically that every mateless edge is a straight line
 * on the puzzle rectangle (invariant from issue #211).
 *
 * Run: npx tsx scripts/diag-fractal-borders.ts
 * Outputs: scripts/diag-output/fractal-borders-*.svg
 */

import { writeFileSync, mkdirSync } from 'fs';
import { generateFractalPuzzle } from '../src/puzzle/fractal-generator.js';

const palette = [
    '#ff9999', '#99ccff', '#99ff99', '#ffcc99',
    '#cc99ff', '#ffff99', '#99ffff', '#ff99cc',
    '#c0c0c0', '#ff6666', '#66cc66', '#6699ff',
];

interface Case { cols: number; rows: number; seed: number; w: number; h: number }

const cases: Case[] = [
    { cols: 4, rows: 4, seed: 1, w: 400, h: 400 },
    { cols: 4, rows: 4, seed: 2, w: 400, h: 400 },
    { cols: 4, rows: 4, seed: 3, w: 400, h: 400 },
    { cols: 6, rows: 4, seed: 42, w: 600, h: 400 },
    { cols: 8, rows: 6, seed: 7, w: 800, h: 600 },
    { cols: 6, rows: 6, seed: 99, w: 600, h: 600 },
];

const OUTPUT_DIR = 'scripts/diag-output';
mkdirSync(OUTPUT_DIR, { recursive: true });

const EPS = 0.05;

function onBorder(x: number, y: number, w: number, h: number): boolean {
    return Math.abs(x) < EPS
        || Math.abs(x - w) < EPS
        || Math.abs(y) < EPS
        || Math.abs(y - h) < EPS;
}

let overallOk = true;

for (const c of cases) {
    const pieces = generateFractalPuzzle(
        c.cols, c.rows, { width: c.w, height: c.h }, c.seed,
    );

    const pad = 40;
    const parts: string[] = [];
    parts.push(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${c.w + 2*pad}" `
        + `height="${c.h + 2*pad}" viewBox="${-pad} ${-pad} `
        + `${c.w + 2*pad} ${c.h + 2*pad}">`,
    );
    parts.push(
        `<rect x="${-pad}" y="${-pad}" width="${c.w + 2*pad}" `
        + `height="${c.h + 2*pad}" fill="#eee"/>`,
    );
    parts.push(
        `<rect width="${c.w}" height="${c.h}" fill="white" `
        + `stroke="red" stroke-width="0.5"/>`,
    );

    for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        parts.push(
            `<g transform="translate(${-p.imageOffset.x},${-p.imageOffset.y})">`,
        );
        parts.push(
            `  <path d="${p.shape}" fill="${palette[i % palette.length]}" `
            + `stroke="black" stroke-width="1" fill-rule="evenodd"/>`,
        );
        parts.push(`</g>`);
    }
    parts.push(`</svg>`);

    const fname = `${OUTPUT_DIR}/fractal-borders-${c.cols}x${c.rows}-seed${c.seed}.svg`;
    writeFileSync(fname, parts.join('\n'));

    let matelessCount = 0, matelessLines = 0, matelessArcs = 0;
    let bothEndpointsOnBorder = 0;
    for (const p of pieces) {
        for (const e of p.edges) {
            if (e.mateEdgeId !== -1) continue;
            matelessCount++;
            const sx = e.start.x - p.imageOffset.x;
            const sy = e.start.y - p.imageOffset.y;
            const ex = e.end.x - p.imageOffset.x;
            const ey = e.end.y - p.imageOffset.y;
            if (e.path.trim().startsWith('L')) matelessLines++;
            else matelessArcs++;
            if (onBorder(sx, sy, c.w, c.h) && onBorder(ex, ey, c.w, c.h)) {
                bothEndpointsOnBorder++;
            }
        }
    }

    const ok = matelessArcs === 0
        && matelessLines === matelessCount
        && bothEndpointsOnBorder === matelessCount;
    overallOk = overallOk && ok;

    console.log(
        `${fname}: ${pieces.length} pieces, `
        + `${matelessCount} mateless (${matelessLines} lines, `
        + `${matelessArcs} arcs), `
        + `${bothEndpointsOnBorder}/${matelessCount} both-endpoints-on-border `
        + `— ${ok ? 'OK' : 'FAIL'}`,
    );
}

console.log(overallOk ? '\nAll OK' : '\nFAILURES detected');
process.exit(overallOk ? 0 : 1);
