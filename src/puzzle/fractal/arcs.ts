/**
 * Arc generation for piece boundaries.
 *
 * `makeArc` builds a single quarter-circle arc; `addArcs` walks the
 * connection graph recursively to construct the full sequence of arcs
 * that bounds a piece.
 */

import type { ArcData, DiagonalConnection, Tile } from './types.js';
import { connectionFromQuad, connectionKey, makeTile } from './tile.js';

export function makeArc(
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

/**
 * Recursively build arcs for the piece containing `con`. Matches the
 * original algorithm exactly — convex arcs (sign=1) bound the piece's
 * own tiles, concave arcs (sign=0) wrap around neighbouring tiles
 * that belong to other pieces.
 */
export function addArcs(
    con: DiagonalConnection,
    connectionSet: Set<string>,
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
            if (connectionSet.has(connectionKey(pct))) {
                addArcs(pct, connectionSet, arcs, rad, frameOffset, false);
            } else if (connectionSet.has(connectionKey(pcnt))) {
                addArcs(pcnt, connectionSet, arcs, rad, frameOffset, false);
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
            if (connectionSet.has(connectionKey(pct))) {
                addArcs(pct, connectionSet, arcs, rad, frameOffset, false);
            } else if (connectionSet.has(connectionKey(pcnt))) {
                addArcs(pcnt, connectionSet, arcs, rad, frameOffset, false);
            } else {
                arcs.push(makeArc(con.p1, rad, frameOffset, q, 0));
            }
        }
    }
}
