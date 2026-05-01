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
    private tapThresholdPx: number;
    private now: () => number;
    private callbacks: Pick<PointerRouterOptions,
        'onPieceTap' | 'onPieceDrag' | 'onBackgroundPan' | 'onPinch' | 'onWheelZoom'>;

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
        const cls = this.classifyTarget(evt.target);
        if (cls.kind === 'ignore') return;

        // Track this pointer (used for pinch detection in later tasks).
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

        // Only the first pointer of a sequence can become a candidate.
        // (Multi-pointer arbitration arrives in Task 5.)
        if (this.state.kind !== 'idle') return;

        if (cls.kind === 'piece') {
            this.state = {
                kind: 'piece-candidate',
                pointerId: evt.pointerId,
                pieceId: cls.pieceId,
                startX: evt.clientX,
                startY: evt.clientY,
            };
        } else {
            this.state = {
                kind: 'background-candidate',
                pointerId: evt.pointerId,
                startX: evt.clientX,
                startY: evt.clientY,
            };
        }
    }

    private onPointerMove(evt: PointerEvent): void {
        const tracked = this.tracked.get(evt.pointerId);
        if (tracked) {
            tracked.lastX = evt.clientX;
            tracked.lastY = evt.clientY;
        }

        if (this.state.kind === 'piece-candidate' && evt.pointerId === this.state.pointerId) {
            if (this.exceedsTapThreshold(evt, this.state.startX, this.state.startY)) {
                const { pieceId, pointerId } = this.state;
                this.state = { kind: 'piece-drag', pointerId, pieceId, startedAt: this.now() };
                this.container.setPointerCapture(pointerId);
                this.callbacks.onPieceDrag.start(pieceId, evt);
            }
            return;
        }
        if (this.state.kind === 'background-candidate' && evt.pointerId === this.state.pointerId) {
            if (this.exceedsTapThreshold(evt, this.state.startX, this.state.startY)) {
                const { pointerId } = this.state;
                this.state = { kind: 'background-pan', pointerId };
                this.container.setPointerCapture(pointerId);
                this.callbacks.onBackgroundPan.start(evt);
            }
            return;
        }
        if (this.state.kind === 'piece-drag' && evt.pointerId === this.state.pointerId) {
            this.callbacks.onPieceDrag.move(evt);
            return;
        }
        if (this.state.kind === 'background-pan' && evt.pointerId === this.state.pointerId) {
            this.callbacks.onBackgroundPan.move(evt);
            return;
        }
    }

    private onPointerUp(evt: PointerEvent): void {
        this.tracked.delete(evt.pointerId);

        if (this.state.kind === 'piece-candidate' && evt.pointerId === this.state.pointerId) {
            const { pieceId } = this.state;
            this.state = { kind: 'idle' };
            this.callbacks.onPieceTap(pieceId, evt);
            return;
        }
        if (this.state.kind === 'background-candidate' && evt.pointerId === this.state.pointerId) {
            this.state = { kind: 'idle' };
            return; // silent — no onBackgroundTap in vocabulary yet
        }
        if (this.state.kind === 'piece-drag' && evt.pointerId === this.state.pointerId) {
            this.releaseCapture(evt.pointerId);
            this.state = { kind: 'idle' };
            this.callbacks.onPieceDrag.end(evt);
            return;
        }
        if (this.state.kind === 'background-pan' && evt.pointerId === this.state.pointerId) {
            this.releaseCapture(evt.pointerId);
            this.state = { kind: 'idle' };
            this.callbacks.onBackgroundPan.end(evt);
            return;
        }
    }

    private onPointerCancel(_evt: PointerEvent): void {
        // Task 6: will use pinch, PINCH_GRACE_MS
        void this.pinch; void PINCH_GRACE_MS;
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
