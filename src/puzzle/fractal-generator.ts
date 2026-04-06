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
        return !this.cellmap[c.y * (this.nrow - 1) + c.x];
    }

    visitTile(v: Tile): void {
        const idx = v.y * this.nrow + v.x;
        if (!this.visited[idx]) {
            this.visited[idx] = true;
            this._nunvisited--;
        }
    }

    occupyCell(c: { x: number; y: number }): void {
        this.cellmap[c.y * (this.nrow - 1) + c.x] = true;
    }

    liberateCell(c: { x: number; y: number }): void {
        this.cellmap[c.y * (this.nrow - 1) + c.x] = false;
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

/**
 * Detect pinwheel/swastika shapes: a tile with connections spiralling
 * out in all 4 quadrants creates an unfortunate resemblance.
 * Returns true if the piece contains such a pattern.
 */
function hasPinwheelShape(connections: DiagonalConnection[]): boolean {
    // Build a map of which quadrants each tile connects FROM (as p1)
    const quadsByTile = new Map<string, Set<number>>();
    for (const c of connections) {
        const key = `${c.p1.x},${c.p1.y}`;
        let quads = quadsByTile.get(key);
        if (!quads) {
            quads = new Set();
            quadsByTile.set(key, quads);
        }
        quads.add(c.quad);
    }

    // A tile connecting in all 4 quadrants creates the pinwheel
    for (const quads of quadsByTile.values()) {
        if (quads.size >= 4) {
            return true;
        }
    }

    return false;
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

        // Reject connections that would create a pinwheel shape
        const tentative = [...myconnections, chosen];
        if (hasPinwheelShape(tentative)) {
            // Try another connection from the remaining candidates
            const alternatives = pcs.filter(p => p !== chosen);
            let found = false;
            for (const alt of alternatives) {
                const altTentative = [...myconnections, alt];
                if (!hasPinwheelShape(altTentative)) {
                    myconnections.push(alt);
                    mytiles.push(alt.p2);
                    grid.occupyCell(alt.cell);
                    grid.visitTile(alt.p2);
                    found = true;
                    break;
                }
            }
            if (!found) {
                // All options create a pinwheel — stop growing this piece
                break;
            }

            continue;
        }

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

/**
 * Find tiles that were visited but never made it into any piece,
 * and attach them to the nearest adjacent piece via a diagonal connection.
 */
function adoptOrphanTiles(
    grid: CellGrid,
    pieces: DiagonalConnection[][],
    cols: number,
    rows: number,
): void {
    // Build a set of all tiles that ARE in pieces
    const tilesInPieces = new Set<string>();
    for (const p of pieces) {
        tilesInPieces.add(`${p[0].p1.x},${p[0].p1.y}`);
        for (const c of p) {
            tilesInPieces.add(`${c.p2.x},${c.p2.y}`);
        }
    }

    // Find orphans: tiles in the grid that aren't in any piece
    const neighbors = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    let changed = true;
    while (changed) {
        changed = false;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const key = `${x},${y}`;
                if (tilesInPieces.has(key)) continue;

                // This tile is an orphan — try to connect it to an adjacent piece
                const orphan = makeTile(x, y);
                for (const n of neighbors) {
                    const adj = makeTile(x + n[0], y + n[1]);
                    const adjKey = `${adj.x},${adj.y}`;
                    if (!grid.isTileValid(adj) || !tilesInPieces.has(adjKey)) continue;

                    // Check if the cell between them is free
                    const dc = makeConnection(adj, orphan, true);
                    if (!grid.isCellEmpty(dc.cell)) continue;

                    // Find which piece the adjacent tile belongs to
                    for (const p of pieces) {
                        const allTiles: Tile[] = [p[0].p1];
                        for (const c of p) allTiles.push(c.p2);

                        if (allTiles.find(t => tileEq(t, adj))) {
                            // Add the orphan to this piece
                            p.push(dc);
                            grid.occupyCell(dc.cell);
                            grid.visitTile(orphan);
                            tilesInPieces.add(key);
                            changed = true;
                            break;
                        }
                    }
                    if (tilesInPieces.has(key)) break;
                }
            }
        }
    }
}

/**
 * Fill empty cells by adding diagonal connections through them.
 * A cell at (cx, cy) has 4 corner tiles: (cx,cy), (cx+1,cy),
 * (cx,cy+1), (cx+1,cy+1). An empty cell means no diagonal
 * connection passes through it, leaving a visible star-shaped hole.
 * We fix this by adding a connection between two corner tiles
 * that belong to the same piece (or to any piece if needed).
 */
function fillEmptyCells(
    grid: CellGrid,
    pieces: DiagonalConnection[][],
    cols: number,
    rows: number,
): void {
    // Build a map of tile → piece index for quick lookup
    const tileToPiece = new Map<string, number>();
    for (let pi = 0; pi < pieces.length; pi++) {
        const p = pieces[pi];
        tileToPiece.set(`${p[0].p1.x},${p[0].p1.y}`, pi);
        for (const c of p) {
            tileToPiece.set(`${c.p2.x},${c.p2.y}`, pi);
        }
    }

    for (let cy = 0; cy < rows - 1; cy++) {
        for (let cx = 0; cx < cols - 1; cx++) {
            if (!grid.isCellEmpty({ x: cx, y: cy })) continue;

            // Try both diagonals through this cell
            const diagonals: [Tile, Tile][] = [
                [makeTile(cx, cy), makeTile(cx + 1, cy + 1)],
                [makeTile(cx + 1, cy), makeTile(cx, cy + 1)],
            ];

            let filled = false;
            for (const [t1, t2] of diagonals) {
                const k1 = `${t1.x},${t1.y}`;
                const k2 = `${t2.x},${t2.y}`;
                const pi1 = tileToPiece.get(k1);
                const pi2 = tileToPiece.get(k2);

                if (pi1 === undefined && pi2 === undefined) continue;

                // Prefer connecting within the same piece
                // Otherwise add to whichever piece owns a corner tile
                const targetPi = pi1 !== undefined ? pi1 : pi2!;
                const from = pi1 !== undefined ? t1 : t2;
                const to = pi1 !== undefined ? t2 : t1;
                const dc = makeConnection(from, to, tileToPiece.has(`${to.x},${to.y}`));

                pieces[targetPi].push(dc);
                grid.occupyCell(dc.cell);
                if (!grid.isTileVisited(to)) grid.visitTile(to);
                if (!tileToPiece.has(`${to.x},${to.y}`)) {
                    tileToPiece.set(`${to.x},${to.y}`, targetPi);
                }
                filled = true;
                break;
            }

            if (!filled) {
                // Neither diagonal has a tile in a piece — log for debugging
                console.warn(`[fractal] Could not fill cell (${cx},${cy}). Corner tiles:`,
                    diagonals.map(([t1, t2]) =>
                        `(${t1.x},${t1.y}):pi=${tileToPiece.get(`${t1.x},${t1.y}`) ?? 'none'} ↔ (${t2.x},${t2.y}):pi=${tileToPiece.get(`${t2.x},${t2.y}`) ?? 'none'}`
                    ).join(', '));
            }
        }
    }
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

    // 3. Detect gap cells BEFORE scaling (while arc coords are in abstract space).
    //    addArcs is a recursive tree-walk from p[0] that may miss connections
    //    added by fillEmptyCells. A convex arc (sign=1) at tile (tx,ty)
    //    quadrant q covers the adjacent cell:
    //      q=0 → (tx, ty-1), q=1 → (tx-1, ty-1),
    //      q=2 → (tx-1, ty), q=3 → (tx, ty)
    const coveredCells = new Set<string>();
    for (const arcs of allPieceArcs) {
        for (const a of arcs) {
            if (a.sign !== 1) continue;
            const tx = Math.round((a.cx - rad - frameOffset) / (2 * rad));
            const ty = Math.round((a.cy - rad - frameOffset) / (2 * rad));
            let cx: number, cy: number;
            switch (a.quad) {
                case 0: cx = tx; cy = ty - 1; break;
                case 1: cx = tx - 1; cy = ty - 1; break;
                case 2: cx = tx - 1; cy = ty; break;
                case 3: cx = tx; cy = ty; break;
                default: continue;
            }
            coveredCells.add(`${cx},${cy}`);
        }
    }

    // Build a map of piece index → gap cells to fill with diamond fillers.
    // For ownership, find a piece that has a concave arc bordering this cell
    // (i.e., the piece whose boundary actually touches the gap).
    // Cell (cx,cy) is bordered by concave arcs at:
    //   tile(cx,cy) q=3, tile(cx+1,cy) q=2, tile(cx,cy+1) q=0, tile(cx+1,cy+1) q=1
    const concaveArcOwner = new Map<string, number>(); // "tx,ty,q" → pieceIdx
    for (let pi = 0; pi < allPieceArcs.length; pi++) {
        for (const a of allPieceArcs[pi]) {
            if (a.sign !== 0) continue;
            const tx = Math.round((a.cx - rad - frameOffset) / (2 * rad));
            const ty = Math.round((a.cy - rad - frameOffset) / (2 * rad));
            concaveArcOwner.set(`${tx},${ty},${a.quad}`, pi);
        }
    }

    const gapFills = new Map<number, Array<{ cellX: number; cellY: number }>>();
    for (let pi = 0; pi < fractalPieces.length; pi++) {
        for (const con of fractalPieces[pi]) {
            const key = `${con.cell.x},${con.cell.y}`;
            if (!coveredCells.has(key)) {
                const cx = con.cell.x;
                const cy = con.cell.y;

                // Skip boundary-adjacent cells: cells with any corner tile
                // on the grid edge are visually covered by the straightened
                // border, so diamond fillers would create extra artifacts.
                if (cx <= 0 || cx + 1 >= gridCols - 1 ||
                    cy <= 0 || cy + 1 >= gridRows - 1) {
                    coveredCells.add(key);
                    continue;
                }

                // Find a neighboring piece that borders this cell
                const borderArcs = [
                    `${cx},${cy},3`,       // tile(cx,cy) q=3
                    `${cx + 1},${cy},2`,   // tile(cx+1,cy) q=2
                    `${cx},${cy + 1},0`,   // tile(cx,cy+1) q=0
                    `${cx + 1},${cy + 1},1`, // tile(cx+1,cy+1) q=1
                ];

                let owner = pi; // fallback to connection owner
                for (const arcKey of borderArcs) {
                    const arcOwner = concaveArcOwner.get(arcKey);
                    if (arcOwner !== undefined) {
                        owner = arcOwner;
                        break;
                    }
                }

                if (!gapFills.has(owner)) gapFills.set(owner, []);
                gapFills.get(owner)!.push({ cellX: cx, cellY: cy });
                coveredCells.add(key); // Only fill once
            }
        }
    }

    // 4. Scale all arc coordinates to image pixel space.
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

    // 5. Convert each piece
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

            // Compute the outward corner: the cell corner the arc curves through.
            // For a border arc this corner lies on the puzzle boundary rectangle;
            // for an interior unmatched arc (gap-filler boundary) it does not.
            let cornerX: number, cornerY: number;
            switch (a.quad) {
                case 0: cornerX = a.cx + rx; cornerY = a.cy - ry; break;
                case 1: cornerX = a.cx - rx; cornerY = a.cy - ry; break;
                case 2: cornerX = a.cx - rx; cornerY = a.cy + ry; break;
                default: cornerX = a.cx + rx; cornerY = a.cy + ry; break;
            }

            // An arc is a boundary arc when its outward corner lies on the
            // puzzle boundary rectangle. This works for both mated and unmated
            // arcs: boundary tiles have corners at x=0, x=W, y=0, or y=H,
            // while interior tile corners are always strictly inside.
            // For mated boundary arcs, both sides (sign=0 and sign=1) get
            // straightened consistently — their shared corner is on the
            // boundary, so both pieces end up with straight edges there.
            const eps = 0.5;
            const isOuterBorder =
                cornerX < eps || cornerX > imageSize.width - eps ||
                cornerY < eps || cornerY > imageSize.height - eps;

            const localCornerX = cornerX - minX;
            const localCornerY = cornerY - minY;

            let path: string;
            if (isOuterBorder) {
                // Replace the outward-bulging arc with two straight lines that
                // follow the puzzle boundary rectangle: first to the boundary
                // corner, then to the arc's original endpoint.
                path = `L ${fmt(localCornerX)} ${fmt(localCornerY)} L ${fmt(localEx)} ${fmt(localEy)}`;
            } else {
                path = `A ${fmt(rx)} ${fmt(ry)} 0 0,${a.sign} ${fmt(localEx)} ${fmt(localEy)}`;
            }

            edges.push({
                id: edgeId,
                mateEdgeId,
                matePieceId,
                path,
                start: { x: localSx, y: localSy },
                end: { x: localEx, y: localEy },
                _isOuterBorder: isOuterBorder,
                _localCornerX: localCornerX,
                _localCornerY: localCornerY,
            } as Edge & { _isOuterBorder: boolean; _localCornerX: number; _localCornerY: number });
        }

        // Shape: M + all arc paths + Z
        // When consecutive boundary arcs have interior arcs between them,
        // the path dips interior creating V-shaped notches. To produce
        // clean straight borders, we trace only the boundary corners and
        // skip the interior V-notch arcs between them.
        //
        // Strategy: identify the "interior section" of the edge loop (the
        // longest run of consecutive non-boundary edges) and keep those
        // as-is. Everything else is the "boundary section" where we emit
        // only boundary corner points, skipping V-notch arcs.
        type ExtEdge = Edge & { _isOuterBorder: boolean; _localCornerX: number; _localCornerY: number };
        const n = edges.length;
        const isBoundary = edges.map(e => (e as ExtEdge)._isOuterBorder);
        const hasBoundary = isBoundary.some(b => b);

        // Find the longest run of consecutive non-boundary edges.
        // This is the interior contour that must be preserved.
        let bestRunStart = 0;
        let bestRunLen = 0;
        if (hasBoundary) {
            for (let start = 0; start < n; start++) {
                if (isBoundary[start]) continue;
                let len = 0;
                while (len < n && !isBoundary[(start + len) % n]) len++;
                if (len > bestRunLen) {
                    bestRunLen = len;
                    bestRunStart = start;
                }
            }
        }

        // Mark edges: those in the longest non-boundary run are "interior"
        // (emit as-is); all others are "boundary section" (emit corner
        // for boundary edges, skip non-boundary V-notch edges).
        const inInteriorRun = new Array(n).fill(false);
        if (hasBoundary) {
            for (let j = 0; j < bestRunLen; j++) {
                inInteriorRun[(bestRunStart + j) % n] = true;
            }
        }

        // Helper: determine which side of the rectangle a corner is on.
        // Returns 'T','R','B','L' (or two letters for exact rectangle corners).
        const W = imageSize.width;
        const H = imageSize.height;
        const bEps = 1;
        function borderSide(cx: number, cy: number): string {
            let s = '';
            if (cy < bEps) s += 'T';
            if (cx > W - bEps) s += 'R';
            if (cy > H - bEps) s += 'B';
            if (cx < bEps) s += 'L';
            return s;
        }

        // Rectangle corners in local coords, keyed by the two sides they join
        const rectCorners: Record<string, {x: number, y: number}> = {
            TL: { x: 0 - minX, y: 0 - minY },
            TR: { x: W - minX, y: 0 - minY },
            BR: { x: W - minX, y: H - minY },
            BL: { x: 0 - minX, y: H - minY },
        };

        // Insert rectangle corner points when the boundary path
        // transitions between different sides of the rectangle.
        function addRectCornersBetween(
            parts: string[],
            prevAbsX: number, prevAbsY: number,
            nextAbsX: number, nextAbsY: number,
        ): void {
            const s1 = borderSide(prevAbsX, prevAbsY);
            const s2 = borderSide(nextAbsX, nextAbsY);
            if (s1 === s2) return; // same side, no corner needed
            // Find corners that join s1 and s2
            const needed: string[] = [];
            if ((s1.includes('T') && s2.includes('L')) ||
                (s1.includes('L') && s2.includes('T')))
                needed.push('TL');
            if ((s1.includes('T') && s2.includes('R')) ||
                (s1.includes('R') && s2.includes('T')))
                needed.push('TR');
            if ((s1.includes('B') && s2.includes('R')) ||
                (s1.includes('R') && s2.includes('B')))
                needed.push('BR');
            if ((s1.includes('B') && s2.includes('L')) ||
                (s1.includes('L') && s2.includes('B')))
                needed.push('BL');
            for (const key of needed) {
                const c = rectCorners[key];
                parts.push(`L ${fmt(c.x)} ${fmt(c.y)}`);
            }
        }

        // Start the path from the interior run so the boundary section
        // is processed as one contiguous block (no wrap-around issues).
        const startIdx = hasBoundary ? bestRunStart : 0;
        const startEdge = edges[startIdx];
        const shapeParts = [`M ${fmt(startEdge.start.x)} ${fmt(startEdge.start.y)}`];
        let lastBorderCornerAbsX = NaN;
        let lastBorderCornerAbsY = NaN;
        for (let j = 0; j < n; j++) {
            const i = (startIdx + j) % n;
            const ext = edges[i] as ExtEdge;
            if (!hasBoundary || inInteriorRun[i]) {
                // Interior contour edge — emit as-is
                shapeParts.push(ext.path);
            } else if (ext._isOuterBorder) {
                const absCornerX = ext._localCornerX + minX;
                const absCornerY = ext._localCornerY + minY;
                // If previous boundary corner was on a different side,
                // add the rectangle corner between them.
                if (!isNaN(lastBorderCornerAbsX)) {
                    addRectCornersBetween(
                        shapeParts,
                        lastBorderCornerAbsX, lastBorderCornerAbsY,
                        absCornerX, absCornerY,
                    );
                }
                shapeParts.push(`L ${fmt(ext._localCornerX)} ${fmt(ext._localCornerY)}`);
                lastBorderCornerAbsX = absCornerX;
                lastBorderCornerAbsY = absCornerY;
            } else if (ext.mateEdgeId !== -1) {
                // Mated non-boundary arc in the boundary section — this
                // defines a real border with a neighboring piece and must
                // be kept.  Emit an L to the arc's start first: previous
                // skipped V-notch arcs may have left the cursor behind.
                shapeParts.push(`L ${fmt(ext.start.x)} ${fmt(ext.start.y)}`);
                shapeParts.push(ext.path);
            }
            // else: unmated V-notch arc in the boundary section — skip
        }
        shapeParts.push('Z');

        // Append diamond filler sub-paths for gap cells owned by this piece.
        // Each gap cell at (cellX, cellY) has 4 edge midpoints:
        //   top:    ((cellX+1)*spacing, cellY*spacing + rad) — in abstract coords
        //   right:  ((cellX+1)*spacing + rad, (cellY+1)*spacing)
        //   bottom: ((cellX+1)*spacing, (cellY+1)*spacing + rad)
        //   left:   (cellX*spacing + rad, (cellY+1)*spacing)
        // where spacing = 2*rad. Connected by 4 convex quarter-circle arcs.
        const gaps = gapFills.get(pi);
        if (gaps) {
            const spacing = 2 * rad;
            for (const { cellX, cellY } of gaps) {
                // Midpoints in pixel coords
                const top = {
                    x: (cellX + 1) * spacing * scaleX - minX,
                    y: (cellY * spacing + rad) * scaleY - minY,
                };
                const right = {
                    x: ((cellX + 1) * spacing + rad) * scaleX - minX,
                    y: (cellY + 1) * spacing * scaleY - minY,
                };
                const bottom = {
                    x: (cellX + 1) * spacing * scaleX - minX,
                    y: ((cellY + 1) * spacing + rad) * scaleY - minY,
                };
                const left = {
                    x: (cellX * spacing + rad) * scaleX - minX,
                    y: (cellY + 1) * spacing * scaleY - minY,
                };
                const rx = rad * scaleX;
                const ry = rad * scaleY;

                // Star filler: top → right → bottom → left → close
                // Each segment is a concave quarter-circle arc (sweep=0),
                // curving inward to create the four-pointed star shape
                // that matches the gap geometry.
                shapeParts.push(
                    `M ${fmt(top.x)} ${fmt(top.y)}`,
                    `A ${fmt(rx)} ${fmt(ry)} 0 0,0 ${fmt(right.x)} ${fmt(right.y)}`,
                    `A ${fmt(rx)} ${fmt(ry)} 0 0,0 ${fmt(bottom.x)} ${fmt(bottom.y)}`,
                    `A ${fmt(rx)} ${fmt(ry)} 0 0,0 ${fmt(left.x)} ${fmt(left.y)}`,
                    `A ${fmt(rx)} ${fmt(ry)} 0 0,0 ${fmt(top.x)} ${fmt(top.y)}`,
                    'Z',
                );
            }
        }

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
// Fractal grid scaling
// ---------------------------------------------------------------------------

/**
 * Average number of tiles consumed per piece in the fractal generator.
 * Empirically measured across many seeds with default piece-size params.
 */
const TILES_PER_PIECE = 4.9;

/**
 * Compute tile-grid dimensions that produce approximately `targetPieces`
 * fractal pieces while matching the aspect ratio of the puzzle image.
 *
 * @param targetPieces - Desired number of pieces (e.g. 24, 48, 96, 192)
 * @param imageAspect  - Image width / height (e.g. 4/3 ≈ 1.333)
 * @returns `{ cols, rows }` for the tile grid
 */
export function scaleFractalGrid(
    targetPieces: number,
    imageAspect: number,
): { cols: number; rows: number } {
    // Total tiles needed ≈ targetPieces × tilesPerPiece
    const totalTiles = targetPieces * TILES_PER_PIECE;

    // Solve cols × rows = totalTiles with cols/rows = imageAspect
    //   cols = sqrt(totalTiles × imageAspect)
    //   rows = totalTiles / cols
    const rawCols = Math.sqrt(totalTiles * imageAspect);
    const rawRows = totalTiles / rawCols;

    // Round to even numbers (≥ 4) for symmetric grids
    const cols = Math.max(4, 2 * Math.round(rawCols / 2));
    const rows = Math.max(4, 2 * Math.round(rawRows / 2));

    return { cols, rows };
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

    // Adopt orphan tiles: tiles that were visited but never ended up in
    // a piece (e.g. because the piece was too small and got discarded).
    // For each orphan, find an adjacent piece and add a connection to it.
    adoptOrphanTiles(grid, pieces, cols, rows);

    // Fill any remaining empty cells (star-shaped holes)
    fillEmptyCells(grid, pieces, cols, rows);

    // Convert to standard Piece[] format
    return convertToStandardPieces(pieces, rad, frameOffset, imageSize, cols, rows);
}
