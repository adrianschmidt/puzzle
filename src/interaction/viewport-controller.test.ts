/**
 * @vitest-environment jsdom
 */

/**
 * Tests for ViewportController.
 *
 * Tests the helper functions (pure math) and the public gesture handler methods.
 * Listener-attachment tests were removed in Task 9 — PointerRouter now owns
 * all container listeners; ViewportController only contains gesture math.
 */

import { describe, it, expect, vi } from 'vitest';
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

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function fakePointerEvent(o: {
    pointerId?: number;
    clientX?: number;
    clientY?: number;
} = {}): PointerEvent {
    return {
        pointerId: o.pointerId ?? 1,
        clientX: o.clientX ?? 0,
        clientY: o.clientY ?? 0,
    } as PointerEvent;
}

function setup() {
    const transform = new ViewportTransform();
    const onChanged = vi.fn();
    const vc = new ViewportController(transform, onChanged);
    const panSpy = vi.spyOn(transform, 'pan');
    const zoomSpy = vi.spyOn(transform, 'zoom');
    return { vc, transform, onChanged, panSpy, zoomSpy };
}

// ---------------------------------------------------------------------------
// Pan handler math
// ---------------------------------------------------------------------------

describe('ViewportController — pan', () => {
    it('handlePanStart + handlePanMove translates the transform by the pointer delta', () => {
        const { vc, transform, onChanged } = setup();
        vc.handlePanStart(fakePointerEvent({ clientX: 100, clientY: 200 }));
        vc.handlePanMove(fakePointerEvent({ clientX: 110, clientY: 205 }));
        expect(transform.getOffset()).toEqual({ x: 10, y: 5 });
        expect(onChanged).toHaveBeenCalled();
    });

    it('accumulates pan deltas on subsequent moves', () => {
        const { vc, panSpy } = setup();
        vc.handlePanStart(fakePointerEvent({ clientX: 0, clientY: 0 }));
        vc.handlePanMove(fakePointerEvent({ clientX: 10, clientY: 5 }));
        vc.handlePanMove(fakePointerEvent({ clientX: 30, clientY: 20 }));
        expect(panSpy).toHaveBeenNthCalledWith(1, { x: 10, y: 5 });
        expect(panSpy).toHaveBeenNthCalledWith(2, { x: 20, y: 15 });
    });

    it('handlePanMove is a no-op before handlePanStart', () => {
        const { vc, panSpy } = setup();
        vc.handlePanMove(fakePointerEvent({ clientX: 50, clientY: 50 }));
        expect(panSpy).not.toHaveBeenCalled();
    });

    it('handlePanEnd clears pan state so subsequent moves are no-ops', () => {
        const { vc, panSpy } = setup();
        vc.handlePanStart(fakePointerEvent({ clientX: 0, clientY: 0 }));
        vc.handlePanEnd();
        panSpy.mockClear();
        vc.handlePanMove(fakePointerEvent({ clientX: 50, clientY: 50 }));
        expect(panSpy).not.toHaveBeenCalled();
    });

    it('handlePanEnd does not throw when called without a prior start', () => {
        const { vc } = setup();
        expect(() => vc.handlePanEnd()).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Pinch handler math
// ---------------------------------------------------------------------------

describe('ViewportController — pinch', () => {
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

    it('handlePinchMove pans by midpoint movement', () => {
        const { vc, panSpy } = setup();
        // fingers at (0,0) and (100,0) → midpoint (50,0)
        vc.handlePinchStart(
            fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }),
            fakePointerEvent({ pointerId: 2, clientX: 100, clientY: 0 }),
        );
        panSpy.mockClear();
        // move finger 2 to (110,10) → midpoint (55,5) → pan delta (5,5)
        vc.handlePinchMove(
            fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }),
            fakePointerEvent({ pointerId: 2, clientX: 110, clientY: 10 }),
        );
        expect(panSpy).toHaveBeenCalledWith({ x: 5, y: 5 });
    });

    it('handlePinchMove is a no-op before handlePinchStart', () => {
        const { vc, zoomSpy, panSpy } = setup();
        vc.handlePinchMove(
            fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }),
            fakePointerEvent({ pointerId: 2, clientX: 100, clientY: 0 }),
        );
        expect(zoomSpy).not.toHaveBeenCalled();
        expect(panSpy).not.toHaveBeenCalled();
    });

    it('ignores zero-distance pinch (avoids divide-by-zero on touch overlap)', () => {
        const { vc, zoomSpy } = setup();
        // Both touches at the same point → distance 0
        vc.handlePinchStart(
            fakePointerEvent({ pointerId: 1, clientX: 50, clientY: 50 }),
            fakePointerEvent({ pointerId: 2, clientX: 50, clientY: 50 }),
        );
        zoomSpy.mockClear();
        // Move one finger out → newDist/lastPinchDist = newDist/0 = Infinity, skip zoom
        vc.handlePinchMove(
            fakePointerEvent({ pointerId: 1, clientX: 50, clientY: 50 }),
            fakePointerEvent({ pointerId: 2, clientX: 100, clientY: 50 }),
        );
        expect(zoomSpy).not.toHaveBeenCalled();
    });

    it('handlePinchEnd clears pinch state', () => {
        const { vc, zoomSpy } = setup();
        vc.handlePinchStart(
            fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }),
            fakePointerEvent({ pointerId: 2, clientX: 100, clientY: 0 }),
        );
        vc.handlePinchEnd();
        zoomSpy.mockClear();
        vc.handlePinchMove(
            fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }),
            fakePointerEvent({ pointerId: 2, clientX: 150, clientY: 0 }),
        );
        expect(zoomSpy).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Wheel handler math
// ---------------------------------------------------------------------------

describe('ViewportController — wheel', () => {
    function fakeWheelEvent(o: {
        deltaY?: number;
        clientX?: number;
        clientY?: number;
    } = {}): WheelEvent {
        return {
            deltaY: o.deltaY ?? 0,
            clientX: o.clientX ?? 0,
            clientY: o.clientY ?? 0,
            preventDefault: vi.fn(),
        } as unknown as WheelEvent;
    }

    it('calls preventDefault and zooms', () => {
        const { vc, zoomSpy, onChanged } = setup();
        const evt = fakeWheelEvent({ deltaY: 10, clientX: 50, clientY: 60 });
        vc.handleWheel(evt);
        expect((evt as unknown as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault).toHaveBeenCalled();
        expect(zoomSpy).toHaveBeenCalledTimes(1);
        expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it('clamps extreme positive deltaY to factor 0.75', () => {
        // deltaY 99999 → clamped to 50 → factor = 1 - 50*0.005 = 0.75
        const { vc, zoomSpy } = setup();
        const evt = fakeWheelEvent({ deltaY: 99999, clientX: 100, clientY: 200 });
        vc.handleWheel(evt);
        expect(zoomSpy).toHaveBeenCalledWith(0.75, { x: 100, y: 200 });
    });

    it('clamps extreme negative deltaY to factor 1.25', () => {
        // deltaY -99999 → clamped to -50 → factor = 1 - (-50)*0.005 = 1.25
        const { vc, zoomSpy } = setup();
        const evt = fakeWheelEvent({ deltaY: -99999, clientX: 0, clientY: 0 });
        vc.handleWheel(evt);
        expect(zoomSpy).toHaveBeenCalledWith(1.25, { x: 0, y: 0 });
    });

    it('uses small deltaY without clamping (trackpad pinch)', () => {
        // deltaY 10 → factor = 1 - 10*0.005 = 0.95
        const { vc, zoomSpy } = setup();
        const evt = fakeWheelEvent({ deltaY: 10, clientX: 0, clientY: 0 });
        vc.handleWheel(evt);
        expect(zoomSpy).toHaveBeenCalledWith(0.95, { x: 0, y: 0 });
    });
});
