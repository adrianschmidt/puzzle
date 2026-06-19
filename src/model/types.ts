/**
 * Core data model for the puzzle engine.
 *
 * Graph-based and shape-agnostic — no grid assumptions.
 * The engine handles merging and interaction generically;
 * puzzle generators produce pieces conforming to these types.
 */

/** A 2D point. */
export interface Point {
    x: number;
    y: number;
}

/** Width × height dimensions. */
export interface Size {
    width: number;
    height: number;
}

/**
 * One edge of a piece.
 *
 * Connectivity is expressed through mate relationships:
 * an edge knows which piece and edge it connects to.
 * Border edges use -1 for both mate fields.
 */
export interface Edge {
    /** Unique edge identifier (globally unique across all pieces). */
    id: number;
    /** The matching edge on the adjacent piece (-1 for border edges). */
    mateEdgeId: number;
    /** Which piece the mate edge belongs to (-1 for border edges). */
    matePieceId: number;
    /** SVG path segment for this edge (relative to piece-local coords). */
    path: string;
    /** Where this edge starts on the piece (piece-local coords). */
    start: Point;
    /** Where this edge ends on the piece (piece-local coords). */
    end: Point;
    /**
     * Sampled points along this edge's underlying cut curve (piece-local
     * coords). Forwarded from `EdgeDefinition.curvePoints`. Present for
     * non-straight cut edges; absent for straight edges. Tab protrusions
     * are NOT included here — they live only in `path`. Used by bbox
     * helpers to approximate curved-edge silhouette.
     */
    curvePoints?: Point[];
}

/**
 * A single puzzle piece.
 *
 * Knows its shape and connectivity, but nothing about
 * where it is on the table — that's the group's job.
 */
export interface Piece {
    /** Unique piece identifier. */
    id: number;
    /**
     * All edges of this piece, defining its shape boundary and
     * connectivity. Edges are stored as a flat list of one or more
     * loops chained end-to-start internally; loop boundaries are
     * detected by the chain breaking (an edge's `start` no longer
     * matches the previous edge's `end`). Pieces without holes are a
     * single loop; pieces with holes have additional loops following
     * the outer boundary. Use `shape` for rendering — it already
     * encodes loop structure as multi-`M..Z` SVG subpaths.
     */
    edges: Edge[];
    /** Full SVG clip-path `d` attribute built from all edges. */
    shape: string;
    /** Offset to position the source image behind the clip-path (piece-local coords). */
    imageOffset: Point;
}

/**
 * A group of connected pieces.
 *
 * Every piece is always in exactly one group.
 * A solo (unmerged) piece is a single-piece group.
 */
export interface PieceGroup {
    /** Unique group identifier. */
    id: number;
    /** pieceId → offset of that piece within the group's local space. */
    pieces: Map<number, Point>;
    /** The group's position in world (table) coordinates. */
    position: Point;
    /**
     * Rotation in float degrees, normalized to `[0, 360)`.
     *
     * Quarter-turn-mode puzzles store one of `{0, 90, 180, 270}`; free-mode
     * puzzles store any float in the range. Applied to the group's local
     * geometry at render time and during world-position lookups. Piece
     * offsets and edge endpoints stay in un-rotated local coordinates.
     *
     * Surfaces in the UI for puzzle styles that enable rotation (currently
     * any cut style with `rotationMode !== 'none'`); puzzles with
     * `rotationMode === 'none'` always have 0.
     */
    rotation: number;
}

/**
 * Attribution info for the puzzle image (e.g. Unsplash photographer).
 */
export interface ImageAttribution {
    /** Photographer / artist name. */
    photographerName: string;
    /** Link to the photographer's profile. */
    photographerUrl: string;
    /** Link to the original photo page. */
    photoUrl: string;
}

/**
 * Grid dimensions for the puzzle (cols × rows).
 */
export interface GridSize {
    cols: number;
    rows: number;
}

/**
 * Complete game state — everything needed to render and persist a game.
 *
 * The `*ById` and `pieceToGroup` Maps are derived indexes that mirror
 * `pieces` and `groups` for O(1) lookup on hot paths (drag, merge
 * detection, pile detection). They are NOT serialized — `deserializeState`
 * rebuilds them. Mutations to `groups` must go through the helpers in
 * `model/helpers.ts` (`addGroup`, `removeGroup`, `mergeGroups`) so the
 * indexes stay consistent.
 */
export interface GameState {
    /** All pieces in the puzzle (immutable after generation). */
    pieces: Piece[];
    /** Current groups (mutates as pieces merge). */
    groups: PieceGroup[];
    /** pieceId → Piece. Built once at construction; never mutates. */
    piecesById: Map<number, Piece>;
    /** groupId → PieceGroup. Kept in sync with `groups`. */
    groupsById: Map<number, PieceGroup>;
    /** pieceId → the group containing that piece. Kept in sync with `groups`. */
    pieceToGroup: Map<number, PieceGroup>;
    /** URL of the puzzle image. */
    imageUrl: string;
    /** Pixel dimensions of the puzzle image. */
    imageSize: Size;
    /** Grid dimensions used to generate this puzzle. */
    gridSize: GridSize;
    /** True when all pieces have been merged into a single group. */
    completed: boolean;
    /** Optional attribution for the puzzle image (e.g. from Unsplash). */
    attribution?: ImageAttribution;
    /** PRNG seed used for procedural cut generation. Reproduces the same cuts. */
    seed?: number;
    /** Cut style used for this puzzle. Defaults to 'classic' when absent. */
    cutStyle?: string;
    /**
     * How (or whether) groups in this puzzle can be rotated by the player.
     *
     * - `'none'`: rotation is disabled; all groups stay at rotation 0.
     * - `'quarter-turn'`: 90°-snapped rotation via toolbar buttons.
     * - `'free'`: continuous rotation via a drag handle. Merge alignment
     *   tolerates ±10° angular misalignment.
     *
     * Defaults to `'none'` when absent.
     */
    rotationMode?: 'none' | 'quarter-turn' | 'free';
    /**
     * Composable-cut config (only set when cutStyle === 'composable').
     *
     * Needed to reproduce the puzzle from its seed and surfaced in the
     * Debug panel for bug reports. Mirrors the {@link ComposableConfig}
     * shape from the composable generator, inlined here so this module
     * stays free of cross-package imports from the puzzle layer.
     */
    composableConfig?: {
        baseCutGenerator?: string;
        baseCutConfig?: Record<string, unknown>;
        tabGenerator?: string;
        tabConfig?: Record<string, unknown>;
        minPieceArea?: number;
        /** Borderless mode (strip the outer ring of pieces). */
        borderless?: boolean;
    };
    /**
     * Fractal-cut config (only set when cutStyle === 'fractal').
     *
     * Needed to reproduce the puzzle from its seed and surfaced in the
     * Debug panel for bug reports.
     */
    fractalConfig?: {
        borderless?: boolean;
    };
    /**
     * Wavy-cut config (only set when cutStyle === 'wavy').
     *
     * Needed to reproduce the puzzle from its seed and surfaced in the
     * Debug panel. Mirrors {@link GameState.fractalConfig}.
     */
    wavyConfig?: {
        borderless?: boolean;
        /**
         * Trace-set version for the hand-traced tab shapes. Present on puzzles
         * generated with traced tabs (every new Wavy game); absent on legacy
         * Wavy puzzles, which reproduce with classic tabs. See
         * project_share_link_prng_contract.
         */
        traceSetVersion?: number;
    };
}
