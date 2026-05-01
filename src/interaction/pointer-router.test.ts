/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { PointerRouter } from './pointer-router.js';
import type { ClassifyTarget } from './pointer-router.js';

interface FakePointerInit {
    pointerId?: number;
    pointerType?: 'mouse' | 'touch' | 'pen';
    clientX?: number;
    clientY?: number;
    target?: EventTarget | null;
}

function fakePointerEvent(o: FakePointerInit = {}): PointerEvent {
    return {
        pointerId: o.pointerId ?? 1,
        pointerType: o.pointerType ?? 'mouse',
        clientX: o.clientX ?? 0,
        clientY: o.clientY ?? 0,
        target: o.target ?? null,
    } as PointerEvent;
}

interface FakeWheelInit {
    deltaY?: number;
    clientX?: number;
    clientY?: number;
    target?: EventTarget | null;
}

function fakeWheelEvent(o: FakeWheelInit = {}): WheelEvent {
    return {
        deltaY: o.deltaY ?? 0,
        clientX: o.clientX ?? 0,
        clientY: o.clientY ?? 0,
        target: o.target ?? null,
        preventDefault: vi.fn(),
    } as unknown as WheelEvent;
}

interface RouterHarness {
    container: HTMLElement;
    classifyTarget: ReturnType<typeof vi.fn>;
    fire: (type: string, evt: Event) => void;
    callbacks: {
        onPieceTap: ReturnType<typeof vi.fn>;
        onPieceDrag: { start: ReturnType<typeof vi.fn>; move: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
        onBackgroundPan: { start: ReturnType<typeof vi.fn>; move: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
        onPinch: { start: ReturnType<typeof vi.fn>; move: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
        onWheelZoom: ReturnType<typeof vi.fn>;
    };
    nowMock: ReturnType<typeof vi.fn>;
    router: PointerRouter;
}

function createHarness(opts: { classifyTarget?: ClassifyTarget } = {}): RouterHarness {
    const handlers: Record<string, Array<(e: Event) => void>> = {};
    const container = document.createElement('div');
    container.addEventListener = vi.fn((type: string, cb: EventListenerOrEventListenerObject) => {
        (handlers[type] ??= []).push(cb as (e: Event) => void);
    }) as typeof container.addEventListener;
    container.removeEventListener = vi.fn((type: string, cb: EventListenerOrEventListenerObject) => {
        const arr = handlers[type] ?? [];
        const idx = arr.indexOf(cb as (e: Event) => void);
        if (idx >= 0) arr.splice(idx, 1);
    }) as typeof container.removeEventListener;
    container.setPointerCapture = vi.fn();
    container.hasPointerCapture = vi.fn(() => false);
    container.releasePointerCapture = vi.fn();

    const classifyTarget = vi.fn(opts.classifyTarget ?? ((_t) => ({ kind: 'ignore' as const })));

    const callbacks = {
        onPieceTap: vi.fn(),
        onPieceDrag: { start: vi.fn(), move: vi.fn(), end: vi.fn(), cancel: vi.fn() },
        onBackgroundPan: { start: vi.fn(), move: vi.fn(), end: vi.fn(), cancel: vi.fn() },
        onPinch: { start: vi.fn(), move: vi.fn(), end: vi.fn() },
        onWheelZoom: vi.fn(),
    };

    let nowValue = 0;
    const nowMock = vi.fn(() => nowValue);
    (nowMock as unknown as { advance: (ms: number) => void }).advance = (ms: number) => { nowValue += ms; };

    const router = new PointerRouter({
        container,
        classifyTarget,
        now: nowMock,
        ...callbacks,
    });

    return {
        container,
        classifyTarget,
        fire: (type, evt) => { for (const cb of handlers[type] ?? []) cb(evt); },
        callbacks,
        nowMock,
        router,
    };
}

describe('PointerRouter — construction & wheel', () => {
    it('attaches container listeners on construction', () => {
        const h = createHarness();
        expect(h.container.addEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
        expect(h.container.addEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
        expect(h.container.addEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
        expect(h.container.addEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
        expect(h.container.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), expect.objectContaining({ passive: false }));
    });

    it('removes listeners on destroy', () => {
        const h = createHarness();
        h.router.destroy();
        expect(h.container.removeEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
        expect(h.container.removeEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
        expect(h.container.removeEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
        expect(h.container.removeEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
        expect(h.container.removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function));
    });

    it('dispatches onWheelZoom for wheel events on a piece target and prevents default', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 1 }) });
        const evt = fakeWheelEvent();
        h.fire('wheel', evt);
        expect(h.callbacks.onWheelZoom).toHaveBeenCalledWith(evt);
        expect(evt.preventDefault).toHaveBeenCalled();
    });

    it('dispatches onWheelZoom for wheel events on a background target and prevents default', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'background' }) });
        const evt = fakeWheelEvent();
        h.fire('wheel', evt);
        expect(h.callbacks.onWheelZoom).toHaveBeenCalledWith(evt);
        expect(evt.preventDefault).toHaveBeenCalled();
    });

    it('does NOT dispatch onWheelZoom or call preventDefault for ignore targets', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'ignore' }) });
        const evt = fakeWheelEvent();
        h.fire('wheel', evt);
        expect(h.callbacks.onWheelZoom).not.toHaveBeenCalled();
        expect(evt.preventDefault).not.toHaveBeenCalled();
    });
});

describe('PointerRouter — piece tap', () => {
    it('emits onPieceTap on pointerup before threshold is crossed', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 7 }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 100, clientY: 100 }));
        const upEvt = fakePointerEvent({ pointerId: 1, clientX: 102, clientY: 101 });
        h.fire('pointerup', upEvt);

        expect(h.callbacks.onPieceTap).toHaveBeenCalledWith(7, upEvt);
        expect(h.callbacks.onPieceDrag.start).not.toHaveBeenCalled();
    });

    it('does not capture pointer for a tap', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 7 }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1 }));
        h.fire('pointerup', fakePointerEvent({ pointerId: 1 }));
        expect(h.container.setPointerCapture).not.toHaveBeenCalled();
    });
});

describe('PointerRouter — piece drag', () => {
    it('emits onPieceDrag.start when movement crosses tap threshold', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 7 }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 100, clientY: 100 }));
        const moveEvt = fakePointerEvent({ pointerId: 1, clientX: 110, clientY: 100 });
        h.fire('pointermove', moveEvt);

        expect(h.callbacks.onPieceDrag.start).toHaveBeenCalledWith(7, moveEvt);
        expect(h.callbacks.onPieceTap).not.toHaveBeenCalled();
    });

    it('captures pointer at drag start', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 7 }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 42, clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 42, clientX: 20, clientY: 0 }));

        expect(h.container.setPointerCapture).toHaveBeenCalledWith(42);
    });

    it('emits onPieceDrag.move for subsequent moves once dragging', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 7 }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 20, clientY: 0 })); // promote
        const second = fakePointerEvent({ pointerId: 1, clientX: 30, clientY: 0 });
        h.fire('pointermove', second);

        expect(h.callbacks.onPieceDrag.move).toHaveBeenCalledWith(second);
    });

    it('emits onPieceDrag.end and releases capture on pointerup', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 7 }) });
        (h.container.hasPointerCapture as ReturnType<typeof vi.fn>).mockReturnValue(true);
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 20, clientY: 0 })); // promote
        const upEvt = fakePointerEvent({ pointerId: 1, clientX: 30, clientY: 0 });
        h.fire('pointerup', upEvt);

        expect(h.callbacks.onPieceDrag.end).toHaveBeenCalledWith(upEvt);
        expect(h.container.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    it('does not promote when movement stays below threshold', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 7 }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 5, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 7, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 5 }));

        expect(h.callbacks.onPieceDrag.start).not.toHaveBeenCalled();
        expect(h.callbacks.onPieceDrag.move).not.toHaveBeenCalled();
    });

    it('uses Euclidean distance for the threshold check', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 7 }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        // 6,6 ≈ 8.49 px — over the 8 px threshold
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 6, clientY: 6 }));

        expect(h.callbacks.onPieceDrag.start).toHaveBeenCalled();
    });
});

describe('PointerRouter — background pan', () => {
    it('does not start pan on pointerdown alone', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'background' }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        expect(h.callbacks.onBackgroundPan.start).not.toHaveBeenCalled();
    });

    it('emits onBackgroundPan.start when movement crosses threshold and captures pointer', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'background' }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        const moveEvt = fakePointerEvent({ pointerId: 1, clientX: 20, clientY: 0 });
        h.fire('pointermove', moveEvt);

        expect(h.callbacks.onBackgroundPan.start).toHaveBeenCalledWith(moveEvt);
        expect(h.container.setPointerCapture).toHaveBeenCalledWith(1);
    });

    it('emits onBackgroundPan.move for subsequent moves once panning', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'background' }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 20, clientY: 0 }));
        const second = fakePointerEvent({ pointerId: 1, clientX: 30, clientY: 0 });
        h.fire('pointermove', second);

        expect(h.callbacks.onBackgroundPan.move).toHaveBeenCalledWith(second);
    });

    it('emits onBackgroundPan.end and releases capture on pointerup', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'background' }) });
        (h.container.hasPointerCapture as ReturnType<typeof vi.fn>).mockReturnValue(true);
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 20, clientY: 0 }));
        const upEvt = fakePointerEvent({ pointerId: 1, clientX: 25, clientY: 0 });
        h.fire('pointerup', upEvt);

        expect(h.callbacks.onBackgroundPan.end).toHaveBeenCalledWith(upEvt);
        expect(h.container.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    it('background pointerup before threshold is silent (no event)', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'background' }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointerup', fakePointerEvent({ pointerId: 1, clientX: 2, clientY: 0 }));

        expect(h.callbacks.onBackgroundPan.start).not.toHaveBeenCalled();
        expect(h.callbacks.onBackgroundPan.end).not.toHaveBeenCalled();
        expect(h.callbacks.onPieceTap).not.toHaveBeenCalled();
    });

    it('ignores pointerdown on ignore targets', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'ignore' }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 50, clientY: 0 }));
        h.fire('pointerup', fakePointerEvent({ pointerId: 1, clientX: 50, clientY: 0 }));

        expect(h.callbacks.onPieceTap).not.toHaveBeenCalled();
        expect(h.callbacks.onPieceDrag.start).not.toHaveBeenCalled();
        expect(h.callbacks.onBackgroundPan.start).not.toHaveBeenCalled();
    });
});

describe('PointerRouter — pinch (from idle)', () => {
    function pieceClassifier(): ClassifyTarget {
        return () => ({ kind: 'piece', pieceId: 1 });
    }

    it('starts a pinch when a 2nd touch pointer lands (both touches)', () => {
        const h = createHarness({ classifyTarget: pieceClassifier() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));

        expect(h.callbacks.onPinch.start).toHaveBeenCalledTimes(1);
        const [a, b] = h.callbacks.onPinch.start.mock.calls[0];
        expect([a.pointerId, b.pointerId].sort()).toEqual([1, 2]);
    });

    it('does not start a pinch from mouse + touch', () => {
        const h = createHarness({ classifyTarget: pieceClassifier() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0 }));
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));

        expect(h.callbacks.onPinch.start).not.toHaveBeenCalled();
    });

    it('emits onPinch.move when either pair member moves', () => {
        const h = createHarness({ classifyTarget: pieceClassifier() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 5, clientY: 0 }));

        expect(h.callbacks.onPinch.move).toHaveBeenCalledTimes(1);
        const [a, b] = h.callbacks.onPinch.move.mock.calls[0];
        // Both args are the latest known positions of the locked pair
        expect((a.pointerId === 1 ? a.clientX : b.clientX)).toBe(5);
    });

    it('locks the pair: a 3rd touch does not replace pair members', () => {
        const h = createHarness({ classifyTarget: pieceClassifier() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));
        h.callbacks.onPinch.start.mockClear();

        h.fire('pointerdown', fakePointerEvent({ pointerId: 3, pointerType: 'touch', clientX: 200, clientY: 0 }));
        expect(h.callbacks.onPinch.start).not.toHaveBeenCalled();

        h.fire('pointermove', fakePointerEvent({ pointerId: 3, pointerType: 'touch', clientX: 210, clientY: 0 }));
        expect(h.callbacks.onPinch.move).not.toHaveBeenCalled();
    });

    it('ends pinch when either pair member lifts', () => {
        const h = createHarness({ classifyTarget: pieceClassifier() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));
        h.fire('pointerup', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));

        expect(h.callbacks.onPinch.end).toHaveBeenCalledTimes(1);
    });

    it('lifting a non-pair-member 3rd touch does not end pinch', () => {
        const h = createHarness({ classifyTarget: pieceClassifier() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));
        h.fire('pointerdown', fakePointerEvent({ pointerId: 3, pointerType: 'touch', clientX: 200, clientY: 0 }));
        h.fire('pointerup', fakePointerEvent({ pointerId: 3, pointerType: 'touch', clientX: 200, clientY: 0 }));

        expect(h.callbacks.onPinch.end).not.toHaveBeenCalled();
    });
});
