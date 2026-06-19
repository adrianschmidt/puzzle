/**
 * Traced tab shape template — pulls cubic-Bezier paths from a
 * photographed library and applies six PRNG-driven transforms.
 *
 * Outer-PRNG contract LOCKED: exactly ONE outer call per generation.
 * That call seeds a local sub-PRNG used for all per-edge transforms.
 * See project_share_link_prng_contract.
 */

import type { Point } from '../../model/types.js';
import type { BezierPath } from './bezier-path.js';
import { reverseBezierPath } from './bezier-path.js';
import type { TabTemplate } from './tab-shapes.js';
import { createSeededRandom } from '../seeded-random.js';
import {
    TRACED_TEMPLATES,
    type TracedLandmarks,
    type TracedTemplate,
} from './traces/index.js';
import { recordTracedTabChoice } from './traced-tab-recorder.js';

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/**
 * Derive a deterministic integer seed for the local sub-PRNG from one
 * outer-PRNG draw. createSeededRandom normalizes via `seed | 0`, so any
 * integer in the int32 range is fine; we use the canonical mulberry32
 * pattern of scaling [0,1) → uint32.
 */
function seedFromFloat(v: number): number {
    return Math.floor(v * 4294967296);
}

function mirrorLandmarksX(lm: TracedLandmarks): TracedLandmarks {
    return {
        apex_y: lm.apex_y,
        head: { y: lm.head.y, width: lm.head.width, center_x: 1 - lm.head.center_x },
        neck: { y: lm.neck.y, width: lm.neck.width, center_x: 1 - lm.neck.center_x },
    };
}

/**
 * Smooth bump that's 0 at y=0, peaks at y=neck.y, 0 at y=head.y, 0 above.
 * Uses two smoothstep ramps glued at the neck peak.
 */
function neckWeight(y: number, neckY: number, headY: number): number {
    if (y <= 0 || y >= headY) return 0;
    if (y < neckY) {
        const t = y / neckY; // 0 → 1
        return t * t * (3 - 2 * t);
    } else {
        const t = (headY - y) / (headY - neckY); // 1 at neck.y → 0 at head.y
        return t * t * (3 - 2 * t);
    }
}

function pivotX(y: number, lm: TracedLandmarks): number {
    if (y <= 0) return 0.5;
    if (y <= lm.neck.y) {
        return lerp(0.5, lm.neck.center_x, y / lm.neck.y);
    }
    if (y <= lm.head.y) {
        const t = (y - lm.neck.y) / (lm.head.y - lm.neck.y);
        return lerp(lm.neck.center_x, lm.head.center_x, t);
    }
    return lm.head.center_x;
}

function pinchNeck(
    p: Point,
    lm: TracedLandmarks,
    neckScale: number,
): Point {
    const w = neckWeight(p.y, lm.neck.y, lm.head.y);
    const px = pivotX(p.y, lm);
    const k = lerp(1.0, neckScale, w);
    return { x: px + (p.x - px) * k, y: p.y };
}

/**
 * Build a traced tab template bound to a specific (frozen) ordered trace
 * list. The trace-set version chooses which list — see getTracedTemplates.
 *
 * Outer-PRNG contract LOCKED: exactly ONE outer call per generation, which
 * seeds a local sub-PRNG that drives every per-edge transform. Changing
 * `templates` changes only which trace is selected and its geometry; it does
 * not change the outer- or local-PRNG call sequence.
 */
export function createTracedTabTemplate(
    templates: readonly TracedTemplate[],
): TabTemplate {
    return {
        name: 'Traced',

        generate(random: () => number): BezierPath {
            const subSeed = random();
            const local = createSeededRandom(seedFromFloat(subSeed));

            const idx       = Math.floor(local() * templates.length); // local 1
            const flip      = local() < 0.5;                          // local 2
            // Cache the template id now so the recorder below sees the same index→id mapping the chosen template will use.
            const templateId = templates[idx].id;
            const scalex    = lerp(0.14, 0.20, local());              // local 3
            const scaley    = lerp(0.85, 1.15, local());              // local 4
            const mid       = lerp(0.45, 0.55, local());              // local 5
            const neckScale = lerp(0.75, 1.10, local());              // local 6

            recordTracedTabChoice({
                templateIdx: idx, templateId,
                flip, scalex, scaley, mid, neckScale,
            });

            const template: TracedTemplate = templates[idx];
            let path: Point[] = template.path.map(p => ({ x: p.x, y: p.y }));
            let landmarks = template.landmarks;

            if (flip) {
                path = reverseBezierPath(path.map(p => ({ x: 1 - p.x, y: p.y })));
                landmarks = mirrorLandmarksX(landmarks);
            }

            path = path.map(p => pinchNeck(p, landmarks, neckScale));

            const xFactor = scalex / Math.max(0.05, landmarks.neck.width);
            const yFactor = xFactor * scaley;

            path = path.map(p => ({
                x: mid + (p.x - landmarks.neck.center_x) * xFactor,
                y: p.y * yFactor,
            }));

            return path;
        },
    };
}

/**
 * Default (version 1) traced template. Retained for the TabTemplate surface,
 * the traced-tab-recorder docs, and direct unit tests; production generation
 * resolves the template for the requested trace-set version via the generator
 * (see traced-tab-generator.ts).
 */
export const tracedTabTemplate: TabTemplate = createTracedTabTemplate(TRACED_TEMPLATES);
