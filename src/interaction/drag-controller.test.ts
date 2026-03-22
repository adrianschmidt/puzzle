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

    return { id, pieces, position };
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
            onDrop: vi.fn(),
            requestRender: vi.fn(),
        };

        controller = new DragController(() => groups, callbacks);
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
                    clientX: 0,
                    clientY: 0,
                    pointerId: 1,
                }),
            );

            controller.handlePointerMove(
                fakePointerEvent({
                    clientX: 10,
                    clientY: 5,
                    pointerId: 1,
                }),
            );
            controller.handlePointerMove(
                fakePointerEvent({
                    clientX: 30,
                    clientY: 20,
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
        it('should end the drag and call onDrop', () => {
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
            expect(callbacks.onDrop).toHaveBeenCalledWith(1);
        });

        it('should not call onDrop if no drag is active', () => {
            controller.handlePointerUp(
                fakePointerEvent({ pointerId: 1 }),
            );

            expect(callbacks.onDrop).not.toHaveBeenCalled();
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
            expect(callbacks.onDrop).not.toHaveBeenCalled();
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

            expect(callbacks.onDrop).toHaveBeenCalledWith(3);
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
});
