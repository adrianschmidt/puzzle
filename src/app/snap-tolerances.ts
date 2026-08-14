/**
 * The single definition of the "would a drop merge?" thresholds, shared by
 * drop/commit merge detection and snap-proximity rotation so they can't drift
 * apart.
 */

import type { GameState } from '../model/types.js';
import type { SnapTolerances } from '../game/snap-proximity-rotation.js';
import { getActiveTolerance, getActiveRotationTolerance } from '../ui/index.js';

export function activeSnapTolerances(state: GameState): SnapTolerances {
    return {
        tolerancePx: getActiveTolerance(
            state.imageSize.width,
            state.gridSize.cols,
            state.cutStyle,
        ),
        rotationToleranceDeg: getActiveRotationTolerance(),
    };
}
