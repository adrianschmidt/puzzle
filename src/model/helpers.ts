/**
 * Helper functions for the puzzle data model.
 *
 * These operate on the generic graph-based model
 * and know nothing about grids or specific puzzle shapes.
 */

import type { Edge, GameState, Piece, PieceGroup, Point } from './types.js';

/**
 * Build the `piecesById` index for a freshly constructed pieces array.
 *
 * Pieces are immutable after generation, so this Map is built once and
 * never mutated. Used by `createNewGame`, `deserializeState`, and tests.
 */
export function buildPiecesById(pieces: Piece[]): Map<number, Piece> {
    const map = new Map<number, Piece>();
    for (const piece of pieces) {
        map.set(piece.id, piece);
    }
    return map;
}

/**
 * Build the `groupsById` and `pieceToGroup` indexes for a list of groups.
 *
 * Used at construction time and after wholesale group rebuilds. Incremental
 * mutations should use `addGroup` / `removeGroup` / `mergeGroups` instead.
 */
export function buildGroupIndexes(groups: PieceGroup[]): {
    groupsById: Map<number, PieceGroup>;
    pieceToGroup: Map<number, PieceGroup>;
} {
    const groupsById = new Map<number, PieceGroup>();
    const pieceToGroup = new Map<number, PieceGroup>();
    for (const group of groups) {
        groupsById.set(group.id, group);
        for (const pieceId of group.pieces.keys()) {
            pieceToGroup.set(pieceId, group);
        }
    }
    return { groupsById, pieceToGroup };
}

/**
 * Look up a piece by id. Throws if not found.
 */
export function getPiece(state: GameState, pieceId: number): Piece {
    const piece = state.piecesById.get(pieceId);
    if (!piece) {
        throw new Error(`Piece ${pieceId} not found`);
    }
    return piece;
}

/**
 * Look up a group by id. Throws if not found.
 */
export function getGroup(state: GameState, groupId: number): PieceGroup {
    const group = state.groupsById.get(groupId);
    if (!group) {
        throw new Error(`Group ${groupId} not found`);
    }
    return group;
}

/**
 * Look up a group by id, returning `undefined` if not found.
 *
 * Use when the absence of a group is a valid outcome (e.g. defensive
 * checks during pointer events, where the dragged group may have been
 * absorbed by a merge).
 */
export function tryGetGroup(
    state: GameState,
    groupId: number,
): PieceGroup | undefined {
    return state.groupsById.get(groupId);
}

/**
 * Find the group that contains a given piece. Throws if the piece is
 * not in any group.
 */
export function getGroupForPiece(
    state: GameState,
    pieceId: number,
): PieceGroup {
    const group = state.pieceToGroup.get(pieceId);
    if (!group) {
        throw new Error(`Piece ${pieceId} is not in any group`);
    }
    return group;
}

/**
 * Add a group to the state, keeping the indexes in sync.
 *
 * All callers that grow `state.groups` must go through this helper.
 */
export function addGroup(state: GameState, group: PieceGroup): void {
    state.groups.push(group);
    state.groupsById.set(group.id, group);
    for (const pieceId of group.pieces.keys()) {
        state.pieceToGroup.set(pieceId, group);
    }
}

/**
 * Remove a group from the state, keeping the indexes in sync.
 *
 * Removes the `pieceToGroup` entries only for pieces still recorded as
 * belonging to this group — pieces that have been re-pointed to a
 * different group (e.g. after `mergeGroups`) are not touched.
 */
export function removeGroup(state: GameState, groupId: number): void {
    const group = state.groupsById.get(groupId);
    if (!group) return;

    const index = state.groups.indexOf(group);
    if (index !== -1) {
        state.groups.splice(index, 1);
    }
    state.groupsById.delete(groupId);
    for (const pieceId of group.pieces.keys()) {
        if (state.pieceToGroup.get(pieceId) === group) {
            state.pieceToGroup.delete(pieceId);
        }
    }
}

/**
 * Find the mate edge for a given piece's edge.
 *
 * Returns the mate piece and its corresponding edge,
 * or `undefined` if the edge is a border edge (no mate).
 */
export function getMateEdge(
    _piece: Piece,
    edge: Edge,
    state: GameState,
): { piece: Piece; edge: Edge } | undefined {
    if (edge.matePieceId === -1 || edge.mateEdgeId === -1) {
        return undefined;
    }

    const matePiece = getPiece(state, edge.matePieceId);
    const mateEdge = matePiece.edges.find((e) => e.id === edge.mateEdgeId);

    if (!mateEdge) {
        throw new Error(
            `Mate edge ${edge.mateEdgeId} not found on piece ${matePiece.id}`,
        );
    }

    return { piece: matePiece, edge: mateEdge };
}

/**
 * Move a group by a delta, mutating its position in place.
 */
export function moveGroup(
    group: PieceGroup,
    delta: Point,
): void {
    group.position = {
        x: group.position.x + delta.x,
        y: group.position.y + delta.y,
    };
}

/**
 * Rotate a point by `degrees` clockwise around the origin.
 *
 * Used for converting between a group's un-rotated local space and its
 * rotated world projection. Accepts any float (positive, negative, or out
 * of `[0, 360)` range) — callers that need a normalized group rotation
 * should pass values through `normalizeDegrees` themselves.
 */
export function rotatePoint(point: Point, degrees: number): Point {
    const rad = (degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
        x: point.x * cos - point.y * sin,
        y: point.x * sin + point.y * cos,
    };
}

/**
 * Normalize an unbounded degrees value into the range [0, 360).
 *
 * Accepts negative or large positive inputs and returns a non-negative
 * value strictly less than 360. Preserves fractional precision.
 */
export function normalizeDegrees(deg: number): number {
    return ((deg % 360) + 360) % 360;
}

/**
 * Smallest signed angular delta from `b` to `a` in degrees, in the
 * half-open range `(-180, 180]`.
 *
 * Wrap-aware: the delta between 359° and 1° is `-2`, not `-358`. Useful
 * for tolerance comparisons (e.g. `Math.abs(signedAngularDelta(...)) < 10`).
 *
 * `a − b` is the convention: positive when `a` is "ahead" of `b` going
 * clockwise.
 */
export function signedAngularDelta(a: number, b: number): number {
    const raw = (((a - b) % 360) + 540) % 360 - 180;
    return raw === -180 ? 180 : raw;
}

/**
 * Project a point from a group's un-rotated local space into world space.
 *
 * Applies `group.rotation` around the group's own origin, then translates
 * by `group.position`. The input is assumed to already be in the group's
 * piece-offset frame (so for points expressed relative to a specific piece,
 * use `getWorldPosition` instead, which adds the piece offset first).
 */
export function localToWorld(local: Point, group: PieceGroup): Point {
    const rotated = rotatePoint(local, group.rotation);

    return {
        x: group.position.x + rotated.x,
        y: group.position.y + rotated.y,
    };
}

/**
 * Compute the world position of a point on a piece.
 *
 * Piece offsets and edge endpoints live in the group's un-rotated local
 * space. The point is shifted by the piece's offset within the group, then
 * projected to world space via `localToWorld`.
 */
export function getWorldPosition(
    point: Point,
    pieceId: number,
    group: PieceGroup,
): Point {
    const offset = group.pieces.get(pieceId);
    if (!offset) {
        throw new Error(`Piece ${pieceId} not found in group ${group.id}`);
    }

    return localToWorld(
        { x: offset.x + point.x, y: offset.y + point.y },
        group,
    );
}

/**
 * A border edge of a group paired with its mate in another group —
 * one element of the {@link getBorderEdges} result.
 */
export interface GroupBorderEdge {
    piece: Piece;
    edge: Edge;
    matePiece: Piece;
    mateEdge: Edge;
    mateGroup: PieceGroup;
}

/**
 * Get all border edges of a group — edges whose mates
 * are in a different group.
 *
 * These are the candidates for merge detection after a drop.
 * Each result includes the piece and edge within the group,
 * plus the mate piece and edge in the other group.
 */
export function getBorderEdges(
    group: PieceGroup,
    state: GameState,
): GroupBorderEdge[] {
    const results: GroupBorderEdge[] = [];

    for (const pieceId of group.pieces.keys()) {
        const piece = getPiece(state, pieceId);

        for (const edge of piece.edges) {
            const mate = getMateEdge(piece, edge, state);

            if (!mate) {
                continue; // border edge of the puzzle itself
            }

            // Is the mate in a different group?
            const mateGroup = getGroupForPiece(state, mate.piece.id);

            if (mateGroup.id !== group.id) {
                results.push({
                    piece,
                    edge,
                    matePiece: mate.piece,
                    mateEdge: mate.edge,
                    mateGroup,
                });
            }
        }
    }

    return results;
}
