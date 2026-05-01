/**
 * Tests for DragController.
 *
 * Uses mock callbacks and fake PointerEvents to verify
 * drag logic without needing a real DOM.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DragController } from './drag-controller.js';
import type { DragCallbacks } from './drag-controller.js';
import type { PieceGroup } from '../model/types.js';

/** Create a minimal fake PointerEvent with the fields DragController uses. */
function fakePointerEvent(
    overrides: Partial<{
        clientX: number;
        clientY: number;
        pointerId: number;
    }> = {},
): PointerEvent {
    return {
        clientX: overrides.clientX ?? 0,
        clientY: overrides.clientY ?? 0,
        pointerId: overrides.pointerId ?? 1,
    } as PointerEvent;
}

function makeGroup(
    id: number,
    pieceIds: number[],
    position = { x: 0, y: 0 },
): PieceGroup {
    const pieces = new Map<number, { x: number; y: number }>();
    for (const pid of pieceIds) {
        pieces.set(pid, { x: 0, y: 0 });
    }

    return { id, pieces, position, rotation: 0 };
}

describe('DragController', () => {
    let groups: PieceGroup[];
    let callbacks: DragCallbacks;
    let controller: DragController;

    beforeEach(() => {
        groups = [
            makeGroup(1, [10, 11]),
            makeGroup(2, [20]),
            makeGroup(3, [30, 31, 32]),
        ];

        callbacks = {
            moveGroup: vi.fn(),
            bringToFront: vi.fn(),
            requestRender: vi.fn(),
        };

        // Provide a large viewport so pointer clamping doesn't
        // affect existing test values.
        controller = new DragController(
            () => groups,
            callbacks,
            () => ({ width: 10000, height: 10000 }),
        );
    });

    describe('handlePointerDown', () => {
        it('should start a drag for the group containing the piece', () => {
            const event = fakePointerEvent({
                clientX: 100,
                clientY: 200,
                pointerId: 5,
            });

            controller.handlePointerDown(10, event);

            const drag = controller.getActiveDrag();
            expect(drag).not.toBeNull();
            expect(drag!.groupId).toBe(1);
            expect(drag!.lastPointer).toEqual({ x: 100, y: 200 });
            expect(drag!.pointerId).toBe(5);
            expect(drag!.startPosition).toEqual({ x: 0, y: 0 });
        });

        it('should bring the group to front', () => {
            controller.handlePointerDown(
                20,
                fakePointerEvent({ pointerId: 1 }),
            );

            expect(callbacks.bringToFront).toHaveBeenCalledWith(2);
        });

        it('should request a render', () => {
            controller.handlePointerDown(
                10,
                fakePointerEvent({ pointerId: 1 }),
            );

            expect(callbacks.requestRender).toHaveBeenCalled();
        });

        it('should throw if piece is not in any group', () => {
            expect(() =>
                controller.handlePointerDown(
                    999,
                    fakePointerEvent({ pointerId: 1 }),
                ),
            ).toThrow('Piece 999 is not in any group');
        });

        it('should work with different pieces in the same group', () => {
            controller.handlePointerDown(
                11,
                fakePointerEvent({ pointerId: 1 }),
            );

            const drag = controller.getActiveDrag();
            expect(drag!.groupId).toBe(1);
        });
    });

    describe('handlePointerMove', () => {
        it('should compute delta and call moveGroup', () => {
            controller.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 100,
                    clientY: 200,
                    pointerId: 1,
                }),
            );

            controller.handlePointerMove(
                fakePointerEvent({
                    clientX: 115,
                    clientY: 210,
                    pointerId: 1,
                }),
            );

            expect(callbacks.moveGroup).toHaveBeenCalledWith(1, {
                x: 15,
                y: 10,
            });
        });

        it('should accumulate deltas from multiple moves', () => {
            controller.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 100,
                    clientY: 100,
                    pointerId: 1,
                }),
            );

            controller.handlePointerMove(
                fakePointerEvent({
                    clientX: 110,
                    clientY: 105,
                    pointerId: 1,
                }),
            );
            controller.handlePointerMove(
                fakePointerEvent({
                    clientX: 130,
                    clientY: 120,
                    pointerId: 1,
                }),
            );

            // First move: delta (10, 5), second: delta (20, 15)
            expect(callbacks.moveGroup).toHaveBeenCalledTimes(2);
            expect(callbacks.moveGroup).toHaveBeenNthCalledWith(1, 1, {
                x: 10,
                y: 5,
            });
            expect(callbacks.moveGroup).toHaveBeenNthCalledWith(2, 1, {
                x: 20,
                y: 15,
            });
        });

        it('should request render on each move', () => {
            controller.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 0,
                    clientY: 0,
                    pointerId: 1,
                }),
            );

            // Reset call count after pointerdown's requestRender
            vi.mocked(callbacks.requestRender).mockClear();

            controller.handlePointerMove(
                fakePointerEvent({
                    clientX: 10,
                    clientY: 5,
                    pointerId: 1,
                }),
            );

            expect(callbacks.requestRender).toHaveBeenCalledTimes(1);
        });

        it('should ignore moves if no drag is active', () => {
            controller.handlePointerMove(
                fakePointerEvent({
                    clientX: 10,
                    clientY: 5,
                    pointerId: 1,
                }),
            );

            expect(callbacks.moveGroup).not.toHaveBeenCalled();
        });

        it('should ignore moves from a different pointer', () => {
            controller.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 0,
                    clientY: 0,
                    pointerId: 1,
                }),
            );

            controller.handlePointerMove(
                fakePointerEvent({
                    clientX: 10,
                    clientY: 5,
                    pointerId: 2,
                }),
            );

            expect(callbacks.moveGroup).not.toHaveBeenCalled();
        });

        it('should handle negative deltas (moving left/up)', () => {
            controller.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 100,
                    clientY: 100,
                    pointerId: 1,
                }),
            );

            controller.handlePointerMove(
                fakePointerEvent({
                    clientX: 80,
                    clientY: 70,
                    pointerId: 1,
                }),
            );

            expect(callbacks.moveGroup).toHaveBeenCalledWith(1, {
                x: -20,
                y: -30,
            });
        });
    });

    describe('handlePointerUp', () => {
        it('should end the drag', () => {
            controller.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 0,
                    clientY: 0,
                    pointerId: 1,
                }),
            );

            controller.handlePointerUp(
                fakePointerEvent({ pointerId: 1 }),
            );

            expect(controller.getActiveDrag()).toBeNull();
        });

        it('should be a no-op if no drag is active', () => {
            controller.handlePointerUp(
                fakePointerEvent({ pointerId: 1 }),
            );

            // No error thrown; drag remains null.
            expect(controller.getActiveDrag()).toBeNull();
        });

        it('should ignore up events from a different pointer', () => {
            controller.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 0,
                    clientY: 0,
                    pointerId: 1,
                }),
            );

            controller.handlePointerUp(
                fakePointerEvent({ pointerId: 2 }),
            );

            // Drag should still be active
            expect(controller.getActiveDrag()).not.toBeNull();
        });

        it('should not respond to moves after drop', () => {
            controller.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 0,
                    clientY: 0,
                    pointerId: 1,
                }),
            );

            controller.handlePointerUp(
                fakePointerEvent({ pointerId: 1 }),
            );

            vi.mocked(callbacks.moveGroup).mockClear();
            controller.handlePointerMove(
                fakePointerEvent({
                    clientX: 10,
                    clientY: 10,
                    pointerId: 1,
                }),
            );

            expect(callbacks.moveGroup).not.toHaveBeenCalled();
        });
    });

    describe('viewport clamping', () => {
        // These tests use a small viewport to exercise pointer clamping.
        // The margin constant in drag-controller.ts is 40px.
        const MARGIN = 40;
        const VP_W = 400;
        const VP_H = 300;

        let clampedController: DragController;

        beforeEach(() => {
            clampedController = new DragController(
                () => groups,
                callbacks,
                () => ({ width: VP_W, height: VP_H }),
            );
        });

        it('should clamp pointer on pointerdown at left edge', () => {
            clampedController.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 5,
                    clientY: 150,
                    pointerId: 1,
                }),
            );

            const drag = clampedController.getActiveDrag();
            expect(drag!.lastPointer.x).toBe(MARGIN);
            expect(drag!.lastPointer.y).toBe(150);
        });

        it('should clamp pointer on pointerdown at right edge', () => {
            clampedController.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: VP_W + 10,
                    clientY: 150,
                    pointerId: 1,
                }),
            );

            const drag = clampedController.getActiveDrag();
            expect(drag!.lastPointer.x).toBe(VP_W - MARGIN);
        });

        it('should clamp pointer on pointerdown at top edge', () => {
            clampedController.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 200,
                    clientY: 10,
                    pointerId: 1,
                }),
            );

            const drag = clampedController.getActiveDrag();
            expect(drag!.lastPointer.y).toBe(MARGIN);
        });

        it('should clamp pointer on pointerdown at bottom edge', () => {
            clampedController.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 200,
                    clientY: VP_H + 5,
                    pointerId: 1,
                }),
            );

            const drag = clampedController.getActiveDrag();
            expect(drag!.lastPointer.y).toBe(VP_H - MARGIN);
        });

        it('should not clamp pointer that is inside the margin', () => {
            clampedController.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 200,
                    clientY: 150,
                    pointerId: 1,
                }),
            );

            const drag = clampedController.getActiveDrag();
            expect(drag!.lastPointer).toEqual({ x: 200, y: 150 });
        });

        it('should clamp pointer during move at left edge', () => {
            // Start in the middle
            clampedController.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 200,
                    clientY: 150,
                    pointerId: 1,
                }),
            );

            vi.mocked(callbacks.moveGroup).mockClear();

            // Move pointer past the left edge
            clampedController.handlePointerMove(
                fakePointerEvent({
                    clientX: -50,
                    clientY: 150,
                    pointerId: 1,
                }),
            );

            // Delta should be from 200 → MARGIN (40), not 200 → -50
            expect(callbacks.moveGroup).toHaveBeenCalledWith(1, {
                x: MARGIN - 200,
                y: 0,
            });
        });

        it('should clamp pointer during move at right edge', () => {
            clampedController.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 200,
                    clientY: 150,
                    pointerId: 1,
                }),
            );

            vi.mocked(callbacks.moveGroup).mockClear();

            clampedController.handlePointerMove(
                fakePointerEvent({
                    clientX: VP_W + 100,
                    clientY: 150,
                    pointerId: 1,
                }),
            );

            // Delta should be from 200 → (VP_W - MARGIN), not → VP_W + 100
            expect(callbacks.moveGroup).toHaveBeenCalledWith(1, {
                x: VP_W - MARGIN - 200,
                y: 0,
            });
        });

        it('should clamp pointer during move at top edge', () => {
            clampedController.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 200,
                    clientY: 150,
                    pointerId: 1,
                }),
            );

            vi.mocked(callbacks.moveGroup).mockClear();

            clampedController.handlePointerMove(
                fakePointerEvent({
                    clientX: 200,
                    clientY: -30,
                    pointerId: 1,
                }),
            );

            expect(callbacks.moveGroup).toHaveBeenCalledWith(1, {
                x: 0,
                y: MARGIN - 150,
            });
        });

        it('should clamp pointer during move at bottom edge', () => {
            clampedController.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 200,
                    clientY: 150,
                    pointerId: 1,
                }),
            );

            vi.mocked(callbacks.moveGroup).mockClear();

            clampedController.handlePointerMove(
                fakePointerEvent({
                    clientX: 200,
                    clientY: VP_H + 50,
                    pointerId: 1,
                }),
            );

            expect(callbacks.moveGroup).toHaveBeenCalledWith(1, {
                x: 0,
                y: VP_H - MARGIN - 150,
            });
        });

        it('should clamp at both axes simultaneously (corner)', () => {
            clampedController.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 200,
                    clientY: 150,
                    pointerId: 1,
                }),
            );

            vi.mocked(callbacks.moveGroup).mockClear();

            // Move to bottom-right corner, well past the edge
            clampedController.handlePointerMove(
                fakePointerEvent({
                    clientX: VP_W + 200,
                    clientY: VP_H + 200,
                    pointerId: 1,
                }),
            );

            expect(callbacks.moveGroup).toHaveBeenCalledWith(1, {
                x: VP_W - MARGIN - 200,
                y: VP_H - MARGIN - 150,
            });
        });

        it('should produce zero delta when already clamped and moving further out', () => {
            // Start clamped against left edge
            clampedController.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 0,
                    clientY: 150,
                    pointerId: 1,
                }),
            );

            vi.mocked(callbacks.moveGroup).mockClear();

            // Move even further left — should still clamp to MARGIN,
            // producing zero delta since lastPointer is already at MARGIN.
            clampedController.handlePointerMove(
                fakePointerEvent({
                    clientX: -100,
                    clientY: 150,
                    pointerId: 1,
                }),
            );

            expect(callbacks.moveGroup).toHaveBeenCalledWith(1, {
                x: 0,
                y: 0,
            });
        });

        it('should track clamped position for subsequent deltas', () => {
            clampedController.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 200,
                    clientY: 150,
                    pointerId: 1,
                }),
            );

            vi.mocked(callbacks.moveGroup).mockClear();

            // First move: clamped to left edge
            clampedController.handlePointerMove(
                fakePointerEvent({
                    clientX: -50,
                    clientY: 150,
                    pointerId: 1,
                }),
            );

            // Second move: back to center — delta should be from
            // clamped position (MARGIN), not from -50
            clampedController.handlePointerMove(
                fakePointerEvent({
                    clientX: 200,
                    clientY: 150,
                    pointerId: 1,
                }),
            );

            expect(callbacks.moveGroup).toHaveBeenNthCalledWith(2, 1, {
                x: 200 - MARGIN,
                y: 0,
            });
        });

        it('should handle viewport resize between moves', () => {
            let vpSize = { width: VP_W, height: VP_H };
            const resizableController = new DragController(
                () => groups,
                callbacks,
                () => vpSize,
            );

            // Start drag near the right edge
            resizableController.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: VP_W - MARGIN - 10,
                    clientY: 150,
                    pointerId: 1,
                }),
            );

            vi.mocked(callbacks.moveGroup).mockClear();

            // Shrink viewport (e.g. virtual keyboard appears)
            vpSize = { width: 200, height: 200 };

            // Move slightly right — now clamped to the smaller viewport
            resizableController.handlePointerMove(
                fakePointerEvent({
                    clientX: VP_W - MARGIN,
                    clientY: 150,
                    pointerId: 1,
                }),
            );

            // X: pointer at VP_W - MARGIN (360) clamps to new vp 200 - 40 = 160
            // Delta from start (350) → 160 = -190
            // Y: pointer at 150 is within new vp margin (40..160), no clamp
            // Delta = 150 - 150 = 0
            expect(callbacks.moveGroup).toHaveBeenCalledWith(1, {
                x: 160 - (VP_W - MARGIN - 10),
                y: 0,
            });
        });
    });

    describe('screenDeltaToWorld', () => {
        it('should convert screen deltas to world space when zoomed in', () => {
            // At scale 2, a 20px screen movement = 10px world movement
            const zoomedController = new DragController(
                () => groups,
                callbacks,
                () => ({ width: 10000, height: 10000 }),
                (delta) => ({ x: delta.x / 2, y: delta.y / 2 }),
            );

            zoomedController.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 100,
                    clientY: 100,
                    pointerId: 1,
                }),
            );

            vi.mocked(callbacks.moveGroup).mockClear();

            zoomedController.handlePointerMove(
                fakePointerEvent({
                    clientX: 120,
                    clientY: 110,
                    pointerId: 1,
                }),
            );

            // Screen delta (20, 10) → world delta (10, 5)
            expect(callbacks.moveGroup).toHaveBeenCalledWith(1, {
                x: 10,
                y: 5,
            });
        });

        it('should use identity transform by default', () => {
            // Default controller (no transform) — delta passes through unchanged
            controller.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 100,
                    clientY: 100,
                    pointerId: 1,
                }),
            );

            vi.mocked(callbacks.moveGroup).mockClear();

            controller.handlePointerMove(
                fakePointerEvent({
                    clientX: 120,
                    clientY: 110,
                    pointerId: 1,
                }),
            );

            expect(callbacks.moveGroup).toHaveBeenCalledWith(1, {
                x: 20,
                y: 10,
            });
        });
    });

    describe('full drag cycle', () => {
        it('should complete a full drag: down → move → up', () => {
            // Start drag
            controller.handlePointerDown(
                30,
                fakePointerEvent({
                    clientX: 50,
                    clientY: 50,
                    pointerId: 3,
                }),
            );

            expect(callbacks.bringToFront).toHaveBeenCalledWith(3);
            expect(controller.getActiveDrag()!.groupId).toBe(3);

            // Move
            controller.handlePointerMove(
                fakePointerEvent({
                    clientX: 80,
                    clientY: 60,
                    pointerId: 3,
                }),
            );

            expect(callbacks.moveGroup).toHaveBeenCalledWith(3, {
                x: 30,
                y: 10,
            });

            // Drop
            controller.handlePointerUp(
                fakePointerEvent({ pointerId: 3 }),
            );

            expect(controller.getActiveDrag()).toBeNull();
        });

        it('should allow a new drag after completing one', () => {
            // First drag
            controller.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 0,
                    clientY: 0,
                    pointerId: 1,
                }),
            );
            controller.handlePointerUp(
                fakePointerEvent({ pointerId: 1 }),
            );

            // Second drag on a different group
            controller.handlePointerDown(
                20,
                fakePointerEvent({
                    clientX: 50,
                    clientY: 50,
                    pointerId: 2,
                }),
            );

            expect(controller.getActiveDrag()!.groupId).toBe(2);
        });
    });

    describe('cancel', () => {
        it('should cancel an active drag and restore the group position', () => {
            const group = groups[0]; // Group 1 at position (0, 0)

            controller.handlePointerDown(
                10,
                fakePointerEvent({
                    clientX: 100,
                    clientY: 100,
                    pointerId: 1,
                }),
            );

            // Simulate some movement
            controller.handlePointerMove(
                fakePointerEvent({
                    clientX: 150,
                    clientY: 120,
                    pointerId: 1,
                }),
            );

            // Simulate group position updated by moveGroup callback
            group.position = { x: 50, y: 20 };

            vi.mocked(callbacks.moveGroup).mockClear();

            controller.cancel();

            // Drag should be cleared
            expect(controller.getActiveDrag()).toBeNull();
            // Group should be restored to origin
            expect(callbacks.moveGroup).toHaveBeenCalledWith(1, { x: -50, y: -20 });
            // Render must fire so the snap-back is visible immediately
            expect(callbacks.requestRender).toHaveBeenCalled();
        });

        it('should be a no-op when no drag is active', () => {
            controller.cancel();

            expect(callbacks.moveGroup).not.toHaveBeenCalled();
            expect(controller.getActiveDrag()).toBeNull();
        });

        it('should allow a new drag after cancellation', () => {
            controller.handlePointerDown(
                10,
                fakePointerEvent({ pointerId: 1 }),
            );
            controller.cancel();

            controller.handlePointerDown(
                20,
                fakePointerEvent({ pointerId: 2 }),
            );

            expect(controller.getActiveDrag()!.groupId).toBe(2);
        });
    });
});
