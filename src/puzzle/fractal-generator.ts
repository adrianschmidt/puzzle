/**
 * Fractal circle-packing puzzle generator.
 *
 * Ported from the Fractal Jigsaw Generator by proceduraljigsaw:
 * https://github.com/proceduraljigsaw/Fractalpuzzlejs
 *
 * The algorithm places tiles on a square grid and connects them
 * diagonally to form pieces. Each piece is bounded by quarter-circle
 * arcs around the tile centres, producing organic, dragon-curve-like
 * shapes that interlock without traditional tabs/blanks.
 *
 * Key concepts:
 * - **Tile:** a point on the grid, identified by (x, y).
 * - **DiagonalConnection:** a diagonal link between two tiles,
 *   occupying the cell (square) between them.
 * - **Piece:** a set of DiagonalConnections grown via flood-fill.
 * - **Arc:** a quarter-circle arc segment forming the piece boundary.
 *
 * The generator outputs standard Piece[] conforming to the engine's
 * data model, with proper edge mate relationships for merge detection.
 */

import type { Edge, Piece, Point, Size } from '../model/types.js';
import { createSeededRandom } from './seeded-random.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface Tile {
    x: number;
    y: number;
    hasconnections: boolean;
}

interface DiagonalConnection {
    p1: Tile;
    p2: Tile;
    p2_taken: boolean;
    slope: number;
    quad: number;
    cell: { x: number; y: number };
}

interface ArcData {
    /** Centre point of the arc's circle. */
    cx: number;
    cy: number;
    /** Radius. */
    r: number;
    /** Start point. */
    sx: number;
    sy: number;
    /** End point. */
    ex: number;
    ey: number;
    /** Sweep flag (0 or 1). */
    sign: number;
    /** Quadrant (0-3). */
    quad: number;
}

// ---------------------------------------------------------------------------
// Tile / Connection helpers
// ---------------------------------------------------------------------------

function tileEq(a: Tile, b: Tile): boolean {
    return a.x === b.x && a.y === b.y;
}

function makeTile(x: number, y: number): Tile {
    return { x, y, hasconnections: true };
}

function makeConnection(p1: Tile, p2: Tile, p2_taken: boolean): DiagonalConnection {
    const slope = (p2.y - p1.y) / (p2.x - p1.x);
    const cell = { x: Math.min(p2.x, p1.x), y: Math.min(p2.y, p1.y) };
    let quad: number;
    if (slope > 0) {
        quad = p2.y > p1.y ? 3 : 1;
    } else {
        quad = p2.y > p1.y ? 2 : 0;
    }

    return { p1, p2, p2_taken, slope, quad, cell };
}

function connectionFromQuad(p1: Tile, quadrant: number, p2_taken: boolean): DiagonalConnection {
    let p2: Tile;
    switch (quadrant) {
        case 0: p2 = makeTile(p1.x + 1, p1.y - 1); break;
        case 1: p2 = makeTile(p1.x - 1, p1.y - 1); break;
        case 2: p2 = makeTile(p1.x - 1, p1.y + 1); break;
        case 3: p2 = makeTile(p1.x + 1, p1.y + 1); break;
        default: throw new Error(`Invalid quadrant: ${quadrant}`);
    }

    return makeConnection(p1, p2, p2_taken);
}

function connectionEq(a: DiagonalConnection, b: DiagonalConnection): boolean {
    return a.cell.x === b.cell.x && a.cell.y === b.cell.y
        && a.slope === b.slope && a.p2_taken === b.p2_taken;
}

// ---------------------------------------------------------------------------
// CellGrid — tracks visited tiles and occupied cells
// ---------------------------------------------------------------------------

class CellGrid {
    private readonly nrow: number;
    private readonly ncol: number;
    private readonly visited: boolean[];
    private readonly cellmap: boolean[];
    private _nunvisited: number;

    constructor(nrow: number, ncol: number) {
        this.nrow = nrow;
        this.ncol = ncol;
        this.visited = new Array(ncol * nrow).fill(false);
        this.cellmap = new Array((ncol - 1) * (nrow - 1)).fill(false);
        this._nunvisited = ncol * nrow;
    }

    get nunvisited(): number {
        return this._nunvisited;
    }

    randomEmptyTile(random: () => number): Tile {
        const empty: number[] = [];
        for (let i = 0; i < this.visited.length; i++) {
            if (!this.visited[i]) empty.push(i);
        }

        const idx = empty[Math.floor(random() * empty.length)];
        const y = Math.floor(idx / this.nrow);
        const x = idx % this.nrow;

        return makeTile(x, y);
    }

    reset(): void {
        this.visited.fill(false);
        this.cellmap.fill(false);
        this._nunvisited = this.ncol * this.nrow;
    }

    isTileValid(v: Tile): boolean {
        return v.x >= 0 && v.x < this.nrow && v.y >= 0 && v.y < this.ncol;
    }

    isTileVisited(v: Tile): boolean {
        return this.visited[v.y * this.nrow + v.x];
    }

    isCellEmpty(c: { x: number; y: number }): boolean {
        return !this.cellmap[c.y * this.nrow + c.x];
    }

    visitTile(v: Tile): void {
        const idx = v.y * this.nrow + v.x;
        if (!this.visited[idx]) {
            this.visited[idx] = true;
            this._nunvisited--;
        }
    }

    occupyCell(c: { x: number; y: number }): void {
        this.cellmap[c.y * this.nrow + c.x] = true;
    }

    liberateCell(c: { x: number; y: number }): void {
        this.cellmap[c.y * this.nrow + c.x] = false;
    }
}

// ---------------------------------------------------------------------------
// Arc generation (piece boundary)
// ---------------------------------------------------------------------------

function makeArc(
    gcp: Tile, rad: number, offs: number, quad: number, sign: number,
): ArcData {
    const cx = gcp.x * 2 * rad + rad + offs;
    const cy = gcp.y * 2 * rad + rad + offs;

    let pax: number, pay: number, pbx: number, pby: number;
    switch (quad) {
        case 0: pax = cx + rad; pay = cy; pbx = cx; pby = cy - rad; break;
        case 1: pax = cx; pay = cy - rad; pbx = cx - rad; pby = cy; break;
        case 2: pax = cx - rad; pay = cy; pbx = cx; pby = cy + rad; break;
        case 3: pax = cx; pay = cy + rad; pbx = cx + rad; pby = cy; break;
        default: throw new Error(`Invalid quad: ${quad}`);
    }

    let sx: number, sy: number, ex: number, ey: number;
    if (sign === 0) {
        sx = pax; sy = pay; ex = pbx; ey = pby;
    } else {
        sx = pbx; sy = pby; ex = pax; ey = pay;
    }

    return { cx, cy, r: rad, sx, sy, ex, ey, sign, quad };
}

// ---------------------------------------------------------------------------
// Build arcs for a piece (recursive, matches original algorithm exactly)
// ---------------------------------------------------------------------------

function addArcs(
    con: DiagonalConnection,
    connections: DiagonalConnection[],
    arcs: ArcData[],
    rad: number,
    frameOffset: number,
    first: boolean,
): void {
    // Arc on the "first" side of the connection
    let newarc: ArcData;
    switch (con.quad) {
        case 0: newarc = makeArc(makeTile(con.p1.x + 1, con.p1.y), rad, frameOffset, 1, 1); break;
        case 1: newarc = makeArc(makeTile(con.p1.x, con.p1.y - 1), rad, frameOffset, 2, 1); break;
        case 2: newarc = makeArc(makeTile(con.p1.x - 1, con.p1.y), rad, frameOffset, 3, 1); break;
        case 3: newarc = makeArc(makeTile(con.p1.x, con.p1.y + 1), rad, frameOffset, 0, 1); break;
        default: throw new Error(`Invalid quad: ${con.quad}`);
    }
    arcs.push(newarc);

    // Handle p2 side
    if (con.p2_taken) {
        const p2quads = [(con.quad + 3) % 4, (con.quad + 4) % 4, (con.quad + 5) % 4];
        for (const q of p2quads) {
            const pct = connectionFromQuad(con.p2, q, true);
            const pcnt = connectionFromQuad(con.p2, q, false);
            if (connections.find(c => connectionEq(c, pct))) {
                addArcs(pct, connections, arcs, rad, frameOffset, false);
            } else if (connections.find(c => connectionEq(c, pcnt))) {
                addArcs(pcnt, connections, arcs, rad, frameOffset, false);
            } else {
                arcs.push(makeArc(con.p2, rad, frameOffset, q, 0));
            }
        }
    } else {
        arcs.push(makeArc(con.p2, rad, frameOffset, (con.quad + 2) % 4, 1));
    }

    // Arc on the "second" side of the connection
    switch (con.quad) {
        case 0: newarc = makeArc(makeTile(con.p1.x, con.p1.y - 1), rad, frameOffset, 3, 1); break;
        case 1: newarc = makeArc(makeTile(con.p1.x - 1, con.p1.y), rad, frameOffset, 0, 1); break;
        case 2: newarc = makeArc(makeTile(con.p1.x, con.p1.y + 1), rad, frameOffset, 1, 1); break;
        case 3: newarc = makeArc(makeTile(con.p1.x + 1, con.p1.y), rad, frameOffset, 2, 1); break;
        default: throw new Error(`Invalid quad: ${con.quad}`);
    }
    arcs.push(newarc);

    // Handle p1 side (only on first call)
    if (first) {
        const p1quads = [(con.quad + 1) % 4, (con.quad + 2) % 4, (con.quad + 3) % 4];
        for (const q of p1quads) {
            const pct = connectionFromQuad(con.p1, q, true);
            const pcnt = connectionFromQuad(con.p1, q, false);
            if (connections.find(c => connectionEq(c, pct))) {
                addArcs(pct, connections, arcs, rad, frameOffset, false);
            } else if (connections.find(c => connectionEq(c, pcnt))) {
                addArcs(pcnt, connections, arcs, rad, frameOffset, false);
            } else {
                arcs.push(makeArc(con.p1, rad, frameOffset, q, 0));
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Piece generation (flood-fill on diagonal connections)
// ---------------------------------------------------------------------------

function findPossibleConnections(
    grid: CellGrid,
    mytiles: Tile[],
    allowPartials: boolean,
): DiagonalConnection[] {
    const neighbors = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    const pcs: DiagonalConnection[] = [];

    for (const v of mytiles) {
        if (v.hasconnections || allowPartials) {
            v.hasconnections = false;
            for (const n of neighbors) {
                const cpt = makeTile(v.x + n[0], v.y + n[1]);
                if (grid.isTileValid(cpt) && !mytiles.find(nv => tileEq(nv, cpt))) {
                    const dc = makeConnection(v, cpt, !grid.isTileVisited(cpt));
                    if (grid.isCellEmpty(dc.cell)) {
                        if (allowPartials || !grid.isTileVisited(cpt)) {
                            pcs.push(dc);
                            v.hasconnections = true;
                        }
                    }
                }
            }
        }
    }

    return pcs;
}

function createPiece(
    grid: CellGrid,
    minSize: number,
    maxSize: number,
    random: () => number,
): DiagonalConnection[] | null {
    const mytiles: Tile[] = [];
    const myconnections: DiagonalConnection[] = [];
    const targetLen = Math.round(minSize + random() * (maxSize - minSize));

    const vi = grid.randomEmptyTile(random);
    mytiles.push(vi);
    grid.visitTile(vi);

    while (grid.nunvisited > 0 && mytiles.length < targetLen) {
        const pcs = findPossibleConnections(grid, mytiles, false);
        if (pcs.length === 0) break;

        const chosen = pcs[Math.floor(random() * pcs.length)];
        myconnections.push(chosen);
        mytiles.push(chosen.p2);
        grid.occupyCell(chosen.cell);
        grid.visitTile(chosen.p2);
    }

    if (mytiles.length >= minSize) {
        return myconnections;
    }

    // Too small — release cells
    for (const c of myconnections) {
        grid.liberateCell(c.cell);
    }

    return null;
}

function fillHoles(
    grid: CellGrid,
    pieces: DiagonalConnection[][],
    allowPartials: boolean,
): boolean {
    let filled = false;
    pieces.sort((a, b) => a.length - b.length);

    for (const p of pieces) {
        const tiles: Tile[] = [p[0].p1];
        for (const con of p) tiles.push(con.p2);

        for (const v of tiles) {
            let pcs = findPossibleConnections(grid, [v], allowPartials);
            pcs = pcs.filter(ele => !tiles.find(vf => tileEq(vf, ele.p2)));

            for (const pc of pcs) {
                p.push(pc);
                tiles.push(pc.p2);
                filled = true;
                grid.occupyCell(pc.cell);
                grid.visitTile(pc.p2);
            }
        }
    }

    return filled;
}

// ---------------------------------------------------------------------------
// Convert fractal pieces to standard Piece[] format
// ---------------------------------------------------------------------------

/**
 * Build arcs for all pieces, then convert each piece's arc sequence
 * into Edge[] with proper mate relationships.
 *
 * Two arcs are "mates" when they share the same centre + quadrant
 * but belong to different pieces (one has sign=0, the other sign=1).
 */
function convertToStandardPieces(
    fractalPieces: DiagonalConnection[][],
    rad: number,
    frameOffset: number,
    imageSize: Size,
    gridCols: number,
    gridRows: number,
): Piece[] {
    // 1. Build all arc sequences for all pieces
    const allPieceArcs: ArcData[][] = [];
    for (const p of fractalPieces) {
        const arcs: ArcData[] = [];
        addArcs(p[0], p, arcs, rad, frameOffset, true);
        allPieceArcs.push(arcs);
    }

    // 2. Build an index of arcs by (cx, cy, quad) for mate lookup
    //    Must be done BEFORE scaling, using original abstract coordinates.
    //    Also store each arc's key so we can look it up after scaling.
    const arcIndex = new Map<string, Array<{ pieceIdx: number; arcIdx: number }>>();
    const arcKeys: string[][] = [];
    for (let pi = 0; pi < allPieceArcs.length; pi++) {
        const arcs = allPieceArcs[pi];
        arcKeys[pi] = [];
        for (let ai = 0; ai < arcs.length; ai++) {
            const a = arcs[ai];
            const key = `${a.cx},${a.cy},${a.quad}`;
            arcKeys[pi][ai] = key;
            let list = arcIndex.get(key);
            if (!list) {
                list = [];
                arcIndex.set(key, list);
            }
            list.push({ pieceIdx: pi, arcIdx: ai });
        }
    }

    // 3. Scale all arc coordinates to image pixel space.
    const puzzleWidth = gridCols * 2 * rad;
    const puzzleHeight = gridRows * 2 * rad;
    const scaleX = imageSize.width / puzzleWidth;
    const scaleY = imageSize.height / puzzleHeight;

    for (const arcs of allPieceArcs) {
        for (const a of arcs) {
            a.sx *= scaleX;
            a.ex *= scaleX;
            a.cx *= scaleX;
            a.sy *= scaleY;
            a.ey *= scaleY;
            a.cy *= scaleY;
        }
    }

    // 4. Convert each piece
    let nextEdgeId = 0;
    const edgeIds: number[][] = allPieceArcs.map(arcs => arcs.map(() => nextEdgeId++));

    const pieces: Piece[] = [];

    for (let pi = 0; pi < allPieceArcs.length; pi++) {
        const arcs = allPieceArcs[pi];
        if (arcs.length === 0) continue;

        // Find bounding box of the piece in pixel-space
        let minX = Infinity, minY = Infinity;
        for (const a of arcs) {
            minX = Math.min(minX, a.sx, a.ex);
            minY = Math.min(minY, a.sy, a.ey);
        }

        // Each arc becomes one Edge
        const edges: Edge[] = [];
        for (let ai = 0; ai < arcs.length; ai++) {
            const a = arcs[ai];
            const edgeId = edgeIds[pi][ai];

            // Find mate: same (cx, cy, quad) in a different piece
            // Use the pre-scale key stored before coordinate scaling
            const key = arcKeys[pi][ai];
            const candidates = arcIndex.get(key) || [];
            let mateEdgeId = -1;
            let matePieceId = -1;
            for (const c of candidates) {
                if (c.pieceIdx !== pi) {
                    mateEdgeId = edgeIds[c.pieceIdx][c.arcIdx];
                    matePieceId = c.pieceIdx;
                    break;
                }
            }

            // Convert to piece-local coordinates (subtract bounding box origin)
            const localSx = a.sx - minX;
            const localSy = a.sy - minY;
            const localEx = a.ex - minX;
            const localEy = a.ey - minY;
            const rx = a.r * scaleX;
            const ry = a.r * scaleY;

            const path = `A ${fmt(rx)} ${fmt(ry)} 0 0,${a.sign} ${fmt(localEx)} ${fmt(localEy)}`;

            edges.push({
                id: edgeId,
                mateEdgeId,
                matePieceId,
                path,
                start: { x: localSx, y: localSy },
                end: { x: localEx, y: localEy },
            });
        }

        // Shape: M + all arc paths + Z
        const firstEdge = edges[0];
        const shapeParts = [`M ${fmt(firstEdge.start.x)} ${fmt(firstEdge.start.y)}`];
        for (const e of edges) {
            shapeParts.push(e.path);
        }
        shapeParts.push('Z');
        const shape = shapeParts.join(' ');

        // imageOffset: piece-local (0,0) maps to (minX, minY) in image pixels
        const imageOffset: Point = {
            x: -minX,
            y: -minY,
        };

        pieces.push({
            id: pi,
            edges,
            shape,
            imageOffset,
        });
    }

    return pieces;
}

function fmt(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Configuration for the fractal generator.
 */
export interface FractalConfig {
    /** Minimum number of tiles per piece (default: 2). */
    minPieceSize?: number;
    /** Maximum number of tiles per piece (default: 8). */
    maxPieceSize?: number;
}

/**
 * Generate a fractal puzzle using the circle-packing diagonal connection algorithm.
 *
 * @param cols - Grid columns (tile grid, NOT piece columns)
 * @param rows - Grid rows (tile grid, NOT piece rows)
 * @param imageSize - Pixel dimensions of the puzzle image
 * @param seed - PRNG seed for reproducible layouts
 * @param config - Optional configuration for piece sizes
 * @returns Array of pieces with organic arc-based shapes
 */
export function generateFractalPuzzle(
    cols: number,
    rows: number,
    imageSize: Size,
    seed: number,
    config?: FractalConfig,
): Piece[] {
    const random = createSeededRandom(seed);
    const minPieceSize = config?.minPieceSize ?? 2;
    const maxPieceSize = config?.maxPieceSize ?? 8;

    // Tile radius in abstract units. The actual pixel size is
    // determined by scaling in convertToStandardPieces.
    const rad = 6.0;
    const frameOffset = 0;

    // Create grid and generate pieces
    const grid = new CellGrid(cols, rows);
    const pieces: DiagonalConnection[][] = [];

    while (grid.nunvisited > 0) {
        const piece = createPiece(grid, minPieceSize, maxPieceSize, random);
        if (piece) {
            pieces.push(piece);
        }
    }

    // Regenerate grid state for hole-filling
    grid.reset();
    for (const p of pieces) {
        for (const c of p) {
            if (!grid.isTileVisited(c.p1)) grid.visitTile(c.p1);
            if (c.p2_taken && !grid.isTileVisited(c.p2)) grid.visitTile(c.p2);
            grid.occupyCell(c.cell);
        }
    }

    // Fill remaining holes
    while (fillHoles(grid, pieces, false)) { /* keep going */ }
    fillHoles(grid, pieces, true);

    // Convert to standard Piece[] format
    return convertToStandardPieces(pieces, rad, frameOffset, imageSize, cols, rows);
}
