/**
 * Silhouette base-cut generator.
 *
 * Combines runtime-injected image-trace outlines (see
 * src/puzzle/silhouette/) with a delegated sine lattice:
 *
 *   - Every outline becomes a suppressTabs cut, so its edges stay
 *     knife-edged through applyTabs.
 *   - Outlines smaller than the whole-piece threshold stay WHOLE:
 *     lattice curves are clipped out of their interior (the DCEL's
 *     T-junction handling shares the cut vertices — see
 *     dcel-junction.test.ts).
 *   - Larger outlines are subdivided: the lattice passes through, and
 *     the outline still becomes real cuts.
 *
 * PRNG contract: exactly ONE outer random() call (sub-PRNG rule from
 * the repo CLAUDE.md); the sine delegate consumes only the local
 * stream. The `outlines` config field is runtime-injected by the
 * composable strategy and NEVER persisted (design spec, persistence
 * boundary).
 */
import type { Point, Size } from '../../model/types.js';
import { Curve } from './curve.js';
import type { BaseCutGenerator } from './plugin-types.js';
import { sineCutGenerator } from './sine-cut-generator.js';
import { createSeededRandom } from '../seeded-random.js';
import type { SilhouetteOutline } from '../silhouette/types.js';

export interface SilhouetteCutConfig {
    cols: number;
    rows: number;
    ha?: number; hf?: number; va?: number; vf?: number;
    /** Whole-piece threshold, multiple of average piece area (default 3). */
    wp?: number;
    /** Runtime-injected outlines — never persisted. */
    outlines?: SilhouetteOutline[];
}

const DEFAULT_WHOLE_PIECE_FACTOR = 3;

function seedFromFloat(v: number): number {
    return Math.floor(v * 4294967296);
}

export const silhouetteCutGenerator: BaseCutGenerator = {
    id: 'silhouette',

    generate(frame: Size, random: () => number, config: unknown): Curve[] {
        const cfg = (config ?? {}) as Partial<SilhouetteCutConfig>;
        const cols = cfg.cols ?? 1;
        const rows = cfg.rows ?? 1;

        // ONE outer draw; everything below uses the local stream.
        const local = createSeededRandom(seedFromFloat(random()));

        const border: Curve[] = [
            Curve.line({ x: 0, y: 0 }, { x: frame.width, y: 0 }),
            Curve.line({ x: frame.width, y: 0 }, { x: frame.width, y: frame.height }),
            Curve.line({ x: frame.width, y: frame.height }, { x: 0, y: frame.height }),
            Curve.line({ x: 0, y: frame.height }, { x: 0, y: 0 }),
        ];

        // Delegate the lattice to sine; drop its 4 border duplicates.
        // Imported directly (not via getBaseCutGenerator) to avoid a
        // module-load cycle with generator-registry.ts, which registers
        // this generator and therefore imports this file.
        const lattice = sineCutGenerator.generate(frame, local, {
            cols, rows,
            ha: cfg.ha, hf: cfg.hf, va: cfg.va, vf: cfg.vf,
        }).slice(4);

        const outlines = cfg.outlines ?? [];
        const avgPieceArea = (frame.width * frame.height) / (cols * rows);
        const wholeMaxArea =
            (cfg.wp ?? DEFAULT_WHOLE_PIECE_FACTOR) * avgPieceArea;

        // Each outline is emitted as ONE curve per original path segment
        // (not one combined closed curve) so every polygon corner —
        // including corners the lattice never crosses — becomes a real
        // DCEL vertex via the shared-endpoint vertex pool, rather than an
        // interior joint hidden inside a single multi-segment curve.
        const outlineCurves: Curve[] = [];
        const wholeBlobs: SilhouetteOutline[] = [];
        const wholeBlobOutlineCurves: Curve[] = [];
        for (const outline of outlines) {
            const segments = outlinePathToCurves(outline.path);
            outlineCurves.push(...segments);
            if (outline.area <= wholeMaxArea) {
                wholeBlobs.push(outline);
                wholeBlobOutlineCurves.push(...segments);
            }
        }

        // Clip lattice curves out of whole-blob interiors.
        const clippedLattice: Curve[] = [];
        for (const curve of lattice) {
            for (const span of clipAgainstBlobs(curve, wholeBlobs, wholeBlobOutlineCurves)) {
                clippedLattice.push(span);
            }
        }

        return [...border, ...outlineCurves, ...clippedLattice];
    },
};

/**
 * Split a closed outline path into one suppressTabs Curve per original
 * Bézier segment (rather than a single combined closed Curve). Adjacent
 * segments share exact endpoint coordinates, so the DCEL's vertex pool
 * merges them into one vertex per polygon corner even where no other
 * curve crosses — keeping face-area/vertex bookkeeping accurate for
 * whole (uncut) corners of the outline.
 */
function outlinePathToCurves(path: Point[]): Curve[] {
    const whole = Curve.fromBezierPath(path, { suppressTabs: true });
    return whole.segments.map(seg => new Curve([seg], { suppressTabs: true }));
}

/**
 * Split a lattice curve at its intersections with WHOLE blob outlines
 * and return only the spans whose midpoints are outside every whole
 * blob. Cuts are made exactly at the intersection parameters; the
 * DCEL's T-junction handling turns the touching endpoints into shared
 * vertices (dcel-junction.test.ts pins this).
 */
function clipAgainstBlobs(
    curve: Curve,
    wholeBlobs: SilhouetteOutline[],
    wholeBlobOutlineCurves: Curve[],
): Curve[] {
    if (wholeBlobs.length === 0) return [curve];

    // Gather split parameters against whole-blob outline curves only.
    const ts: number[] = [];
    for (const outlineCurve of wholeBlobOutlineCurves) {
        for (const ix of curve.intersect(outlineCurve)) {
            if (ix.tSelf > 1e-6 && ix.tSelf < 1 - 1e-6) ts.push(ix.tSelf);
        }
    }
    if (ts.length === 0) {
        return isInsideAnyBlob(curve.pointAt(0.5), wholeBlobs) ? [] : [curve];
    }
    ts.sort((a, b) => a - b);

    // Walk the spans between consecutive cut parameters.
    const bounds = [0, ...ts, 1];
    const spans: Curve[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
        const t0 = bounds[i], t1 = bounds[i + 1];
        if (t1 - t0 < 1e-6) continue;
        const mid = curve.pointAt((t0 + t1) / 2);
        if (isInsideAnyBlob(mid, wholeBlobs)) continue;
        spans.push(extractSpan(curve, t0, t1));
    }
    return spans;
}

/** Sub-curve for t ∈ [t0, t1] with the usual re-scaling after splitAt. */
function extractSpan(curve: Curve, t0: number, t1: number): Curve {
    let c = curve;
    if (t0 > 1e-9) {
        c = curve.splitAt(t0)[1];
        t1 = (t1 - t0) / (1 - t0);
    }
    if (t1 < 1 - 1e-9) {
        c = c.splitAt(t1)[0];
    }
    return c;
}

function isInsideAnyBlob(p: Point, blobs: SilhouetteOutline[]): boolean {
    return blobs.some(b => pointInPolygon(p, b.polygon));
}

/** Standard even-odd ray cast. */
function pointInPolygon(p: Point, polygon: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if ((a.y > p.y) !== (b.y > p.y)
            && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
}
