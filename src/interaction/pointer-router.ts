/**
 * Single source of truth for container-level pointer events.
 *
 * Owns pointerdown/move/up/cancel/wheel listeners on a container, classifies
 * targets via `classifyTarget`, and emits pre-classified gesture events:
 * piece-tap, piece-drag.{start,move,end,cancel}, background-pan.{...},
 * pinch.{start,move,end}, wheel-zoom.
 *
 * See docs/superpowers/specs/2026-05-01-pointer-router-design.md for the
 * full state machine and arbitration rules.
 */

import type { Point } from '../model/types.js';

export type ClassifyTarget = (
    target: EventTarget | null,
    /**
     * Screen coordinates of the event, when available (pointerdown). Lets the
     * classifier widen a background hit into a nearby piece via a screen-space
     * probe. Omitted for events where a probe makes no sense (e.g. wheel).
     */
    point?: Point,
) =>
    | { kind: 'piece'; pieceId: number }
    | { kind: 'background' }
    | { kind: 'ignore' };

export interface PointerRouterOptions {
    container: HTMLElement;
    classifyTarget: ClassifyTarget;
    /** Default 8 px. */
    tapThresholdPx?: number;
    /** Default `performance.now`. Override for tests. */
    now?: () => number;

    onPieceTap: (pieceId: number, evt: PointerEvent) => void;
    onPieceDrag: {
        start: (pieceId: number, evt: PointerEvent) => void;
        move: (evt: PointerEvent) => void;
        end: (evt: PointerEvent) => void;
        cancel: () => void;
    };
    onBackgroundPan: {
        start: (evt: PointerEvent) => void;
        move: (evt: PointerEvent) => void;
        end: (evt: PointerEvent) => void;
        cancel: () => void;
    };
    /**
     * Pinch has no separate cancel — `end` fires for both clean lift and
     * `pointercancel`, since the end-state is the same regardless of cause.
     */
    onPinch: {
        start: (a: PointerEvent, b: PointerEvent) => void;
        move: (a: PointerEvent, b: PointerEvent) => void;
        end: () => void;
    };
    onWheelZoom: (evt: WheelEvent) => void;
    /** Optional. Fired when a background pointerdown/up resolves without crossing the tap threshold. */
    onBackgroundTap?: (evt: PointerEvent) => void;
}

const DEFAULT_TAP_THRESHOLD_PX = 8;
const PINCH_GRACE_MS = 250;

interface TrackedPointer {
    pointerId: number;
    pointerType: string;
    targetKind: 'piece' | 'background';
    pieceId: number | null;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
}

type State =
    | { kind: 'idle' }
    | { kind: 'piece-candidate'; pointerId: number; pieceId: number; startX: number; startY: number }
    | { kind: 'background-candidate'; pointerId: number; startX: number; startY: number }
    | { kind: 'piece-drag'; pointerId: number; pieceId: number; startedAt: number }
    | { kind: 'background-pan'; pointerId: number };

type PinchState =
    | { kind: 'inactive' }
    | { kind: 'active'; a: number; b: number };

export class PointerRouter {
    private container: HTMLElement;
    private classifyTarget: ClassifyTarget;
    private tapThresholdPx: number;
    private now: () => number;
    private callbacks: Pick<PointerRouterOptions,
        'onPieceTap' | 'onPieceDrag' | 'onBackgroundPan' | 'onPinch' | 'onWheelZoom' | 'onBackgroundTap'>;

    private tracked = new Map<number, TrackedPointer>();
    private state: State = { kind: 'idle' };
    private pinch: PinchState = { kind: 'inactive' };

    private boundDown = (e: PointerEvent) => this.onPointerDown(e);
    private boundMove = (e: PointerEvent) => this.onPointerMove(e);
    private boundUp = (e: PointerEvent) => this.onPointerUp(e);
    private boundCancel = (e: PointerEvent) => this.onPointerCancel(e);
    private boundWheel = (e: WheelEvent) => this.onWheel(e);

    constructor(opts: PointerRouterOptions) {
        this.container = opts.container;
        this.classifyTarget = opts.classifyTarget;
        this.tapThresholdPx = opts.tapThresholdPx ?? DEFAULT_TAP_THRESHOLD_PX;
        this.now = opts.now ?? (() => performance.now());
        this.callbacks = {
            onPieceTap: opts.onPieceTap,
            onPieceDrag: opts.onPieceDrag,
            onBackgroundPan: opts.onBackgroundPan,
            onPinch: opts.onPinch,
            onWheelZoom: opts.onWheelZoom,
            onBackgroundTap: opts.onBackgroundTap,
        };

        this.container.addEventListener('pointerdown', this.boundDown);
        this.container.addEventListener('pointermove', this.boundMove);
        this.container.addEventListener('pointerup', this.boundUp);
        this.container.addEventListener('pointercancel', this.boundCancel);
        this.container.addEventListener('wheel', this.boundWheel, { passive: false });
    }

    destroy(): void {
        this.container.removeEventListener('pointerdown', this.boundDown);
        this.container.removeEventListener('pointermove', this.boundMove);
        this.container.removeEventListener('pointerup', this.boundUp);
        this.container.removeEventListener('pointercancel', this.boundCancel);
        this.container.removeEventListener('wheel', this.boundWheel);
    }

    // --- Wheel ---------------------------------------------------

    private onWheel(evt: WheelEvent): void {
        const cls = this.classifyTarget(evt.target);
        if (cls.kind === 'ignore') return;
        evt.preventDefault();
        this.callbacks.onWheelZoom(evt);
    }

    // --- Pointer ---------------------------------------------------

    private onPointerDown(evt: PointerEvent): void {
        const cls = this.classifyTarget(evt.target, { x: evt.clientX, y: evt.clientY });
        if (cls.kind === 'ignore') return;

        this.tracked.set(evt.pointerId, {
            pointerId: evt.pointerId,
            pointerType: evt.pointerType,
            targetKind: cls.kind,
            pieceId: cls.kind === 'piece' ? cls.pieceId : null,
            startX: evt.clientX,
            startY: evt.clientY,
            lastX: evt.clientX,
            lastY: evt.clientY,
        });

        // Try to start a pinch first — a 2nd touch landing supersedes any
        // single-pointer candidate logic.
        if (this.tryStartPinch()) return;

        if (this.state.kind !== 'idle') return;

        if (cls.kind === 'piece') {
            this.state = {
                kind: 'piece-candidate',
                pointerId: evt.pointerId, pieceId: cls.pieceId,
                startX: evt.clientX, startY: evt.clientY,
            };
        } else {
            this.state = {
                kind: 'background-candidate',
                pointerId: evt.pointerId,
                startX: evt.clientX, startY: evt.clientY,
            };
        }
    }

    private onPointerMove(evt: PointerEvent): void {
        const tracked = this.tracked.get(evt.pointerId);
        if (tracked) {
            tracked.lastX = evt.clientX;
            tracked.lastY = evt.clientY;
        }

        // Single-pointer gesture transitions: candidate-promotes-to-drag/pan
        // once the tap threshold is crossed; active drag/pan dispatch move events.
        if (this.state.kind === 'piece-candidate' && evt.pointerId === this.state.pointerId) {
            if (this.exceedsTapThreshold(evt, this.state.startX, this.state.startY)) {
                const { pieceId, pointerId } = this.state;
                this.state = { kind: 'piece-drag', pointerId, pieceId, startedAt: this.now() };
                this.container.setPointerCapture(pointerId);
                this.callbacks.onPieceDrag.start(pieceId, evt);
            }
        } else if (this.state.kind === 'background-candidate' && evt.pointerId === this.state.pointerId) {
            if (this.exceedsTapThreshold(evt, this.state.startX, this.state.startY)) {
                const { pointerId } = this.state;
                this.state = { kind: 'background-pan', pointerId };
                this.container.setPointerCapture(pointerId);
                this.callbacks.onBackgroundPan.start(evt);
            }
        } else if (this.state.kind === 'piece-drag' && evt.pointerId === this.state.pointerId) {
            this.callbacks.onPieceDrag.move(evt);
        } else if (this.state.kind === 'background-pan' && evt.pointerId === this.state.pointerId) {
            this.callbacks.onBackgroundPan.move(evt);
        }

        // Pinch path — pair member moved.
        if (this.pinch.kind === 'active' &&
            (evt.pointerId === this.pinch.a || evt.pointerId === this.pinch.b)) {
            const ta = this.tracked.get(this.pinch.a);
            const tb = this.tracked.get(this.pinch.b);
            if (ta && tb) this.callbacks.onPinch.move(this.toEvent(ta), this.toEvent(tb));
        }
    }

    private onPointerUp(evt: PointerEvent): void {
        // Compute pair-membership BEFORE delete so the lifting pointer is
        // still in `tracked` for the check.
        const wasPinchPair = this.pinch.kind === 'active' &&
            (evt.pointerId === this.pinch.a || evt.pointerId === this.pinch.b);

        this.tracked.delete(evt.pointerId);

        if (this.state.kind === 'piece-candidate' && evt.pointerId === this.state.pointerId) {
            const { pieceId } = this.state;
            this.state = { kind: 'idle' };
            this.callbacks.onPieceTap(pieceId, evt);
        } else if (this.state.kind === 'background-candidate' && evt.pointerId === this.state.pointerId) {
            this.state = { kind: 'idle' };
            this.callbacks.onBackgroundTap?.(evt);
        } else if (this.state.kind === 'piece-drag' && evt.pointerId === this.state.pointerId) {
            this.releaseCapture(evt.pointerId);
            this.state = { kind: 'idle' };
            this.callbacks.onPieceDrag.end(evt);
        } else if (this.state.kind === 'background-pan' && evt.pointerId === this.state.pointerId) {
            this.releaseCapture(evt.pointerId);
            this.state = { kind: 'idle' };
            this.callbacks.onBackgroundPan.end(evt);
        }

        if (wasPinchPair) {
            this.pinch = { kind: 'inactive' };
            this.callbacks.onPinch.end();
        }
    }

    private onPointerCancel(evt: PointerEvent): void {
        const wasPinchPair = this.pinch.kind === 'active' &&
            (evt.pointerId === this.pinch.a || evt.pointerId === this.pinch.b);

        this.tracked.delete(evt.pointerId);

        if (this.state.kind === 'piece-candidate' && evt.pointerId === this.state.pointerId) {
            this.state = { kind: 'idle' };
        } else if (this.state.kind === 'background-candidate' && evt.pointerId === this.state.pointerId) {
            this.state = { kind: 'idle' };
        } else if (this.state.kind === 'piece-drag' && evt.pointerId === this.state.pointerId) {
            this.releaseCapture(evt.pointerId);
            this.state = { kind: 'idle' };
            this.callbacks.onPieceDrag.cancel();
        } else if (this.state.kind === 'background-pan' && evt.pointerId === this.state.pointerId) {
            this.releaseCapture(evt.pointerId);
            this.state = { kind: 'idle' };
            this.callbacks.onBackgroundPan.cancel();
        }

        if (wasPinchPair) {
            this.pinch = { kind: 'inactive' };
            this.callbacks.onPinch.end();
        }
    }

    /**
     * Returns true and starts a pinch (with the locked pair = first two
     * touch pointers tracked) when the just-arrived pointerdown brings
     * the touch-pointer count to 2. Returns false otherwise.
     *
     * Resolves any active single-pointer state before starting the pinch:
     * - candidates are silently discarded,
     * - an active drag inside the grace window is canceled,
     * - an active drag outside the grace window survives concurrently,
     * - an active pan is always canceled.
     */
    private tryStartPinch(): boolean {
        if (this.pinch.kind !== 'inactive') return false;

        const touches = this.touchPointers();
        if (touches.length < 2) return false;

        // Resolve the existing single-pointer state first.
        if (this.state.kind === 'piece-candidate') {
            this.state = { kind: 'idle' };
        } else if (this.state.kind === 'background-candidate') {
            this.state = { kind: 'idle' };
        } else if (this.state.kind === 'piece-drag') {
            const elapsed = this.now() - this.state.startedAt;
            if (elapsed < PINCH_GRACE_MS) {
                const { pointerId } = this.state;
                this.releaseCapture(pointerId);
                this.state = { kind: 'idle' };
                this.callbacks.onPieceDrag.cancel();
            }
            // else: drag survives concurrently (state stays piece-drag)
        } else if (this.state.kind === 'background-pan') {
            const { pointerId } = this.state;
            this.releaseCapture(pointerId);
            this.state = { kind: 'idle' };
            this.callbacks.onBackgroundPan.cancel();
        }

        const [a, b] = touches.slice(0, 2);
        this.pinch = { kind: 'active', a: a.pointerId, b: b.pointerId };
        this.callbacks.onPinch.start(this.toEvent(a), this.toEvent(b));
        return true;
    }

    private touchPointers(): TrackedPointer[] {
        return [...this.tracked.values()].filter(t => t.pointerType === 'touch');
    }

    /** Synthesize a PointerEvent-shape object from a TrackedPointer's last position. */
    private toEvent(t: TrackedPointer): PointerEvent {
        return {
            pointerId: t.pointerId,
            pointerType: t.pointerType,
            clientX: t.lastX,
            clientY: t.lastY,
        } as PointerEvent;
    }

    // --- Helpers ---------------------------------------------------

    private exceedsTapThreshold(evt: PointerEvent, startX: number, startY: number): boolean {
        const dx = evt.clientX - startX;
        const dy = evt.clientY - startY;
        return dx * dx + dy * dy >= this.tapThresholdPx * this.tapThresholdPx;
    }

    private releaseCapture(pointerId: number): void {
        if (this.container.hasPointerCapture(pointerId)) {
            this.container.releasePointerCapture(pointerId);
        }
    }
}
