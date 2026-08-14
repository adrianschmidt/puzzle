/**
 * Traced tab shape template — pulls cubic-Bezier paths from a photographed
 * library and applies six PRNG-driven transforms.
 *
 * Outer-PRNG contract LOCKED: exactly ONE outer call per generation, which
 * seeds a local sub-PRNG for all per-edge transforms.
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
 * Derive a deterministic int seed for the local sub-PRNG from one outer draw.
 * createSeededRandom normalizes via `seed | 0`, so any int32 works; this is the
 * canonical mulberry32 [0,1) → uint32 scaling.
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
 */
function neckWeight(y: number, neckY: number, headY: number): number {
    if (y <= 0 || y >= headY) return 0;
    if (y < neckY) {
        const t = y / neckY;
        return t * t * (3 - 2 * t);
    } else {
        const t = (headY - y) / (headY - neckY);
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
 * Build a traced tab template bound to a specific (frozen) ordered trace list;
 * the trace-set version chooses which list (see getTracedTemplates).
 *
 * Outer-PRNG contract LOCKED: exactly ONE outer call per generation, which
 * seeds a local sub-PRNG driving every per-edge transform. Changing `templates`
 * changes only which trace is selected and its geometry, not the PRNG call sequence.
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
            // Cache the template id now (no PRNG draw) so the recorder sees the same index→id mapping.
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
 * Default (version 1) traced template. Retained for the TabTemplate surface and
 * unit tests; production resolves per trace-set version via the generator
 * (see traced-tab-generator.ts).
 */
export const tracedTabTemplate: TabTemplate = createTracedTabTemplate(TRACED_TEMPLATES);
