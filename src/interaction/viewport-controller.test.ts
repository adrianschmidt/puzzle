/**
 * @vitest-environment jsdom
 */

/**
 * Tests for ViewportController.
 *
 * Tests the helper functions (pure) and the event handling logic.
 *
 * Pattern (mirrors drag-controller.test.ts and setup-drag.test.ts):
 *   - Use a real DOM container (`document.createElement('div')`) so the
 *     `target instanceof Element` check inside `isBackgroundElement`
 *     can succeed when needed.
 *   - Spy on `addEventListener` to capture handlers, then invoke them
 *     directly via a `fire(type, event)` helper. This avoids the
 *     event-construction quirks of jsdom's PointerEvent / WheelEvent.
 *   - Stub `setPointerCapture` / `hasPointerCapture` /
 *     `releasePointerCapture` since jsdom's pointer-capture support is
 *     incomplete and we only need to observe the calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    ViewportController,
    touchDistance,
    touchMidpoint,
} from './viewport-controller.js';
import { ViewportTransform } from './viewport-transform.js';

describe('touchDistance', () => {
    it('should return 0 for same point', () => {
        const p = { id: 1, x: 100, y: 200 };
        expect(touchDistance(p, p)).toBe(0);
    });

    it('should compute horizontal distance', () => {
        const a = { id: 1, x: 0, y: 0 };
        const b = { id: 2, x: 100, y: 0 };
        expect(touchDistance(a, b)).toBe(100);
    });

    it('should compute vertical distance', () => {
        const a = { id: 1, x: 0, y: 0 };
        const b = { id: 2, x: 0, y: 50 };
        expect(touchDistance(a, b)).toBe(50);
    });

    it('should compute diagonal distance', () => {
        const a = { id: 1, x: 0, y: 0 };
        const b = { id: 2, x: 3, y: 4 };
        expect(touchDistance(a, b)).toBe(5);
    });

    it('should be commutative', () => {
        const a = { id: 1, x: 10, y: 20 };
        const b = { id: 2, x: 30, y: 50 };
        expect(touchDistance(a, b)).toBe(touchDistance(b, a));
    });
});

describe('touchMidpoint', () => {
    it('should return the point itself when both are the same', () => {
        const p = { id: 1, x: 100, y: 200 };
        expect(touchMidpoint(p, p)).toEqual({ x: 100, y: 200 });
    });

    it('should compute midpoint on x-axis', () => {
        const a = { id: 1, x: 0, y: 0 };
        const b = { id: 2, x: 100, y: 0 };
        expect(touchMidpoint(a, b)).toEqual({ x: 50, y: 0 });
    });

    it('should compute midpoint on y-axis', () => {
        const a = { id: 1, x: 0, y: 0 };
        const b = { id: 2, x: 0, y: 80 };
        expect(touchMidpoint(a, b)).toEqual({ x: 0, y: 40 });
    });

    it('should compute midpoint diagonally', () => {
        const a = { id: 1, x: 10, y: 20 };
        const b = { id: 2, x: 30, y: 40 };
        expect(touchMidpoint(a, b)).toEqual({ x: 20, y: 30 });
    });

    it('should be commutative', () => {
        const a = { id: 1, x: 10, y: 20 };
        const b = { id: 2, x: 30, y: 50 };
        expect(touchMidpoint(a, b)).toEqual(touchMidpoint(b, a));
    });
});

// --- Test scaffolding for the ViewportController class ---

interface Harness {
    container: HTMLDivElement;
    transform: ViewportTransform;
    controller: ViewportController;
    onViewportChanged: ReturnType<typeof vi.fn>;
    isPieceElement: ReturnType<typeof vi.fn>;
    panSpy: ReturnType<typeof vi.fn>;
    zoomSpy: ReturnType<typeof vi.fn>;
    fire: (type: string, event: unknown) => void;
}

function setupHarness(opts: {
    isPieceElement?: (target: EventTarget | null) => boolean;
} = {}): Harness {
    const container = document.createElement('div');
    const handlers: Record<string, Array<(e: unknown) => void>> = {};
    const captured = new Set<number>();

    vi.spyOn(container, 'addEventListener').mockImplementation(
        (type: string, cb: EventListenerOrEventListenerObject) => {
            (handlers[type] ??= []).push(cb as (e: unknown) => void);
        },
    );
    vi.spyOn(container, 'removeEventListener').mockImplementation(
        (type: string, cb: EventListenerOrEventListenerObject) => {
            const arr = handlers[type] ?? [];
            const idx = arr.indexOf(cb as (e: unknown) => void);
            if (idx >= 0) arr.splice(idx, 1);
        },
    );
    // jsdom does not implement pointer capture; assign vi.fn shims directly.
    container.setPointerCapture = vi.fn((id: number) => {
        captured.add(id);
    });
    container.hasPointerCapture = vi.fn((id: number) => captured.has(id));
    container.releasePointerCapture = vi.fn((id: number) => {
        captured.delete(id);
    });

    const transform = new ViewportTransform();
    const panSpy = vi.spyOn(transform, 'pan');
    const zoomSpy = vi.spyOn(transform, 'zoom');
    const onViewportChanged = vi.fn();
    const isPieceElement = vi.fn(opts.isPieceElement ?? (() => false));

    const controller = new ViewportController({
        container,
        transform,
        onViewportChanged,
        isPieceElement,
    });

    return {
        container,
        transform,
        controller,
        onViewportChanged,
        isPieceElement,
        panSpy,
        zoomSpy,
        fire: (type, event) => {
            for (const cb of handlers[type] ?? []) cb(event);
        },
    };
}

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

interface FakeWheelEvent {
    deltaY: number;
    clientX: number;
    clientY: number;
    target: EventTarget | null;
    preventDefault: ReturnType<typeof vi.fn>;
}

function fakeWheelEvent(o: FakeWheelInit = {}): FakeWheelEvent {
    return {
        deltaY: o.deltaY ?? 0,
        clientX: o.clientX ?? 0,
        clientY: o.clientY ?? 0,
        target: o.target ?? null,
        preventDefault: vi.fn(),
    };
}

function makePuzzleTable(): HTMLElement {
    const el = document.createElement('div');
    el.dataset.puzzleTable = 'true';
    return el;
}

describe('ViewportController', () => {
    let h: Harness;

    beforeEach(() => {
        h = setupHarness();
    });

    describe('wheel zoom', () => {
        it('zooms when wheel target is the container background', () => {
            const event = fakeWheelEvent({
                deltaY: 100,
                clientX: 50,
                clientY: 60,
                target: h.container,
            });

            h.fire('wheel', event);

            expect(event.preventDefault).toHaveBeenCalled();
            expect(h.zoomSpy).toHaveBeenCalledTimes(1);
            expect(h.onViewportChanged).toHaveBeenCalledTimes(1);
        });

        it('zooms when wheel target is a child with data-puzzle-table=true', () => {
            const event = fakeWheelEvent({
                deltaY: 100,
                clientX: 0,
                clientY: 0,
                target: makePuzzleTable(),
            });

            h.fire('wheel', event);

            expect(event.preventDefault).toHaveBeenCalled();
            expect(h.zoomSpy).toHaveBeenCalled();
        });

        it('zooms when wheel target is a piece (per isPieceElement)', () => {
            const harness = setupHarness({ isPieceElement: () => true });
            const event = fakeWheelEvent({
                deltaY: 100,
                target: document.createElement('div'),
            });

            harness.fire('wheel', event);

            expect(event.preventDefault).toHaveBeenCalled();
            expect(harness.zoomSpy).toHaveBeenCalled();
        });

        it('does NOT zoom or preventDefault when target is neither background nor piece', () => {
            const event = fakeWheelEvent({
                deltaY: 100,
                target: document.createElement('div'),
            });

            h.fire('wheel', event);

            expect(event.preventDefault).not.toHaveBeenCalled();
            expect(h.zoomSpy).not.toHaveBeenCalled();
            expect(h.onViewportChanged).not.toHaveBeenCalled();
        });

        it('does NOT zoom when target is null', () => {
            const event = fakeWheelEvent({ deltaY: 100, target: null });

            h.fire('wheel', event);

            expect(event.preventDefault).not.toHaveBeenCalled();
            expect(h.zoomSpy).not.toHaveBeenCalled();
        });

        it('clamps extreme positive deltaY to factor 0.75', () => {
            // deltaY 99999 → clamped to 50 → factor = 1 - 50*0.005 = 0.75
            const event = fakeWheelEvent({
                deltaY: 99999,
                clientX: 100,
                clientY: 200,
                target: h.container,
            });

            h.fire('wheel', event);

            expect(h.zoomSpy).toHaveBeenCalledWith(0.75, { x: 100, y: 200 });
        });

        it('clamps extreme negative deltaY to factor 1.25', () => {
            // deltaY -99999 → clamped to -50 → factor = 1 - (-50)*0.005 = 1.25
            const event = fakeWheelEvent({
                deltaY: -99999,
                clientX: 0,
                clientY: 0,
                target: h.container,
            });

            h.fire('wheel', event);

            expect(h.zoomSpy).toHaveBeenCalledWith(1.25, { x: 0, y: 0 });
        });

        it('uses small deltaY without clamping (trackpad pinch)', () => {
            // deltaY 10 → factor = 1 - 10*0.005 = 0.95
            const event = fakeWheelEvent({
                deltaY: 10,
                clientX: 0,
                clientY: 0,
                target: h.container,
            });

            h.fire('wheel', event);

            expect(h.zoomSpy).toHaveBeenCalledWith(0.95, { x: 0, y: 0 });
        });
    });

    describe('pan', () => {
        it('starts pan when pointerdown lands on the container background', () => {
            h.fire(
                'pointerdown',
                fakePointerEvent({
                    pointerType: 'mouse',
                    target: h.container,
                    clientX: 100,
                    clientY: 200,
                    pointerId: 7,
                }),
            );

            expect(h.container.setPointerCapture).toHaveBeenCalledWith(7);
        });

        it('starts pan when pointerdown lands on a data-puzzle-table=true child', () => {
            h.fire(
                'pointerdown',
                fakePointerEvent({
                    target: makePuzzleTable(),
                    pointerId: 1,
                }),
            );

            expect(h.container.setPointerCapture).toHaveBeenCalledWith(1);
        });

        it('does NOT start pan if pointerdown lands on a piece', () => {
            const harness = setupHarness({ isPieceElement: () => true });

            harness.fire(
                'pointerdown',
                fakePointerEvent({
                    target: document.createElement('div'),
                    pointerId: 1,
                }),
            );

            expect(harness.container.setPointerCapture).not.toHaveBeenCalled();
        });

        it('does NOT start pan if pointerdown lands on a non-background element', () => {
            h.fire(
                'pointerdown',
                fakePointerEvent({
                    target: document.createElement('div'),
                    pointerId: 1,
                }),
            );

            expect(h.container.setPointerCapture).not.toHaveBeenCalled();
        });

        it('calls transform.pan with delta on pointermove during pan', () => {
            h.fire(
                'pointerdown',
                fakePointerEvent({
                    target: h.container,
                    clientX: 100,
                    clientY: 200,
                    pointerId: 1,
                }),
            );
            h.fire(
                'pointermove',
                fakePointerEvent({
                    target: h.container,
                    clientX: 130,
                    clientY: 220,
                    pointerId: 1,
                }),
            );

            expect(h.panSpy).toHaveBeenCalledWith({ x: 30, y: 20 });
            expect(h.onViewportChanged).toHaveBeenCalled();
        });

        it('accumulates pan deltas on subsequent moves', () => {
            h.fire(
                'pointerdown',
                fakePointerEvent({
                    target: h.container,
                    clientX: 0,
                    clientY: 0,
                    pointerId: 1,
                }),
            );
            h.fire(
                'pointermove',
                fakePointerEvent({
                    target: h.container,
                    clientX: 10,
                    clientY: 5,
                    pointerId: 1,
                }),
            );
            h.fire(
                'pointermove',
                fakePointerEvent({
                    target: h.container,
                    clientX: 30,
                    clientY: 20,
                    pointerId: 1,
                }),
            );

            expect(h.panSpy).toHaveBeenNthCalledWith(1, { x: 10, y: 5 });
            expect(h.panSpy).toHaveBeenNthCalledWith(2, { x: 20, y: 15 });
        });

        it('releases pointer capture and clears pan state on pointerup', () => {
            h.fire(
                'pointerdown',
                fakePointerEvent({ target: h.container, pointerId: 1 }),
            );
            h.fire('pointerup', fakePointerEvent({ pointerId: 1 }));

            expect(h.container.releasePointerCapture).toHaveBeenCalledWith(1);

            // After up, subsequent moves should not pan.
            h.panSpy.mockClear();
            h.fire(
                'pointermove',
                fakePointerEvent({
                    target: h.container,
                    clientX: 100,
                    clientY: 100,
                    pointerId: 1,
                }),
            );

            expect(h.panSpy).not.toHaveBeenCalled();
        });

        it('ignores pointermove from a different pointer than the active pan pointer', () => {
            h.fire(
                'pointerdown',
                fakePointerEvent({
                    target: h.container,
                    clientX: 0,
                    clientY: 0,
                    pointerId: 1,
                }),
            );
            h.fire(
                'pointermove',
                fakePointerEvent({
                    target: h.container,
                    clientX: 50,
                    clientY: 50,
                    pointerId: 2,
                }),
            );

            expect(h.panSpy).not.toHaveBeenCalled();
        });
    });

    describe('pinch', () => {
        function startTwoTouches(harness: Harness): void {
            harness.fire(
                'pointerdown',
                fakePointerEvent({
                    pointerType: 'touch',
                    target: harness.container,
                    clientX: 0,
                    clientY: 0,
                    pointerId: 1,
                }),
            );
            harness.fire(
                'pointerdown',
                fakePointerEvent({
                    pointerType: 'touch',
                    target: harness.container,
                    clientX: 100,
                    clientY: 0,
                    pointerId: 2,
                }),
            );
        }

        it('zooms by distance ratio on pinch move', () => {
            startTwoTouches(h);
            h.zoomSpy.mockClear();

            // Move pointer 2 to clientX=150 → distance 100 → 150, ratio 1.5.
            h.fire(
                'pointermove',
                fakePointerEvent({
                    pointerType: 'touch',
                    target: h.container,
                    clientX: 150,
                    clientY: 0,
                    pointerId: 2,
                }),
            );

            expect(h.zoomSpy).toHaveBeenCalledWith(1.5, { x: 75, y: 0 });
            expect(h.onViewportChanged).toHaveBeenCalled();
        });

        it('pans by midpoint movement on pinch move', () => {
            startTwoTouches(h);
            h.panSpy.mockClear();

            // Move pointer 2 from (100,0) to (110,10).
            // Midpoint goes from (50,0) to (55,5) → pan delta (5, 5).
            h.fire(
                'pointermove',
                fakePointerEvent({
                    pointerType: 'touch',
                    target: h.container,
                    clientX: 110,
                    clientY: 10,
                    pointerId: 2,
                }),
            );

            expect(h.panSpy).toHaveBeenCalledWith({ x: 5, y: 5 });
        });

        it('cancels active pan when a 2nd touch lands', () => {
            // First touch starts a pan.
            h.fire(
                'pointerdown',
                fakePointerEvent({
                    pointerType: 'touch',
                    target: h.container,
                    clientX: 100,
                    clientY: 100,
                    pointerId: 1,
                }),
            );
            h.fire(
                'pointermove',
                fakePointerEvent({
                    pointerType: 'touch',
                    target: h.container,
                    clientX: 110,
                    clientY: 100,
                    pointerId: 1,
                }),
            );
            expect(h.panSpy).toHaveBeenCalled();

            // 2nd touch → pinch starts, pan cancels.
            h.fire(
                'pointerdown',
                fakePointerEvent({
                    pointerType: 'touch',
                    target: h.container,
                    clientX: 200,
                    clientY: 100,
                    pointerId: 2,
                }),
            );

            // Lift the 2nd finger so we're back to one touch.
            h.fire('pointerup', fakePointerEvent({ pointerType: 'touch', pointerId: 2 }));

            h.panSpy.mockClear();

            // Move the still-active first finger. It must NOT resume pan,
            // because pan state was cleared when pinch took over.
            h.fire(
                'pointermove',
                fakePointerEvent({
                    pointerType: 'touch',
                    target: h.container,
                    clientX: 130,
                    clientY: 110,
                    pointerId: 1,
                }),
            );

            expect(h.panSpy).not.toHaveBeenCalled();
        });

        it('clears pinch state when one finger is lifted', () => {
            startTwoTouches(h);

            h.fire('pointerup', fakePointerEvent({ pointerType: 'touch', pointerId: 2 }));

            h.zoomSpy.mockClear();
            h.panSpy.mockClear();

            // Moving the remaining finger should NOT trigger pinch zoom/pan.
            h.fire(
                'pointermove',
                fakePointerEvent({
                    pointerType: 'touch',
                    target: h.container,
                    clientX: 50,
                    clientY: 50,
                    pointerId: 1,
                }),
            );

            expect(h.zoomSpy).not.toHaveBeenCalled();
            expect(h.panSpy).not.toHaveBeenCalled();
        });

        it('allows a fresh pan to start after pinch ends and both fingers lift', () => {
            startTwoTouches(h);
            h.fire('pointerup', fakePointerEvent({ pointerType: 'touch', pointerId: 2 }));
            h.fire('pointerup', fakePointerEvent({ pointerType: 'touch', pointerId: 1 }));

            h.panSpy.mockClear();

            // Fresh tap on background → new pan should work.
            h.fire(
                'pointerdown',
                fakePointerEvent({
                    pointerType: 'touch',
                    target: h.container,
                    clientX: 50,
                    clientY: 50,
                    pointerId: 3,
                }),
            );
            h.fire(
                'pointermove',
                fakePointerEvent({
                    pointerType: 'touch',
                    target: h.container,
                    clientX: 60,
                    clientY: 60,
                    pointerId: 3,
                }),
            );

            expect(h.panSpy).toHaveBeenCalledWith({ x: 10, y: 10 });
        });

        it('ignores zero-distance pinch (avoids divide-by-zero on touch overlap)', () => {
            // Both touches at the same point → distance 0.
            h.fire(
                'pointerdown',
                fakePointerEvent({
                    pointerType: 'touch',
                    target: h.container,
                    clientX: 50,
                    clientY: 50,
                    pointerId: 1,
                }),
            );
            h.fire(
                'pointerdown',
                fakePointerEvent({
                    pointerType: 'touch',
                    target: h.container,
                    clientX: 50,
                    clientY: 50,
                    pointerId: 2,
                }),
            );
            h.zoomSpy.mockClear();

            // Move one finger out → newDist/lastPinchDist = newDist/0 = Infinity, skip zoom.
            h.fire(
                'pointermove',
                fakePointerEvent({
                    pointerType: 'touch',
                    target: h.container,
                    clientX: 100,
                    clientY: 50,
                    pointerId: 2,
                }),
            );

            expect(h.zoomSpy).not.toHaveBeenCalled();
        });
    });

    describe('destroy', () => {
        it('removes all event listeners', () => {
            h.controller.destroy();

            expect(h.container.removeEventListener).toHaveBeenCalledWith(
                'wheel',
                expect.any(Function),
            );
            expect(h.container.removeEventListener).toHaveBeenCalledWith(
                'pointerdown',
                expect.any(Function),
            );
            expect(h.container.removeEventListener).toHaveBeenCalledWith(
                'pointermove',
                expect.any(Function),
            );
            expect(h.container.removeEventListener).toHaveBeenCalledWith(
                'pointerup',
                expect.any(Function),
            );
            expect(h.container.removeEventListener).toHaveBeenCalledWith(
                'pointercancel',
                expect.any(Function),
            );
        });
    });
});

describe('ViewportController — public gesture handlers', () => {
    function setup() {
        const transform = new ViewportTransform();
        const onChanged = vi.fn();
        const container = document.createElement('div');
        const vc = new ViewportController({
            container,
            transform,
            onViewportChanged: onChanged,
            isPieceElement: () => false,
        });
        return { vc, transform, onChanged };
    }

    it('handlePanStart + handlePanMove translates the transform by the pointer delta', () => {
        const { vc, transform, onChanged } = setup();
        vc.handlePanStart(fakePointerEvent({ clientX: 100, clientY: 200 }));
        vc.handlePanMove(fakePointerEvent({ clientX: 110, clientY: 205 }));
        expect(transform.getOffset()).toEqual({ x: 10, y: 5 });
        expect(onChanged).toHaveBeenCalled();
    });

    it('handlePinchStart + handlePinchMove zooms by the distance ratio', () => {
        const { vc, transform } = setup();
        vc.handlePinchStart(
            fakePointerEvent({ pointerId: 1, clientX: 100, clientY: 100 }),
            fakePointerEvent({ pointerId: 2, clientX: 200, clientY: 100 }),
        );
        vc.handlePinchMove(
            fakePointerEvent({ pointerId: 1, clientX: 100, clientY: 100 }),
            fakePointerEvent({ pointerId: 2, clientX: 300, clientY: 100 }),
        );
        // distance went from 100 → 200, factor 2 → scale doubled
        expect(transform.getScale()).toBeCloseTo(2.0, 5);
    });

    it('handlePanEnd does not throw', () => {
        const { vc } = setup();
        expect(() => vc.handlePanEnd()).not.toThrow();
    });
});
