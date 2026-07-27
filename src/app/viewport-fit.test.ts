/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { GameState, PieceGroup } from '../model/types.js';
import { ViewportTransform } from '../interaction/index.js';
import { computeGatheredPositions } from '../game/index.js';
import { createFakeRenderer, type FakeRenderer } from '../test-helpers/fake-renderer.js';
import { makeGameState, makeCenteredGroup, makeRectPiece } from '../test-helpers/fixtures.js';
import { VIEWPORT_TRANSITION_MS } from '../renderer/index.js';
import { gatherAndZoomToFit, SETTLE_GRACE_MS, zoomToFitCompletedPuzzle } from './viewport-fit.js';

/**
 * The two deadlines the fallback timer is armed to, derived rather than
 * spelled out: raising the renderer's transition has to move these with it,
 * or the suite reddens on tests that report nothing wrong.
 */
const TABLE_DEADLINE_MS = VIEWPORT_TRANSITION_MS + SETTLE_GRACE_MS;
const NO_TABLE_DEADLINE_MS = VIEWPORT_TRANSITION_MS;

/**
 * A state with two real, well-formed groups (rather than the default empty
 * `groups: []`) so `computeGatheredPositions`/`applyGatheredPositions` have
 * something to actually pack and move.
 */
function makeMultiGroupState(): GameState {
    const pieces = [
        makeRectPiece({ id: 0, width: 100, height: 100 }),
        makeRectPiece({ id: 1, width: 100, height: 100 }),
    ];
    const groups: PieceGroup[] = [
        makeCenteredGroup(0, 0, { x: 100, y: 100 }),
        makeCenteredGroup(1, 1, { x: 500, y: 500 }),
    ];
    return makeGameState({ pieces, groups });
}

/**
 * A state with the single group a completed puzzle would have — one piece
 * is enough since the completion math only needs a group with real bounds.
 */
function makeCompletedState(): GameState {
    const pieces = [makeRectPiece({ id: 0, width: 100, height: 100 })];
    const groups: PieceGroup[] = [makeCenteredGroup(0, 0, { x: 100, y: 100 })];
    return makeGameState({ pieces, groups });
}

describe('gatherAndZoomToFit', () => {
    let container: HTMLElement;
    let renderer: FakeRenderer;
    let viewportTransform: ViewportTransform;
    // `Mock<() => void>` rather than bare `ReturnType<typeof vi.fn>`: the
    // latter widens to vi.fn's full generic constraint and stops being
    // assignable to `ViewportFitDeps.applyTransform: () => void`.
    let applyTransform: Mock<() => void>;
    let renderCurrent: Mock<() => void>;

    beforeEach(() => {
        container = document.createElement('div');
        // jsdom reports 0 for clientWidth/Height; the code falls back to
        // window.innerWidth/Height, which jsdom defaults to 1024x768.
        renderer = createFakeRenderer();
        viewportTransform = new ViewportTransform();
        applyTransform = vi.fn();
        renderCurrent = vi.fn();
    });

    it('scales to fit with 10% padding and centers the layout', () => {
        const state = makeMultiGroupState();
        // Independent reference computation: computeGatheredPositions is
        // deterministic for this fixture (two identically-sized groups, so
        // the internal shuffle can't change the resulting bounds), which
        // lets the expected scale/offset be derived from the real layout
        // instead of hardcoded magic pixel numbers.
        const aspectRatio = window.innerWidth / window.innerHeight;
        const { layoutBounds } = computeGatheredPositions(state.groups, aspectRatio, state.piecesById);
        const expectedScale = Math.min(
            window.innerWidth / layoutBounds.width,
            window.innerHeight / layoutBounds.height,
        ) * 0.9;
        const expectedCenterX = layoutBounds.x + layoutBounds.width / 2;
        const expectedCenterY = layoutBounds.y + layoutBounds.height / 2;

        gatherAndZoomToFit(state, { container, renderer, viewportTransform, applyTransform, renderCurrent });

        const { scale, offset } = viewportTransform.getState();
        expect(scale).toBe(expectedScale);
        expect(offset.x).toBe(window.innerWidth / 2 - expectedCenterX * scale);
        expect(offset.y).toBe(window.innerHeight / 2 - expectedCenterY * scale);
        expect(applyTransform).toHaveBeenCalled();
    });

    it('moves the groups, not just the viewport', () => {
        const state = makeMultiGroupState();
        const before = state.groups.map((g) => ({ ...g.position }));

        gatherAndZoomToFit(state, { container, renderer, viewportTransform, applyTransform, renderCurrent });

        const after = state.groups.map((g) => g.position);
        expect(after).not.toEqual(before);
    });
});

describe('zoomToFitCompletedPuzzle', () => {
    let container: HTMLElement;
    let renderer: FakeRenderer;
    let viewportTransform: ViewportTransform;
    // `Mock<() => void>` rather than bare `ReturnType<typeof vi.fn>`: the
    // latter widens to vi.fn's full generic constraint and stops being
    // assignable to `ViewportFitDeps.applyTransform: () => void`.
    let applyTransform: Mock<() => void>;
    let renderCurrent: Mock<() => void>;
    let deps: Parameters<typeof zoomToFitCompletedPuzzle>[2];

    beforeEach(() => {
        vi.useFakeTimers();
        container = document.createElement('div');
        renderer = createFakeRenderer();
        viewportTransform = new ViewportTransform();
        applyTransform = vi.fn();
        renderCurrent = vi.fn();
        deps = { container, renderer, viewportTransform, applyTransform, renderCurrent };
        // requestAnimationFrame runs the transform application one frame later.
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            cb(0);
            return 0;
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('normalizes a completed rotation to upright', () => {
        const state = makeCompletedState();
        const group = state.groups[0];
        group.rotation = 350;

        zoomToFitCompletedPuzzle(state, group, deps, () => {});

        // 350° takes the +10° short way to an upright resting angle.
        expect(group.rotation).toBe(0);
    });

    it('spins the DOM element the short way (+10°), not the long way (-350°)', () => {
        // The settled model rotation is always normalized to 0, so it can't
        // distinguish a +10° turn from a -350° one — only the CSS transition
        // target actually written to the element shows which way it spins.
        const state = makeCompletedState();
        const group = state.groups[0];
        group.rotation = 350;

        const groupEl = document.createElement('div');
        groupEl.dataset.groupId = String(group.id);
        container.appendChild(groupEl);

        zoomToFitCompletedPuzzle(state, group, deps, () => {});

        // 350° should animate to 360° (the +10° short way), not 0° (the
        // -350° long way), even though both are visually upright at rest.
        expect(groupEl.style.transform).toContain('rotate(360deg)');
        // The origin must be pinned to the image center (50,50 for this
        // fixture's single 100×100 piece) — without it the rotation would
        // pivot about the group's default (0,0) origin and orbit instead of
        // spinning in place.
        expect(groupEl.style.transformOrigin).toBe('50px 50px');
    });

    it('forces a reflow between the re-anchor frame and the spin frame', () => {
        // Without the forced reflow, the browser can coalesce the re-anchor
        // (transition: none) and the spin (a real transition) style writes
        // into a single paint, collapsing the animation to one frame instead
        // of animating from the re-anchored start.
        const state = makeCompletedState();
        const group = state.groups[0];
        group.rotation = 90;

        const groupEl = document.createElement('div');
        groupEl.dataset.groupId = String(group.id);
        container.appendChild(groupEl);
        const reflowSpy = vi.spyOn(groupEl, 'getBoundingClientRect');

        zoomToFitCompletedPuzzle(state, group, deps, () => {});

        expect(reflowSpy).toHaveBeenCalled();
    });

    it('compensates position so the puzzle does not move when the pivot changes', () => {
        // Re-anchoring transform-origin to the image center must keep the same
        // world point under the puzzle, or it jumps before the spin starts.
        // Exact value, not just "changed": position {50,50}, image center
        // {50,50}, rotated 90° — a sign flip or wrong angle would also
        // change the position but land on the wrong point.
        const state = makeCompletedState();
        const group = state.groups[0];
        group.rotation = 90;

        zoomToFitCompletedPuzzle(state, group, deps, () => {});

        expect(group.position).toEqual({ x: -50, y: 50 });
    });

    it('leaves position alone for a puzzle completed upright', () => {
        const state = makeCompletedState();
        const group = state.groups[0];
        group.rotation = 0;
        const before = { ...group.position };

        zoomToFitCompletedPuzzle(state, group, deps, () => {});

        expect(group.position).toEqual(before);
    });

    it('enables the viewport transition and disables it when the transition ends', () => {
        const state = makeCompletedState();
        const table = document.createElement('div');
        table.dataset.puzzleTable = 'true';
        container.appendChild(table);

        const onComplete = vi.fn();
        zoomToFitCompletedPuzzle(state, state.groups[0], deps, onComplete);

        expect(renderer.enableViewportTransition).toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();

        table.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'transform' }));

        expect(renderer.disableViewportTransition).toHaveBeenCalled();
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('ignores a transitionend for an unrelated CSS property', () => {
        // The table transitions other properties too (e.g. background-color
        // on theme change); only "transform" ending means the zoom is done.
        const state = makeCompletedState();
        const table = document.createElement('div');
        table.dataset.puzzleTable = 'true';
        container.appendChild(table);

        const onComplete = vi.fn();
        zoomToFitCompletedPuzzle(state, state.groups[0], deps, onComplete);

        table.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'opacity' }));

        expect(onComplete).not.toHaveBeenCalled();
    });

    it('does not fire onComplete twice for a repeated transitionend', () => {
        // The handler must unsubscribe itself once it fires, or a second
        // "transform" transitionend (e.g. from an unrelated later zoom)
        // would run the completion callback again.
        const state = makeCompletedState();
        const table = document.createElement('div');
        table.dataset.puzzleTable = 'true';
        container.appendChild(table);

        const onComplete = vi.fn();
        zoomToFitCompletedPuzzle(state, state.groups[0], deps, onComplete);

        const dispatchTransformEnd = () =>
            table.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'transform' }));
        dispatchTransformEnd();
        dispatchTransformEnd();

        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('settles on the timer when the transform never transitions', () => {
        // A `transform` transition only starts when the transform actually
        // changes. Two Solves in a row frame the same completed group from
        // the same viewport, so the second computes a target identical to
        // what is already applied, no transition runs and `transitionend`
        // never fires. Without a timer armed in this branch too, the
        // viewport transition is never disabled — so every later pan and
        // zoom animates for 0.8s — the listener stays on an element the
        // renderer never replaces, and the spun group's element is retained.
        const state = makeCompletedState();
        const group = state.groups[0];
        group.rotation = 90;
        const table = document.createElement('div');
        table.dataset.puzzleTable = 'true';
        container.appendChild(table);
        const groupEl = document.createElement('div');
        groupEl.dataset.groupId = String(group.id);
        container.appendChild(groupEl);

        const onComplete = vi.fn();
        zoomToFitCompletedPuzzle(state, group, deps, onComplete);

        // The zoom, then the grace on top. Not settled at the nominal
        // duration: on the ordinary path the real transitionend has to win
        // this race, or the timer would cut the zoom short.
        vi.advanceTimersByTime(VIEWPORT_TRANSITION_MS);
        expect(onComplete).not.toHaveBeenCalled();

        vi.advanceTimersByTime(SETTLE_GRACE_MS);
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(renderer.disableViewportTransition).toHaveBeenCalledTimes(1);
        expect(renderCurrent).toHaveBeenCalledTimes(1);
    });

    it('removes its transitionend listener when the timer settles it', () => {
        // The listener lands on `[data-puzzle-table]`, which `renderer.init`
        // creates once and `renderState` never replaces — so one that is
        // never removed lives on the element for the rest of the session,
        // one per completion. A leaked listener cannot re-run `onComplete`
        // — the `settled` latch stops that — so no callback assertion can
        // see this; the registration itself is what has to be checked.
        const state = makeCompletedState();
        const table = document.createElement('div');
        table.dataset.puzzleTable = 'true';
        container.appendChild(table);
        const add = vi.spyOn(table, 'addEventListener');
        const remove = vi.spyOn(table, 'removeEventListener');

        zoomToFitCompletedPuzzle(state, state.groups[0], deps, () => {});
        vi.advanceTimersByTime(TABLE_DEADLINE_MS);

        // Same handler identities, same order: what was wired is exactly
        // what was unwired, rather than merely "something was removed".
        expect(add.mock.calls.length).toBeGreaterThan(0);
        expect(remove.mock.calls).toEqual(add.mock.calls);
    });

    it('cancels the fallback timer when the transition ends first', () => {
        // The ordinary path: the timer is a net, not a second completion.
        const state = makeCompletedState();
        const table = document.createElement('div');
        table.dataset.puzzleTable = 'true';
        container.appendChild(table);

        const onComplete = vi.fn();
        zoomToFitCompletedPuzzle(state, state.groups[0], deps, onComplete);
        table.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'transform' }));
        expect(onComplete).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(TABLE_DEADLINE_MS);

        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(renderer.disableViewportTransition).toHaveBeenCalledTimes(1);
    });

    it('re-renders whatever game is current when the cleanup fires, not the state captured at call time', () => {
        // The cleanup can fire up to 1000ms after this call (transitionend or
        // the timer fallback) — by which time a new game may have started.
        // It must read gameState fresh via `renderCurrent`, not repaint the
        // `state` this call was made with. The cleanup only exists when the
        // group had a non-zero rotation and its DOM element was found, so
        // both must be set up for this test to exercise it at all.
        const state = makeCompletedState();
        const group = state.groups[0];
        group.rotation = 90;

        const groupEl = document.createElement('div');
        groupEl.dataset.groupId = String(group.id);
        container.appendChild(groupEl);

        zoomToFitCompletedPuzzle(state, group, deps, () => {});
        vi.advanceTimersByTime(NO_TABLE_DEADLINE_MS);

        expect(renderCurrent).toHaveBeenCalledTimes(1);
        expect(renderer.renderState).not.toHaveBeenCalled();
    });

    it('falls back to a timer when the table element is missing', () => {
        const state = makeCompletedState();
        const onComplete = vi.fn();

        zoomToFitCompletedPuzzle(state, state.groups[0], deps, onComplete);
        expect(onComplete).not.toHaveBeenCalled();

        vi.advanceTimersByTime(NO_TABLE_DEADLINE_MS);
        expect(onComplete).toHaveBeenCalledTimes(1);
    });
});
