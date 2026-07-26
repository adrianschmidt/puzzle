/**
 * The info modal's "Reproduction parameters" block and the
 * `__reproPuzzle` console helper share this contract: the modal prints
 * a `ReproParams` as JSON, and the helper accepts that exact object.
 *
 * `imageSize` is part of the reproduction contract, not decoration:
 * generators inscribe the puzzle into the image rectangle, so the same
 * seed/grid/style cuts differently at different image dimensions.
 * `imageUrl` makes the repro visually exact, via `collapseBlankImageUrl`
 * — which owns the one image URL that would drown the printed block, and
 * documents that rule next to the wire field it targets.
 */

import type { GameState, GridSize, Size } from '../model/types.js';
import type { SharePayload, StyleConfigSource } from './share-link.js';
import {
    applyStyleConfigs,
    collapseBlankImageUrl,
    isCutStyle,
    isRotationMode,
} from './share-link.js';

/**
 * Declared in the order `buildReproParams` writes them, which is the order
 * the block prints. `cutStyle`/`rotationMode` are plain strings rather than
 * the wire unions: this object is also hand-typed into a console from a
 * screenshot, so the literal types would be a fiction. `reproParamsToPayload`
 * validates both at runtime instead.
 */
export interface ReproParams extends StyleConfigSource {
    seed?: number;
    cutStyle?: string;
    imageUrl?: string;
    imageSize?: Size;
    gridSize?: GridSize;
    rotationMode?: string;
}

/**
 * Fields required to reproduce a puzzle from its seed.
 * Kept minimal so a screenshot of the block is easy to read.
 */
export function buildReproParams(state: GameState): ReproParams {
    const params: ReproParams = {};
    if (state.seed !== undefined) params.seed = state.seed;
    if (state.cutStyle) params.cutStyle = state.cutStyle;
    if (state.imageUrl) params.imageUrl = collapseBlankImageUrl(state.imageUrl);
    if (state.imageSize) params.imageSize = state.imageSize;
    if (state.gridSize) params.gridSize = state.gridSize;
    if (state.rotationMode) params.rotationMode = state.rotationMode;
    if (state.composableConfig) params.composableConfig = state.composableConfig;
    if (state.fractalConfig) params.fractalConfig = state.fractalConfig;
    if (state.wavyConfig) params.wavyConfig = state.wavyConfig;
    if (state.trianglesConfig) params.trianglesConfig = state.trianglesConfig;
    // Load-bearing for Classic: its presence is what selects the sine
    // generator over the legacy one, so omitting it would make the block
    // describe a different puzzle than the one on screen.
    if (state.classicConfig) params.classicConfig = state.classicConfig;
    return params;
}

/**
 * Map a repro-params object onto the share-link wire format.
 *
 * Throws (naming the field) when a required field is missing or, for
 * `cutStyle`/`rotationMode`, unrecognized — e.g. a params object copied
 * from a screenshot that predates `imageSize` being included, or
 * hand-typed with a typo. Naming the field matters because the
 * alternative is the decoder returning a bare `null`, which cannot say
 * what was wrong.
 * Style-config absence semantics are preserved exactly: no
 * `classicConfig` means no `clf`, which selects the legacy Classic
 * generator, matching the puzzle the block described.
 *
 * Two things the wire format cannot carry, so a replay is faithful in
 * geometry but not in every detail:
 *
 * - `imageSize` is floored to whole pixels by the decoder's `clampDim`.
 *   Fractional dimensions are normal for the inscribed rectangles
 *   fractal/wavy produce, so a replay can differ from the on-screen
 *   puzzle by a sub-pixel image rectangle.
 * - No attribution (`a`) or background color (`bgc`) is emitted, so a
 *   replayed Unsplash puzzle loses its photographer credit and the
 *   sharer's background color.
 */
export function reproParamsToPayload(params: ReproParams): SharePayload {
    // `== null` so an explicit `imageSize: null` is named here too, rather
    // than throwing an unattributed `TypeError` on the property read below.
    function required<T>(value: T | undefined, name: string): T {
        if (value == null) {
            throw new Error(`Repro params missing required field: ${name}`);
        }
        return value;
    }

    const cutStyle = required(params.cutStyle, 'cutStyle');
    if (!isCutStyle(cutStyle)) {
        throw new Error(`Repro params has an unknown cutStyle: ${cutStyle}`);
    }
    const rotationMode = params.rotationMode ?? 'none';
    if (!isRotationMode(rotationMode)) {
        throw new Error(`Repro params has an unknown rotationMode: ${rotationMode}`);
    }
    const imageSize = required(params.imageSize, 'imageSize');
    const gridSize = required(params.gridSize, 'gridSize');
    const payload: SharePayload = {
        v: 1,
        i: params.imageUrl ?? 'blank',
        is: [imageSize.width, imageSize.height],
        g: [gridSize.cols, gridSize.rows],
        c: cutStyle,
        s: required(params.seed, 'seed'),
        r: rotationMode,
    };
    applyStyleConfigs(payload, params);
    return payload;
}
