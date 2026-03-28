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
import { facesToPieceDefinitions } from './faces-to-pieces.js';
import { classicTabTemplate } from '../composable/tab-shapes.js';
import type { TabTemplate } from '../composable/tab-shapes.js';
import { composePuzzle } from '../composable/compose.js';
import {
    mergeTabIntoCurve,
    computeTabPlacement,
    DEFAULT_TAB_PLACEMENT,
} from './tab-merge.js';

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
    const disableTabs = config?.disableTabs ?? false;
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

    // Step 2: Build DCEL → faces → PieceDefinitions
    // When tabs are enabled, merge them into edge segments BEFORE building
    // the DCEL topology, so piece clip paths include tab protrusions.
    const dcel = buildDCEL({
        curves,
        segmentTransform: disableTabs ? undefined : (segments) => {
            return segments.map(seg => {
                // Skip border segments (they connect border vertices)
                // Border segments are short straight lines on the boundary.
                if (isBorderSegment(seg, imageSize)) {
                    return seg;
                }

                const placement = computeTabPlacement(seg, DEFAULT_TAB_PLACEMENT, random);
                if (!placement) return seg;

                return mergeTabIntoCurve(seg, placement, template, random);
            });
        },
    });
    const pieceDefs = facesToPieceDefinitions(dcel);

    // Step 3: Compose final pieces — tabs already in the geometry,
    // so disable tab generation in the composition layer
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

/**
 * Check if a curve segment lies on the puzzle border.
 * Border segments have both endpoints on the boundary rectangle.
 */
function isBorderSegment(curve: Curve, imageSize: Size): boolean {
    const tol = 2;
    const { start, end } = curve;
    const w = imageSize.width;
    const h = imageSize.height;

    const onBorder = (p: { x: number; y: number }) =>
        p.x < tol || p.x > w - tol ||
        p.y < tol || p.y > h - tol;

    return onBorder(start) && onBorder(end);
}
