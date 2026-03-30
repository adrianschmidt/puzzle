/**
 * Render a grid of tabs at different tabWidthFraction values
 * to visually compare sizes on a realistic edge.
 */
import { createSeededRandom } from '../src/puzzle/seeded-random.js';
import { Curve } from '../src/puzzle/topology/curve.js';
import { mergeTabIntoCurve } from '../src/puzzle/topology/tab-merge.js';
import { classicTabTemplate } from '../src/puzzle/composable/tab-shapes.js';
import type { BezierSegment } from '../src/puzzle/topology/curve.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const outDir = join(import.meta.dirname!, 'diag-output');
mkdirSync(outDir, { recursive: true });

const EDGE_LENGTH = 200; // typical edge on a phone
const fractions = [0.08, 0.10, 0.12, 0.15, 0.18, 0.20, 0.25];

const rowHeight = 140;
const margin = 30;
const svgWidth = EDGE_LENGTH + margin * 2;
const svgHeight = fractions.length * rowHeight + margin;

let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">
<rect width="100%" height="100%" fill="white"/>
`;

for (let fi = 0; fi < fractions.length; fi++) {
    const frac = fractions[fi];
    const yBase = fi * rowHeight + margin + 50;

    // Draw the edge line
    svg += `<line x1="${margin}" y1="${yBase}" x2="${margin + EDGE_LENGTH}" y2="${yBase}" stroke="#ddd" stroke-width="1"/>`;
    svg += `<text x="5" y="${yBase - 35}" font-size="10" fill="#333">frac=${frac}</text>`;

    // Generate 3 tabs at this fraction with different seeds
    for (let s = 0; s < 3; s++) {
        const random = createSeededRandom(s * 17 + 7);
        const edge = Curve.line({ x: 0, y: 0 }, { x: EDGE_LENGTH, y: 0 });
        const tCenter = 0.15 + s * 0.3; // spread tabs along edge

        const merged = mergeTabIntoCurve(edge, tCenter, true, frac, classicTabTemplate, random);

        // Draw the merged curve
        let pathD = '';
        for (const seg of merged.segments) {
            if (pathD === '') {
                pathD += `M ${margin + seg.p0.x} ${yBase - seg.p0.y}`;
            }
            pathD += ` C ${margin + seg.cp1.x} ${yBase - seg.cp1.y}, ${margin + seg.cp2.x} ${yBase - seg.cp2.y}, ${margin + seg.p3.x} ${yBase - seg.p3.y}`;
        }
        const colors = ['#e74c3c', '#2ecc71', '#3498db'];
        svg += `<path d="${pathD}" fill="none" stroke="${colors[s]}" stroke-width="1.5"/>`;
    }
}

svg += '</svg>';

writeFileSync(join(outDir, 'tab-sizes-comparison.svg'), svg);
console.log('→ tab-sizes-comparison.svg');
