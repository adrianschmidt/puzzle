/**
 * Gesture-lifecycle wrapper around snap proximity position (mirror of
 * SnapProximityRotationController). Owns the per-gesture context and frame
 * gating: rotates can outpace the refresh, so evaluation runs at most once per
 * frame (first in a frame runs immediately, later ones skipped). Geometry lives
 * in game/snap-proximity-position.ts.
 *
 * stop() only discards the context — translation already applied stays, even on
 * a canceled rotation (it moved toward the correct placement).
 */

import type { GameState } from '../model/types.js';
import { moveGroup, tryGetGroup } from '../model/helpers.js';
import {
    buildProximityContext,
    type ProximityContext,
    type SnapTolerances,
} from '../game/snap-proximity-context.js';
import { computeSnapProximityPosition } from '../game/snap-proximity-position.js';

export interface SnapProximityPositionOptions {
    /**
     * The installed game, or undefined when boot failed and left none installed
     * (#488) — then the controller stays inert. Called on every rotation frame
     * including gated ones (before the early return), so keep it cheap and
     * side-effect-free.
     */
    getState: () => GameState | undefined;
    /** Active snap tolerances for `state`; read once per gesture, at start(). */
    getTolerances: (state: GameState) => SnapTolerances;
    /** Injectable frame scheduler for tests. */
    scheduleFrame?: (cb: () => void) => void;
}

export class SnapProximityPositionController {
    private ctx: ProximityContext | null = null;
    private gated = false;
    private readonly getState: SnapProximityPositionOptions['getState'];
    private readonly getTolerances: SnapProximityPositionOptions['getTolerances'];
    private readonly scheduleFrame: (cb: () => void) => void;

    constructor(options: SnapProximityPositionOptions) {
        this.getState = options.getState;
        this.getTolerances = options.getTolerances;
        this.scheduleFrame = options.scheduleFrame
            ?? ((cb) => { requestAnimationFrame(() => cb()); });
    }

    /**
     * Null (no-op) context unless the game is free-rotation and the group has
     * cross-group mates. anchorPieceId restricts the assist to the manual
     * pivot's piece — see buildProximityContext.
     */
    start(groupId: number, anchorPieceId?: number): void {
        const state = this.getState();
        this.ctx = state
            ? buildProximityContext(state, groupId, this.getTolerances(state), anchorPieceId)
            : null;
        this.gated = false;
    }

    onGroupRotated(): void {
        const state = this.getState();
        if (!state || !this.ctx || this.gated) return;
        this.gated = true;
        this.scheduleFrame(() => { this.gated = false; });

        const delta = computeSnapProximityPosition(state, this.ctx);
        if (delta === null) return;

        const group = tryGetGroup(state, this.ctx.groupId);
        if (group) moveGroup(group, delta);
    }

    stop(): void {
        this.ctx = null;
    }
}
