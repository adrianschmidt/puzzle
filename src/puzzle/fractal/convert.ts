/**
 * Convert fractal pieces (DiagonalConnection lists) to standard Piece[]
 * with full Edge mate relationships for merge detection.
 *
 * This is the largest stage of the pipeline. The work splits into:
 *   1. Build main-contour arcs per piece via the recursive addArcs walk.
 *   2. Detect cells the walk missed (gaps) and append diamond-filler arcs.
 *   3. Append concave arcs for each orphan disc.
 *   4. Index arcs by (cx, cy, quad) to find mates.
 *   5. Scale and translate arcs into image-space.
 *   6. Build edge ops per sub-path, collapsing mateless arc runs into
 *      straight border lines (non-borderless puzzles only).
 *   7. Allocate edge IDs and emit the final Piece[].
 */

import type { Edge, Piece, Size } from '../../model/types.js';
import { fmt } from '../composable/bezier-path.js';
import type { ArcData, DiagonalConnection, Tile } from './types.js';
import { connectionKey, makeTile } from './tile.js';
import { addArcs, makeArc } from './arcs.js';

/**
 * Build arcs for all pieces, then convert each piece's arc sequence
 * into Edge[] with proper mate relationships.
 *
 * Two arcs are "mates" when they share the same centre + quadrant
 * but belong to different pieces (one has sign=0, the other sign=1).
 */
export function convertToStandardPieces(
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
    //    addArcs probes for sibling connections by key, so build a Set
    //    once per piece for O(1) membership instead of O(n) Array.find.
    const allPieceArcs: ArcData[][] = [];
    for (const p of fractalPieces) {
        const arcs: ArcData[] = [];
        const connectionSet = new Set<string>();
        for (const c of p) connectionSet.add(connectionKey(c));
        addArcs(p[0], connectionSet, arcs, rad, frameOffset, true);
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
