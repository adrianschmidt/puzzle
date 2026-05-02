/**
 * Piece growth via flood-fill on diagonal connections.
 *
 * Pipeline order:
 *   1. createPiece — grow one piece from a random empty tile.
 *   2. fillHoles  — extend existing pieces into any remaining slack.
 *   3. adoptOrphanTiles — attach visited-but-unassigned tiles to a
 *      neighbour piece via a fresh diagonal.
 *   4. fillEmptyCells — close star-shaped gaps left between pieces.
 */

import { diagnostics } from '../../diagnostics.js';
import type { CellGrid } from './cell-grid.js';
import type { DiagonalConnection, Tile } from './types.js';
import { makeConnection, makeTile, tileEq } from './tile.js';

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

export function createPiece(
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

export function fillHoles(
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
export function adoptOrphanTiles(
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
export function fillEmptyCells(
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
                diagnostics.warn(`[fractal] Could not fill cell (${cx},${cy}). Corner tiles:`,
                    diagonals.map(([t1, t2]) =>
                        `(${t1.x},${t1.y}):pi=${tileToPiece.get(`${t1.x},${t1.y}`) ?? 'none'} ↔ (${t2.x},${t2.y}):pi=${tileToPiece.get(`${t2.x},${t2.y}`) ?? 'none'}`
                    ).join(', '));
            }
        }
    }
}
