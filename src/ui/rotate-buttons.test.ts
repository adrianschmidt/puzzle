/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRotateButtons } from './rotate-buttons.js';
import { RotationFocus } from '../interaction/rotation-focus.js';
import type { RotationDirection } from '../game/rotate-group.js';

type Bounds = { left: number; right: number; top: number; bottom: number };

describe('createRotateButtons', () => {
    let container: HTMLElement;
    let rotationFocus: RotationFocus;
    let onRotate: ReturnType<typeof vi.fn<(groupId: number, direction: RotationDirection) => void>>;
    let bounds: Map<number, Bounds>;
    let viewport: { width: number; height: number };

    beforeEach(() => {
        vi.useFakeTimers();
        container = document.createElement('div');
        document.body.appendChild(container);
        rotationFocus = new RotationFocus();
        onRotate = vi.fn<(groupId: number, direction: RotationDirection) => void>();
        bounds = new Map([
            [7, { left: 200, right: 300, top: 200, bottom: 300 }],
        ]);
        viewport = { width: 1024, height: 768 };
    });

    afterEach(() => {
        vi.useRealTimers();
        container.remove();
    });

    function build() {
        return createRotateButtons({
            container,
            rotationFocus,
            onRotate,
            getFocusedGroupScreenBounds: (id) => bounds.get(id) ?? null,
            getViewportSize: () => viewport,
        });
    }

    function getPair(): { ccw: HTMLButtonElement | null; cw: HTMLButtonElement | null } {
        return {
            ccw: container.querySelector<HTMLButtonElement>('.rotate-button--ccw'),
            cw: container.querySelector<HTMLButtonElement>('.rotate-button--cw'),
        };
    }

    function getAllPairs(): NodeListOf<HTMLButtonElement> {
        return container.querySelectorAll<HTMLButtonElement>('.rotate-button');
    }

    function fireTransitionEnd(el: Element): void {
        el.dispatchEvent(new Event('transitionend'));
    }

    describe('show/hide gating', () => {
        it('starts hidden — no buttons exist before show() and focus is set', () => {
            build();
            rotationFocus.setFocus(7);
            expect(getAllPairs()).toHaveLength(0);
        });

        it('show() with an already-set focus creates a pair', () => {
            const handle = build();
            rotationFocus.setFocus(7);
            handle.show();
            const { ccw, cw } = getPair();
            expect(ccw).not.toBeNull();
            expect(cw).not.toBeNull();
        });

        it('hide() removes any visible pair', () => {
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);
            expect(getAllPairs().length).toBe(2);
            handle.hide();
            expect(getAllPairs().length).toBe(0);
        });

        it('after hide(), subsequent focus changes do not create pairs', () => {
            const handle = build();
            handle.show();
            handle.hide();
            rotationFocus.setFocus(7);
            expect(getAllPairs().length).toBe(0);
        });
    });

    describe('focus → fade-in', () => {
        it('setFocus while shown creates a pair with the fade-in class', () => {
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);

            const { ccw, cw } = getPair();
            expect(ccw!.classList.contains('rotate-button--fade-in')).toBe(true);
            expect(cw!.classList.contains('rotate-button--fade-in')).toBe(true);
        });

        it('places buttons flanking the focused group bounds', () => {
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);

            const { ccw, cw } = getPair();
            // bounds = {left:200, right:300}; gap=8, button=44.
            // CCW: left = 200 - 8 - 44 = 148
            // CW: left = 300 + 8 = 308
            // both top: midY 250 - 22 = 228
            expect(ccw!.style.left).toBe('148px');
            expect(cw!.style.left).toBe('308px');
            expect(ccw!.style.top).toBe('228px');
            expect(cw!.style.top).toBe('228px');
        });

        it('clamps CCW to viewport left when bounds extend off-screen left', () => {
            bounds.set(7, { left: 5, right: 100, top: 200, bottom: 300 });
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);

            const { ccw } = getPair();
            // left would be 5 - 8 - 44 = -47; clamped to 12 (viewport margin).
            expect(ccw!.style.left).toBe('12px');
        });

        it('clamps CW to viewport right when bounds extend off-screen right', () => {
            bounds.set(7, { left: 800, right: 1100, top: 200, bottom: 300 });
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);

            const { cw } = getPair();
            // viewport.width=1024; max-left = 1024 - 44 - 12 = 968
            expect(cw!.style.left).toBe('968px');
        });

        it('clamps top to viewport top when bounds are above the viewport', () => {
            bounds.set(7, { left: 200, right: 300, top: -200, bottom: -100 });
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);

            const { ccw } = getPair();
            expect(ccw!.style.top).toBe('12px');
        });

        it('clamps top to viewport bottom when bounds are below the viewport', () => {
            bounds.set(7, { left: 200, right: 300, top: 1000, bottom: 1200 });
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);

            const { ccw } = getPair();
            // viewport.height=768; max-top = 768 - 44 - 12 = 712
            expect(ccw!.style.top).toBe('712px');
        });

        it('does nothing if getFocusedGroupScreenBounds returns null', () => {
            const handle = build();
            handle.show();
            rotationFocus.setFocus(99); // not in bounds map
            expect(getAllPairs().length).toBe(0);
        });
    });

    describe('rotate clicks', () => {
        it('CCW click invokes onRotate with the pair’s groupId', () => {
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);

            getPair().ccw!.click();
            expect(onRotate).toHaveBeenCalledExactlyOnceWith(7, 'ccw');
        });

        it('CW click invokes onRotate with the pair’s groupId', () => {
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);

            getPair().cw!.click();
            expect(onRotate).toHaveBeenCalledExactlyOnceWith(7, 'cw');
        });

        it('click does not move the buttons', () => {
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);

            const { ccw } = getPair();
            const beforeLeft = ccw!.style.left;
            const beforeTop = ccw!.style.top;
            ccw!.click();
            expect(ccw!.style.left).toBe(beforeLeft);
            expect(ccw!.style.top).toBe(beforeTop);
        });
    });

    describe('user-dismiss → quick fade', () => {
        it('clearFocus applies quick-fade-out class and disables pointer events', () => {
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);

            rotationFocus.clearFocus();

            const ccw = container.querySelector<HTMLButtonElement>('.rotate-button--ccw');
            expect(ccw!.classList.contains('rotate-button--fade-out-quick')).toBe(true);
        });

        it('after the quick fade-out transition ends, the pair is removed', () => {
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);
            const ccw = container.querySelector('.rotate-button--ccw')!;

            rotationFocus.clearFocus();
            fireTransitionEnd(ccw);

            expect(getAllPairs().length).toBe(0);
        });

        it('switching focus to a different group quick-fades the old and fades in the new', () => {
            bounds.set(8, { left: 500, right: 600, top: 400, bottom: 500 });
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);
            const oldCcw = container.querySelector('.rotate-button--ccw')!;

            rotationFocus.setFocus(8);

            // Old pair has the quick-fade-out class
            expect(oldCcw.classList.contains('rotate-button--fade-out-quick')).toBe(true);
            // A new pair exists, positioned for group 8
            const newPair = container.querySelectorAll<HTMLButtonElement>('.rotate-button--ccw');
            expect(newPair.length).toBe(2); // old + new
            const newCcw = newPair[1];
            expect(newCcw.classList.contains('rotate-button--fade-in')).toBe(true);
            // bounds(8): CCW left = 500 - 8 - 44 = 448
            expect(newCcw.style.left).toBe('448px');
        });
    });

    describe('idle timer → slow fade', () => {
        it('after 5 seconds with no rotate click, applies slow-fade-out class but keeps pointer-events enabled', () => {
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);

            vi.advanceTimersByTime(5000);

            const ccw = container.querySelector<HTMLButtonElement>('.rotate-button--ccw')!;
            expect(ccw.classList.contains('rotate-button--fade-out-slow')).toBe(true);
            expect(ccw.classList.contains('rotate-button--fade-out-quick')).toBe(false);
        });

        it('rotate click resets the idle timer', () => {
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);

            vi.advanceTimersByTime(4000);
            getPair().cw!.click();
            vi.advanceTimersByTime(4000); // total 8s but timer should have reset at 4s

            const ccw = container.querySelector<HTMLButtonElement>('.rotate-button--ccw')!;
            expect(ccw.classList.contains('rotate-button--fade-out-slow')).toBe(false);
        });

        it('idle-timer slow fade end clears the focus', () => {
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);

            vi.advanceTimersByTime(5000);
            const ccw = container.querySelector('.rotate-button--ccw')!;
            fireTransitionEnd(ccw);

            expect(rotationFocus.focusedGroupId).toBeNull();
            expect(getAllPairs().length).toBe(0);
        });

        it('switching focus during slow fade upgrades the old pair to quick fade and spawns the new pair', () => {
            bounds.set(8, { left: 500, right: 600, top: 400, bottom: 500 });
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);

            vi.advanceTimersByTime(5000); // pair-7 enters slow fade
            const oldCcw = container.querySelector<HTMLButtonElement>('.rotate-button--ccw')!;
            expect(oldCcw.classList.contains('rotate-button--fade-out-slow')).toBe(true);

            rotationFocus.setFocus(8);

            // Old pair upgraded to quick fade-out (slow class removed, quick class added)
            expect(oldCcw.classList.contains('rotate-button--fade-out-slow')).toBe(false);
            expect(oldCcw.classList.contains('rotate-button--fade-out-quick')).toBe(true);

            // New pair exists for group 8 with fade-in class
            const allCcws = container.querySelectorAll<HTMLButtonElement>('.rotate-button--ccw');
            expect(allCcws.length).toBe(2);
            const newCcw = allCcws[1];
            expect(newCcw.classList.contains('rotate-button--fade-in')).toBe(true);
            expect(newCcw.style.left).toBe('448px');
        });

        it('clicking a pair during slow fade rescues it: removes fade class, restarts timer, runs rotation', () => {
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);

            vi.advanceTimersByTime(5000); // start slow fade
            const { ccw, cw } = getPair();
            expect(ccw!.classList.contains('rotate-button--fade-out-slow')).toBe(true);

            cw!.click();

            // Rotation ran
            expect(onRotate).toHaveBeenCalledExactlyOnceWith(7, 'cw');
            // Fade-out class removed; fade-in class re-applied
            expect(ccw!.classList.contains('rotate-button--fade-out-slow')).toBe(false);
            expect(ccw!.classList.contains('rotate-button--fade-in')).toBe(true);
            // Focus is still set
            expect(rotationFocus.focusedGroupId).toBe(7);

            // Timer restarted: another 5s should be needed before slow fade
            vi.advanceTimersByTime(4999);
            expect(ccw!.classList.contains('rotate-button--fade-out-slow')).toBe(false);
            vi.advanceTimersByTime(1);
            expect(ccw!.classList.contains('rotate-button--fade-out-slow')).toBe(true);
        });
    });

    describe('destroy', () => {
        it('removes any visible pair', () => {
            const handle = build();
            handle.show();
            rotationFocus.setFocus(7);

            handle.destroy();
            expect(getAllPairs().length).toBe(0);
        });

        it('unsubscribes from focus changes', () => {
            const handle = build();
            handle.show();
            handle.destroy();
            rotationFocus.setFocus(7);
            expect(getAllPairs().length).toBe(0);
        });
    });
});
