/**
 * Helpers for the Tile and DiagonalConnection value types.
 */

import type { DiagonalConnection, Tile } from './types.js';

export function tileEq(a: Tile, b: Tile): boolean {
    return a.x === b.x && a.y === b.y;
}

export function makeTile(x: number, y: number): Tile {
    return { x, y, hasconnections: true };
}

export function makeConnection(p1: Tile, p2: Tile, p2_taken: boolean): DiagonalConnection {
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

export function connectionFromQuad(p1: Tile, quadrant: number, p2_taken: boolean): DiagonalConnection {
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

export function connectionKey(c: DiagonalConnection): string {
    return `${c.cell.x},${c.cell.y},${c.slope},${c.p2_taken}`;
}
