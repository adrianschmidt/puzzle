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
    /** All edges of this piece, defining its shape boundary and connectivity. */
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
 */
export interface GameState {
    /** All pieces in the puzzle (immutable after generation). */
    pieces: Piece[];
    /** Current groups (mutates as pieces merge). */
    groups: PieceGroup[];
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
}
