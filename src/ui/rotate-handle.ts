/**
 * Free-rotation drag handle — a single round button that floats below the
 * focused group's bbox. A drag that originates on this handle rotates the
 * focused group continuously, with the angle from the group's bbox-centre
 * to the pointer kept constant for the duration of the drag.
 *
 * A `pointerdown` on the button captures the pointer, records the pivot
 * (group bbox-centre in world space) and initial angle, then emits
 * `onRotate` with an additive delta on each `pointermove`. `pointerup`
 * fires `onCommit`; `pointercancel` or a second window `pointerdown`
 * cancels without committing.
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
     * to the live `PieceGroup` and re-renders.
     */
    onRotate: (groupId: number, deltaDegrees: number) => void;
    /**
     * Emitted on drag end, after the final `onRotate`. The host runs
     * merge-detection here.
     */
    onCommit: (groupId: number) => void;
    /** Project the focused group's visual bounds into screen-space. */
    getFocusedGroupScreenBounds: (groupId: number) =>
        | { left: number; right: number; top: number; bottom: number }
        | null;
    getViewportSize?: () => { width: number; height: number };
    /** Current rotation of the focused group, in degrees. */
    getGroupRotation: (groupId: number) => number | null;
    /** World position of the focused group's bbox centre. */
    getGroupPivotWorld: (groupId: number) => { x: number; y: number } | null;
    /** Convert a screen-space (clientX, clientY) point to world coordinates. */
    screenToWorld: (clientX: number, clientY: number) => { x: number; y: number };
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
    cancelDrag: () => void;
    isDragging: () => boolean;
}

/**
 * A nearly-complete circle (~330°) with a gap at the top, and two V-shaped
 * arrowheads at the gap ends pointing outward in opposite tangential
 * directions (up-and-left for the CCW exit, up-and-right for the CW exit).
 * Reads unambiguously as "rotates either way."
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

    // 270° arc with a 90° gap at the top of a radius-8 circle centred at
    // (12, 12). Endpoints at (6, 6) [≈10:30] and (18, 6) [≈1:30]. sweep=0
    // (CCW in screen coords) places the centre below the chord so the arc
    // loops around the bottom; large-arc=1 takes the long way.
    const arc = document.createElementNS(SVG_NS, 'path');
    arc.setAttribute('d', 'M6 6 A 8 8 0 1 0 18 6');
    svg.appendChild(arc);

    // Filled triangle arrowheads at the gap, apexes at (3, 3) and (21, 3) —
    // pointing tangentially outward (up-and-left for the CCW exit, up-and-
    // right for the CW exit). Filled triangles read more clearly as
    // directional arrows than stroked Vs at this size, and the contrast in
    // style with the stroke-only quarter-turn rotate buttons reinforces
    // that this is a different kind of control.
    const headLeft = document.createElementNS(SVG_NS, 'polygon');
    headLeft.setAttribute('points', '3 3, 5 7, 7 5');
    headLeft.setAttribute('fill', 'currentColor');
    headLeft.setAttribute('stroke', 'none');
    svg.appendChild(headLeft);

    const headRight = document.createElementNS(SVG_NS, 'polygon');
    headRight.setAttribute('points', '21 3, 19 7, 17 5');
    headRight.setAttribute('fill', 'currentColor');
    headRight.setAttribute('stroke', 'none');
    svg.appendChild(headRight);

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

        // ── Gesture wiring ────────────────────────────────────────────────

        let drag: {
            pivot: { x: number; y: number };
            initialRotation: number;
            initialAngleRad: number;
            pointerId: number;
            extraPointerListener: (e: PointerEvent) => void;
        } | null = null;

        function finalizeDrag(commit: boolean): void {
            if (!drag) return;
            if (button.hasPointerCapture(drag.pointerId)) {
                button.releasePointerCapture(drag.pointerId);
            }
            window.removeEventListener('pointerdown', drag.extraPointerListener, true);
            const groupIdRef = active?.groupId;
            drag = null;
            if (commit && groupIdRef !== undefined) {
                options.onCommit(groupIdRef);
            }
            startIdleTimer();
        }

        function cancelDrag(): void {
            finalizeDrag(/* commit */ false);
        }

        button.addEventListener('pointerdown', (event) => {
            if (drag !== null) return;
            const pivot = options.getGroupPivotWorld(groupId);
            const initialRotation = options.getGroupRotation(groupId);
            if (!pivot || initialRotation === null) return;

            const Q0 = options.screenToWorld(event.clientX, event.clientY);
            const initialAngleRad = Math.atan2(Q0.y - pivot.y, Q0.x - pivot.x);

            button.setPointerCapture(event.pointerId);

            // Multi-finger cancel: any subsequent pointerdown anywhere on window
            // (other than the captured pointer) ends the rotation drag.
            const extraPointerListener = (e: PointerEvent): void => {
                if (e.pointerId === event.pointerId) return;
                cancelDrag();
            };
            window.addEventListener('pointerdown', extraPointerListener, true);

            drag = {
                pivot,
                initialRotation,
                initialAngleRad,
                pointerId: event.pointerId,
                extraPointerListener,
            };

            if (active && active.state !== 'visible') rescueActive();
            clearIdleTimer();
            event.preventDefault();
        });

        button.addEventListener('pointermove', (event) => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            const Q = options.screenToWorld(event.clientX, event.clientY);
            const angleRad = Math.atan2(Q.y - drag.pivot.y, Q.x - drag.pivot.x);
            const deltaDeg = ((angleRad - drag.initialAngleRad) * 180) / Math.PI;
            const targetRotation = drag.initialRotation + deltaDeg;
            const currentRotation = options.getGroupRotation(groupId);
            if (currentRotation === null) return;
            options.onRotate(groupId, targetRotation - currentRotation);
        });

        button.addEventListener('pointerup', (event) => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            finalizeDrag(/* commit */ true);
        });

        button.addEventListener('pointercancel', (event) => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            finalizeDrag(/* commit */ false);
        });

        // ── End gesture wiring ────────────────────────────────────────────

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
            cancelDrag,
            isDragging: () => drag !== null,
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
        // Idle timeout should never tear down an in-progress drag. Today the
        // idle timer is cleared at pointerdown and re-armed at finalize, so
        // this branch is unreachable; the guard makes the contract explicit
        // and protects future callers that might re-arm the timer mid-drag.
        if (active.isDragging()) return;
        clearIdleTimer();
        active.state = 'fade-out-slow';
        active.button.classList.remove('rotate-handle--fade-in');
        active.button.classList.add('rotate-handle--fade-out-slow');
        scheduleRemoval(active, SLOW_FADE_MS, /* clearFocusOnRemove */ true);
    }

    function startQuickFadeOut(handle: ActiveHandle): void {
        handle.cancelDrag();
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
        active.cancelDrag(); // clean up any in-progress drag before removing the button
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
