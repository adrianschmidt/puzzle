/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RotationFocus } from '../interaction/rotation-focus.js';
import { createRotateHandle } from './rotate-handle.js';

describe('rotate-handle gesture', () => {
    let container: HTMLElement;
    let rotationFocus: RotationFocus;
    let onRotate: ReturnType<typeof vi.fn>;
    let onCommit: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        document.body.replaceChildren();
        container = document.createElement('div');
        document.body.appendChild(container);
        rotationFocus = new RotationFocus();
        onRotate = vi.fn();
        onCommit = vi.fn();

        // jsdom does not implement pointer capture — stub the methods on the
        // prototype so all buttons created during the test have them.
        HTMLButtonElement.prototype.setPointerCapture = vi.fn();
        HTMLButtonElement.prototype.releasePointerCapture = vi.fn();
        HTMLButtonElement.prototype.hasPointerCapture = vi.fn(() => false);
    });

    afterEach(() => {
        document.body.replaceChildren();
        // Clean up prototype stubs.
        // @ts-expect-error — deleting stub added in beforeEach
        delete HTMLButtonElement.prototype.setPointerCapture;
        // @ts-expect-error
        delete HTMLButtonElement.prototype.releasePointerCapture;
        // @ts-expect-error
        delete HTMLButtonElement.prototype.hasPointerCapture;
    });

    function makeHandle(opts: Partial<Parameters<typeof createRotateHandle>[0]> = {}) {
        return createRotateHandle({
            container,
            rotationFocus,
            onRotate: onRotate as (groupId: number, deltaDegrees: number) => void,
            onCommit: onCommit as (groupId: number) => void,
            getFocusedGroupScreenBounds: () => ({ left: 100, right: 200, top: 100, bottom: 200 }),
            getViewportSize: () => ({ width: 800, height: 600 }),
            getGroupRotation: () => 0,
            getGroupPivotWorld: () => ({ x: 150, y: 150 }),
            screenToWorld: (cx, cy) => ({ x: cx, y: cy }), // identity for tests
            ...opts,
        });
    }

    function dispatchPointerEvent(target: EventTarget, type: string, init: Partial<PointerEventInit>): void {
        const evt = new PointerEvent(type, { pointerId: 1, bubbles: true, ...init });
        target.dispatchEvent(evt);
    }

    it('emits onRotate with a delta proportional to the angular change', () => {
        const handle = makeHandle();
        handle.show();
        rotationFocus.setFocus(0);

        const button = container.querySelector('.rotate-handle')! as HTMLButtonElement;

        // Pointer starts at (250, 150) — pivot (150, 150), so initial angle = 0 rad.
        dispatchPointerEvent(button, 'pointerdown', { clientX: 250, clientY: 150 });
        // Move to (150, 250) — angle = 90° clockwise.
        dispatchPointerEvent(button, 'pointermove', { clientX: 150, clientY: 250 });

        expect(onRotate).toHaveBeenCalled();
        const lastCall = onRotate.mock.calls.at(-1)!;
        expect(lastCall[0]).toBe(0);
        // Delta from current (0) to target (90) is 90°.
        expect(lastCall[1]).toBeCloseTo(90, 1);

        handle.destroy();
    });

    it('calls onCommit on pointerup', () => {
        const handle = makeHandle();
        handle.show();
        rotationFocus.setFocus(0);

        const button = container.querySelector('.rotate-handle')! as HTMLButtonElement;
        dispatchPointerEvent(button, 'pointerdown', { clientX: 250, clientY: 150 });
        dispatchPointerEvent(button, 'pointermove', { clientX: 150, clientY: 250 });
        dispatchPointerEvent(button, 'pointerup', { clientX: 150, clientY: 250 });

        expect(onCommit).toHaveBeenCalledWith(0);

        handle.destroy();
    });

    it('cancels (no onCommit) when a second pointer lands on window', () => {
        const handle = makeHandle();
        handle.show();
        rotationFocus.setFocus(0);

        const button = container.querySelector('.rotate-handle')! as HTMLButtonElement;
        dispatchPointerEvent(button, 'pointerdown', { clientX: 250, clientY: 150 });

        // Second finger lands somewhere else.
        const secondFinger = new PointerEvent('pointerdown', {
            pointerId: 2, bubbles: true, clientX: 500, clientY: 500,
        });
        window.dispatchEvent(secondFinger);

        // Subsequent pointermove on the original pointer should NOT emit onRotate.
        onRotate.mockClear();
        dispatchPointerEvent(button, 'pointermove', { clientX: 150, clientY: 250 });
        expect(onRotate).not.toHaveBeenCalled();
        expect(onCommit).not.toHaveBeenCalled();

        handle.destroy();
    });

    it('cancels gesture on pointercancel without calling onCommit', () => {
        const handle = makeHandle();
        handle.show();
        rotationFocus.setFocus(0);

        const button = container.querySelector('.rotate-handle')! as HTMLButtonElement;
        dispatchPointerEvent(button, 'pointerdown', { clientX: 250, clientY: 150 });
        dispatchPointerEvent(button, 'pointercancel', { clientX: 250, clientY: 150 });

        expect(onCommit).not.toHaveBeenCalled();

        // After cancel, a pointermove from the same pointerId should not emit onRotate.
        onRotate.mockClear();
        dispatchPointerEvent(button, 'pointermove', { clientX: 150, clientY: 250 });
        expect(onRotate).not.toHaveBeenCalled();

        handle.destroy();
    });

    it('uses the current group rotation to compute additive delta after re-rotation', () => {
        // Simulate a host that applies onRotate to the model. After the first
        // move, the group is at 45°. The next move should emit a delta from
        // that new rotation, not from R0=0.
        let currentRotation = 0;
        const handle = makeHandle({
            getGroupRotation: () => currentRotation,
            onRotate: vi.fn((_, delta) => { currentRotation += delta; }),
        });
        handle.show();
        rotationFocus.setFocus(0);

        const button = container.querySelector('.rotate-handle')! as HTMLButtonElement;
        dispatchPointerEvent(button, 'pointerdown', { clientX: 250, clientY: 150 });

        // First move: pointer at angle 45° → target 45°, delta 45°.
        dispatchPointerEvent(button, 'pointermove', { clientX: 220.7, clientY: 220.7 });
        // currentRotation is now ≈ 45°.

        // Second move: pointer at angle 90° → target 90°, delta = 90 − 45 = 45°.
        dispatchPointerEvent(button, 'pointermove', { clientX: 150, clientY: 250 });
        // currentRotation should now be ≈ 90°.

        // Floating-point: allow 1° tolerance.
        expect(currentRotation).toBeCloseTo(90, 0);

        handle.destroy();
    });

    it('removes the window pointerdown listener when focus switches mid-drag', () => {
        const handle = makeHandle();
        handle.show();
        rotationFocus.setFocus(0);

        const button = container.querySelector('.rotate-handle')! as HTMLButtonElement;
        dispatchPointerEvent(button, 'pointerdown', { clientX: 250, clientY: 150 });

        // Switch focus to a different group while drag is in progress.
        rotationFocus.setFocus(1);

        // The old handle should have detached its window listener. Simulate a
        // second-finger pointerdown — if the old listener is still around, it
        // would have called cancelDrag() (no-op since drag is already cleared)
        // but no other observable side effect to assert. Instead, verify that
        // a subsequent pointermove on the (now-detached) old button does not
        // emit onRotate.
        onRotate.mockClear();
        dispatchPointerEvent(button, 'pointermove', { clientX: 150, clientY: 250 });
        expect(onRotate).not.toHaveBeenCalled();

        handle.destroy();
    });
});
