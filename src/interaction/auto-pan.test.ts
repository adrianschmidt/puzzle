import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    computeAutoPanVelocity,
    AutoPanController,
    EDGE_ZONE_PX,
    MAX_PAN_SPEED_PX_PER_SEC,
} from './auto-pan.js';
import type { AutoPanCallbacks } from './auto-pan.js';
import type { Point } from '../model/types.js';

// --- computeAutoPanVelocity tests ---

describe('computeAutoPanVelocity', () => {
    const W = 1000;
    const H = 800;

    it('returns zero velocity when pointer is in the centre', () => {
        const v = computeAutoPanVelocity({ x: 500, y: 400 }, W, H);
        expect(v.x).toBe(0);
        expect(v.y).toBe(0);
    });

    it('returns zero velocity just inside the edge zone boundary', () => {
        const v = computeAutoPanVelocity({ x: EDGE_ZONE_PX, y: 400 }, W, H);
        expect(v.x).toBe(0);
        expect(v.y).toBe(0);
    });

    it('returns negative x velocity near the left edge', () => {
        const v = computeAutoPanVelocity({ x: 10, y: 400 }, W, H);
        expect(v.x).toBeLessThan(0);
        expect(v.y).toBe(0);
    });

    it('returns positive x velocity near the right edge', () => {
        const v = computeAutoPanVelocity({ x: W - 10, y: 400 }, W, H);
        expect(v.x).toBeGreaterThan(0);
        expect(v.y).toBe(0);
    });

    it('returns negative y velocity near the top edge', () => {
        const v = computeAutoPanVelocity({ x: 500, y: 10 }, W, H);
        expect(v.x).toBe(0);
        expect(v.y).toBeLessThan(0);
    });

    it('returns positive y velocity near the bottom edge', () => {
        const v = computeAutoPanVelocity({ x: 500, y: H - 10 }, W, H);
        expect(v.x).toBe(0);
        expect(v.y).toBeGreaterThan(0);
    });

    it('returns max speed at the very edge (x=0)', () => {
        const v = computeAutoPanVelocity({ x: 0, y: 400 }, W, H);
        expect(v.x).toBe(-MAX_PAN_SPEED_PX_PER_SEC);
    });

    it('returns max speed at the very bottom edge', () => {
        const v = computeAutoPanVelocity({ x: 500, y: H }, W, H);
        expect(v.y).toBe(MAX_PAN_SPEED_PX_PER_SEC);
    });

    it('returns diagonal velocity in a corner', () => {
        const v = computeAutoPanVelocity({ x: 0, y: 0 }, W, H);
        expect(v.x).toBe(-MAX_PAN_SPEED_PX_PER_SEC);
        expect(v.y).toBe(-MAX_PAN_SPEED_PX_PER_SEC);
    });

    it('velocity is proportional to depth into edge zone', () => {
        const halfwayIn = computeAutoPanVelocity({ x: EDGE_ZONE_PX / 2, y: 400 }, W, H);
        const fullyIn = computeAutoPanVelocity({ x: 0, y: 400 }, W, H);

        // At halfway, speed should be 50% of max
        expect(halfwayIn.x).toBeCloseTo(-MAX_PAN_SPEED_PX_PER_SEC * 0.5);
        // At edge, speed should be 100% of max
        expect(fullyIn.x).toBe(-MAX_PAN_SPEED_PX_PER_SEC);
    });

    it('respects custom edge zone and max speed', () => {
        const v = computeAutoPanVelocity(
            { x: 0, y: 400 },
            W,
            H,
            100,  // custom edge zone
            300,  // custom max speed
        );
        expect(v.x).toBe(-300);
    });
});

// --- AutoPanController tests ---

describe('AutoPanController', () => {
    let callbacks: AutoPanCallbacks;
    let panCalls: Point[];
    let moveCalls: Array<{ groupId: number; delta: Point }>;
    let renderCount: number;
    let controller: AutoPanController;

    beforeEach(() => {
        panCalls = [];
        moveCalls = [];
        renderCount = 0;

        // Ensure RAF/CAF exist on globalThis (missing in some test environments)
        if (!globalThis.requestAnimationFrame) {
            (globalThis as any).requestAnimationFrame = () => 0;
        }
        if (!globalThis.cancelAnimationFrame) {
            (globalThis as any).cancelAnimationFrame = () => {};
        }

        callbacks = {
            panViewport: (delta) => panCalls.push({ ...delta }),
            moveGroup: (groupId, delta) => moveCalls.push({ groupId, delta: { ...delta } }),
            screenDeltaToWorld: (d) => d, // identity (scale=1)
            requestRender: () => renderCount++,
            getViewportSize: () => ({ width: 1000, height: 800 }),
        };

        controller = new AutoPanController(callbacks);

        vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 1);
        vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('is not active initially', () => {
        expect(controller.isActive()).toBe(false);
    });

    it('becomes active after start()', () => {
        controller.start(42);
        expect(controller.isActive()).toBe(true);
    });

    it('becomes inactive after stop()', () => {
        controller.start(42);
        controller.stop();
        expect(controller.isActive()).toBe(false);
    });

    it('requests animation frame when pointer is updated', () => {
        controller.start(42);
        controller.updatePointer({ x: 5, y: 400 });
        expect(requestAnimationFrame).toHaveBeenCalled();
    });

    it('does not request animation frame without start()', () => {
        controller.updatePointer({ x: 5, y: 400 });
        expect(requestAnimationFrame).not.toHaveBeenCalled();
    });

    it('cancels animation frame on stop()', () => {
        controller.start(42);
        controller.updatePointer({ x: 5, y: 400 });
        controller.stop();
        expect(cancelAnimationFrame).toHaveBeenCalled();
    });
});
