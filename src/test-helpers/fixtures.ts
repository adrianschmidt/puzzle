/**
 * Shared test fixtures for Piece / GameState construction.
 *
 * Tests across the codebase used to roll their own makePiece / makeGameState
 * helpers, each subtly different. Drift across copies meant a test failure in
 * one file could be papered over by an inconsistent fixture rather than the
 * real bug. These canonical builders accept overrides so individual tests can
 * still tune the shape they need.
 */

import type { Edge, GameState, Piece, Point } from '../model/types.js';
import { buildGroupIndexes, buildPiecesById } from '../model/helpers.js';

/**
 * Re-export `buildPiecesById` for tests that call helpers expecting the
 * `piecesById` index (e.g. `getGroupBounds`, `getGroupVisualBounds`,
 * `rotateGroup`) without going through `makeGameState`.
 */
export { buildPiecesById };

export interface MakePieceOpts {
    id?: number;
    edges?: Edge[];
    shape?: string;
    imageOffset?: Point;
}

/**
 * Build a Piece with empty edges, empty shape, and zero imageOffset by default.
 *
 * Pass `edges` to inject custom edges, e.g. when testing edge-graph traversal.
 * For a standard rectangular piece with derived shape and grid imageOffset,
 * use makeRectPiece instead.
 */
export function makePiece(opts: MakePieceOpts = {}): Piece {
    return {
        id: opts.id ?? 0,
        edges: opts.edges ?? [],
        shape: opts.shape ?? '',
        imageOffset: opts.imageOffset ?? { x: 0, y: 0 },
    };
}

export interface MakeRectPieceOpts {
    id?: number;
    width?: number;
    height?: number;
    /** Column in the source-image grid; used to derive imageOffset. */
    col?: number;
    /** Row in the source-image grid; used to derive imageOffset. */
    row?: number;
    /** Override the derived imageOffset. */
    imageOffset?: Point;
}

/**
 * Build a 4-edge rectangular Piece spanning (0,0) to (width, height) in piece-local coords.
 *
 * All edges are border edges (no mates). Edge ids are deterministic (id*4 .. id*4+3)
 * so they don't collide between pieces. imageOffset defaults to (-col*width, -row*height)
 * — i.e. the piece tiled at column `col`, row `row` behind a single source image.
 * `col` defaults to `id` so a single-row strip works without specifying it.
 */
export function makeRectPiece(opts: MakeRectPieceOpts = {}): Piece {
    const id = opts.id ?? 0;
    const width = opts.width ?? 100;
    const height = opts.height ?? 100;
    const col = opts.col ?? id;
    const row = opts.row ?? 0;
    const base = id * 4;

    return {
        id,
        edges: [
            {
                id: base,
                mateEdgeId: -1,
                matePieceId: -1,
                path: `L${width},0`,
                start: { x: 0, y: 0 },
                end: { x: width, y: 0 },
            },
            {
                id: base + 1,
                mateEdgeId: -1,
                matePieceId: -1,
                path: `L${width},${height}`,
                start: { x: width, y: 0 },
                end: { x: width, y: height },
            },
            {
                id: base + 2,
                mateEdgeId: -1,
                matePieceId: -1,
                path: `L0,${height}`,
                start: { x: width, y: height },
                end: { x: 0, y: height },
            },
            {
                id: base + 3,
                mateEdgeId: -1,
                matePieceId: -1,
                path: 'L0,0',
                start: { x: 0, y: height },
                end: { x: 0, y: 0 },
            },
        ],
        shape: `M0,0 L${width},0 L${width},${height} L0,${height} Z`,
        // `|| 0` normalizes `-0` (from `-0 * width`) to `0` so values survive
        // JSON round-trips unchanged in serialization tests.
        imageOffset: opts.imageOffset ?? {
            x: -col * width || 0,
            y: -row * height || 0,
        },
    };
}

/**
 * Build a minimal valid GameState with sensible defaults.
 *
 * Default: empty pieces/groups, 800×600 image, 8×6 grid, not completed.
 * Pass any subset of GameState fields to override.
 *
 * The `piecesById`, `groupsById`, and `pieceToGroup` indexes are derived
 * from the final `pieces`/`groups` (overrides included) so callers don't
 * have to keep them in sync manually. Override them explicitly only if
 * a test needs to exercise an inconsistent state.
 */
export function makeGameState(overrides: Partial<GameState> = {}): GameState {
    const pieces = overrides.pieces ?? [];
    const groups = overrides.groups ?? [];
    const { groupsById, pieceToGroup } = buildGroupIndexes(groups);

    const base: GameState = {
        pieces,
        groups,
        piecesById: buildPiecesById(pieces),
        groupsById,
        pieceToGroup,
        imageUrl: 'test.jpg',
        imageSize: { width: 800, height: 600 },
        gridSize: { cols: 8, rows: 6 },
        completed: false,
    };
    return { ...base, ...overrides };
}
