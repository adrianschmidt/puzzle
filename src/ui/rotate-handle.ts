/**
 * Free-rotation drag handle — a single round button that floats below the
 * focused group's bbox. A drag that originates on this handle rotates the
 * focused group continuously, with the angle from the group's bbox-centre
 * to the pointer kept constant for the duration of the drag.
 *
 * Gesture math is added in T11. This file currently implements the
 * lifecycle / placement / fade scaffolding only — visually the handle
 * appears and disappears in lockstep with `RotationFocus` but does not
 * yet respond to drag.
 */

import type { RotationFocus } from '../interaction/rotation-focus.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const BUTTON_SIZE_PX = 44;
const BUTTON_GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 12;
const IDLE_TIMEOUT_MS = 5000;
const QUICK_FADE_MS = 100;
const SLOW_FADE_MS = 750;

export interface RotateHandleOptions {
    container: HTMLElement;
    rotationFocus: RotationFocus;
    /**
     * Emitted continuously during drag; the host applies the rotation
     * to the live `PieceGroup` and re-renders. Filled in by T11.
     */
    onRotate: (groupId: number, deltaDegrees: number) => void;
    /**
     * Emitted on drag end, after the final `onRotate`. The host runs
     * merge-detection here. Filled in by T11.
     */
    onCommit: (groupId: number) => void;
    /** Project the focused group's visual bounds into screen-space. */
    getFocusedGroupScreenBounds: (groupId: number) =>
        | { left: number; right: number; top: number; bottom: number }
        | null;
    getViewportSize?: () => { width: number; height: number };
}

export interface RotateHandleHandle {
    show: () => void;
    hide: () => void;
    destroy: () => void;
}

interface ActiveHandle {
    groupId: number;
    button: HTMLButtonElement;
    idleTimerId: ReturnType<typeof setTimeout> | null;
    removalTimerId: ReturnType<typeof setTimeout> | null;
    transitionEndListener: ((e: Event) => void) | null;
    state: 'visible' | 'fade-out-quick' | 'fade-out-slow';
}

/**
 * Two opposing curved arrows forming a closed circle — signals that the
 * group can rotate freely in either direction. Stroke styling matches the
 * existing rotate-button SVG so the two button variants visually rhyme.
 */
function makeBidirectionalRotateIcon(): SVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    // Top half arc + arrowhead (clockwise direction).
    const arc1 = document.createElementNS(SVG_NS, 'path');
    arc1.setAttribute('d', 'M3 12 A9 9 0 0 1 21 12');
    svg.appendChild(arc1);
    const head1 = document.createElementNS(SVG_NS, 'polyline');
    head1.setAttribute('points', '21 5 21 12 14 12');
    svg.appendChild(head1);

    // Bottom half arc + arrowhead (counter-clockwise direction).
    const arc2 = document.createElementNS(SVG_NS, 'path');
    arc2.setAttribute('d', 'M21 12 A9 9 0 0 1 3 12');
    svg.appendChild(arc2);
    const head2 = document.createElementNS(SVG_NS, 'polyline');
    head2.setAttribute('points', '3 19 3 12 10 12');
    svg.appendChild(head2);

    return svg;
}

function makeButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'rotate-handle';
    button.type = 'button';
    button.setAttribute('aria-label', 'Rotate selection (drag)');
    button.appendChild(makeBidirectionalRotateIcon());
    return button;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function defaultViewportSize(): { width: number; height: number } {
    return {
        width: window.visualViewport?.width ?? window.innerWidth,
        height: window.visualViewport?.height ?? window.innerHeight,
    };
}

export function createRotateHandle(
    options: RotateHandleOptions,
): RotateHandleHandle {
    const {
        container,
        rotationFocus,
        getFocusedGroupScreenBounds,
        getViewportSize = defaultViewportSize,
    } = options;
    void options.onRotate; void options.onCommit; // wired in T11

    let shown = false;
    let active: ActiveHandle | null = null;
    let unsubscribeFocus: (() => void) | null = null;

    function placeButton(button: HTMLButtonElement, leftPx: number, topPx: number): void {
        button.style.left = `${leftPx}px`;
        button.style.top = `${topPx}px`;
    }

    function spawn(groupId: number): void {
        const bounds = getFocusedGroupScreenBounds(groupId);
        if (!bounds) return;
        const viewport = getViewportSize();

        const button = makeButton();

        const naturalLeft = (bounds.left + bounds.right) / 2 - BUTTON_SIZE_PX / 2;
        const naturalTop = bounds.bottom + BUTTON_GAP_PX;

        const maxLeft = viewport.width - BUTTON_SIZE_PX - VIEWPORT_MARGIN_PX;
        const maxTop = viewport.height - BUTTON_SIZE_PX - VIEWPORT_MARGIN_PX;

        placeButton(
            button,
            clamp(naturalLeft, VIEWPORT_MARGIN_PX, maxLeft),
            clamp(naturalTop, VIEWPORT_MARGIN_PX, maxTop),
        );

        container.appendChild(button);

        // Force a reflow so the browser registers the base-rule opacity:0
        // before the fade-in class lands (mirrors rotate-buttons.ts).
        void button.offsetHeight;
        button.classList.add('rotate-handle--fade-in');

        active = {
            groupId,
            button,
            idleTimerId: null,
            removalTimerId: null,
            transitionEndListener: null,
            state: 'visible',
        };
        startIdleTimer();
    }

    function rescueActive(): void {
        if (!active) return;
        cancelRemoval(active);
        if (active.idleTimerId !== null) {
            clearTimeout(active.idleTimerId);
            active.idleTimerId = null;
        }
        active.button.classList.remove(
            'rotate-handle--fade-out-slow',
            'rotate-handle--fade-out-quick',
        );
        active.button.classList.add('rotate-handle--fade-in');
        active.state = 'visible';
    }

    function startIdleTimer(): void {
        if (!active) return;
        if (active.idleTimerId !== null) clearTimeout(active.idleTimerId);
        active.idleTimerId = setTimeout(startSlowFadeOut, IDLE_TIMEOUT_MS);
    }

    function clearIdleTimer(): void {
        if (active && active.idleTimerId !== null) {
            clearTimeout(active.idleTimerId);
            active.idleTimerId = null;
        }
    }

    function startSlowFadeOut(): void {
        if (!active) return;
        clearIdleTimer();
        active.state = 'fade-out-slow';
        active.button.classList.remove('rotate-handle--fade-in');
        active.button.classList.add('rotate-handle--fade-out-slow');
        scheduleRemoval(active, SLOW_FADE_MS, /* clearFocusOnRemove */ true);
    }

    function startQuickFadeOut(handle: ActiveHandle): void {
        cancelRemoval(handle);
        if (handle.idleTimerId !== null) {
            clearTimeout(handle.idleTimerId);
            handle.idleTimerId = null;
        }
        handle.state = 'fade-out-quick';
        handle.button.classList.remove(
            'rotate-handle--fade-in',
            'rotate-handle--fade-out-slow',
        );
        handle.button.classList.add('rotate-handle--fade-out-quick');
        scheduleRemoval(handle, QUICK_FADE_MS, /* clearFocusOnRemove */ false);
    }

    function scheduleRemoval(
        handle: ActiveHandle,
        fallbackMs: number,
        clearFocusOnRemove: boolean,
    ): void {
        const onEnd = () => {
            if (handle.removalTimerId !== null) {
                clearTimeout(handle.removalTimerId);
                handle.removalTimerId = null;
            }
            handle.transitionEndListener = null;
            handle.button.removeEventListener('transitionend', onEnd);
            handle.button.remove();
            if (active === handle) active = null;
            if (clearFocusOnRemove) rotationFocus.clearFocus();
        };
        handle.transitionEndListener = onEnd;
        handle.button.addEventListener('transitionend', onEnd);
        handle.removalTimerId = setTimeout(onEnd, fallbackMs + 100);
    }

    function cancelRemoval(handle: ActiveHandle): void {
        if (handle.removalTimerId !== null) {
            clearTimeout(handle.removalTimerId);
            handle.removalTimerId = null;
        }
        if (handle.transitionEndListener !== null) {
            handle.button.removeEventListener('transitionend', handle.transitionEndListener);
            handle.transitionEndListener = null;
        }
    }

    function teardownActive(): void {
        if (!active) return;
        if (active.idleTimerId !== null) clearTimeout(active.idleTimerId);
        if (active.removalTimerId !== null) clearTimeout(active.removalTimerId);
        if (active.transitionEndListener !== null) {
            active.button.removeEventListener('transitionend', active.transitionEndListener);
        }
        active.button.remove();
        active = null;
    }

    function handleFocusChange(focusedGroupId: number | null): void {
        if (!shown) return;
        if (focusedGroupId === null) {
            if (active) startQuickFadeOut(active);
            return;
        }
        if (active && active.groupId === focusedGroupId) {
            if (active.state !== 'visible') {
                rescueActive();
                startIdleTimer();
            }
            return;
        }
        if (active) {
            const old = active;
            active = null;
            startQuickFadeOut(old);
        }
        spawn(focusedGroupId);
    }

    return {
        show() {
            if (shown) return;
            shown = true;
            unsubscribeFocus = rotationFocus.onChange(handleFocusChange);
            if (rotationFocus.focusedGroupId !== null) {
                spawn(rotationFocus.focusedGroupId);
            }
        },
        hide() {
            if (!shown) return;
            shown = false;
            if (unsubscribeFocus) {
                unsubscribeFocus();
                unsubscribeFocus = null;
            }
            teardownActive();
        },
        destroy() {
            if (unsubscribeFocus) {
                unsubscribeFocus();
                unsubscribeFocus = null;
            }
            shown = false;
            teardownActive();
        },
    };
}
