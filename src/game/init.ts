/**
 * Game initialization logic.
 *
 * Creates a new game state: generates pieces using the configured cut
 * style's generator, partitions them into starting groups (one piece
 * per group by default; the generator may opt in to multi-piece groups
 * via {@link AutoGroup}s for auto-glued tiny pieces), and randomizes
 * positions within the viewport so all groups are visible.
 */

import type { GameState, PieceGroup, Piece, Point, Size, GridSize } from '../model/types.js';
import type { FractalConfig } from '../puzzle/fractal/index.js';
import type { ComposableConfig } from '../puzzle/composable-generator.js';
import type { AutoGroup } from '../puzzle/topology/auto-group.js';
import { buildGroupIndexes, buildPiecesById } from '../model/helpers.js';
import { generateSeed } from '../puzzle/seeded-random.js';
import type { CutStyle } from './cut-styles.js';
import { getCutStyleStrategy } from './cut-style-strategies.js';
import { TabDebugSession } from '../puzzle/topology/tab-debug.js';

/**
 * Read-once URL-param check for the tab-debug session opt-in. Returns
 * true if the page was opened with `?tabDebug=1` (or any truthy value
 * other than `0` / `false`). Safe under SSR / tests — falls back to
 * false when `window` isn't available.
 */
function tabDebugEnabled(): boolean {
    if (typeof window === 'undefined' || !window.location) return false;
    const v = new URLSearchParams(window.location.search).get('tabDebug');
    return v !== null && v !== '0' && v !== 'false';
}

/** Default grid dimensions for the MVP puzzle. */
export const DEFAULT_COLS = 8;
export const DEFAULT_ROWS = 6;

/** Margin from the viewport edge to keep pieces visible. */
export const VIEWPORT_MARGIN = 20;

/**
 * Options for random position generation.
 * Extracted for testability (allows injecting a seeded RNG).
 */
export interface InitOptions {
    /** Random number generator: returns a value in [0, 1). Default: Math.random */
    random?: () => number;
    /** PRNG seed for procedural cut generation. If omitted, a random seed is generated. */
    seed?: number;
    /** Cut style to use. Defaults to 'classic'. */
    cutStyle?: CutStyle;
    /** Configuration for the composable generator (only used when cutStyle is 'composable'). */
    composableConfig?: ComposableConfig;
    /** Configuration for the fractal generator (only used when cutStyle is 'fractal'). */
    fractalConfig?: FractalConfig;
    /** Configuration for the wavy generator (only used when cutStyle is 'wavy'). */
    wavyConfig?: { borderless?: boolean; traceSetVersion?: number };
    /** Configuration for the triangles preset (only used when cutStyle is 'triangles'). */
    trianglesConfig?: { traceSetVersion?: number };
    /**
     * Rotation mode for this puzzle. Defaults to `'none'`.
     *
     * When set to `'quarter-turn'`, each initial single-piece group gets a
     * random rotation in {0,1,2,3} so the player must solve orientation
     * as well as position.
     */
    rotationMode?: 'none' | 'quarter-turn' | 'free';
}

/**
 * Create a new game state with randomized piece positions.
 *
 * @param imageUrl - URL of the puzzle image
 * @param imageSize - Pixel dimensions of the puzzle image
 * @param viewport - Available viewport size for positioning pieces
 * @param gridSize - Grid dimensions (cols × rows). Defaults to 8×6.
 * @param options - Optional configuration (e.g. custom RNG)
 */
export function createNewGame(
    imageUrl: string,
    imageSize: Size,
    viewport: Size,
    gridSize: GridSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    options: InitOptions = {},
): GameState {
    const seed = options.seed ?? generateSeed();
    const cutStyle = options.cutStyle ?? 'classic';
    const rotationMode = options.rotationMode ?? 'none';

    const strategy = getCutStyleStrategy(cutStyle);
    const tabDebug = tabDebugEnabled() ? new TabDebugSession() : undefined;
    const ctx = {
        fractalConfig: options.fractalConfig,
        composableConfig: options.composableConfig,
        wavyConfig: options.wavyConfig,
        trianglesConfig: options.trianglesConfig,
        tabDebug,
    };

    const generationGrid = strategy.scaleGrid(gridSize, imageSize, ctx);
    const puzzleSize = strategy.inscribePuzzleSize(imageSize, generationGrid, ctx);
    const { pieces, autoGroups, tabDebugReport } =
        strategy.generatePieces(generationGrid, puzzleSize, seed, ctx);

    if (tabDebugReport) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__tabDebug = tabDebugReport;
        // eslint-disable-next-line no-console
        console.info('[tabDebug] report attached to window.__tabDebug',
            { pieceCount: Object.keys(tabDebugReport).length });
    }

    const groups = createInitialGroups(
        pieces, puzzleSize, viewport, gridSize, options, autoGroups,
    );
    const { groupsById, pieceToGroup } = buildGroupIndexes(groups);

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
    };
}

/**
 * Create the starting `PieceGroup[]` for a new game.
 *
 * If `autoGroups` is omitted (or empty), each piece becomes its own
 * single-piece group — the legacy behavior, used by classic and
 * fractal cut styles.
 *
 * If `autoGroups` is provided (composable cut style with `minPieceArea`
 * configured), it dictates the partition: each {@link AutoGroup}
 * becomes one `PieceGroup` containing all its pieces. Within a multi-
 * piece group, the anchor is the lowest piece id and gets local offset
 * `(0,0)`; other pieces are offset so the source image lines up
 * seamlessly across the group, computed from `imageOffset` deltas.
 * One world position and one rotation are picked per group, not per
 * piece.
 *
 * Positions are distributed within the usable area of the viewport,
 * accounting for piece dimensions so pieces stay fully visible.
 *
 * @param pieces - All puzzle pieces
 * @param imageSize - Puzzle image dimensions (to compute piece cell size)
 * @param viewport - Available viewport dimensions
 * @param gridSize - Grid dimensions (cols × rows)
 * @param options - Optional configuration
 * @param autoGroups - Starting groups from the generator (composable
 *     cut style only). When omitted, every piece is its own group.
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

    // Resolve the partition. The generator either tells us how to glue
    // tiny pieces together, or we default to one-piece-per-group so
    // existing styles (classic, fractal) keep their behavior.
    const partition: AutoGroup[] = autoGroups && autoGroups.length > 0
        ? autoGroups
        : pieces.map(p => ({ id: p.id, pieceIds: [p.id] }));

    // One random position per group (not per piece). For multi-piece
    // groups, each contained piece needs an offset so the underlying
    // image stays aligned — see the offset math below.
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
 * Build the `pieces` map for a starting group.
 *
 * Single-piece groups trivially map to `{[id]: (0,0)}`. For multi-
 * piece groups (auto-grouped tiny pieces from the topology generator),
 * we pick the lowest piece id as the anchor — by construction this
 * is also the group id — and compute every other piece's local
 * offset as `anchor.imageOffset - piece.imageOffset`.
 *
 * Why this delta works: each piece's `imageOffset` says where to put
 * the source image so the piece's own clip-path lines up. For two
 * pieces in the same group to render the puzzle picture seamlessly,
 * their world-space clip-path positions must differ by the same
 * vector their `imageOffset`s differ by — but with the sign flipped,
 * because `imageOffset` is "image relative to clip-path". Mid-game
 * merges (`game/group-merging.ts`) compute the equivalent delta from
 * world coordinates; here we derive it from image-space offsets,
 * which haven't been placed in the world yet.
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

    // `pieceIds` is sorted ascending by `autoGroupSmallPieces`, and
    // the group id equals the smallest piece id (the union-find root).
    // The anchor is therefore `pieceIds[0]`.
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

/**
 * Generate random positions for n pieces within the viewport.
 *
 * Each position ensures the piece stays fully visible:
 * - x: from VIEWPORT_MARGIN to (viewport.width - pieceWidth - VIEWPORT_MARGIN)
 * - y: from VIEWPORT_MARGIN to (viewport.height - pieceHeight - VIEWPORT_MARGIN)
 *
 * If the viewport is too small to fit pieces with margin,
 * positions are clamped to at least 0.
 */
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
