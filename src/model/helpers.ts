/** Operate on the generic graph model — no grid or puzzle-shape assumptions. */

import type { Edge, GameState, Piece, PieceGroup, Point } from './types.js';

/** Pieces are immutable after generation; built once, never mutated. */
export function buildPiecesById(pieces: Piece[]): Map<number, Piece> {
    const map = new Map<number, Piece>();
    for (const piece of pieces) {
        map.set(piece.id, piece);
    }
    return map;
}

/**
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

/** Throws if not found. */
export function getPiece(state: GameState, pieceId: number): Piece {
    const piece = state.piecesById.get(pieceId);
    if (!piece) {
        throw new Error(`Piece ${pieceId} not found`);
    }
    return piece;
}

/** Throws if not found. */
export function getGroup(state: GameState, groupId: number): PieceGroup {
    const group = state.groupsById.get(groupId);
    if (!group) {
        throw new Error(`Group ${groupId} not found`);
    }
    return group;
}

/**
 * Undefined-returning variant, for when a missing group is valid (e.g. the
 * dragged group was absorbed by a merge).
 */
export function tryGetGroup(
    state: GameState,
    groupId: number,
): PieceGroup | undefined {
    return state.groupsById.get(groupId);
}

/** Throws if the piece is not in any group. */
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

/** Adds a group, keeping the indexes in sync. All growth of `state.groups` must go through here. */
export function addGroup(state: GameState, group: PieceGroup): void {
    state.groups.push(group);
    state.groupsById.set(group.id, group);
    for (const pieceId of group.pieces.keys()) {
        state.pieceToGroup.set(pieceId, group);
    }
}

/**
 * Removes a group, keeping the indexes in sync. Only clears `pieceToGroup`
 * entries still pointing at this group — pieces re-pointed elsewhere (e.g. by
 * `mergeGroups`) are left alone.
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

/** Returns `undefined` if the edge is a border edge (no mate). */
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
 * Rotate a point `degrees` clockwise around the origin. Accepts any float
 * (negative or out of `[0, 360)`); callers needing a normalized angle apply
 * `normalizeDegrees` themselves.
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

/** Normalize an unbounded degrees value into the range [0, 360). */
export function normalizeDegrees(deg: number): number {
    return ((deg % 360) + 360) % 360;
}

/**
 * Smallest signed delta `a − b` in degrees, wrap-aware, in `(-180, 180]`
 * (359→1 is `-2`, not `-358`). Positive when `a` leads `b` clockwise.
 */
export function signedAngularDelta(a: number, b: number): number {
    const raw = (((a - b) % 360) + 540) % 360 - 180;
    return raw === -180 ? 180 : raw;
}

/**
 * Project a point from a group's un-rotated local space to world space:
 * rotate by `group.rotation` about the group origin, then translate by
 * `group.position`. For points relative to a specific piece, use
 * `getWorldPosition` (it adds the piece offset first).
 */
export function localToWorld(local: Point, group: PieceGroup): Point {
    const rotated = rotatePoint(local, group.rotation);

    return {
        x: group.position.x + rotated.x,
        y: group.position.y + rotated.y,
    };
}

/**
 * Adds the piece's in-group offset to `point` (both in un-rotated local space),
 * then projects to world via `localToWorld`.
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
 * A group's border edges — those whose mate is in a different group. These are
 * the candidates for merge detection after a drop.
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
