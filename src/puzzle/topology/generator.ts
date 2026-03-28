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

    // Step 2: Build DCEL on raw cuts (no tabs yet) → faces → PieceDefinitions
    // Tabs are applied by the composition layer to the resulting edges,
    // not merged into the cut lines pre-DCEL.
    const dcel = buildDCEL({ curves });
    const pieceDefs = facesToPieceDefinitions(dcel);

    // Step 3: Compose final pieces — composition layer applies tabs
    return composePuzzle(pieceDefs, template, random, { disableTabs });
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
 * Generate a sine-wave curve as a polyline Curve.
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

    // Perpendicular unit vector
    const px = -dy / len;
    const py = dx / len;

    const numPoints = Math.max(20, Math.ceil(frequency * 16));
    const points: { x: number; y: number }[] = [];

    for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        const offset = amplitude * Math.sin(2 * Math.PI * frequency * t + phase);
        points.push({
            x: start.x + t * dx + offset * px,
            y: start.y + t * dy + offset * py,
        });
    }

    return Curve.fromPolyline(points);
}
