/**
 * `zoomToFitCompletedPuzzle` reaches into the DOM directly — querying
 * `[data-group-id]` and `[data-puzzle-table]`, and calling
 * `applyGroupTransform` — instead of going through the `Renderer` port.
 * That is a pre-existing leak carried over from `main.ts`, not something
 * this module introduces; routing it through the renderer is out of scope
 * here.
 */

import {
    applyGroupTransform,
    VIEWPORT_TRANSITION,
    VIEWPORT_TRANSITION_MS,
    type Renderer,
} from '../renderer/index.js';
import type { ViewportTransform } from '../interaction/index.js';
import type { GameState, PieceGroup } from '../model/types.js';
import { rotatePoint, signedAngularDelta } from '../model/helpers.js';
import {
    computeGatheredPositions,
    applyGatheredPositions,
    getGroupVisualBounds,
    getGroupImageCenter,
} from '../game/index.js';

/**
 * Headroom the fallback timer gives `transitionend` to fire first, so the
 * net below never pre-empts a transition that is genuinely running.
 *
 * The deadline itself is {@link VIEWPORT_TRANSITION_MS}, imported rather
 * than restated: the `Renderer` port owns how long its animation takes, so
 * a second literal here would let the two drift and start cutting every
 * completion zoom short. The group spin below reuses the renderer's CSS
 * string for the same reason, which is what makes the two animations land
 * together.
 *
 * Exported so `viewport-fit.test.ts` can derive the deadlines it advances
 * timers to instead of hardcoding them — otherwise raising the transition
 * reddens tests that report nothing wrong.
 */
export const SETTLE_GRACE_MS = 200;

export interface ViewportFitDeps {
    container: HTMLElement;
    renderer: Renderer;
    viewportTransform: ViewportTransform;
    applyTransform: () => void;
    /**
     * Re-render whatever game is current, read late. The completion cleanup
     * fires up to 1000ms after the call (the transition plus the settle
     * grace below), by which time a new game may have started — capturing
     * `state` would paint the finished puzzle over it.
     */
    renderCurrent: () => void;
}

export function gatherAndZoomToFit(state: GameState, deps: ViewportFitDeps): void {
    const { container, viewportTransform, applyTransform } = deps;
    const screenWidth = container.clientWidth || window.innerWidth;
    const screenHeight = container.clientHeight || window.innerHeight;
    const aspectRatio = screenWidth / screenHeight;

    const { positions, layoutBounds } = computeGatheredPositions(
        state.groups,
        aspectRatio,
        state.piecesById,
    );

    applyGatheredPositions(state.groups, positions);

    const scaleX = screenWidth / layoutBounds.width;
    const scaleY = screenHeight / layoutBounds.height;
    const scale = Math.min(scaleX, scaleY) * 0.9;

    const layoutCenterX = layoutBounds.x + layoutBounds.width / 2;
    const layoutCenterY = layoutBounds.y + layoutBounds.height / 2;

    viewportTransform.setState({
        scale,
        offset: {
            x: screenWidth / 2 - layoutCenterX * scale,
            y: screenHeight / 2 - layoutCenterY * scale,
        },
    });

    applyTransform();
}

/**
 * Unlike gatherAndZoomToFit(), this does not re-lay-out the board. Its one
 * model write is the completed group's upright resting state — `position`
 * and `rotation = 0` — and only when the puzzle finished at a non-zero
 * rotation.
 *
 * @param onComplete - Run exactly once per call, when the zoom settles:
 *   at `transitionend`, or at a deadline if that never arrives — including
 *   when no animation ran at all. Like `deps.renderCurrent` it fires up to
 *   1000ms late, so it must not assume the game that completed is still
 *   installed; there is no handle to cancel it with.
 */
export function zoomToFitCompletedPuzzle(
    state: GameState,
    completedGroup: PieceGroup,
    deps: ViewportFitDeps,
    onComplete: () => void,
): void {
    const { container, renderer, viewportTransform, applyTransform, renderCurrent } = deps;
    const screenWidth = container.clientWidth || window.innerWidth;
    const screenHeight = container.clientHeight || window.innerHeight;

    // If the puzzle was completed at a non-zero rotation, spin the group
    // upright in parallel with the viewport zoom. Two things matter for how
    // this looks:
    //
    //   1. It should spin about the puzzle's own center, in place — not orbit.
    //      CSS interpolates `translate(...)` and `rotate(...)` independently,
    //      so animating both would swing the center along an arc. Instead we
    //      pin the rotation's `transform-origin` to the image center and
    //      animate the angle only, keeping the center fixed throughout.
    //   2. It should take the shortest path (≤180°): 350° spins +10° to land
    //      upright, not −350° the long way round.
    let groupTransitionCleanup: (() => void) | null = null;
    if (completedGroup.rotation !== 0) {
        const startRotation = completedGroup.rotation;

        // Pivot about the assembled image center (corner geometry only, so
        // asymmetric tabs don't offset it). `getGroupImageCenter` works in
        // un-rotated local space — the same frame `transform-origin` uses.
        const centerLocal = getGroupImageCenter(completedGroup, state.piecesById);

        // Compensate `position` so that, with the origin moved to the center,
        // the puzzle stays exactly where it was rendered. Same world point as
        // before; only its local-space pivot changed.
        const rotatedCenter = rotatePoint(centerLocal, startRotation);
        const finalPosition = {
            x: completedGroup.position.x + rotatedCenter.x - centerLocal.x,
            y: completedGroup.position.y + rotatedCenter.y - centerLocal.y,
        };

        // Shortest signed turn that lands on an upright (0°-equivalent) angle.
        // e.g. 350° → 360°, 10° → 0°, 200° → 360°.
        const targetRotation = startRotation + signedAngularDelta(0, startRotation);

        const groupEl = container.querySelector(
            `[data-group-id="${completedGroup.id}"]`,
        ) as HTMLElement | null;
        if (groupEl) {
            // Re-anchor to the center origin without moving the puzzle (same
            // angle, compensated position), then force a reflow so this state
            // becomes the transition's start frame rather than collapsing into
            // the spin below.
            groupEl.style.transition = 'none';
            applyGroupTransform(groupEl, finalPosition, startRotation, centerLocal);
            groupEl.getBoundingClientRect();

            // Spin about the center to upright, in lockstep with the
            // viewport zoom — the renderer's own transition string, so
            // same duration, same easing, same frame.
            groupEl.style.transition = VIEWPORT_TRANSITION;
            applyGroupTransform(groupEl, finalPosition, targetRotation, centerLocal);

            groupTransitionCleanup = () => {
                // Settle into the normal representation: origin back at 0,0 and
                // rotation normalized to 0. Visually identical to the spin's
                // final frame (targetRotation ≡ 0 mod 360), so no jump.
                groupEl.style.transition = '';
                renderCurrent();
            };
        }

        // Commit the upright resting state. Used immediately below to frame the
        // viewport on the final orientation, and as the model's settled value.
        completedGroup.position = finalPosition;
        completedGroup.rotation = 0;
    }

    const groupBounds = getGroupVisualBounds(completedGroup, state.piecesById);

    const worldBounds = {
        x: completedGroup.position.x + groupBounds.minX,
        y: completedGroup.position.y + groupBounds.minY,
        width: groupBounds.width,
        height: groupBounds.height,
    };

    const scaleX = screenWidth / worldBounds.width;
    const scaleY = screenHeight / worldBounds.height;
    const targetScale = Math.min(scaleX, scaleY) * 0.9; // 10% padding like gatherAndZoomToFit

    const worldCenterX = worldBounds.x + worldBounds.width / 2;
    const worldCenterY = worldBounds.y + worldBounds.height / 2;
    const targetOffset = {
        x: screenWidth / 2 - worldCenterX * targetScale,
        y: screenHeight / 2 - worldCenterY * targetScale,
    };

    renderer.enableViewportTransition();

    // Apply the target transform on next frame to ensure transition is set
    requestAnimationFrame(() => {
        viewportTransform.setState({
            scale: targetScale,
            offset: targetOffset,
        });

        applyTransform();

        const tableEl = container.querySelector('[data-puzzle-table]') as HTMLElement | null;

        let settled = false;
        let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

        // Wind the zoom up: put the table's transition back the way it was,
        // let the spun group's element go, and tell the caller.
        //
        // Single-shot today by construction rather than by the latch: the
        // first path through unsubscribes the listener and cancels the
        // timer, so whichever loses the race can no longer reach here. The
        // latch is defence in depth for the edit that breaks that — moving
        // either line below `onComplete`, or dropping one — since a second
        // `onComplete` shows the completion overlay twice. It is set before
        // the three effects so a throw in any of them cannot re-open it
        // either.
        function settle(): void {
            if (settled) return;
            settled = true;
            tableEl?.removeEventListener('transitionend', handleTransitionEnd);
            clearTimeout(fallbackTimer);
            renderer.disableViewportTransition();
            groupTransitionCleanup?.();
            onComplete();
        }

        function handleTransitionEnd(event: TransitionEvent): void {
            if (event.propertyName === 'transform' && event.target === tableEl) settle();
        }

        tableEl?.addEventListener('transitionend', handleTransitionEnd);

        // `transitionend` is the accurate signal but it cannot be the only
        // one: when the target transform equals the current one — two
        // Solves in a row frame the same completed group from the same
        // viewport, so `targetScale`/`targetOffset` come out identical —
        // the browser starts no `transform` transition and the event never
        // fires. Left unsettled that keeps `transition: transform 0.8s` on
        // the table, so every later pan and zoom animates; keeps the
        // listener on an element `renderState` never replaces; and keeps
        // the completed group's detached element alive for the session.
        //
        // With a table present the timer is the net, so it gets a grace
        // period on top of the transition — the real event has to win the
        // race on the ordinary path or it would cut the zoom short. With
        // no table there is nothing to transition and nothing to wait for,
        // so it fires at the nominal duration, as it always has.
        fallbackTimer = setTimeout(
            settle,
            tableEl ? VIEWPORT_TRANSITION_MS + SETTLE_GRACE_MS : VIEWPORT_TRANSITION_MS,
        );
    });
}
