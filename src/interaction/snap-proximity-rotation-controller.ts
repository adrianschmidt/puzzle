/**
 * Owns the per-drag context and frame gating: moves can outpace the refresh, so
 * evaluation runs at most once per frame (first in a frame runs immediately,
 * later ones skipped). Geometry lives in game/snap-proximity-rotation.ts.
 *
 * stop() only discards the context — rotation already applied stays, even on a
 * canceled drag. Callers must stop() before a cancel-restore, or the restore's
 * moveGroup callback triggers a stray evaluation.
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
    /** Injectable frame scheduler for tests. */
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

    /** Null (no-op) context unless the game is free-rotation and the group has cross-group mates. */
    start(groupId: number): void {
        this.ctx = buildProximityContext(
            this.getState(), groupId, this.getTolerances(),
        );
        this.gated = false;
    }

    onGroupMoved(): void {
        if (!this.ctx || this.gated) return;
        this.gated = true;
        this.scheduleFrame(() => { this.gated = false; });

        const state = this.getState();
        const result = computeSnapProximityRotation(state, this.ctx);
        if (result === null) return;

        const group = tryGetGroup(state, this.ctx.groupId);
        if (group) {
            rotateGroup(group, state.piecesById, result.deltaDeg, result.pivotLocal);
        }
    }

    stop(): void {
        this.ctx = null;
    }
}
