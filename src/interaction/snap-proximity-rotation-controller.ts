/**
 * Drag-lifecycle wrapper around snap proximity rotation.
 *
 * Owns the per-drag context (built once at drag start) and frame gating:
 * pointer-move events can outpace the display refresh, so evaluation runs
 * at most once per animation frame. The first move in a frame evaluates
 * immediately (no added latency); later moves in the same frame are
 * skipped. All the geometry lives in `game/snap-proximity-rotation.ts`.
 *
 * `stop()` only discards the context — rotation already applied stays,
 * including on a canceled drag (it rotated toward the correct alignment,
 * so keeping it is harmless). Callers must stop() before a cancel-restore
 * so the restore's moveGroup callback doesn't trigger a stray evaluation.
 */

import type { GameState } from '../model/types.js';
import { tryGetGroup } from '../model/helpers.js';
import { rotateGroup } from '../game/rotate-group.js';
import {
    buildProximityContext,
    computeSnapProximityRotation,
} from '../game/snap-proximity-rotation.js';
import type { ProximityContext, SnapTolerances } from '../game/snap-proximity-rotation.js';

export interface SnapProximityRotationOptions {
    getState: () => GameState;
    /** Active snap tolerances; read once per drag, at start(). */
    getTolerances: () => SnapTolerances;
    /** Injectable frame scheduler for tests. Defaults to requestAnimationFrame. */
    scheduleFrame?: (cb: () => void) => void;
}

export class SnapProximityRotationController {
    private ctx: ProximityContext | null = null;
    private gated = false;
    private readonly getState: () => GameState;
    private readonly getTolerances: SnapProximityRotationOptions['getTolerances'];
    private readonly scheduleFrame: (cb: () => void) => void;

    constructor(options: SnapProximityRotationOptions) {
        this.getState = options.getState;
        this.getTolerances = options.getTolerances;
        this.scheduleFrame = options.scheduleFrame
            ?? ((cb) => { requestAnimationFrame(() => cb()); });
    }

    /**
     * Begin tracking a drag of `groupId`. Cheap no-op context (null) unless
     * the game is in free-rotation mode and the group has cross-group mates.
     */
    start(groupId: number): void {
        this.ctx = buildProximityContext(
            this.getState(), groupId, this.getTolerances(),
        );
        this.gated = false;
    }

    /** Evaluate after the dragged group moved; at most once per frame. */
    onGroupMoved(): void {
        if (!this.ctx || this.gated) return;
        this.gated = true;
        this.scheduleFrame(() => { this.gated = false; });

        const state = this.getState();
        const delta = computeSnapProximityRotation(state, this.ctx);
        if (delta === null) return;

        const group = tryGetGroup(state, this.ctx.groupId);
        // ctx.centerLocal is valid for the whole drag (composition is fixed),
        // so reuse it as the pivot instead of re-walking the group's bounds.
        if (group) rotateGroup(group, state.piecesById, delta, this.ctx.centerLocal);
    }

    /** End tracking (drop or cancel). Rotation already applied stays. */
    stop(): void {
        this.ctx = null;
    }
}
