/**
 * @vitest-environment jsdom
 */

/**
 * Tests for setupInteraction — the orchestration layer that wires
 * PointerRouter + DragController + ViewportController + AutoPanController.
 *
 * The bulk of gesture-classification logic is covered in pointer-router.test.ts;
 * this file only verifies that the wiring between collaborators is correct.
 *
 * Uses a FakeContainer that captures addEventListener handlers and exposes
 * a fire() helper — same pattern as setup-drag.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupInteraction } from './setup-interaction.js';
import { ViewportTransform } from './viewport-transform.js';
import { SelectionManager } from './selection-manager.js';
import { RotationFocus } from './rotation-focus.js';
import type { Renderer } from '../renderer/types.js';
import type { GameState, PieceGroup } from '../model/types.js';
import { makeCenteredGroup, makeGameState, makeMatedPiecePair } from '../test-helpers/fixtures.js';
import { loadOffsetDragPreference } from '../ui/offset-drag.js';

vi.mock('../ui/offset-drag.js', () => ({
    loadOffsetDragPreference: vi.fn(() => false),
}));

beforeEach(() => {
    globalThis.requestAnimationFrame = vi.fn(() => 1);
    globalThis.cancelAnimationFrame = vi.fn();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FakeContainer {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    setPointerCapture: ReturnType<typeof vi.fn>;
    hasPointerCapture: ReturnType<typeof vi.fn>;
    releasePointerCapture: ReturnType<typeof vi.fn>;
    appendChild: ReturnType<typeof vi.fn>;
    fire(type: string, event: PointerEvent | WheelEvent): void;
}

function createFakeContainer(): FakeContainer {
    const listeners: Record<string, Array<(e: Event) => void>> = {};
    const captured = new Set<number>();

    return {
        addEventListener: vi.fn((type: string, cb: (e: Event) => void) => {
            (listeners[type] ??= []).push(cb);
        }),
        removeEventListener: vi.fn((type: string, cb: (e: Event) => void) => {
            const arr = listeners[type] ?? [];
            const idx = arr.indexOf(cb);
            if (idx >= 0) arr.splice(idx, 1);
        }),
        setPointerCapture: vi.fn((id: number) => { captured.add(id); }),
        hasPointerCapture: vi.fn((id: number) => captured.has(id)),
        releasePointerCapture: vi.fn((id: number) => { captured.delete(id); }),
        appendChild: vi.fn(),
        fire(type, event) {
            for (const cb of listeners[type] ?? []) cb(event);
        },
    };
}

function createFakeRenderer(): Renderer {
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
        pieceIdFromTarget: vi.fn((t: EventTarget | null) =>
            (t as { _pieceId?: number } | null)?._pieceId ?? null),
        // Defaults to "no piece nearby"; tests of the near-miss probe
        // override this to report a piece for probed points.
        pieceIdAtPoint: vi.fn(() => null),
        destroy: vi.fn(),
    };
}

function fakePointerEvent(
    overrides: Partial<{
        clientX: number;
        clientY: number;
        pointerId: number;
        pointerType: string;
        target: EventTarget | null;
        shiftKey: boolean;
    }> = {},
): PointerEvent {
    return {
        clientX: overrides.clientX ?? 0,
        clientY: overrides.clientY ?? 0,
        pointerId: overrides.pointerId ?? 1,
        pointerType: overrides.pointerType ?? 'mouse',
        target: overrides.target ?? null,
        shiftKey: overrides.shiftKey ?? false,
        preventDefault: vi.fn(),
    } as unknown as PointerEvent;
}

function makeGroup(id: number, pieceIds: number[], position = { x: 0, y: 0 }): PieceGroup {
    const pieces = new Map<number, { x: number; y: number }>();
    for (const pid of pieceIds) pieces.set(pid, { x: 0, y: 0 });
    return { id, pieces, position, rotation: 0 };
}

function makeState(groups: PieceGroup[]): GameState {
    return makeGameState({ groups });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('setupInteraction', () => {
    it('cleanup() removes container listeners', () => {
        const container = createFakeContainer();
        const cleanup = setupInteraction({
            container: container as unknown as HTMLElement,
            renderer: createFakeRenderer(),
            viewportTransform: new ViewportTransform(),
            getState: () => makeState([makeGroup(1, [1])]),
            onStateChanged: vi.fn(),
            onDrop: vi.fn(),
            onViewportChanged: vi.fn(),
        });

        cleanup();

        expect(container.removeEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
        expect(container.removeEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
        expect(container.removeEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
        expect(container.removeEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
        expect(container.removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function));
    });

    it('a piece tap in select-mode toggles selection', () => {
        const container = createFakeContainer();
        const renderer = createFakeRenderer();
        const selectionManager = new SelectionManager();
        selectionManager.toolActive = true;

        // Group 7 contains piece 3
        const state = makeState([makeGroup(7, [3])]);

        setupInteraction({
            container: container as unknown as HTMLElement,
            renderer,
            viewportTransform: new ViewportTransform(),
            getState: () => state,
            onStateChanged: vi.fn(),
            onDrop: vi.fn(),
            onViewportChanged: vi.fn(),
            selectionManager,
        });

        // The renderer's pieceIdFromTarget will return 3 for this target object
        const pieceTarget = { _pieceId: 3 } as unknown as EventTarget;

        // Fire pointerdown then pointerup with minimal movement (tap)
        container.fire('pointerdown', fakePointerEvent({ target: pieceTarget, clientX: 100, clientY: 100 }));
        container.fire('pointerup', fakePointerEvent({ target: pieceTarget, clientX: 101, clientY: 100 }));

        expect(selectionManager.isSelected(7)).toBe(true);
        expect(renderer.setGroupSelected).toHaveBeenCalledWith(7, true);
    });

    it('a piece drag triggers setGroupDragging(true) on start and onDrop on end', () => {
        const container = createFakeContainer();
        const renderer = createFakeRenderer();
        const onStateChanged = vi.fn();
        const onDrop = vi.fn();
        const state = makeState([makeGroup(7, [3])]);

        setupInteraction({
            container: container as unknown as HTMLElement,
            renderer,
            viewportTransform: new ViewportTransform(),
            getState: () => state,
            onStateChanged,
            onDrop,
            onViewportChanged: vi.fn(),
        });

        const pieceTarget = { _pieceId: 3 };
        container.fire('pointerdown', fakePointerEvent({ target: pieceTarget as unknown as EventTarget, pointerId: 1, clientX: 100, clientY: 100 }));
        container.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 120, clientY: 100 })); // promote
        expect(renderer.setGroupDragging).toHaveBeenCalledWith(7, true);

        container.fire('pointerup', fakePointerEvent({ pointerId: 1, clientX: 120, clientY: 100 }));
        expect(renderer.setGroupDragging).toHaveBeenCalledWith(7, false);
        expect(onDrop).toHaveBeenCalledWith(7);
    });

    it('a near-miss background press grabs a nearby piece via the probe', () => {
        const container = createFakeContainer();
        const renderer = createFakeRenderer();
        const onDrop = vi.fn();
        // Group 7 / piece 3 is just off the press point; the direct target is
        // background, but the probe finds piece 3 at points near the press.
        // Coordinate-sensitive so the test would fail if the wiring probed
        // the wrong location (or dropped the point).
        renderer.pieceIdAtPoint = vi.fn((p: { x: number; y: number }) =>
            Math.hypot(p.x - 100, p.y - 100) <= 8 ? 3 : null);
        const state = makeState([makeGroup(7, [3])]);

        setupInteraction({
            container: container as unknown as HTMLElement,
            renderer,
            viewportTransform: new ViewportTransform(),
            getState: () => state,
            onStateChanged: vi.fn(),
            onDrop,
            onViewportChanged: vi.fn(),
            panViewport: vi.fn(),
        });

        // Direct hit is background (target === container), so the probe runs.
        const bgTarget = container as unknown as EventTarget;
        container.fire('pointerdown', fakePointerEvent({ target: bgTarget, pointerId: 1, clientX: 100, clientY: 100 }));
        container.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 120, clientY: 100 })); // promote

        // It became a piece drag (not a background pan).
        expect(renderer.pieceIdAtPoint).toHaveBeenCalled();
        expect(renderer.setGroupDragging).toHaveBeenCalledWith(7, true);

        container.fire('pointerup', fakePointerEvent({ pointerId: 1, clientX: 120, clientY: 100 }));
        expect(onDrop).toHaveBeenCalledWith(7);
    });

    it('a background press with no nearby piece pans instead of grabbing', () => {
        const container = createFakeContainer();
        const renderer = createFakeRenderer(); // pieceIdAtPoint defaults to null
        const onDrop = vi.fn();
        const onViewportChanged = vi.fn();
        const state = makeState([makeGroup(7, [3])]);

        setupInteraction({
            container: container as unknown as HTMLElement,
            renderer,
            viewportTransform: new ViewportTransform(),
            getState: () => state,
            onStateChanged: vi.fn(),
            onDrop,
            onViewportChanged,
            panViewport: vi.fn(),
        });

        const bgTarget = container as unknown as EventTarget;
        container.fire('pointerdown', fakePointerEvent({ target: bgTarget, pointerId: 1, clientX: 100, clientY: 100 }));
        container.fire('pointermove', fakePointerEvent({ target: bgTarget, pointerId: 1, clientX: 130, clientY: 100 })); // promote pan
        container.fire('pointermove', fakePointerEvent({ target: bgTarget, pointerId: 1, clientX: 150, clientY: 100 })); // pan move

        // The probe ran and found nothing, so this stayed a background pan:
        // no piece grabbed, and the viewport changed.
        expect(renderer.pieceIdAtPoint).toHaveBeenCalled();
        expect(renderer.setGroupDragging).not.toHaveBeenCalled();
        expect(onViewportChanged).toHaveBeenCalled();
        expect(onDrop).not.toHaveBeenCalled();
    });

    it('a pointercancel during drag clears dragging visual without calling onDrop', () => {
        const container = createFakeContainer();
        const renderer = createFakeRenderer();
        const onDrop = vi.fn();
        const state = makeState([makeGroup(7, [3])]);

        setupInteraction({
            container: container as unknown as HTMLElement,
            renderer,
            viewportTransform: new ViewportTransform(),
            getState: () => state,
            onStateChanged: vi.fn(),
            onDrop,
            onViewportChanged: vi.fn(),
        });

        const pieceTarget = { _pieceId: 3 };
        container.fire('pointerdown', fakePointerEvent({ target: pieceTarget as unknown as EventTarget, pointerId: 1, clientX: 100, clientY: 100 }));
        container.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 120, clientY: 100 })); // promote
        container.fire('pointercancel', fakePointerEvent({ pointerId: 1 }));

        expect(renderer.setGroupDragging).toHaveBeenCalledWith(7, false);
        expect(onDrop).not.toHaveBeenCalled();
    });

    describe('rotation focus', () => {
        it('a piece tap sets focus on that group, regardless of multi-select state', () => {
            const container = createFakeContainer();
            const renderer = createFakeRenderer();
            const rotationFocus = new RotationFocus();
            const state = makeState([makeGroup(7, [3])]);

            setupInteraction({
                container: container as unknown as HTMLElement,
                renderer,
                viewportTransform: new ViewportTransform(),
                getState: () => state,
                onStateChanged: vi.fn(),
                onDrop: vi.fn(),
                onViewportChanged: vi.fn(),
                rotationFocus,
            });

            const pieceTarget = { _pieceId: 3 } as unknown as EventTarget;
            container.fire('pointerdown', fakePointerEvent({ target: pieceTarget, clientX: 100, clientY: 100 }));
            container.fire('pointerup', fakePointerEvent({ target: pieceTarget, clientX: 101, clientY: 100 }));

            expect(rotationFocus.focusedGroupId).toBe(7);
        });

        it('a piece tap also still toggles multi-select when the tool is active', () => {
            const container = createFakeContainer();
            const renderer = createFakeRenderer();
            const rotationFocus = new RotationFocus();
            const selectionManager = new SelectionManager();
            selectionManager.toolActive = true;
            const state = makeState([makeGroup(7, [3])]);

            setupInteraction({
                container: container as unknown as HTMLElement,
                renderer,
                viewportTransform: new ViewportTransform(),
                getState: () => state,
                onStateChanged: vi.fn(),
                onDrop: vi.fn(),
                onViewportChanged: vi.fn(),
                selectionManager,
                rotationFocus,
            });

            const pieceTarget = { _pieceId: 3 } as unknown as EventTarget;
            container.fire('pointerdown', fakePointerEvent({ target: pieceTarget, clientX: 100, clientY: 100 }));
            container.fire('pointerup', fakePointerEvent({ target: pieceTarget, clientX: 101, clientY: 100 }));

            expect(selectionManager.isSelected(7)).toBe(true);
            expect(rotationFocus.focusedGroupId).toBe(7);
        });

        it('a piece drag start clears focus', () => {
            const container = createFakeContainer();
            const renderer = createFakeRenderer();
            const rotationFocus = new RotationFocus();
            rotationFocus.setFocus(7);
            const state = makeState([makeGroup(7, [3])]);

            setupInteraction({
                container: container as unknown as HTMLElement,
                renderer,
                viewportTransform: new ViewportTransform(),
                getState: () => state,
                onStateChanged: vi.fn(),
                onDrop: vi.fn(),
                onViewportChanged: vi.fn(),
                rotationFocus,
            });

            const pieceTarget = { _pieceId: 3 };
            container.fire('pointerdown', fakePointerEvent({ target: pieceTarget as unknown as EventTarget, pointerId: 1, clientX: 100, clientY: 100 }));
            container.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 120, clientY: 100 }));

            expect(rotationFocus.focusedGroupId).toBeNull();
        });

        it('a background tap clears focus', () => {
            const container = createFakeContainer();
            const renderer = createFakeRenderer();
            const rotationFocus = new RotationFocus();
            rotationFocus.setFocus(7);
            const state = makeState([makeGroup(7, [3])]);

            setupInteraction({
                container: container as unknown as HTMLElement,
                renderer,
                viewportTransform: new ViewportTransform(),
                getState: () => state,
                onStateChanged: vi.fn(),
                onDrop: vi.fn(),
                onViewportChanged: vi.fn(),
                rotationFocus,
            });

            // Background-target pointerdown → small pointerup = background tap.
            // Cast the FakeContainer to EventTarget so the production
            // classifyTarget's `target === container` reference check matches.
            const bgTarget = container as unknown as EventTarget;
            container.fire('pointerdown', fakePointerEvent({ target: bgTarget, pointerId: 1, clientX: 100, clientY: 100 }));
            container.fire('pointerup', fakePointerEvent({ target: bgTarget, pointerId: 1, clientX: 101, clientY: 100 }));

            expect(rotationFocus.focusedGroupId).toBeNull();
        });

        it('a background pan start clears focus', () => {
            const container = createFakeContainer();
            const renderer = createFakeRenderer();
            const rotationFocus = new RotationFocus();
            rotationFocus.setFocus(7);
            const state = makeState([makeGroup(7, [3])]);

            setupInteraction({
                container: container as unknown as HTMLElement,
                renderer,
                viewportTransform: new ViewportTransform(),
                getState: () => state,
                onStateChanged: vi.fn(),
                onDrop: vi.fn(),
                onViewportChanged: vi.fn(),
                panViewport: vi.fn(),
                rotationFocus,
            });

            // Cast the FakeContainer to EventTarget so the production
            // classifyTarget's `target === container` reference check matches.
            const bgTarget = container as unknown as EventTarget;
            container.fire('pointerdown', fakePointerEvent({ target: bgTarget, pointerId: 1, clientX: 100, clientY: 100 }));
            container.fire('pointermove', fakePointerEvent({ target: bgTarget, pointerId: 1, clientX: 130, clientY: 100 })); // promote pan

            expect(rotationFocus.focusedGroupId).toBeNull();
        });

        it('a wheel zoom clears focus', () => {
            const container = createFakeContainer();
            const renderer = createFakeRenderer();
            const rotationFocus = new RotationFocus();
            rotationFocus.setFocus(7);
            const state = makeState([makeGroup(7, [3])]);

            setupInteraction({
                container: container as unknown as HTMLElement,
                renderer,
                viewportTransform: new ViewportTransform(),
                getState: () => state,
                onStateChanged: vi.fn(),
                onDrop: vi.fn(),
                onViewportChanged: vi.fn(),
                rotationFocus,
            });

            const pieceTarget = { _pieceId: 3 };
            const wheelEvt = {
                deltaY: -100,
                clientX: 50,
                clientY: 50,
                target: pieceTarget,
                preventDefault: vi.fn(),
            } as unknown as WheelEvent;

            container.fire('wheel', wheelEvt);

            expect(rotationFocus.focusedGroupId).toBeNull();
        });

        it('a pinch start clears focus', () => {
            const container = createFakeContainer();
            const renderer = createFakeRenderer();
            const rotationFocus = new RotationFocus();
            rotationFocus.setFocus(7);
            const state = makeState([makeGroup(7, [3])]);

            setupInteraction({
                container: container as unknown as HTMLElement,
                renderer,
                viewportTransform: new ViewportTransform(),
                getState: () => state,
                onStateChanged: vi.fn(),
                onDrop: vi.fn(),
                onViewportChanged: vi.fn(),
                rotationFocus,
            });

            const pieceTarget = { _pieceId: 3 };
            container.fire('pointerdown', fakePointerEvent({ target: pieceTarget as unknown as EventTarget, pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
            container.fire('pointerdown', fakePointerEvent({ target: pieceTarget as unknown as EventTarget, pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));

            expect(rotationFocus.focusedGroupId).toBeNull();
        });
    });

    describe('offset drag', () => {
        it('does NOT apply when dragging a multi-selection', () => {
            vi.mocked(loadOffsetDragPreference).mockReturnValue(true);
            const container = createFakeContainer();
            const renderer = createFakeRenderer();
            const selectionManager = new SelectionManager();
            selectionManager.toolActive = true;

            // Two single-piece groups, both selected. Dragging group 7 also
            // moves group 8, so more than one group moves and the offset
            // must not be applied.
            const group7 = makeGroup(7, [3], { x: 0, y: 0 });
            const group8 = makeGroup(8, [4], { x: 0, y: 0 });
            selectionManager.select(7);
            selectionManager.select(8);
            const state = makeState([group7, group8]);

            setupInteraction({
                container: container as unknown as HTMLElement,
                renderer,
                viewportTransform: new ViewportTransform(),
                getState: () => state,
                onStateChanged: vi.fn(),
                onDrop: vi.fn(),
                onViewportChanged: vi.fn(),
                selectionManager,
            });

            const pieceTarget = { _pieceId: 3 };
            container.fire('pointerdown', fakePointerEvent({ target: pieceTarget as unknown as EventTarget, pointerId: 1, clientX: 100, clientY: 100 }));
            container.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 120, clientY: 100 })); // promote

            expect(group7.position.y).toBe(0);
        });

        it('does NOT apply when dragging a multi-piece group within a multi-selection', () => {
            vi.mocked(loadOffsetDragPreference).mockReturnValue(true);
            const container = createFakeContainer();
            const renderer = createFakeRenderer();
            const selectionManager = new SelectionManager();
            selectionManager.toolActive = true;

            // The dragged group has two pieces, but the multi-selection still
            // moves two groups, so the offset must not be applied: the
            // exclusion depends on the group count, not the piece count.
            const group7 = makeGroup(7, [3, 4], { x: 0, y: 0 });
            const group8 = makeGroup(8, [5], { x: 0, y: 0 });
            selectionManager.select(7);
            selectionManager.select(8);
            const state = makeState([group7, group8]);

            setupInteraction({
                container: container as unknown as HTMLElement,
                renderer,
                viewportTransform: new ViewportTransform(),
                getState: () => state,
                onStateChanged: vi.fn(),
                onDrop: vi.fn(),
                onViewportChanged: vi.fn(),
                selectionManager,
            });

            const pieceTarget = { _pieceId: 3 };
            container.fire('pointerdown', fakePointerEvent({ target: pieceTarget as unknown as EventTarget, pointerId: 1, clientX: 100, clientY: 100 }));
            container.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 120, clientY: 100 })); // promote

            expect(group7.position.y).toBe(0);
        });

        it('still applies when the multi-select tool has only one group selected', () => {
            vi.mocked(loadOffsetDragPreference).mockReturnValue(true);
            const container = createFakeContainer();
            const renderer = createFakeRenderer();
            const selectionManager = new SelectionManager();
            selectionManager.toolActive = true;

            const group7 = makeGroup(7, [3], { x: 0, y: 0 });
            selectionManager.select(7);
            const state = makeState([group7]);

            setupInteraction({
                container: container as unknown as HTMLElement,
                renderer,
                viewportTransform: new ViewportTransform(),
                getState: () => state,
                onStateChanged: vi.fn(),
                onDrop: vi.fn(),
                onViewportChanged: vi.fn(),
                selectionManager,
            });

            const pieceTarget = { _pieceId: 3 };
            container.fire('pointerdown', fakePointerEvent({ target: pieceTarget as unknown as EventTarget, pointerId: 1, clientX: 100, clientY: 100 }));
            container.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 120, clientY: 100 })); // promote

            // OFFSET_DRAG_SCREEN_PX = 50, shifted upward (negative Y).
            expect(group7.position.y).toBe(-50);
        });

        it('applies when dragging a single multi-piece group', () => {
            vi.mocked(loadOffsetDragPreference).mockReturnValue(true);
            const container = createFakeContainer();
            const renderer = createFakeRenderer();

            // One group with two pieces, no multi-select involved. Exactly
            // one group moves, so the offset applies despite the piece count.
            const group7 = makeGroup(7, [3, 4], { x: 0, y: 0 });
            const state = makeState([group7]);

            setupInteraction({
                container: container as unknown as HTMLElement,
                renderer,
                viewportTransform: new ViewportTransform(),
                getState: () => state,
                onStateChanged: vi.fn(),
                onDrop: vi.fn(),
                onViewportChanged: vi.fn(),
            });

            const pieceTarget = { _pieceId: 3 };
            container.fire('pointerdown', fakePointerEvent({ target: pieceTarget as unknown as EventTarget, pointerId: 1, clientX: 100, clientY: 100 }));
            container.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 120, clientY: 100 })); // promote

            // OFFSET_DRAG_SCREEN_PX = 50, shifted upward (negative Y).
            expect(group7.position.y).toBe(-50);
        });
    });
});

describe('snap proximity rotation', () => {
    // The 'offset drag' tests above set loadOffsetDragPreference to true and
    // never reset it, so it leaks into later tests in this file. Reset it
    // here so a piece-drag start doesn't apply a stray offset that would
    // throw off the snap-distance measurements below.
    beforeEach(() => {
        vi.mocked(loadOffsetDragPreference).mockReturnValue(false);
    });

    /**
     * Free-rotation state: piece 0 (group 7) at the origin, piece 1
     * (group 8) rotated 18° with its bbox center 20px right of its
     * aligned center (150, 50).
     */
    function makeFreeRotationState(rotationMode: GameState['rotationMode'] = 'free'): GameState {
        const { piece0, piece1 } = makeMatedPiecePair();
        const group7 = makeCenteredGroup(7, 0, { x: 50, y: 50 });
        const group8 = makeCenteredGroup(8, 1, { x: 170, y: 50 }, 18);
        return makeGameState({ pieces: [piece0, piece1], groups: [group7, group8], rotationMode });
    }

    const getSnapTolerances = () => ({ tolerancePx: 40, rotationToleranceDeg: 20 });

    function dragPieceOne(container: FakeContainer, toX: number): void {
        const pieceTarget = { _pieceId: 1 } as unknown as EventTarget;
        container.fire('pointerdown', fakePointerEvent({ target: pieceTarget, pointerId: 1, clientX: 300, clientY: 300 }));
        container.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 320, clientY: 300 })); // promote
        container.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: toX, clientY: 300 })); // real move
    }

    it('rotates the dragged group toward a nearby mate during a free-rotation drag', () => {
        const container = createFakeContainer();
        const state = makeFreeRotationState();

        setupInteraction({
            container: container as unknown as HTMLElement,
            renderer: createFakeRenderer(),
            viewportTransform: new ViewportTransform(),
            getState: () => state,
            onStateChanged: vi.fn(),
            onDrop: vi.fn(),
            onViewportChanged: vi.fn(),
            getSnapTolerances,
        });

        // Move 10px left: center 170 → 160, d = 10 → cap = 5; 18° → 5°.
        dragPieceOne(container, 310);

        expect(state.groupsById.get(8)!.rotation).toBeCloseTo(5);
    });

    it('does not rotate when rotation mode is not free', () => {
        const container = createFakeContainer();
        const state = makeFreeRotationState('quarter-turn');

        setupInteraction({
            container: container as unknown as HTMLElement,
            renderer: createFakeRenderer(),
            viewportTransform: new ViewportTransform(),
            getState: () => state,
            onStateChanged: vi.fn(),
            onDrop: vi.fn(),
            onViewportChanged: vi.fn(),
            getSnapTolerances,
        });

        dragPieceOne(container, 310);

        expect(state.groupsById.get(8)!.rotation).toBeCloseTo(18);
    });

    it('does not rotate during a multi-selection drag', () => {
        const container = createFakeContainer();
        const state = makeFreeRotationState();
        const selectionManager = new SelectionManager();
        selectionManager.toolActive = true;
        selectionManager.select(7);
        selectionManager.select(8);

        setupInteraction({
            container: container as unknown as HTMLElement,
            renderer: createFakeRenderer(),
            viewportTransform: new ViewportTransform(),
            getState: () => state,
            onStateChanged: vi.fn(),
            onDrop: vi.fn(),
            onViewportChanged: vi.fn(),
            selectionManager,
            getSnapTolerances,
        });

        dragPieceOne(container, 310);

        expect(state.groupsById.get(8)!.rotation).toBeCloseTo(18);
    });
});

describe('setupInteraction — marquee routing', () => {
    function dragBackground(
        container: ReturnType<typeof createFakeContainer>,
        opts: { shiftKey?: boolean } = {},
    ): void {
        // Background pointerdown, then a move past the 8px tap threshold to
        // promote the background-candidate into a drag (pan or marquee), then up.
        const target = container as unknown as EventTarget;
        container.fire('pointerdown', fakePointerEvent({
            pointerId: 1, clientX: 0, clientY: 0, target, ...opts,
        }));
        container.fire('pointermove', fakePointerEvent({
            pointerId: 1, clientX: 40, clientY: 40, target, ...opts,
        }));
        container.fire('pointerup', fakePointerEvent({
            pointerId: 1, clientX: 40, clientY: 40, target, ...opts,
        }));
    }

    function setup(container: ReturnType<typeof createFakeContainer>, selectionManager: SelectionManager) {
        setupInteraction({
            container: container as unknown as HTMLElement,
            renderer: createFakeRenderer(),
            viewportTransform: new ViewportTransform(),
            getState: () => makeGameState(),
            onStateChanged: vi.fn(),
            onDrop: vi.fn(),
            onViewportChanged: vi.fn(),
            selectionManager,
        });
    }

    it('draws a marquee (appends an overlay) when the marquee is active', () => {
        const container = createFakeContainer();
        const selectionManager = new SelectionManager();
        selectionManager.toggleMarquee(); // arms marquee (and the tool)
        setup(container, selectionManager);

        dragBackground(container);

        expect(container.appendChild).toHaveBeenCalled();
    });

    it('pans (no overlay) when multi-select is on but the marquee is off', () => {
        const container = createFakeContainer();
        const selectionManager = new SelectionManager();
        selectionManager.toolActive = true; // tool on, marquee off
        setup(container, selectionManager);

        dragBackground(container);

        expect(container.appendChild).not.toHaveBeenCalled();
    });

    it('pans (no overlay) when both are off and no Shift', () => {
        const container = createFakeContainer();
        const selectionManager = new SelectionManager();
        setup(container, selectionManager);

        dragBackground(container);

        expect(container.appendChild).not.toHaveBeenCalled();
    });

    it('Shift+drag draws a marquee and enables multi-select without arming the marquee', () => {
        const container = createFakeContainer();
        const selectionManager = new SelectionManager();
        setup(container, selectionManager);

        dragBackground(container, { shiftKey: true });

        expect(selectionManager.toolActive).toBe(true);
        expect(selectionManager.marqueeActive).toBe(false);
        expect(container.appendChild).toHaveBeenCalled();
    });
});
