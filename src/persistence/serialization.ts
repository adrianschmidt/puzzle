/**
 * Serialization helpers for GameState.
 *
 * GameState contains Maps (PieceGroup.pieces), which don't survive
 * JSON round-tripping. These helpers convert to/from a plain JSON-safe
 * representation.
 */

import type { GameState, PieceGroup, Point } from '../model/types.js';

/** Current schema version. Bump when the serialized shape changes. */
export const STATE_VERSION = 1;

/** A PieceGroup with its Map serialized as an entries array. */
export interface SerializedPieceGroup {
    id: number;
    pieces: Array<[number, Point]>;
    position: Point;
}

/** JSON-safe representation of a full game state, with a version tag. */
export interface SerializedGameState {
    version: number;
    pieces: GameState['pieces'];
    groups: SerializedPieceGroup[];
    imageUrl: string;
    completed: boolean;
}

/**
 * Convert a GameState to a JSON-safe object.
 *
 * Maps are converted to `[key, value][]` entries arrays.
 */
export function serializeState(state: GameState): SerializedGameState {
    return {
        version: STATE_VERSION,
        pieces: state.pieces,
        groups: state.groups.map(serializeGroup),
        imageUrl: state.imageUrl,
        completed: state.completed,
    };
}

/**
 * Restore a GameState from its serialized form.
 *
 * Validates the version tag and reconstructs Maps from entries arrays.
 * Throws if the data is invalid or the version is unsupported.
 */
export function deserializeState(data: SerializedGameState): GameState {
    if (data.version !== STATE_VERSION) {
        throw new Error(
            `Unsupported state version: ${data.version} (expected ${STATE_VERSION})`,
        );
    }

    validateSerializedState(data);

    return {
        pieces: data.pieces,
        groups: data.groups.map(deserializeGroup),
        imageUrl: data.imageUrl,
        completed: data.completed,
    };
}

function serializeGroup(group: PieceGroup): SerializedPieceGroup {
    return {
        id: group.id,
        pieces: Array.from(group.pieces.entries()),
        position: group.position,
    };
}

function deserializeGroup(group: SerializedPieceGroup): PieceGroup {
    return {
        id: group.id,
        pieces: new Map(group.pieces),
        position: group.position,
    };
}

/**
 * Basic structural validation of the serialized state.
 * Throws descriptive errors on invalid data.
 */
function validateSerializedState(data: SerializedGameState): void {
    if (!Array.isArray(data.pieces) || data.pieces.length === 0) {
        throw new Error('Invalid state: pieces must be a non-empty array');
    }

    if (!Array.isArray(data.groups) || data.groups.length === 0) {
        throw new Error('Invalid state: groups must be a non-empty array');
    }

    if (typeof data.imageUrl !== 'string' || data.imageUrl.length === 0) {
        throw new Error('Invalid state: imageUrl must be a non-empty string');
    }

    if (typeof data.completed !== 'boolean') {
        throw new Error('Invalid state: completed must be a boolean');
    }

    for (const group of data.groups) {
        if (typeof group.id !== 'number') {
            throw new Error('Invalid state: group id must be a number');
        }

        if (!Array.isArray(group.pieces) || group.pieces.length === 0) {
            throw new Error(
                `Invalid state: group ${group.id} must have at least one piece`,
            );
        }

        if (
            !Number.isFinite(group.position?.x) ||
            !Number.isFinite(group.position?.y)
        ) {
            throw new Error(
                `Invalid state: group ${group.id} must have a valid position`,
            );
        }
    }
}
