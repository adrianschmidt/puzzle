/**
 * Topology-driven puzzle generator.
 *
 * Generates puzzle pieces using the full topology pipeline:
 *   1. Create border + internal cut lines as Curves
 *   2. Optionally merge tabs into internal cuts
 *   3. Build DCEL → find faces → extract PieceDefinitions
 *   4. Feed into composePuzzle() for final Piece[]
 *
 * Replaces the grid-based composable generator with a topology-driven
 * approach where pieces are defined by the enclosed regions of
 * intersecting cut lines.
 *
 * See issue #166 for the architecture.
 */

import type { Piece, Size } from '../../model/types.js';
import { Curve } from './curve.js';
import { buildDCEL } from './dcel.js';
import type { HalfEdge, Face } from './dcel.js';
import { facesToPieceDefinitions } from './faces-to-pieces.js';
import { classicTabTemplate } from '../composable/tab-shapes.js';
import type { TabTemplate } from '../composable/tab-shapes.js';
import { composePuzzle } from '../composable/compose.js';
import { mergeTabsIntoCuts, DEFAULT_TAB_PLACEMENT } from './tab-merge.js';
import type { CollisionOptions } from './tab-merge.js';
import { resolveExcessIntersections } from './collision.js';
import { diagnostics, logFaceDetails } from './diagnostics.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the topology generator.
 * All parameters are optional — sensible defaults are used.
 */
export interface TopologyGeneratorConfig {
    /** Horizontal cut wave amplitude (0–0.5, fraction of piece height). Default: 0.15 */
    horizontalAmplitude?: number;
    /** Horizontal cut wave frequency in Hz (0–10). Default: 1.5 */
    horizontalFrequency?: number;
    /** Vertical cut wave amplitude (0–0.5, fraction of piece width). Default: 0.15 */
    verticalAmplitude?: number;
    /** Vertical cut wave frequency in Hz (0–10). Default: 1.5 */
    verticalFrequency?: number;
    /** When true, skip tab generation — all shared edges are flat lines. Default: false */
    disableTabs?: boolean;
    /** Tab shape template. Default: classicTabTemplate */
    tabTemplate?: TabTemplate;
    /** Collision detection and resolution options for tabs. */
    collision?: CollisionOptions;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a puzzle using the topology-driven pipeline.
 *
 * @param cols - Number of piece columns
 * @param rows - Number of piece rows
 * @param imageSize - Pixel dimensions of the puzzle image
 * @param random - Seeded PRNG function
 * @param config - Optional generator configuration
 * @returns Complete Piece[] ready for the game engine
 */
export function generateTopologyPuzzle(
    cols: number,
    rows: number,
    imageSize: Size,
    random: () => number,
    config?: TopologyGeneratorConfig,
): Piece[] {
    const hAmp = config?.horizontalAmplitude ?? 0.15;
    const hFreq = config?.horizontalFrequency ?? 1.5;
    const vAmp = config?.verticalAmplitude ?? 0.15;
    const vFreq = config?.verticalFrequency ?? 1.5;
    // Tabs disabled by default until intersection reliability is resolved (#191)
    const disableTabs = config?.disableTabs ?? true;
    const template = config?.tabTemplate ?? classicTabTemplate;

    const pieceWidth = imageSize.width / cols;
    const pieceHeight = imageSize.height / rows;

    // Pixel amplitudes
    const hPixelAmp = (hAmp * pieceHeight) / 2;
    const vPixelAmp = (vAmp * pieceWidth) / 2;

    // Step 1: Generate border and internal cut lines as Curves
    const { curves } = generateCutCurves(
        cols, rows, imageSize, pieceWidth, pieceHeight,
        hPixelAmp, hFreq, vPixelAmp, vFreq, random,
    );

    diagnostics.log('cuts', `Generated ${curves.length} curves (4 border + ${curves.length - 4} internal)`, {
        curveSegments: curves.map((c, i) => ({
            index: i,
            segments: c.segments.length,
            start: c.start,
            end: c.end,
        })),
    });

    // Step 1b: Resolve excess intersections between base cuts.
    // High-amplitude sine waves can cross more times than expected,
    // creating tiny lens-shaped regions. We splice out the lens
    // segment from one curve so the other curve is the sole path
    // through that region. This avoids near-coincident paths that
    // cause phantom intersections. (See issues #219, #220.)
    let finalCurves = resolveExcessIntersections(curves, 4);

    diagnostics.log('splice', `After splice: ${finalCurves.length} curves (was ${curves.length})`, {
        curveSegments: finalCurves.map((c, i) => ({
            index: i,
            segments: c.segments.length,
            start: c.start,
            end: c.end,
        })),
    });

    // Step 2: Merge tabs into cut lines BEFORE topology computation.
    // This ensures piece clip paths include tab protrusions/sockets.
    // The DCEL then sees the full tab-modified geometry.
    if (!disableTabs) {
        const borderIndices = new Set([0, 1, 2, 3]);
        finalCurves = mergeTabsIntoCuts(
            finalCurves, borderIndices, template, DEFAULT_TAB_PLACEMENT, random,
            config?.collision,
        );
    }

    // Step 3: Build DCEL on (possibly tab-modified) cuts → faces → pieces
    const dcel = buildDCEL({ curves: finalCurves });

    // Log DCEL state before face merging
    const computeArea = (face: { outerEdge: HalfEdge }) => {
        let area = 0;
        let current = face.outerEdge;
        do {
            const a = current.origin.position;
            const b = current.twin.origin.position;
            area += (a.x * b.y - b.x * a.y);
            current = current.next;
        } while (current !== face.outerEdge);
        return area / 2;
    };
    logFaceDetails('dcel-pre-merge', dcel.faces, computeArea as (face: Face) => number);

    const expectedPieceCount = cols * rows;
    const pieceDefs = facesToPieceDefinitions(dcel, expectedPieceCount);

    logFaceDetails('dcel-post-merge', dcel.faces, computeArea as (face: Face) => number);
    diagnostics.log('pieces', `Generated ${pieceDefs.length} piece definitions`);

    // Step 4: Compose final pieces — tabs are already in the geometry
    return composePuzzle(pieceDefs, template, random, { disableTabs: true });
}

// ---------------------------------------------------------------------------
// Cut line generation
// ---------------------------------------------------------------------------

interface CutCurveResult {
    curves: Curve[];
}

/**
 * Generate border and internal cut lines as Curve objects.
 */
function generateCutCurves(
    cols: number,
    rows: number,
    imageSize: Size,
    pieceWidth: number,
    pieceHeight: number,
    hPixelAmp: number,
    hFreq: number,
    vPixelAmp: number,
    vFreq: number,
    random: () => number,
): CutCurveResult {
    const curves: Curve[] = [];

    // Border curves (always straight, always first)
    curves.push(
        Curve.line({ x: 0, y: 0 }, { x: imageSize.width, y: 0 }),
        Curve.line({ x: imageSize.width, y: 0 }, { x: imageSize.width, y: imageSize.height }),
        Curve.line({ x: imageSize.width, y: imageSize.height }, { x: 0, y: imageSize.height }),
        Curve.line({ x: 0, y: imageSize.height }, { x: 0, y: 0 }),
    );

    // Random phase offsets per cut
    const rowPhases: number[] = [];
    for (let r = 0; r <= rows; r++) {
        rowPhases.push(random() * Math.PI * 2);
    }
    const colPhases: number[] = [];
    for (let c = 0; c <= cols; c++) {
        colPhases.push(random() * Math.PI * 2);
    }

    // Internal horizontal cuts (rows 1 to rows-1)
    for (let r = 1; r < rows; r++) {
        const y = r * pieceHeight;
        const useWave = hPixelAmp > 0 && hFreq > 0;
        if (useWave) {
            curves.push(generateSineCurve(
                { x: 0, y },
                { x: imageSize.width, y },
                hPixelAmp, hFreq, rowPhases[r],
            ));
        } else {
            curves.push(Curve.line(
                { x: 0, y },
                { x: imageSize.width, y },
            ));
        }
    }

    // Internal vertical cuts (cols 1 to cols-1)
    for (let c = 1; c < cols; c++) {
        const x = c * pieceWidth;
        const useWave = vPixelAmp > 0 && vFreq > 0;
        if (useWave) {
            curves.push(generateSineCurve(
                { x, y: 0 },
                { x, y: imageSize.height },
                vPixelAmp, vFreq, colPhases[c],
            ));
        } else {
            curves.push(Curve.line(
                { x, y: 0 },
                { x, y: imageSize.height },
            ));
        }
    }

    return { curves };
}

/**
 * Generate a sine-wave curve as a chain of cubic Bézier segments.
 *
 * Uses Hermite-to-Bézier conversion with 4 segments per full wave.
 * This produces smooth, accurate curves that intersect precisely
 * via bezier-js — no polyline sampling artifacts.
 */
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

    // Unit vectors: tangent along the cut, perpendicular for displacement
    const tx = dx / len;
    const ty = dy / len;
    const px = -ty;
    const py = tx;

    // 4 Bézier segments per wave gives excellent accuracy
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

    // Hermite-to-Bézier: cp1 = p0 + tangent0 * dt/3, cp2 = p1 - tangent1 * dt/3
    for (let i = 0; i < totalSegments; i++) {
        const t0 = i / totalSegments;
        const t1 = (i + 1) / totalSegments;
        const dt = t1 - t0;

        const p0 = evalSine(t0);
        const p1 = evalSine(t1);

        if (i === 0) {
            bezierPoints.push({ x: p0.x, y: p0.y });
        }
        bezierPoints.push(
            { x: p0.x + p0.tx * dt / 3, y: p0.y + p0.ty * dt / 3 },
            { x: p1.x - p1.tx * dt / 3, y: p1.y - p1.ty * dt / 3 },
            { x: p1.x, y: p1.y },
        );
    }

    return Curve.fromBezierPath(bezierPoints);
}


