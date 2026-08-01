/**
 * The pure generate phase of creating a new game: strategy dispatch,
 * piece generation, quantization, sealing. Extracted from `init.ts` so
 * the generation worker and the synchronous main-thread fallback run
 * byte-identical code — the seeded-PRNG call-order contract (share
 * links/saves replay puzzles from the seed alone) has exactly one
 * implementation regardless of which thread executes it.
 *
 * Request and result are plain structured-cloneable data; the result
 * crosses a `postMessage` boundary on the worker path. Quantize + seal
 * run here — inside the worker — deliberately: sealing drops the dense
 * curve samples before the clone, which is most of the payload.
 */

import type { GridSize, Piece, Size } from '../model/types.js';
import type { FractalConfig } from '../puzzle/fractal/index.js';
import type { ComposableConfig } from '../puzzle/composable-generator.js';
import type { AutoGroup } from '../puzzle/topology/auto-group.js';
import type { PieceCountMismatch } from '../puzzle/topology/generator.js';
import type { TabDebugReport } from '../puzzle/topology/tab-debug.js';
import { TabDebugSession } from '../puzzle/topology/tab-debug.js';
import { quantizePieceGeometry } from '../model/quantize-geometry.js';
import { sealPieceGeometry } from '../model/seal-geometry.js';
import type { CutStyle } from './cut-styles.js';
import { getCutStyleStrategy } from './cut-style-strategies.js';

/** Everything the generate phase needs. Plain data — worker-safe. */
export interface GenerationRequest {
    cutStyle: CutStyle;
    gridSize: GridSize;
    imageSize: Size;
    seed: number;
    fractalConfig?: FractalConfig;
    /**
     * `ComposableConfig` minus `tabDebug`: a live `TabDebugSession` is a
     * class instance carrying a function property, so it can't cross
     * `structuredClone`/`postMessage`. The request's own `tabDebug: boolean`
     * carries that intent across the wire instead, and `runGeneration`
     * builds the real session locally. Same reasoning as
     * `GameState.composableConfig` (`model/types.ts`), which inlines an
     * equivalent tabDebug-free shape.
     */
    composableConfig?: Omit<ComposableConfig, 'tabDebug'>;
    wavyConfig?: { borderless?: boolean; traceSetVersion?: number };
    trianglesConfig?: { traceSetVersion?: number };
    classicConfig?: { traceSetVersion?: number };
    /**
     * Whether to run a tab-debug session. A boolean, not a session:
     * the flag is read from the URL on the main thread (workers have no
     * `window.location`) and the live session object cannot cross the
     * worker boundary — so the session is constructed here and only its
     * plain-data report travels back.
     */
    tabDebug: boolean;
}

/** What the generate phase yields. Plain data — worker-safe. */
export interface GenerationResult {
    pieces: Piece[];
    puzzleSize: Size;
    autoGroups?: AutoGroup[];
    tabDebugReport?: TabDebugReport;
    pieceCountMismatch?: PieceCountMismatch;
}

export function runGeneration(request: GenerationRequest): GenerationResult {
    const strategy = getCutStyleStrategy(request.cutStyle);
    const tabDebug = request.tabDebug ? new TabDebugSession() : undefined;
    const ctx = {
        fractalConfig: request.fractalConfig,
        composableConfig: request.composableConfig,
        wavyConfig: request.wavyConfig,
        trianglesConfig: request.trianglesConfig,
        classicConfig: request.classicConfig,
        tabDebug,
    };

    const generationGrid = strategy.scaleGrid(request.gridSize, request.imageSize, ctx);
    const puzzleSize = strategy.inscribePuzzleSize(request.imageSize, generationGrid, ctx);
    const { pieces: rawPieces, autoGroups, tabDebugReport, pieceCountMismatch } =
        strategy.generatePieces(generationGrid, puzzleSize, request.seed, ctx);

    const pieces = sealPieceGeometry(quantizePieceGeometry(rawPieces));

    return { pieces, puzzleSize, autoGroups, tabDebugReport, pieceCountMismatch };
}

/**
 * Whether generating this request will hit the traced-tab generator, and
 * so needs the lazy traced chunk loaded first. The worker entry awaits
 * the chunk based on this; keep it in step with which strategies pass
 * `tabGenerator: 'traced'` in `cut-style-strategies.ts` (its test
 * enumerates them). Mirrors `needsTracedTabChunk`
 * (`app/share-payload-to-init.ts`), which answers the same question for
 * a share payload rather than a request.
 */
export function requestNeedsTracedTabs(request: GenerationRequest): boolean {
    switch (request.cutStyle) {
        case 'triangles':
            return true;
        case 'classic':
            return request.classicConfig?.traceSetVersion !== undefined;
        case 'wavy':
            return request.wavyConfig?.traceSetVersion !== undefined;
        case 'composable':
            return request.composableConfig?.tabGenerator === 'traced';
        case 'fractal':
            return false;
    }
}
