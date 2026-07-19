/**
 * Gesture-lifecycle wrapper around snap proximity position (the mirror of
 * SnapProximityRotationController).
 *
 * Owns the per-gesture context (built once at rotation start) and frame
 * gating: pointer-move events can outpace the display refresh, so evaluation
 * runs at most once per animation frame. The first rotate in a frame
 * evaluates immediately (no added latency); later rotates in the same frame
 * are skipped. All the geometry lives in `game/snap-proximity-position.ts`.
 *
 * `stop()` only discards the context — translation already applied stays,
 * including on a canceled rotation (it moved toward the correct placement,
 * so keeping it is harmless), mirroring the rotation controller.
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
    getState: () => GameState;
    /** Active snap tolerances; read once per gesture, at start(). */
    getTolerances: () => SnapTolerances;
    /** Injectable frame scheduler for tests. Defaults to requestAnimationFrame. */
    scheduleFrame?: (cb: () => void) => void;
}

export class SnapProximityPositionController {
    private ctx: ProximityContext | null = null;
    private gated = false;
    private readonly getState: () => GameState;
    private readonly getTolerances: SnapProximityPositionOptions['getTolerances'];
    private readonly scheduleFrame: (cb: () => void) => void;

    constructor(options: SnapProximityPositionOptions) {
        this.getState = options.getState;
        this.getTolerances = options.getTolerances;
        this.scheduleFrame = options.scheduleFrame
            ?? ((cb) => { requestAnimationFrame(() => cb()); });
    }

    /**
     * Begin tracking a rotation of `groupId`. Cheap no-op context (null)
     * unless the game is in free-rotation mode and the group has cross-group
     * mates.
     */
    start(groupId: number): void {
        this.ctx = buildProximityContext(
            this.getState(), groupId, this.getTolerances(),
        );
        this.gated = false;
    }

    /** Evaluate after the group rotated; at most once per frame. */
    onGroupRotated(): void {
        if (!this.ctx || this.gated) return;
        this.gated = true;
        this.scheduleFrame(() => { this.gated = false; });

        const state = this.getState();
        const delta = computeSnapProximityPosition(state, this.ctx);
        if (delta === null) return;

        const group = tryGetGroup(state, this.ctx.groupId);
        if (group) moveGroup(group, delta);
    }

    /** End tracking (commit or cancel). Translation already applied stays. */
    stop(): void {
        this.ctx = null;
    }
}
