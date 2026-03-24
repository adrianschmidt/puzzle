/**
 * Serialization helpers for GameState.
 *
 * GameState contains Maps (PieceGroup.pieces), which don't survive
 * JSON round-tripping. These helpers convert to/from a plain JSON-safe
 * representation.
 */

import type {
    GameState,
    GridSize,
    ImageAttribution,
    PieceGroup,
    Point,
    Size,
} from '../model/types.js';
import { getImageDimensions } from '../renderer/svg-dom-utils.js';
import { DEFAULT_COLS, DEFAULT_ROWS } from '../game/init.js';

/** Current schema version. Bump when the serialized shape changes. */
export const STATE_VERSION = 5;

/**
 * Supported schema versions.
 *
 * - v1: original format (no imageSize or attribution)
 * - v2: adds imageSize and optional attribution
 * - v3: adds gridSize (cols × rows)
 * - v4: adds seed for procedural cut generation
 * - v5: adds cutStyle ('classic' | 'fractal')
 */
const SUPPORTED_VERSIONS = [1, 2, 3, 4, 5];

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
    imageSize?: Size;
    gridSize?: GridSize;
    completed: boolean;
    attribution?: ImageAttribution;
    seed?: number;
    cutStyle?: string;
}

/**
 * Convert a GameState to a JSON-safe object.
 *
 * Maps are converted to `[key, value][]` entries arrays.
 */
export function serializeState(state: GameState): SerializedGameState {
    const serialized: SerializedGameState = {
        version: STATE_VERSION,
        pieces: state.pieces,
        groups: state.groups.map(serializeGroup),
        imageUrl: state.imageUrl,
        imageSize: state.imageSize,
        gridSize: state.gridSize,
        completed: state.completed,
    };

    if (state.attribution) {
        serialized.attribution = state.attribution;
    }

    if (state.seed !== undefined) {
        serialized.seed = state.seed;
    }

    if (state.cutStyle) {
        serialized.cutStyle = state.cutStyle;
    }

    return serialized;
}

/**
 * Restore a GameState from its serialized form.
 *
 * Validates the version tag and reconstructs Maps from entries arrays.
 * Supports migration from v1 (derives imageSize from pieces).
 * Throws if the data is invalid or the version is unsupported.
 */
export function deserializeState(data: SerializedGameState): GameState {
    if (!SUPPORTED_VERSIONS.includes(data.version)) {
        throw new Error(
            `Unsupported state version: ${data.version} (expected one of ${SUPPORTED_VERSIONS.join(', ')})`,
        );
    }

    validateSerializedState(data);

    const groups = data.groups.map(deserializeGroup);

    // For v1 saves (no imageSize), derive it from piece data
    const imageSize = data.imageSize ?? deriveImageSize(data);

    // For v1/v2 saves (no gridSize), assume the original 8×6 default
    const gridSize = data.gridSize ?? { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };

    const state: GameState = {
        pieces: data.pieces,
        groups,
        imageUrl: data.imageUrl,
        imageSize,
        gridSize,
        completed: data.completed,
    };

    if (data.attribution) {
        state.attribution = data.attribution;
    }

    if (data.seed !== undefined) {
        state.seed = data.seed;
    }

    if (data.cutStyle) {
        state.cutStyle = data.cutStyle;
    }

    return state;
}

/**
 * Derive image dimensions from piece data (for v1 migration).
 *
 * Uses the same algorithm as the renderer's getImageDimensions,
 * but works on serialized data by constructing a temporary partial state.
 */
function deriveImageSize(data: SerializedGameState): Size {
    // Construct a minimal GameState-like object for getImageDimensions
    const tempState: GameState = {
        pieces: data.pieces,
        groups: [],
        imageUrl: '',
        imageSize: { width: 0, height: 0 },
        gridSize: { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
        completed: false,
    };

    return getImageDimensions(tempState);
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
