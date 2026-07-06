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
import type { ViewportState } from '../interaction/viewport-transform.js';

/** Current schema version. Bump when the serialized shape changes. */
export const STATE_VERSION = 11;

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
 * - v11: split storage — STATIC blob omits groups/selection/completed (those live in
 *        the separate progress blob); v≤10 full blobs still load via deserializeState.
 */
const SUPPORTED_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

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
     * Wavy-cut config (only set when cutStyle === 'wavy').
     */
    wavyConfig?: GameState['wavyConfig'];
    /**
     * Triangles-cut config (only set when cutStyle === 'triangles').
     */
    trianglesConfig?: GameState['trianglesConfig'];
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

/** Static portion: geometry + immutable metadata. No groups/selection/completed. */
export interface SerializedStaticState {
    version: number;
    pieces: GameState['pieces'];
    imageUrl: string;
    imageSize?: Size;
    gridSize?: GridSize;
    attribution?: ImageAttribution;
    seed?: number;
    cutStyle?: string;
    rotationMode?: 'none' | 'quarter-turn' | 'free';
    composableConfig?: GameState['composableConfig'];
    fractalConfig?: GameState['fractalConfig'];
    wavyConfig?: GameState['wavyConfig'];
    trianglesConfig?: GameState['trianglesConfig'];
    /** Present only on legacy v7 blobs read through the static path. */
    generatorConfig?: Record<string, unknown>;
}

/** Mutable portion: changes as the player plays. */
export interface SerializedProgress {
    version: number;
    /** Seed of the puzzle this progress belongs to, for pairing with the static blob. */
    seed?: number;
    groups: SerializedPieceGroup[];
    selection?: number[];
    completed: boolean;
    /**
     * The player's last viewport (zoom + pan). Like {@link SerializedGameState.selection},
     * this is deliberately additive and optional — it is NOT gated behind a
     * STATE_VERSION bump. The state it represents lives outside GameState (in
     * ViewportTransform). Older builds ignore the unknown key; newer builds
     * restore it when present. Omitted when the caller passes no viewport.
     */
    viewport?: SerializedViewport;
}

/** JSON-safe viewport (zoom + pan) snapshot. */
export interface SerializedViewport {
    scale: number;
    offset: Point;
}

/**
 * Pin {@link SerializedViewport} to the runtime {@link ViewportState} it
 * mirrors. The save/restore wiring (main.ts) assigns one to the other purely
 * by structural compatibility — there is no explicit conversion. These
 * `declare` signatures make that contract load-bearing: if a field is ever
 * added to one interface but not the other, the assignment would silently drop
 * the field at save or restore time, but this fails to compile first. They emit
 * no runtime code.
 *
 * The reference to {@link ViewportState} is a type-only import, so persistence
 * keeps no runtime dependency on the interaction layer.
 */
declare function __assertViewportContract(
    toDisk: ViewportState extends SerializedViewport ? true : never,
    fromDisk: SerializedViewport extends ViewportState ? true : never,
): void;

/**
 * Convert a GameState to a JSON-safe object in the full single-blob (v≤10)
 * format.
 *
 * The live save path no longer uses this — it writes the split
 * {@link serializeStatic} + {@link serializeProgress} blobs. `serializeState`
 * is retained as the symmetric counterpart to {@link deserializeState} (which
 * still loads legacy single-key saves) and for tests that exercise the full
 * blob shape.
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

    if (state.wavyConfig) {
        serialized.wavyConfig = state.wavyConfig;
    }

    if (state.trianglesConfig) {
        serialized.trianglesConfig = state.trianglesConfig;
    }

    return serialized;
}

/** Serialize only the static geometry + metadata (no groups/selection/completed). */
export function serializeStatic(state: GameState): SerializedStaticState {
    const s: SerializedStaticState = {
        version: STATE_VERSION,
        pieces: state.pieces,
        imageUrl: state.imageUrl,
        imageSize: state.imageSize,
        gridSize: state.gridSize,
    };
    if (state.attribution) s.attribution = state.attribution;
    if (state.seed !== undefined) s.seed = state.seed;
    if (state.cutStyle) s.cutStyle = state.cutStyle;
    if (state.rotationMode) s.rotationMode = state.rotationMode;
    if (state.composableConfig) s.composableConfig = state.composableConfig;
    if (state.fractalConfig) s.fractalConfig = state.fractalConfig;
    if (state.wavyConfig) s.wavyConfig = state.wavyConfig;
    if (state.trianglesConfig) s.trianglesConfig = state.trianglesConfig;
    return s;
}

/** Serialize only the mutable progress (groups, selection, completed, viewport). */
export function serializeProgress(
    state: GameState,
    selection?: Iterable<number>,
    viewport?: SerializedViewport,
): SerializedProgress {
    const p: SerializedProgress = {
        version: STATE_VERSION,
        groups: state.groups.map(serializeGroup),
        completed: state.completed,
    };
    if (state.seed !== undefined) p.seed = state.seed;
    if (selection !== undefined) {
        const ids = [...selection];
        if (ids.length > 0) p.selection = ids;
    }
    if (viewport !== undefined) p.viewport = viewport;
    return p;
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
    const imageSize = data.imageSize ?? deriveImageSize(data.pieces);

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

    if (data.wavyConfig) {
        state.wavyConfig = data.wavyConfig;
    }

    if (data.trianglesConfig) {
        state.trianglesConfig = data.trianglesConfig;
    }

    return state;
}

/**
 * Rebuild a full GameState from a static blob + a progress blob.
 *
 * The static blob may be a v11 static-only blob or a legacy v≤10 full blob
 * (its inline groups are ignored — groups come from `progress`).
 *
 * Progress blobs are always written at the current version (rotations in
 * degrees); no quarter-turn→degrees migration is applied here — legacy v≤10
 * saves load via `deserializeState`.
 */
export function recombine(
    staticData: SerializedStaticState,
    progress: SerializedProgress,
): GameState {
    if (!SUPPORTED_VERSIONS.includes(staticData.version)) {
        throw new Error(
            `Unsupported state version: ${staticData.version} (expected one of ${SUPPORTED_VERSIONS.join(', ')})`,
        );
    }
    if (!SUPPORTED_VERSIONS.includes(progress.version)) {
        throw new Error(
            `Unsupported progress version: ${progress.version} (expected one of ${SUPPORTED_VERSIONS.join(', ')})`,
        );
    }
    if (!Array.isArray(staticData.pieces) || staticData.pieces.length === 0) {
        throw new Error('Invalid state: pieces must be a non-empty array');
    }
    if (typeof staticData.imageUrl !== 'string' || staticData.imageUrl.length === 0) {
        throw new Error('Invalid state: imageUrl must be a non-empty string');
    }
    validateGroups(progress.groups);

    const groups = progress.groups.map(deserializeGroup);
    const { groupsById, pieceToGroup } = buildGroupIndexes(groups);
    const imageSize = staticData.imageSize ?? deriveImageSize(staticData.pieces);
    const gridSize = staticData.gridSize ?? { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };

    const state: GameState = {
        pieces: staticData.pieces,
        groups,
        piecesById: buildPiecesById(staticData.pieces),
        groupsById,
        pieceToGroup,
        imageUrl: staticData.imageUrl,
        imageSize,
        gridSize,
        completed: progress.completed,
    };
    if (staticData.attribution) state.attribution = staticData.attribution;
    if (staticData.seed !== undefined) state.seed = staticData.seed;
    if (staticData.cutStyle) state.cutStyle = staticData.cutStyle;
    state.rotationMode = resolveRotationMode(staticData, groups);
    const composableConfig = resolveComposableConfig(staticData);
    if (composableConfig) state.composableConfig = composableConfig;
    const fractalConfig = resolveFractalConfig(staticData);
    if (fractalConfig) state.fractalConfig = fractalConfig;
    if (staticData.wavyConfig) state.wavyConfig = staticData.wavyConfig;
    if (staticData.trianglesConfig) state.trianglesConfig = staticData.trianglesConfig;
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
    data: SerializedStaticState,
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
    data: SerializedStaticState,
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
 *   behavior matches what the player saw.
 * - Everything else defaults to 'none'.
 */
function resolveRotationMode(
    data: SerializedStaticState,
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
 * Derive image dimensions from piece data (for v1 migration and static-blob
 * fallback).
 *
 * Uses `getImageDimensions` on a temporary partial state synthesised
 * from the pieces array. The other fields are inert padding — `getImageDimensions`
 * only reads `pieces`.
 */
function deriveImageSize(pieces: GameState['pieces']): Size {
    const tempState: GameState = {
        pieces,
        groups: [],
        piecesById: buildPiecesById(pieces),
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
export function readSelection(data: SerializedGameState | SerializedProgress): number[] {
    if (!Array.isArray(data.selection)) {
        return [];
    }
    return data.selection.filter(
        (id): id is number => typeof id === 'number' && Number.isFinite(id),
    );
}

/**
 * Extract a sanitized viewport from a serialized progress blob.
 *
 * Tolerates missing/garbage data (older saves, hand-edited storage): a missing
 * field, a non-object viewport, a non-finite `scale`, or an `offset` without
 * finite `x`/`y` all yield `undefined`. Never throws.
 */
export function readViewport(data: SerializedProgress): SerializedViewport | undefined {
    const vp = data.viewport as unknown;
    if (typeof vp !== 'object' || vp === null) {
        return undefined;
    }
    const { scale, offset } = vp as { scale?: unknown; offset?: unknown };
    if (typeof scale !== 'number' || !Number.isFinite(scale)) {
        return undefined;
    }
    if (typeof offset !== 'object' || offset === null) {
        return undefined;
    }
    const { x, y } = offset as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
        return undefined;
    }
    return { scale, offset: { x, y } };
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
        rotation: normalizeStoredRotation(group.rotation),
    };
}

/**
 * v5 and earlier saves have no rotation; coerce missing/invalid values to 0.
 *
 * Returns the raw stored value (either quarter-turns for v ≤ 8 saves or
 * degrees for v ≥ 9 saves). The caller is responsible for converting
 * quarter-turn-era values to degrees by multiplying by 90.
 */
function normalizeStoredRotation(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    return 0;
}

/** Validate the serialized groups array (shape + per-group invariants). */
function validateGroups(groups: SerializedPieceGroup[] | undefined): void {
    if (!Array.isArray(groups) || groups.length === 0) {
        throw new Error('Invalid state: groups must be a non-empty array');
    }
    for (const group of groups) {
        if (typeof group.id !== 'number') {
            throw new Error('Invalid state: group id must be a number');
        }
        if (!Array.isArray(group.pieces) || group.pieces.length === 0) {
            throw new Error(`Invalid state: group ${group.id} must have at least one piece`);
        }
        if (!Number.isFinite(group.position?.x) || !Number.isFinite(group.position?.y)) {
            throw new Error(`Invalid state: group ${group.id} must have a valid position`);
        }
    }
}

/**
 * Basic structural validation of the serialized state.
 * Throws descriptive errors on invalid data.
 */
function validateSerializedState(data: SerializedGameState): void {
    if (!Array.isArray(data.pieces) || data.pieces.length === 0) {
        throw new Error('Invalid state: pieces must be a non-empty array');
    }

    if (typeof data.imageUrl !== 'string' || data.imageUrl.length === 0) {
        throw new Error('Invalid state: imageUrl must be a non-empty string');
    }

    if (typeof data.completed !== 'boolean') {
        throw new Error('Invalid state: completed must be a boolean');
    }

    validateGroups(data.groups);
}
