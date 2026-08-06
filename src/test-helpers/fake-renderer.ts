/**
 * The app layer talks to the renderer through the `Renderer` port only, so a
 * fake made of spies is enough to assert what the layer asked for — no real
 * DOM, no `SvgDomRenderer`.
 *
 * The two hit-test methods answer `null` for everything: this fake has no
 * geometry to hit-test against. They are spies like the rest, not bare
 * stubs, because they *are* reached — `game-session.test.ts` hands this fake
 * to the real `setupInteraction`, which calls `pieceIdFromTarget` on every
 * pointerdown and `pieceIdAtPoint` for the snap probe. A test that drives a
 * real pointer sequence therefore gets "no piece hit" from every event; that
 * is a limit of the fake, not a behavior failure. Give the relevant one a
 * `mockReturnValue(pieceId)` when a test here needs a hit.
 */

import { vi, type Mock } from 'vitest';
import type { Renderer } from '../renderer/types.js';

// `Mock<Renderer['x']>` (not bare `Mock`/`ReturnType<typeof vi.fn>`, which
// widens to vi.fn's full `Procedure | Constructable` generic constraint and
// stops being callable — TypeScript then rejects assigning these fields to
// a real `Renderer`) — parameterizing each field on its real method
// signature also means a signature change on `Renderer` breaks this file's
// typecheck instead of silently losing argument typing in
// `toHaveBeenCalledWith`.
//
// Extending `Renderer` directly needs no `Omit` of the overridden keys:
// `Mock<T>` is callable with `T`'s own signature, so each field below is
// assignable to the member it overrides. Keeping the members inherited is
// what makes that assignability checked — a wrong `Mock<…>` parameter here
// fails at this declaration (TS2430) rather than only at distant call sites.
export interface FakeRenderer extends Renderer {
    init: Mock<Renderer['init']>;
    renderState: Mock<Renderer['renderState']>;
    bringGroupToFront: Mock<Renderer['bringGroupToFront']>;
    setViewportTransform: Mock<Renderer['setViewportTransform']>;
    enableViewportTransition: Mock<Renderer['enableViewportTransition']>;
    disableViewportTransition: Mock<Renderer['disableViewportTransition']>;
    setGroupDragging: Mock<Renderer['setGroupDragging']>;
    flashMergePulse: Mock<Renderer['flashMergePulse']>;
    setGroupSelected: Mock<Renderer['setGroupSelected']>;
    pieceIdFromTarget: Mock<Renderer['pieceIdFromTarget']>;
    pieceIdAtPoint: Mock<Renderer['pieceIdAtPoint']>;
    destroy: Mock<Renderer['destroy']>;
}

export function createFakeRenderer(): FakeRenderer {
    return {
        init: vi.fn(),
        renderState: vi.fn(),
        bringGroupToFront: vi.fn(),
        setViewportTransform: vi.fn(),
        enableViewportTransition: vi.fn(),
        disableViewportTransition: vi.fn(),
        setGroupDragging: vi.fn(),
        flashMergePulse: vi.fn(),
        setGroupSelected: vi.fn(),
        pieceIdFromTarget: vi.fn<Renderer['pieceIdFromTarget']>(() => null),
        pieceIdAtPoint: vi.fn<Renderer['pieceIdAtPoint']>(() => null),
        destroy: vi.fn(),
    };
}
