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
import { buildGroupIndexes, buildPiecesById } from '../model/helpers.js';
import { getImageDimensions } from '../model/derive.js';
import { DEFAULT_COLS, DEFAULT_ROWS } from '../game/init.js';
import { legacyDisableTabsToTabGenerator } from '../game/composable-config.js';

/** Current schema version. Bump when the serialized shape changes. */
export const STATE_VERSION = 10;

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
 * - v9: rotation is stored as float degrees (0–360); v8 and earlier saves are
 *       migrated by multiplying their integer quarter-turn values by 90
 * - v10: composableConfig switched from legacy `horizontalAmplitude`/… fields
 *        to the opaque `{baseCutGenerator, baseCutConfig, tabGenerator, tabConfig}`
 *        shape that the topology refactor introduced. v9 and earlier saves are
 *        migrated on load (see `migrateLegacyComposableConfig`).
 */
const SUPPORTED_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** A PieceGroup with its Map serialized as an entries array. */
export interface SerializedPieceGroup {
    id: number;
    pieces: Array<[number, Point]>;
    position: Point;
    /**
     * Rotation. v9+ saves store float degrees in `[0, 360)`; v6–v8 stored
     * a quarter-turn count `{0, 1, 2, 3}` and are migrated on load. Missing
     * on v5 and earlier saves.
     */
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
    rotationMode?: 'none' | 'quarter-turn' | 'free';
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
    /**
     * The user's multi-select selection: the group ids they have tapped to
     * select for batch movement. Omitted when nothing is selected.
     *
     * Deliberately **not** gated behind a `STATE_VERSION` bump: it is a
     * purely additive, optional field that the selection itself lives
     * outside `GameState`. Older builds ignore the unknown key and still
     * load the save as their current version; newer builds restore the
     * selection when present. Bumping the version would instead make older
     * builds reject the whole save during a deploy — far worse than a
     * selection that fails to restore.
     */
    selection?: number[];
}

/**
 * Convert a GameState to a JSON-safe object.
 *
 * Maps are converted to `[key, value][]` entries arrays.
 *
 * The multi-select `selection` lives outside `GameState` (in the
 * SelectionManager), so it is passed in separately. Any ids are written
 * verbatim; callers are responsible for passing only currently-valid group
 * ids. An empty/omitted selection leaves the field off the output.
 */
export function serializeState(
    state: GameState,
    selection?: Iterable<number>,
): SerializedGameState {
    const serialized: SerializedGameState = {
        version: STATE_VERSION,
        pieces: state.pieces,
        groups: state.groups.map(serializeGroup),
        imageUrl: state.imageUrl,
        imageSize: state.imageSize,
        gridSize: state.gridSize,
        completed: state.completed,
    };

    if (selection !== undefined) {
        const ids = [...selection];
        if (ids.length > 0) {
            serialized.selection = ids;
        }
    }

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

    // v8 and earlier stored rotation as quarter-turn count {0,1,2,3}; v9+
    // stores it as float degrees. Migrate older saves by multiplying.
    if (data.version <= 8) {
        for (const group of groups) {
            group.rotation = group.rotation * 90;
        }
    }

    const { groupsById, pieceToGroup } = buildGroupIndexes(groups);

    // For v1 saves (no imageSize), derive it from piece data
    const imageSize = data.imageSize ?? deriveImageSize(data);

    // For v1/v2 saves (no gridSize), assume the original 8×6 default
    const gridSize = data.gridSize ?? { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };

    const state: GameState = {
        pieces: data.pieces,
        groups,
        piecesById: buildPiecesById(data.pieces),
        groupsById,
        pieceToGroup,
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
 * The on-disk shape changed at v10 from the legacy long-named fields
 * (`horizontalAmplitude`, `horizontalFrequency`, …) to the opaque
 * `{baseCutGenerator, baseCutConfig, tabGenerator, tabConfig}` shape that
 * the topology refactor introduced.
 *
 * - v10+ saves store the new shape directly; pass it through.
 * - v8/v9 saves stored the legacy shape under `composableConfig`; migrate.
 * - v7 saves stored an opaque `generatorConfig` with the same legacy
 *   field names; migrate those too.
 *
 * v6 and earlier saves never carry composable config (the cut style did
 * not exist yet, or the field had not been added).
 */
function resolveComposableConfig(
    data: SerializedGameState,
): GameState['composableConfig'] | undefined {
    if (data.composableConfig) {
        const cfg = data.composableConfig as Record<string, unknown>;
        // v10+ saves already use the new shape. Detect by the presence of
        // any new-shape field (any one is sufficient — the keys are
        // disjoint from the legacy field names).
        if (
            'baseCutGenerator' in cfg ||
            'baseCutConfig' in cfg ||
            'tabGenerator' in cfg ||
            'tabConfig' in cfg
        ) {
            return data.composableConfig;
        }
        // Legacy v8/v9 shape — migrate to the new opaque shape.
        return migrateLegacyComposableConfig(cfg);
    }

    if (data.cutStyle !== 'composable' || !data.generatorConfig) {
        return undefined;
    }

    return migrateLegacyComposableConfig(data.generatorConfig);
}

/**
 * Build the opaque {@link GameState.composableConfig} shape from a record
 * carrying the legacy `horizontalAmplitude`/`horizontalFrequency`/
 * `verticalAmplitude`/`verticalFrequency`/`disableTabs` fields. Used for
 * v7/v8/v9 → v10 migration.
 */
function migrateLegacyComposableConfig(
    legacy: Record<string, unknown>,
): NonNullable<GameState['composableConfig']> {
    const baseCutConfig: Record<string, unknown> = {};
    if (typeof legacy.horizontalAmplitude === 'number') {
        baseCutConfig.ha = legacy.horizontalAmplitude;
    }
    if (typeof legacy.horizontalFrequency === 'number') {
        baseCutConfig.hf = legacy.horizontalFrequency;
    }
    if (typeof legacy.verticalAmplitude === 'number') {
        baseCutConfig.va = legacy.verticalAmplitude;
    }
    if (typeof legacy.verticalFrequency === 'number') {
        baseCutConfig.vf = legacy.verticalFrequency;
    }

    const config: NonNullable<GameState['composableConfig']> = {
        baseCutGenerator: 'sine',
        baseCutConfig,
        tabGenerator: legacyDisableTabsToTabGenerator(legacy.disableTabs),
        tabConfig: {},
    };
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
): 'none' | 'quarter-turn' | 'free' {
    if (
        data.rotationMode === 'quarter-turn' ||
        data.rotationMode === 'none' ||
        data.rotationMode === 'free'
    ) {
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
        piecesById: buildPiecesById(data.pieces),
        groupsById: new Map(),
        pieceToGroup: new Map(),
        imageUrl: '',
        imageSize: { width: 0, height: 0 },
        gridSize: { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
        completed: false,
    };

    return getImageDimensions(tempState);
}

/**
 * Extract a sanitized multi-select selection from a serialized state.
 *
 * Tolerates missing/garbage data (older saves, hand-edited storage): a
 * non-array or absent `selection` yields `[]`, and non-finite-number
 * entries are dropped. Returned ids are not checked against the live
 * groups — the caller prunes ids that no longer exist.
 */
export function readSelection(data: SerializedGameState): number[] {
    if (!Array.isArray(data.selection)) {
        return [];
    }
    return data.selection.filter(
        (id): id is number => typeof id === 'number' && Number.isFinite(id),
    );
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

/**
 * v5 and earlier saves have no rotation; coerce missing/invalid values to 0.
 *
 * Returns the raw stored value (either quarter-turns for v ≤ 8 saves or
 * degrees for v ≥ 9 saves). The caller is responsible for converting
 * quarter-turn-era values to degrees by multiplying by 90.
 */
function normaliseStoredRotation(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
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
