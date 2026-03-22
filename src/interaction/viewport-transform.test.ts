/**
 * Tests for ViewportTransform.
 *
 * Verifies coordinate conversion, zoom-around-point, pan,
 * and scale clamping behavior.
 */

import { describe, it, expect } from 'vitest';
import {
    ViewportTransform,
    clampScale,
    MIN_SCALE,
    MAX_SCALE,
    WHEEL_ZOOM_FACTOR,
} from './viewport-transform.js';

describe('ViewportTransform', () => {
    describe('initial state', () => {
        it('should default to identity transform', () => {
            const vt = new ViewportTransform();
            expect(vt.getScale()).toBe(1);
            expect(vt.getOffset()).toEqual({ x: 0, y: 0 });
        });

        it('should accept initial state', () => {
            const vt = new ViewportTransform({ scale: 2, offset: { x: 10, y: 20 } });
            expect(vt.getScale()).toBe(2);
            expect(vt.getOffset()).toEqual({ x: 10, y: 20 });
        });

        it('should accept partial initial state', () => {
            const vt = new ViewportTransform({ scale: 0.5 });
            expect(vt.getScale()).toBe(0.5);
            expect(vt.getOffset()).toEqual({ x: 0, y: 0 });
        });
    });

    describe('screenToWorld', () => {
        it('should be identity at default transform', () => {
            const vt = new ViewportTransform();
            expect(vt.screenToWorld({ x: 100, y: 200 })).toEqual({ x: 100, y: 200 });
        });

        it('should account for scale', () => {
            const vt = new ViewportTransform({ scale: 2 });
            expect(vt.screenToWorld({ x: 200, y: 100 })).toEqual({ x: 100, y: 50 });
        });

        it('should account for offset', () => {
            const vt = new ViewportTransform({ offset: { x: 50, y: 30 } });
            expect(vt.screenToWorld({ x: 150, y: 130 })).toEqual({ x: 100, y: 100 });
        });

        it('should account for both scale and offset', () => {
            const vt = new ViewportTransform({ scale: 2, offset: { x: 50, y: 30 } });
            // world = (screen - offset) / scale = (150 - 50) / 2 = 50, (130 - 30) / 2 = 50
            expect(vt.screenToWorld({ x: 150, y: 130 })).toEqual({ x: 50, y: 50 });
        });

        it('should handle negative world coordinates', () => {
            const vt = new ViewportTransform({ offset: { x: 100, y: 100 } });
            expect(vt.screenToWorld({ x: 50, y: 50 })).toEqual({ x: -50, y: -50 });
        });
    });

    describe('worldToScreen', () => {
        it('should be identity at default transform', () => {
            const vt = new ViewportTransform();
            expect(vt.worldToScreen({ x: 100, y: 200 })).toEqual({ x: 100, y: 200 });
        });

        it('should account for scale', () => {
            const vt = new ViewportTransform({ scale: 2 });
            expect(vt.worldToScreen({ x: 100, y: 50 })).toEqual({ x: 200, y: 100 });
        });

        it('should account for offset', () => {
            const vt = new ViewportTransform({ offset: { x: 50, y: 30 } });
            expect(vt.worldToScreen({ x: 100, y: 100 })).toEqual({ x: 150, y: 130 });
        });

        it('should be inverse of screenToWorld', () => {
            const vt = new ViewportTransform({ scale: 1.5, offset: { x: -20, y: 40 } });
            const screen = { x: 300, y: 200 };
            const world = vt.screenToWorld(screen);
            const back = vt.worldToScreen(world);
            expect(back.x).toBeCloseTo(screen.x);
            expect(back.y).toBeCloseTo(screen.y);
        });
    });

    describe('screenDeltaToWorld', () => {
        it('should be identity at scale 1', () => {
            const vt = new ViewportTransform();
            expect(vt.screenDeltaToWorld({ x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
        });

        it('should scale deltas', () => {
            const vt = new ViewportTransform({ scale: 2 });
            expect(vt.screenDeltaToWorld({ x: 20, y: 10 })).toEqual({ x: 10, y: 5 });
        });

        it('should not be affected by offset', () => {
            const vt = new ViewportTransform({ scale: 2, offset: { x: 999, y: 999 } });
            expect(vt.screenDeltaToWorld({ x: 20, y: 10 })).toEqual({ x: 10, y: 5 });
        });
    });

    describe('pan', () => {
        it('should update offset by screen delta', () => {
            const vt = new ViewportTransform();
            vt.pan({ x: 30, y: -20 });
            expect(vt.getOffset()).toEqual({ x: 30, y: -20 });
        });

        it('should accumulate pans', () => {
            const vt = new ViewportTransform();
            vt.pan({ x: 10, y: 10 });
            vt.pan({ x: 20, y: -5 });
            expect(vt.getOffset()).toEqual({ x: 30, y: 5 });
        });

        it('should not affect scale', () => {
            const vt = new ViewportTransform({ scale: 2 });
            vt.pan({ x: 50, y: 50 });
            expect(vt.getScale()).toBe(2);
        });
    });

    describe('zoom', () => {
        it('should change scale by factor', () => {
            const vt = new ViewportTransform();
            vt.zoom(2, { x: 0, y: 0 });
            expect(vt.getScale()).toBe(2);
        });

        it('should keep focus point fixed on screen (zoom at origin)', () => {
            const vt = new ViewportTransform();
            const focus = { x: 0, y: 0 };
            vt.zoom(2, focus);
            // After zooming around origin with no initial offset,
            // the world point at origin should still map to screen origin.
            const screen = vt.worldToScreen({ x: 0, y: 0 });
            expect(screen.x).toBeCloseTo(0);
            expect(screen.y).toBeCloseTo(0);
        });

        it('should keep focus point fixed on screen (zoom at center)', () => {
            const vt = new ViewportTransform();
            const focus = { x: 400, y: 300 };

            // Before zoom: screen (400, 300) maps to world (400, 300)
            const worldBefore = vt.screenToWorld(focus);

            vt.zoom(2, focus);

            // After zoom: same world point should still map to same screen point
            const screenAfter = vt.worldToScreen(worldBefore);
            expect(screenAfter.x).toBeCloseTo(focus.x);
            expect(screenAfter.y).toBeCloseTo(focus.y);
        });

        it('should keep focus point fixed with offset', () => {
            const vt = new ViewportTransform({ scale: 1.5, offset: { x: -100, y: -50 } });
            const focus = { x: 300, y: 200 };
            const worldBefore = vt.screenToWorld(focus);

            vt.zoom(0.8, focus);

            const screenAfter = vt.worldToScreen(worldBefore);
            expect(screenAfter.x).toBeCloseTo(focus.x);
            expect(screenAfter.y).toBeCloseTo(focus.y);
        });

        it('should clamp zoom at MIN_SCALE', () => {
            const vt = new ViewportTransform({ scale: MIN_SCALE });
            vt.zoom(0.5, { x: 0, y: 0 });
            expect(vt.getScale()).toBe(MIN_SCALE);
        });

        it('should clamp zoom at MAX_SCALE', () => {
            const vt = new ViewportTransform({ scale: MAX_SCALE });
            vt.zoom(2, { x: 0, y: 0 });
            expect(vt.getScale()).toBe(MAX_SCALE);
        });

        it('should handle zoom out (factor < 1)', () => {
            const vt = new ViewportTransform({ scale: 2 });
            vt.zoom(0.5, { x: 0, y: 0 });
            expect(vt.getScale()).toBe(1);
        });

        it('should handle sequential zooms', () => {
            const vt = new ViewportTransform();
            const focus = { x: 200, y: 150 };
            const worldBefore = vt.screenToWorld(focus);

            vt.zoom(1.5, focus);
            vt.zoom(1.5, focus);

            // Focus point should still be fixed
            const screenAfter = vt.worldToScreen(worldBefore);
            expect(screenAfter.x).toBeCloseTo(focus.x);
            expect(screenAfter.y).toBeCloseTo(focus.y);
            expect(vt.getScale()).toBeCloseTo(2.25);
        });
    });

    describe('setState', () => {
        it('should set state directly', () => {
            const vt = new ViewportTransform();
            vt.setState({ scale: 3, offset: { x: 100, y: 200 } });
            expect(vt.getScale()).toBe(3);
            expect(vt.getOffset()).toEqual({ x: 100, y: 200 });
        });

        it('should clamp scale', () => {
            const vt = new ViewportTransform();
            vt.setState({ scale: 100, offset: { x: 0, y: 0 } });
            expect(vt.getScale()).toBe(MAX_SCALE);
        });
    });

    describe('reset', () => {
        it('should reset to identity', () => {
            const vt = new ViewportTransform({ scale: 3, offset: { x: 100, y: 200 } });
            vt.reset();
            expect(vt.getScale()).toBe(1);
            expect(vt.getOffset()).toEqual({ x: 0, y: 0 });
        });
    });

    describe('getState immutability', () => {
        it('should return a copy, not a reference', () => {
            const vt = new ViewportTransform({ offset: { x: 10, y: 20 } });
            const state = vt.getState();
            state.offset.x = 999;
            expect(vt.getOffset().x).toBe(10);
        });
    });
});

describe('clampScale', () => {
    it('should clamp below MIN_SCALE', () => {
        expect(clampScale(0.01)).toBe(MIN_SCALE);
    });

    it('should clamp above MAX_SCALE', () => {
        expect(clampScale(100)).toBe(MAX_SCALE);
    });

    it('should not clamp within range', () => {
        expect(clampScale(1.5)).toBe(1.5);
    });

    it('should return boundary values exactly', () => {
        expect(clampScale(MIN_SCALE)).toBe(MIN_SCALE);
        expect(clampScale(MAX_SCALE)).toBe(MAX_SCALE);
    });
});

describe('WHEEL_ZOOM_FACTOR', () => {
    it('should be greater than 1', () => {
        expect(WHEEL_ZOOM_FACTOR).toBeGreaterThan(1);
    });
});
