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

import type { Edge, Piece, Size } from '../model/types.js';
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
    orphanDiscs: Array<{ tile: Tile; ownerPieceIdx: number }>,
    rad: number,
    frameOffset: number,
    imageSize: Size,
    gridCols: number,
    gridRows: number,
    borderless: boolean,
): Piece[] {
    // 1. Build main-contour arcs for each piece via the addArcs tree-walk.
    const allPieceArcs: ArcData[][] = [];
    for (const p of fractalPieces) {
        const arcs: ArcData[] = [];
        addArcs(p[0], p, arcs, rad, frameOffset, true);
        allPieceArcs.push(arcs);
    }

    // 2. Detect gap cells BEFORE scaling (while arc coords are in abstract space).
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
                // Find a neighboring piece that borders this cell
                const cx = con.cell.x;
                const cy = con.cell.y;
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

    // 3. Record the main-contour arc count per piece before appending any
    //    diamond-filler arcs. Shape construction later uses this to emit
    //    each diamond as its own closed sub-path (M…Z).
    const mainArcCount = allPieceArcs.map(arcs => arcs.length);

    // 4. Append four arcs per gap cell to the owner piece. Each diamond side
    //    is generated with sign=1 so it traverses the same geometric arc as
    //    the neighboring concave arc but in the opposite direction (and with
    //    the opposite sweep flag). That matches the start↔end invariant the
    //    merge-detection code expects of a mate pair. The sides are ordered
    //    so their endpoints chain into a closed loop:
    //      right → top → left → bottom → right.
    for (const [owner, gaps] of gapFills) {
        for (const { cellX, cellY } of gaps) {
            const sides: Array<{ tile: Tile; quad: number }> = [
                { tile: makeTile(cellX + 1, cellY), quad: 2 },     // right → top
                { tile: makeTile(cellX, cellY), quad: 3 },         // top → left
                { tile: makeTile(cellX, cellY + 1), quad: 0 },     // left → bottom
                { tile: makeTile(cellX + 1, cellY + 1), quad: 1 }, // bottom → right
            ];
            for (const { tile, quad } of sides) {
                allPieceArcs[owner].push(
                    makeArc(tile, rad, frameOffset, quad, 1),
                );
            }
        }
    }

    // 5. Append four concave arcs per orphan disc to its owner piece.
    //    The orphan tile has no diagonal to or from it, so addArcs never
    //    visits it; instead the owner piece (a neighbour whose diagonal
    //    occupies an adjacent cell) gets the disc as an extra closed
    //    sub-path. Ordering q=0,1,2,3 with sign=0 chains the four arcs
    //    right→top→left→bottom→right into a closed loop. Mates resolve
    //    through the arc index below — 1 or 2 arcs mate with convex arcs
    //    on the owner piece itself (intra-piece self-mates, filtered on
    //    exact identity only), and the remaining arcs sit on the puzzle
    //    outer border with mateEdgeId === -1.
    for (const { tile, ownerPieceIdx } of orphanDiscs) {
        for (let q = 0; q < 4; q++) {
            allPieceArcs[ownerPieceIdx].push(
                makeArc(tile, rad, frameOffset, q, 0),
            );
        }
    }

    // 6. Build an index of arcs by (cx, cy, quad) for mate lookup
    //    Must be done BEFORE scaling, using original abstract coordinates.
    //    Also store each arc's key so we can look it up after scaling.
    //    Runs after the diamond and disc arcs are appended so their keys —
    //    which match the corresponding concave arcs' keys — participate in
    //    mate lookup.
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

    // 6b. Precompute mateless status for each arc. A mateless arc is one
    //     whose (cx,cy,quad) key has no other arc referring to the same
    //     geometric location — i.e., the arc sits on the puzzle's outer
    //     border with no neighbouring tile across it. These are the arcs
    //     that must be trimmed away to produce a rectangular puzzle.
    const isMateless: boolean[][] = allPieceArcs.map((arcs, pi) =>
        arcs.map((_, ai) => {
            const candidates = arcIndex.get(arcKeys[pi][ai]) ?? [];
            return candidates.length === 1;
        }),
    );

    // 7. Scale and translate arcs so the puzzle fills the requested image.
    //    Non-borderless: fit the TRIMMED rectangle (shrunk by `rad` on each
    //    side, aligned with outer-row tile centres) to the image; mateless
    //    arcs live in the outer `rad`-wide strip and get replaced below
    //    with straight lines along the new border, giving pieces the "flat
    //    edge, no bumps" look. Borderless: fit the FULL puzzle bounds
    //    (`gridCols * 2 * rad`) to the image so the outer-row arcs sit at
    //    the image edges — pieces on the border keep their organic curves.
    const shift = borderless ? 0 : rad;
    const puzzleWidth = borderless
        ? gridCols * 2 * rad
        : (gridCols - 1) * 2 * rad;
    const puzzleHeight = borderless
        ? gridRows * 2 * rad
        : (gridRows - 1) * 2 * rad;
    const scaleX = imageSize.width / puzzleWidth;
    const scaleY = imageSize.height / puzzleHeight;

    for (const arcs of allPieceArcs) {
        for (const a of arcs) {
            a.sx = (a.sx - shift) * scaleX;
            a.ex = (a.ex - shift) * scaleX;
            a.cx = (a.cx - shift) * scaleX;
            a.sy = (a.sy - shift) * scaleY;
            a.ey = (a.ey - shift) * scaleY;
            a.cy = (a.cy - shift) * scaleY;
        }
    }

    // 8. Build edge ops for each sub-path, collapsing runs of consecutive
    //    mateless arcs into straight lines along the trimmed-rectangle
    //    border. For sub-paths on a puzzle corner the run may cross two
    //    adjacent border sides, in which case two line segments meet at
    //    the corner vertex.
    const rectBorder = {
        xMin: 0, yMin: 0,
        xMax: imageSize.width, yMax: imageSize.height,
    };

    interface ArcOp { type: 'arc'; pieceIdx: number; arcIdx: number }
    interface LineOp { type: 'line'; sx: number; sy: number; ex: number; ey: number }
    type Op = ArcOp | LineOp;

    const pieceSubPaths: Op[][][] = allPieceArcs.map(() => []);

    for (let pi = 0; pi < allPieceArcs.length; pi++) {
        const arcs = allPieceArcs[pi];
        if (arcs.length === 0) continue;

        // Sub-path ranges: main contour first, then each 4-arc extra
        // (diamond filler or orphan disc).
        const ranges: Array<[number, number]> = [];
        if (mainArcCount[pi] > 0) ranges.push([0, mainArcCount[pi]]);
        for (let k = mainArcCount[pi]; k < arcs.length; k += 4) {
            ranges.push([k, k + 4]);
        }

        for (const [spStart, spEnd] of ranges) {
            const n = spEnd - spStart;

            if (borderless) {
                // Keep every arc — outer-border arcs stay curved, so
                // pieces on the border are indistinguishable from interior
                // pieces by shape alone.
                const subOps: Op[] = [];
                for (let i = 0; i < n; i++) {
                    subOps.push({ type: 'arc', pieceIdx: pi, arcIdx: spStart + i });
                }
                pieceSubPaths[pi].push(subOps);
                continue;
            }

            // Rotate so the first arc in the sub-path is non-mateless.
            // Without this, a run that wraps around the sub-path's seam
            // would be split in two — and the leading line segment would
            // start outside the trimmed rectangle.
            let rot = 0;
            while (rot < n && isMateless[pi][spStart + rot]) rot++;
            if (rot === n) continue; // fully outside trimmed rectangle

            const subOps: Op[] = [];
            let i = 0;
            while (i < n) {
                const ai = spStart + ((i + rot) % n);
                if (!isMateless[pi][ai]) {
                    subOps.push({ type: 'arc', pieceIdx: pi, arcIdx: ai });
                    i++;
                    continue;
                }
                // Walk to end of run.
                let j = i;
                while (j < n && isMateless[pi][spStart + ((j + rot) % n)]) j++;
                const firstAi = spStart + ((i + rot) % n);
                const lastAi = spStart + ((j - 1 + rot) % n);
                const runStart = allPieceArcs[pi][firstAi];
                const runEnd = allPieceArcs[pi][lastAi];
                for (const ln of borderPathBetween(
                    runStart.sx, runStart.sy, runEnd.ex, runEnd.ey, rectBorder,
                )) {
                    subOps.push({ type: 'line', ...ln });
                }
                i = j;
            }

            pieceSubPaths[pi].push(subOps);
        }
    }

    // 9. Allocate edge IDs in sub-path order per piece, and build a map
    //    from original (pi, ai) to the new edge ID so arc-to-arc mate
    //    relationships carry over.
    let nextEdgeId = 0;
    const arcToEdgeId = new Map<string, number>();
    const subPathEdgeIds: number[][][] = pieceSubPaths.map(sps =>
        sps.map(ops => ops.map(op => {
            const edgeId = nextEdgeId++;
            if (op.type === 'arc') {
                arcToEdgeId.set(`${op.pieceIdx},${op.arcIdx}`, edgeId);
            }
            return edgeId;
        })),
    );

    // 10. Build each Piece.
    const pieces: Piece[] = [];
    for (let pi = 0; pi < pieceSubPaths.length; pi++) {
        const subPaths = pieceSubPaths[pi];
        if (subPaths.length === 0) continue;

        // Bounding box covers every op across every sub-path.
        let minX = Infinity, minY = Infinity;
        for (const sp of subPaths) {
            for (const op of sp) {
                if (op.type === 'arc') {
                    const a = allPieceArcs[op.pieceIdx][op.arcIdx];
                    minX = Math.min(minX, a.sx, a.ex);
                    minY = Math.min(minY, a.sy, a.ey);
                } else {
                    minX = Math.min(minX, op.sx, op.ex);
                    minY = Math.min(minY, op.sy, op.ey);
                }
            }
        }

        const edges: Edge[] = [];
        const shapeParts: string[] = [];

        for (let spi = 0; spi < subPaths.length; spi++) {
            const sp = subPaths[spi];
            const edgeIds = subPathEdgeIds[pi][spi];

            for (let oi = 0; oi < sp.length; oi++) {
                const op = sp[oi];
                const edgeId = edgeIds[oi];
                let sx: number, sy: number, ex: number, ey: number;
                let path: string;
                let mateEdgeId = -1;
                let matePieceId = -1;

                if (op.type === 'arc') {
                    const a = allPieceArcs[op.pieceIdx][op.arcIdx];
                    sx = a.sx; sy = a.sy; ex = a.ex; ey = a.ey;
                    const rx = a.r * scaleX;
                    const ry = a.r * scaleY;
                    path = `A ${fmt(rx)} ${fmt(ry)} 0 0,${a.sign} ${fmt(ex - minX)} ${fmt(ey - minY)}`;

                    const key = arcKeys[op.pieceIdx][op.arcIdx];
                    const candidates = arcIndex.get(key) ?? [];
                    for (const c of candidates) {
                        if (c.pieceIdx === op.pieceIdx && c.arcIdx === op.arcIdx) continue;
                        const mateId = arcToEdgeId.get(`${c.pieceIdx},${c.arcIdx}`);
                        if (mateId !== undefined) {
                            mateEdgeId = mateId;
                            matePieceId = c.pieceIdx;
                            break;
                        }
                    }
                } else {
                    sx = op.sx; sy = op.sy; ex = op.ex; ey = op.ey;
                    path = `L ${fmt(ex - minX)} ${fmt(ey - minY)}`;
                }

                if (oi === 0) {
                    shapeParts.push(`M ${fmt(sx - minX)} ${fmt(sy - minY)}`);
                }
                shapeParts.push(path);
                if (oi === sp.length - 1) {
                    shapeParts.push('Z');
                }

                edges.push({
                    id: edgeId,
                    mateEdgeId,
                    matePieceId,
                    path,
                    start: { x: sx - minX, y: sy - minY },
                    end: { x: ex - minX, y: ey - minY },
                });
            }
        }

        pieces.push({
            id: pi,
            edges,
            shape: shapeParts.join(' '),
            imageOffset: { x: -minX, y: -minY },
        });
    }

    return pieces;
}

/**
 * Walk the rectangle boundary from (px,py) to (qx,qy). Both points must
 * already lie on the boundary. Returns one line segment when they share
 * a side, or two (through the shared corner) when they don't. Used to
 * replace runs of mateless arcs in a trimmed sub-path.
 */
function borderPathBetween(
    px: number, py: number, qx: number, qy: number,
    rect: { xMin: number; yMin: number; xMax: number; yMax: number },
): Array<{ sx: number; sy: number; ex: number; ey: number }> {
    const eps = 1e-6;
    const onTop = (_x: number, y: number) => Math.abs(y - rect.yMin) < eps;
    const onBottom = (_x: number, y: number) => Math.abs(y - rect.yMax) < eps;
    const onLeft = (x: number, _y: number) => Math.abs(x - rect.xMin) < eps;
    const onRight = (x: number, _y: number) => Math.abs(x - rect.xMax) < eps;

    // Determine which border side each endpoint lies on. When a point
    // sits exactly on a corner it's on two sides — pick the one that
    // matches the other point's side, falling through to the corner-
    // bridging branch when neither does.
    const pSides = [
        ...(onTop(px, py) ? ['top'] : []),
        ...(onBottom(px, py) ? ['bottom'] : []),
        ...(onLeft(px, py) ? ['left'] : []),
        ...(onRight(px, py) ? ['right'] : []),
    ];
    const qSides = [
        ...(onTop(qx, qy) ? ['top'] : []),
        ...(onBottom(qx, qy) ? ['bottom'] : []),
        ...(onLeft(qx, qy) ? ['left'] : []),
        ...(onRight(qx, qy) ? ['right'] : []),
    ];

    const shared = pSides.find(s => qSides.includes(s));
    if (shared) {
        return [{ sx: px, sy: py, ex: qx, ey: qy }];
    }

    const corners: Array<[string, string, number, number]> = [
        ['top', 'left', rect.xMin, rect.yMin],
        ['top', 'right', rect.xMax, rect.yMin],
        ['bottom', 'left', rect.xMin, rect.yMax],
        ['bottom', 'right', rect.xMax, rect.yMax],
    ];
    for (const [s1, s2, cx, cy] of corners) {
        const match =
            (pSides.includes(s1) && qSides.includes(s2))
            || (pSides.includes(s2) && qSides.includes(s1));
        if (match) {
            return [
                { sx: px, sy: py, ex: cx, ey: cy },
                { sx: cx, sy: cy, ex: qx, ey: qy },
            ];
        }
    }

    // Fallback: endpoints are on opposite sides or not on the boundary.
    // This shouldn't happen for well-formed trimmed sub-paths, but draw
    // a direct line rather than failing outright.
    return [{ sx: px, sy: py, ex: qx, ey: qy }];
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
 * Orphan tiles (issue #224) are absorbed as disc sub-paths on an adjacent
 * piece, so they do not add to the piece count.
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
    /**
     * Borderless mode: keep curved outer edges and do not attach orphan-tile
     * discs to neighbour pieces. Makes the puzzle harder because no piece is
     * clearly identifiable as a border piece. Default: false.
     */
    borderless?: boolean;
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
    const borderless = config?.borderless ?? false;

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

    // Any tile still not attached to a piece — because all of its
    // diagonal cells are already occupied and no adoption path exists —
    // becomes a disc sub-path on an adjacent piece. Without this, the
    // tile's circular region is left uncovered in the puzzle (a literal
    // hole). The owner is the piece holding a diagonal in any adjacent
    // cell; empirically (>4000 discs sampled) every orphan's surrounding
    // diagonals belong to exactly one piece.
    const attached = new Set<string>();
    for (const p of pieces) {
        for (const c of p) {
            attached.add(`${c.p1.x},${c.p1.y}`);
            attached.add(`${c.p2.x},${c.p2.y}`);
        }
    }
    const orphanDiscs: Array<{ tile: Tile; ownerPieceIdx: number }> = [];
    if (!borderless) {
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (attached.has(`${x},${y}`)) continue;

                const ownerPieceIdx = findDiagonalOwner(pieces, x, y, cols, rows);
                if (ownerPieceIdx === -1) {
                    console.warn(
                        `[fractal] Orphan tile (${x},${y}) has no adjacent`
                        + ' piece; disc cannot be attached',
                    );
                    continue;
                }
                orphanDiscs.push({ tile: makeTile(x, y), ownerPieceIdx });
            }
        }
    }

    // Convert to standard Piece[] format
    return convertToStandardPieces(
        pieces, orphanDiscs, rad, frameOffset, imageSize, cols, rows, borderless,
    );
}

/**
 * Find the piece that owns any diagonal in a cell adjacent to (x,y).
 * Returns -1 if no adjacent cell contains a diagonal (shouldn't happen
 * for a true orphan — every orphan tile is boxed in by occupied cells).
 */
function findDiagonalOwner(
    pieces: DiagonalConnection[][],
    x: number, y: number,
    cols: number, rows: number,
): number {
    const adjCells = [
        { cx: x - 1, cy: y - 1 },
        { cx: x, cy: y - 1 },
        { cx: x - 1, cy: y },
        { cx: x, cy: y },
    ];
    for (const { cx, cy } of adjCells) {
        if (cx < 0 || cx >= cols - 1 || cy < 0 || cy >= rows - 1) continue;
        for (let pi = 0; pi < pieces.length; pi++) {
            if (pieces[pi].some(c => c.cell.x === cx && c.cell.y === cy)) {
                return pi;
            }
        }
    }

    return -1;
}
