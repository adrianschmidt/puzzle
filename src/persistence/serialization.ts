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
import { getImageDimensions } from '../model/derive.js';
import { DEFAULT_COLS, DEFAULT_ROWS } from '../game/init.js';

/** Current schema version. Bump when the serialized shape changes. */
export const STATE_VERSION = 8;

/**
 * Supported schema versions.
 *
 * - v1: original format (no imageSize or attribution)
 * - v2: adds imageSize and optional attribution
 * - v3: adds gridSize (cols × rows)
 * - v4: adds seed for procedural cut generation
 * - v5: adds cutStyle ('classic' | 'fractal')
 * - v6: adds rotation (0-3 quarter-turns) per group
 * - v7: adds generatorConfig (fractal/composable params) for reproducibility
 * - v8: replaces opaque generatorConfig with typed composableConfig / fractalConfig
 */
const SUPPORTED_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8];

/** A PieceGroup with its Map serialized as an entries array. */
export interface SerializedPieceGroup {
    id: number;
    pieces: Array<[number, Point]>;
    position: Point;
    /** Quarter-turns clockwise (0-3). Missing on v5 and earlier saves. */
    rotation?: number;
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
    /**
     * Rotation mode for this puzzle. Missing on early v6 saves written before
     * the rotation-mode field was added — those are migrated on load based on
     * cut style.
     */
    rotationMode?: 'none' | 'quarter-turn';
    /**
     * Composable-cut config (v8+; only set when cutStyle === 'composable').
     */
    composableConfig?: GameState['composableConfig'];
    /**
     * Fractal-cut config (v8+; only set when cutStyle === 'fractal').
     */
    fractalConfig?: GameState['fractalConfig'];
    /**
     * v7 legacy field: opaque generator config. Migrated to the typed
     * `composableConfig` / `fractalConfig` fields based on `cutStyle` on
     * deserialization. v7 saves are still produced in the wild, so keep
     * the field around for input validation.
     */
    generatorConfig?: Record<string, unknown>;
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

    if (state.rotationMode) {
        serialized.rotationMode = state.rotationMode;
    }

    if (state.composableConfig) {
        serialized.composableConfig = state.composableConfig;
    }

    if (state.fractalConfig) {
        serialized.fractalConfig = state.fractalConfig;
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

    state.rotationMode = resolveRotationMode(data, groups);

    const composableConfig = resolveComposableConfig(data);
    if (composableConfig) {
        state.composableConfig = composableConfig;
    }

    const fractalConfig = resolveFractalConfig(data);
    if (fractalConfig) {
        state.fractalConfig = fractalConfig;
    }

    return state;
}

/**
 * Resolve the composable config from a serialized state.
 *
 * v8+ stores it directly. v7 saves stored an opaque `generatorConfig` whose
 * shape depends on `cutStyle`; for composable puzzles, migrate those fields
 * into the typed shape.
 */
function resolveComposableConfig(
    data: SerializedGameState,
): GameState['composableConfig'] | undefined {
    if (data.composableConfig) {
        return data.composableConfig;
    }

    if (data.cutStyle !== 'composable' || !data.generatorConfig) {
        return undefined;
    }

    const gc = data.generatorConfig;
    const config: NonNullable<GameState['composableConfig']> = {};
    if (typeof gc.horizontalAmplitude === 'number') {
        config.horizontalAmplitude = gc.horizontalAmplitude;
    }
    if (typeof gc.horizontalFrequency === 'number') {
        config.horizontalFrequency = gc.horizontalFrequency;
    }
    if (typeof gc.verticalAmplitude === 'number') {
        config.verticalAmplitude = gc.verticalAmplitude;
    }
    if (typeof gc.verticalFrequency === 'number') {
        config.verticalFrequency = gc.verticalFrequency;
    }
    if (typeof gc.disableTabs === 'boolean') {
        config.disableTabs = gc.disableTabs;
    }
    return config;
}

/**
 * Resolve the fractal config from a serialized state.
 *
 * v8+ stores it directly. v7 saves stored an opaque `generatorConfig`;
 * for fractal puzzles, migrate the `borderless` flag into the typed shape.
 */
function resolveFractalConfig(
    data: SerializedGameState,
): GameState['fractalConfig'] | undefined {
    if (data.fractalConfig) {
        return data.fractalConfig;
    }

    if (data.cutStyle !== 'fractal' || !data.generatorConfig) {
        return undefined;
    }

    const gc = data.generatorConfig;
    if (typeof gc.borderless !== 'boolean') {
        return {};
    }
    return { borderless: gc.borderless };
}

/**
 * Determine the rotationMode for a loaded save.
 *
 * - If the save explicitly records one, honour it.
 * - Otherwise, infer from the data: any non-zero group rotation implies the
 *   player was using quarter-turn mode, so preserve that. Fractal saves
 *   written before rotationMode existed also get quarter-turn so their
 *   behaviour matches what the player saw.
 * - Everything else defaults to 'none'.
 */
function resolveRotationMode(
    data: SerializedGameState,
    groups: PieceGroup[],
): 'none' | 'quarter-turn' {
    if (data.rotationMode === 'quarter-turn' || data.rotationMode === 'none') {
        return data.rotationMode;
    }

    if (groups.some((g) => g.rotation !== 0)) {
        return 'quarter-turn';
    }

    if (data.cutStyle === 'fractal') {
        return 'quarter-turn';
    }

    return 'none';
}

/**
 * Derive image dimensions from piece data (for v1 migration).
 *
 * Uses `getImageDimensions` on a temporary partial state synthesised
 * from the serialized pieces.
 */
function deriveImageSize(data: SerializedGameState): Size {
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
        rotation: group.rotation,
    };
}

function deserializeGroup(group: SerializedPieceGroup): PieceGroup {
    return {
        id: group.id,
        pieces: new Map(group.pieces),
        position: group.position,
        rotation: normaliseStoredRotation(group.rotation),
    };
}

/** v5 and earlier saves have no rotation; coerce unknown values to 0. */
function normaliseStoredRotation(value: unknown): 0 | 1 | 2 | 3 {
    if (value === 1 || value === 2 || value === 3) {
        return value;
    }
    return 0;
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
