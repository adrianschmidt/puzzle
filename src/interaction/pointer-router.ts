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

import type { Point as _Point } from '../model/types.js';

export type ClassifyTarget = (target: EventTarget | null) =>
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
    onPinch: {
        start: (a: PointerEvent, b: PointerEvent) => void;
        move: (a: PointerEvent, b: PointerEvent) => void;
        end: () => void;
    };
    onWheelZoom: (evt: WheelEvent) => void;
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
    private _tapThresholdPx: number;
    private _now: () => number;
    private callbacks: Pick<PointerRouterOptions,
        'onPieceTap' | 'onPieceDrag' | 'onBackgroundPan' | 'onPinch' | 'onWheelZoom'>;

    private _tracked = new Map<number, TrackedPointer>();
    private _state: State = { kind: 'idle' };
    private _pinch: PinchState = { kind: 'inactive' };

    private boundDown = (e: PointerEvent) => this.onPointerDown(e);
    private boundMove = (e: PointerEvent) => this.onPointerMove(e);
    private boundUp = (e: PointerEvent) => this.onPointerUp(e);
    private boundCancel = (e: PointerEvent) => this.onPointerCancel(e);
    private boundWheel = (e: WheelEvent) => this.onWheel(e);

    constructor(opts: PointerRouterOptions) {
        this.container = opts.container;
        this.classifyTarget = opts.classifyTarget;
        this._tapThresholdPx = opts.tapThresholdPx ?? DEFAULT_TAP_THRESHOLD_PX;
        this._now = opts.now ?? (() => performance.now());
        this.callbacks = {
            onPieceTap: opts.onPieceTap,
            onPieceDrag: opts.onPieceDrag,
            onBackgroundPan: opts.onBackgroundPan,
            onPinch: opts.onPinch,
            onWheelZoom: opts.onWheelZoom,
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

    // --- Pointer (stubs for now, filled in by later tasks) -------

    private onPointerDown(_evt: PointerEvent): void {
        // Task 3: will use this._tracked, this._state, this._tapThresholdPx, this._now
        void (this._tracked, this._state, this._tapThresholdPx, this._now, PINCH_GRACE_MS);
    }
    private onPointerMove(_evt: PointerEvent): void { /* Task 3 */ }
    private onPointerUp(_evt: PointerEvent): void { /* Task 3 */ }
    private onPointerCancel(_evt: PointerEvent): void {
        // Task 6: will use this._pinch
        void this._pinch;
    }

    // Tracked-pointer + state-machine helpers used by later tasks live here too.
}
