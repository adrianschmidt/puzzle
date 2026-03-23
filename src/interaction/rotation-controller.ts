/**
 * Rotation controller — handles rotation gestures for piece groups.
 *
 * Touch: two-finger rotate gesture on a piece group
 * Desktop: Shift+scroll wheel or Shift+drag on a piece
 *
 * Rotation is in 90° snapped increments for clean alignment.
 */

import type { PieceGroup } from '../model/types.js';
import { findGroupForPiece } from '../model/helpers.js';
import { normalizeAngle } from '../game/merge-detection.js';

/** Snap angle to nearest 90° increment. */
function snapTo90(angle: number): number {
    return Math.round(angle / 90) * 90;
}

/** Callbacks the rotation controller invokes. */
export interface RotationCallbacks {
    /** Called to update a group's rotation angle. */
    setRotation(groupId: number, angle: number): void;
    /** Called to re-render after a state change. */
    requestRender(): void;
    /** Called when rotation ends (for merge detection). */
    onDrop(groupId: number): void;
}

/**
 * Create a rotation controller and attach event handlers.
 *
 * Returns a cleanup function to remove all listeners.
 */
export function setupRotationHandling(options: {
    container: HTMLElement;
    getGroups: () => PieceGroup[];
    callbacks: RotationCallbacks;
    isPieceElement: (target: EventTarget | null) => boolean;
    findPieceId: (target: EventTarget | null) => number | null;
}): () => void {
    const { container, getGroups, callbacks, isPieceElement, findPieceId } = options;

    // --- Desktop: Shift + scroll wheel rotates the piece under cursor ---
    function handleWheel(e: WheelEvent): void {
        if (!e.shiftKey) return;
        if (!isPieceElement(e.target)) return;

        e.preventDefault();
        e.stopPropagation();

        const pieceId = findPieceId(e.target);
        if (pieceId === null) return;

        const group = findGroupForPiece(pieceId, getGroups());
        const direction = e.deltaY > 0 ? 1 : -1;
        const newRotation = normalizeAngle(snapTo90(group.rotation + direction * 90));

        callbacks.setRotation(group.id, newRotation);
        callbacks.requestRender();
        callbacks.onDrop(group.id);
    }

    // --- Touch: two-finger rotation on a piece ---
    // We track two touches that started on a piece and measure the angle change
    let rotatingGroupId: number | null = null;
    let initialAngle: number | null = null;
    let baseRotation: number = 0;
    const touchPoints = new Map<number, { x: number; y: number }>();

    function getAngle(points: Map<number, { x: number; y: number }>): number | null {
        const pts = Array.from(points.values());
        if (pts.length < 2) return null;

        return Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) * (180 / Math.PI);
    }

    function handleTouchStart(e: TouchEvent): void {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            touchPoints.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
        }

        if (touchPoints.size === 2 && rotatingGroupId === null) {
            // Check if both touches are on the same group
            // Use the first touch's target to identify the group
            const firstTouch = e.touches[0];
            const target = document.elementFromPoint(firstTouch.clientX, firstTouch.clientY);
            if (!isPieceElement(target)) return;

            const pieceId = findPieceId(target);
            if (pieceId === null) return;

            const group = findGroupForPiece(pieceId, getGroups());
            rotatingGroupId = group.id;
            baseRotation = group.rotation;
            initialAngle = getAngle(touchPoints);
        }
    }

    function handleTouchMove(e: TouchEvent): void {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            if (touchPoints.has(touch.identifier)) {
                touchPoints.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
            }
        }

        if (rotatingGroupId === null || initialAngle === null) return;
        if (touchPoints.size < 2) return;

        const currentAngle = getAngle(touchPoints);
        if (currentAngle === null) return;

        const angleDelta = currentAngle - initialAngle;
        const newRotation = normalizeAngle(baseRotation + angleDelta);

        callbacks.setRotation(rotatingGroupId, newRotation);
        callbacks.requestRender();
    }

    function handleTouchEnd(e: TouchEvent): void {
        for (let i = 0; i < e.changedTouches.length; i++) {
            touchPoints.delete(e.changedTouches[i].identifier);
        }

        if (rotatingGroupId !== null && touchPoints.size < 2) {
            // Snap to nearest 90° and trigger merge check
            const group = getGroups().find(g => g.id === rotatingGroupId);
            if (group) {
                const snapped = normalizeAngle(snapTo90(group.rotation));
                callbacks.setRotation(group.id, snapped);
                callbacks.requestRender();
                callbacks.onDrop(group.id);
            }

            rotatingGroupId = null;
            initialAngle = null;
        }
    }

    container.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
        container.removeEventListener('wheel', handleWheel, { capture: true } as EventListenerOptions);
        container.removeEventListener('touchstart', handleTouchStart);
        container.removeEventListener('touchmove', handleTouchMove);
        container.removeEventListener('touchend', handleTouchEnd);
        container.removeEventListener('touchcancel', handleTouchEnd);
    };
}
