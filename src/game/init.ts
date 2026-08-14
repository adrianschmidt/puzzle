import type { GameState, PieceGroup, Piece, Point, Size, GridSize } from '../model/types.js';
import type { FractalConfig } from '../puzzle/fractal/index.js';
import type { ComposableConfig } from '../puzzle/composable-generator.js';
import type { AutoGroup } from '../puzzle/topology/auto-group.js';
import type { PieceCountMismatch } from '../puzzle/topology/generator.js';
import { buildGroupIndexes, buildPiecesById } from '../model/helpers.js';
import { generateSeed } from '../puzzle/seeded-random.js';
import type { CutStyle } from './cut-styles.js';
import { getCutStyleStrategy } from './cut-style-strategies.js';
import { runGeneration } from './generation-core.js';
import type { GenerationRequest, GenerationResult } from './generation-core.js';
import { generatePiecesOffThread } from './generate-async.js';
import type { OffThreadGeneration } from './generate-async.js';

/** Opt-in via `?tabDebug=1` (any value but `0`/`false`); false when no `window`. */
function tabDebugEnabled(): boolean {
    if (typeof window === 'undefined' || !window.location) return false;
    const v = new URLSearchParams(window.location.search).get('tabDebug');
    return v !== null && v !== '0' && v !== 'false';
}

export const DEFAULT_COLS = 8;
export const DEFAULT_ROWS = 6;

export const VIEWPORT_MARGIN = 20;

export interface InitOptions {
    /** Random number generator: returns a value in [0, 1). Default: Math.random */
    random?: () => number;
    /** PRNG seed for procedural cut generation. If omitted, a random seed is generated. */
    seed?: number;
    cutStyle?: CutStyle;
    composableConfig?: ComposableConfig;
    fractalConfig?: FractalConfig;
    wavyConfig?: { borderless?: boolean; traceSetVersion?: number };
    trianglesConfig?: { traceSetVersion?: number };
    classicConfig?: { traceSetVersion?: number };
    /** Defaults to `'none'`. `'quarter-turn'` gives each piece a random {0..3}×90° start. */
    rotationMode?: 'none' | 'quarter-turn' | 'free';
    /**
     * Fires when generation produced a different piece count than the base cut
     * declared (#512). Called synchronously before this function returns, so a
     * caller must capture it into a local and act after the return. Optional;
     * omitting discards the diagnostic.
     */
    onPieceCountMismatch?: (mismatch: PieceCountMismatch) => void;
}

/** `imageUrl` may be null for a blank puzzle. */
export function createNewGame(
    imageUrl: string | null,
    imageSize: Size,
    viewport: Size,
    gridSize: GridSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    options: InitOptions = {},
): GameState {
    const seed = options.seed ?? generateSeed();
    const result = runGeneration(buildGenerationRequest(gridSize, imageSize, seed, options));
    return assembleGameState(imageUrl, viewport, gridSize, options, seed, result);
}

/**
 * How one generation ran, for the `new-game-started` analytics fields. Derived
 * from {@link OffThreadGeneration} (not redeclared) so a new optional field
 * can't be silently dropped by `createNewGameAsync`'s rebuild.
 */
export type GenerationOutcome = Omit<OffThreadGeneration, 'result'> & { durationMs: number };

/** State plus how its generation ran, for the `new-game-started` analytics. */
export interface CreateNewGameAsyncResult {
    state: GameState;
    generation: GenerationOutcome;
}

/**
 * Async counterpart of {@link createNewGame}: same inputs and state, but the
 * generate phase runs in a Web Worker when available, else synchronously.
 * `options.onPieceCountMismatch` fires before the promise resolves. Rejects
 * with {@link GenerationCanceledError} when `signal` aborts.
 */
export async function createNewGameAsync(
    imageUrl: string | null,
    imageSize: Size,
    viewport: Size,
    gridSize: GridSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    options: InitOptions = {},
    signal?: AbortSignal,
): Promise<CreateNewGameAsyncResult> {
    const seed = options.seed ?? generateSeed();
    const startedAt = performance.now();
    // Rest spread (not field-by-field) so a new `OffThreadGeneration` field
    // reaches analytics automatically and absent optionals stay absent.
    const { result, ...ranAs } = await generatePiecesOffThread(
        buildGenerationRequest(gridSize, imageSize, seed, options),
        signal,
    );
    const durationMs = Math.round(performance.now() - startedAt);
    const state = assembleGameState(imageUrl, viewport, gridSize, options, seed, result);
    return { state, generation: { ...ranAs, durationMs } };
}

function buildGenerationRequest(
    gridSize: GridSize,
    imageSize: Size,
    seed: number,
    options: InitOptions,
): GenerationRequest {
    return {
        cutStyle: options.cutStyle ?? 'classic',
        gridSize,
        imageSize,
        seed,
        fractalConfig: options.fractalConfig,
        composableConfig: options.composableConfig,
        wavyConfig: options.wavyConfig,
        trianglesConfig: options.trianglesConfig,
        classicConfig: options.classicConfig,
        tabDebug: tabDebugEnabled(),
    };
}

function assembleGameState(
    imageUrl: string | null,
    viewport: Size,
    gridSize: GridSize,
    options: InitOptions,
    seed: number,
    result: GenerationResult,
): GameState {
    const cutStyle = options.cutStyle ?? 'classic';
    const rotationMode = options.rotationMode ?? 'none';
    const { pieces, puzzleSize, autoGroups, tabDebugReport, pieceCountMismatch } = result;

    if (pieceCountMismatch) {
        options.onPieceCountMismatch?.(pieceCountMismatch);
    }

    if (tabDebugReport) {
        (globalThis as { __tabDebug?: unknown }).__tabDebug = tabDebugReport;
        // eslint-disable-next-line no-console
        console.info('[tabDebug] report attached to window.__tabDebug',
            { pieceCount: Object.keys(tabDebugReport).length });
    }

    const groups = createInitialGroups(
        pieces, puzzleSize, viewport, gridSize, options, autoGroups,
    );
    const { groupsById, pieceToGroup } = buildGroupIndexes(groups);

    const strategy = getCutStyleStrategy(cutStyle);
    return {
        pieces,
        groups,
        piecesById: buildPiecesById(pieces),
        groupsById,
        pieceToGroup,
        imageUrl,
        imageSize: puzzleSize,
        gridSize,
        completed: false,
        seed,
        cutStyle,
        rotationMode,
        composableConfig: strategy.configKey === 'composableConfig' ? options.composableConfig : undefined,
        fractalConfig: strategy.configKey === 'fractalConfig' ? options.fractalConfig : undefined,
        wavyConfig: strategy.configKey === 'wavyConfig' ? options.wavyConfig : undefined,
        trianglesConfig: strategy.configKey === 'trianglesConfig' ? options.trianglesConfig : undefined,
        classicConfig: strategy.configKey === 'classicConfig' ? options.classicConfig : undefined,
    };
}

/**
 * `autoGroups` omitted/empty: each piece becomes its own group (legacy Fractal
 * / pre-upgrade Classic). Provided: it dictates the partition — one
 * `PieceGroup` per {@link AutoGroup}, anchor = lowest piece id at local
 * `(0,0)`, others offset from `imageOffset` deltas so the image is seamless.
 * One world position and rotation per group, not per piece.
 */
export function createInitialGroups(
    pieces: Piece[],
    imageSize: Size,
    viewport: Size,
    gridSize: GridSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    options: InitOptions = {},
    autoGroups?: AutoGroup[],
): PieceGroup[] {
    const random = options.random ?? Math.random;
    const cols = gridSize.cols;
    const rows = gridSize.rows;

    const pieceWidth = imageSize.width / cols;
    const pieceHeight = imageSize.height / rows;

    const pickInitialRotation: () => number =
        options.rotationMode === 'quarter-turn'
            ? () => Math.floor(random() * 4) * 90
            : options.rotationMode === 'free'
            ? () => random() * 360
            : () => 0;

    const partition: AutoGroup[] = autoGroups && autoGroups.length > 0
        ? autoGroups
        : pieces.map(p => ({ id: p.id, pieceIds: [p.id] }));

    const positions = randomizePositions(
        partition.length,
        pieceWidth,
        pieceHeight,
        viewport,
        random,
    );

    const piecesById = new Map<number, Piece>();
    for (const p of pieces) piecesById.set(p.id, p);

    return partition.map((group, index) => ({
        id: group.id,
        pieces: buildGroupPieceMap(group, piecesById),
        position: positions[index],
        rotation: pickInitialRotation(),
    }));
}

/**
 * Anchor = lowest piece id (also the group id), at local `(0,0)`; others get
 * `anchor.imageOffset - piece.imageOffset`. The sign flips because
 * `imageOffset` is "image relative to clip-path", so pieces render seamlessly
 * when their clip-path positions differ by minus their `imageOffset` delta.
 * (Mid-game merges derive the same delta from world coords; here the pieces
 * aren't placed yet.)
 */
function buildGroupPieceMap(
    group: AutoGroup,
    piecesById: Map<number, Piece>,
): Map<number, Point> {
    const out = new Map<number, Point>();
    if (group.pieceIds.length === 1) {
        out.set(group.pieceIds[0], { x: 0, y: 0 });
        return out;
    }

    // `pieceIds` is sorted ascending (`autoGroupSmallPieces`) and the group id
    // equals the smallest piece id (union-find root), so the anchor is `[0]`.
    const anchorId = group.pieceIds[0];
    const anchor = piecesById.get(anchorId);
    if (!anchor) {
        throw new Error(`Anchor piece ${anchorId} missing from piece map`);
    }
    out.set(anchorId, { x: 0, y: 0 });

    for (let i = 1; i < group.pieceIds.length; i++) {
        const pieceId = group.pieceIds[i];
        const piece = piecesById.get(pieceId);
        if (!piece) {
            throw new Error(`Piece ${pieceId} missing from piece map`);
        }
        out.set(pieceId, {
            x: anchor.imageOffset.x - piece.imageOffset.x,
            y: anchor.imageOffset.y - piece.imageOffset.y,
        });
    }
    return out;
}

export function randomizePositions(
    count: number,
    pieceWidth: number,
    pieceHeight: number,
    viewport: Size,
    random: () => number,
): Array<{ x: number; y: number }> {
    const minX = VIEWPORT_MARGIN;
    const minY = VIEWPORT_MARGIN;
    const maxX = Math.max(minX, viewport.width - pieceWidth - VIEWPORT_MARGIN);
    const maxY = Math.max(minY, viewport.height - pieceHeight - VIEWPORT_MARGIN);

    return Array.from({ length: count }, () => ({
        x: minX + random() * (maxX - minX),
        y: minY + random() * (maxY - minY),
    }));
}
