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
import type { Renderer } from '../renderer/types.js';
import type { GameState, PieceGroup } from '../model/types.js';

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
        getTableElement: vi.fn(() => null),
        setGroupDragging: vi.fn(),
        flashMergePulse: vi.fn(),
        setGroupSelected: vi.fn(),
        pieceIdFromTarget: vi.fn((t: EventTarget | null) =>
            (t as { _pieceId?: number } | null)?._pieceId ?? null),
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
    }> = {},
): PointerEvent {
    return {
        clientX: overrides.clientX ?? 0,
        clientY: overrides.clientY ?? 0,
        pointerId: overrides.pointerId ?? 1,
        pointerType: overrides.pointerType ?? 'mouse',
        target: overrides.target ?? null,
        preventDefault: vi.fn(),
    } as unknown as PointerEvent;
}

function makeGroup(id: number, pieceIds: number[], position = { x: 0, y: 0 }): PieceGroup {
    const pieces = new Map<number, { x: number; y: number }>();
    for (const pid of pieceIds) pieces.set(pid, { x: 0, y: 0 });
    return { id, pieces, position, rotation: 0 };
}

function makeState(groups: PieceGroup[]): GameState {
    return { groups } as unknown as GameState;
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
});
