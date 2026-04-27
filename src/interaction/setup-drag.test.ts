/**
 * @vitest-environment jsdom
 */

/**
 * Tests for setupDragHandling — the orchestration layer that wires
 * the DragController to a Renderer, the SelectionManager, the
 * AutoPanController, and the DOM container.
 *
 * Uses a fake container (capturing addEventListener handlers) and a
 * fake renderer (capturing the piece pointerdown callback). Pointer
 * events are plain objects shaped like PointerEvent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupDragHandling } from './setup-drag.js';
import { SelectionManager } from './selection-manager.js';
import { AutoPanController } from './auto-pan.js';
import type { Renderer, PiecePointerDownCallback } from '../renderer/types.js';
import type { GameState, PieceGroup } from '../model/types.js';

vi.mock('../ui/offset-drag.js', () => ({
    loadOffsetDragPreference: vi.fn(() => false),
}));

import { loadOffsetDragPreference } from '../ui/offset-drag.js';

// rAF stub — AutoPanController.updatePointer triggers it but we never
// drive the animation loop in these tests.
beforeEach(() => {
    globalThis.requestAnimationFrame = vi.fn(() => 1);
    globalThis.cancelAnimationFrame = vi.fn();
    vi.mocked(loadOffsetDragPreference).mockReturnValue(false);
});

interface FakeContainer {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    setPointerCapture: ReturnType<typeof vi.fn>;
    hasPointerCapture: ReturnType<typeof vi.fn>;
    releasePointerCapture: ReturnType<typeof vi.fn>;
    fire(type: string, event: PointerEvent): void;
}

function createFakeContainer(): FakeContainer {
    const listeners: Record<string, Array<(e: PointerEvent) => void>> = {};
    const captured = new Set<number>();

    return {
        addEventListener: vi.fn((type: string, cb: (e: PointerEvent) => void) => {
            (listeners[type] ??= []).push(cb);
        }),
        removeEventListener: vi.fn((type: string, cb: (e: PointerEvent) => void) => {
            const arr = listeners[type] ?? [];
            const idx = arr.indexOf(cb);
            if (idx >= 0) arr.splice(idx, 1);
        }),
        setPointerCapture: vi.fn((id: number) => {
            captured.add(id);
        }),
        hasPointerCapture: vi.fn((id: number) => captured.has(id)),
        releasePointerCapture: vi.fn((id: number) => {
            captured.delete(id);
        }),
        fire(type, event) {
            for (const cb of listeners[type] ?? []) cb(event);
        },
    };
}

interface FakeRenderer extends Renderer {
    triggerPiecePointerDown(pieceId: number, event: PointerEvent): void;
}

function createFakeRenderer(): FakeRenderer {
    let cb: PiecePointerDownCallback | null = null;

    return {
        init: vi.fn(),
        renderState: vi.fn(),
        onPiecePointerDown: vi.fn((handler: PiecePointerDownCallback) => {
            cb = handler;
        }),
        bringGroupToFront: vi.fn(),
        setViewportTransform: vi.fn(),
        getTableElement: vi.fn(() => null),
        setGroupDragging: vi.fn(),
        flashMergePulse: vi.fn(),
        setGroupSelected: vi.fn(),
        destroy: vi.fn(),
        triggerPiecePointerDown(pieceId, event) {
            cb?.(pieceId, event);
        },
    };
}

function fakePointerEvent(
    overrides: Partial<{ clientX: number; clientY: number; pointerId: number }> = {},
): PointerEvent {
    return {
        clientX: overrides.clientX ?? 0,
        clientY: overrides.clientY ?? 0,
        pointerId: overrides.pointerId ?? 1,
    } as PointerEvent;
}

function makeGroup(
    id: number,
    pieceIds: number[],
    position = { x: 0, y: 0 },
): PieceGroup {
    const pieces = new Map<number, { x: number; y: number }>();
    for (const pid of pieceIds) pieces.set(pid, { x: 0, y: 0 });
    return { id, pieces, position, rotation: 0 };
}

interface Harness {
    container: FakeContainer;
    renderer: FakeRenderer;
    state: GameState;
    selectionManager: SelectionManager;
    onStateChanged: ReturnType<typeof vi.fn>;
    onDrop: ReturnType<typeof vi.fn>;
    panViewport: ReturnType<typeof vi.fn>;
    cleanup: () => void;
}

function setup(opts: {
    groups?: PieceGroup[];
    selectionManager?: SelectionManager;
    panViewport?: boolean;
} = {}): Harness {
    const groups = opts.groups ?? [
        makeGroup(1, [10, 11], { x: 100, y: 100 }),
        makeGroup(2, [20], { x: 200, y: 200 }),
        makeGroup(3, [30], { x: 300, y: 300 }),
    ];
    const state: GameState = {
        pieces: [],
        groups,
        // The orchestrator only reads `groups`; other fields aren't touched.
    } as unknown as GameState;
    const container = createFakeContainer();
    const renderer = createFakeRenderer();
    const selectionManager = opts.selectionManager ?? new SelectionManager();
    const onStateChanged = vi.fn();
    const onDrop = vi.fn();
    const panViewport = vi.fn();

    const cleanup = setupDragHandling({
        container: container as unknown as HTMLElement,
        renderer,
        getState: () => state,
        onStateChanged,
        onDrop,
        panViewport: opts.panViewport === false ? undefined : panViewport,
        selectionManager,
    });

    return {
        container,
        renderer,
        state,
        selectionManager,
        onStateChanged,
        onDrop,
        panViewport,
        cleanup,
    };
}

describe('setupDragHandling — scaffolding', () => {
    it('registers pointermove, pointerup, pointercancel listeners on the container', () => {
        const h = setup();
        expect(h.container.addEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
        expect(h.container.addEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
        expect(h.container.addEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    });

    it('cleanup removes the listeners it registered', () => {
        const h = setup();
        h.cleanup();
        expect(h.container.removeEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
        expect(h.container.removeEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
        expect(h.container.removeEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    });
});

describe('setupDragHandling — tap vs drag (multi-select tool active)', () => {
    it('a tap (no movement) toggles selection of the tapped group', () => {
        const h = setup();
        h.selectionManager.toolActive = true;

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 100, clientY: 100, pointerId: 7 }),
        );
        h.container.fire('pointerup', fakePointerEvent({ clientX: 100, clientY: 100, pointerId: 7 }));

        expect(h.selectionManager.isSelected(1)).toBe(true);
        expect(h.renderer.setGroupSelected).toHaveBeenCalledWith(1, true);
    });

    it('a tap restores the group to its starting position (cancels micro-drag)', () => {
        const h = setup();
        h.selectionManager.toolActive = true;
        const startPos = { ...h.state.groups[0].position };

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 100, clientY: 100, pointerId: 1 }),
        );
        // Tiny movement, well under TAP_THRESHOLD_PX = 8
        h.container.fire('pointermove', fakePointerEvent({ clientX: 103, clientY: 102, pointerId: 1 }));
        h.container.fire('pointerup', fakePointerEvent({ clientX: 103, clientY: 102, pointerId: 1 }));

        expect(h.state.groups[0].position).toEqual(startPos);
    });

    it('a tap clears the dragging visual state on every group', () => {
        const h = setup();
        h.selectionManager.toolActive = true;

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 50, clientY: 50, pointerId: 1 }),
        );
        h.container.fire('pointerup', fakePointerEvent({ clientX: 50, clientY: 50, pointerId: 1 }));

        // Every group is marked not-dragging on tap (group ids 1, 2, 3)
        for (const group of h.state.groups) {
            expect(h.renderer.setGroupDragging).toHaveBeenCalledWith(group.id, false);
        }
    });

    it('movement exceeding TAP_THRESHOLD_PX is treated as a drag, not a tap', () => {
        const h = setup();
        h.selectionManager.toolActive = true;

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 100, clientY: 100, pointerId: 1 }),
        );
        // Move 20px right — well past the 8px threshold
        h.container.fire('pointermove', fakePointerEvent({ clientX: 120, clientY: 100, pointerId: 1 }));
        h.container.fire('pointerup', fakePointerEvent({ clientX: 120, clientY: 100, pointerId: 1 }));

        // No selection toggle on real drags
        expect(h.selectionManager.isSelected(1)).toBe(false);
        expect(h.renderer.setGroupSelected).not.toHaveBeenCalled();
        // Group actually moved by the drag delta
        expect(h.state.groups[0].position).toEqual({ x: 120, y: 100 });
    });

    it('movement at exactly the threshold (8px diagonal) still counts as a tap', () => {
        const h = setup();
        h.selectionManager.toolActive = true;

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 100, clientY: 100, pointerId: 1 }),
        );
        // 5px right + 5px down → distance² = 50, threshold² = 64 → still a tap
        h.container.fire('pointermove', fakePointerEvent({ clientX: 105, clientY: 105, pointerId: 1 }));
        h.container.fire('pointerup', fakePointerEvent({ clientX: 105, clientY: 105, pointerId: 1 }));

        expect(h.selectionManager.isSelected(1)).toBe(true);
    });

    it('does not treat pointerup as a tap when the multi-select tool is inactive', () => {
        const h = setup();
        // toolActive defaults to false

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 100, clientY: 100, pointerId: 1 }),
        );
        h.container.fire('pointerup', fakePointerEvent({ clientX: 100, clientY: 100, pointerId: 1 }));

        expect(h.selectionManager.isSelected(1)).toBe(false);
        expect(h.renderer.setGroupSelected).not.toHaveBeenCalled();
    });
});

describe('setupDragHandling — multi-select group movement', () => {
    function setupWithSelection(): Harness {
        const h = setup();
        h.selectionManager.toolActive = true;
        h.selectionManager.select(1);
        h.selectionManager.select(2);
        return h;
    }

    it('dragging a selected piece moves all selected groups by the same delta', () => {
        const h = setupWithSelection();
        const start1 = { ...h.state.groups[0].position };
        const start2 = { ...h.state.groups[1].position };
        // Group 3 is unselected; should not move
        const start3 = { ...h.state.groups[2].position };

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 500, clientY: 500, pointerId: 1 }),
        );
        h.container.fire('pointermove', fakePointerEvent({ clientX: 540, clientY: 530, pointerId: 1 }));
        h.container.fire('pointerup', fakePointerEvent({ clientX: 540, clientY: 530, pointerId: 1 }));

        expect(h.state.groups[0].position).toEqual({ x: start1.x + 40, y: start1.y + 30 });
        expect(h.state.groups[1].position).toEqual({ x: start2.x + 40, y: start2.y + 30 });
        expect(h.state.groups[2].position).toEqual(start3);
    });

    it('bringToFront and setGroupDragging(true) are applied to every selected group on drag start', () => {
        const h = setupWithSelection();

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 500, clientY: 500, pointerId: 1 }),
        );

        expect(h.renderer.bringGroupToFront).toHaveBeenCalledWith(1);
        expect(h.renderer.bringGroupToFront).toHaveBeenCalledWith(2);
        expect(h.renderer.setGroupDragging).toHaveBeenCalledWith(1, true);
        expect(h.renderer.setGroupDragging).toHaveBeenCalledWith(2, true);
    });

    it('on drop, onDrop fires only for the dragged group', () => {
        const h = setupWithSelection();

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 500, clientY: 500, pointerId: 1 }),
        );
        h.container.fire('pointermove', fakePointerEvent({ clientX: 600, clientY: 600, pointerId: 1 }));
        h.container.fire('pointerup', fakePointerEvent({ clientX: 600, clientY: 600, pointerId: 1 }));

        expect(h.onDrop).toHaveBeenCalledTimes(1);
        expect(h.onDrop).toHaveBeenCalledWith(1);
    });

    it('on drop, setGroupDragging(false) is cleared on every selected group', () => {
        const h = setupWithSelection();

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 500, clientY: 500, pointerId: 1 }),
        );
        h.container.fire('pointermove', fakePointerEvent({ clientX: 600, clientY: 600, pointerId: 1 }));
        h.container.fire('pointerup', fakePointerEvent({ clientX: 600, clientY: 600, pointerId: 1 }));

        expect(h.renderer.setGroupDragging).toHaveBeenCalledWith(1, false);
        expect(h.renderer.setGroupDragging).toHaveBeenCalledWith(2, false);
    });

    it('dragging a non-selected group does not move other selected groups', () => {
        const h = setup();
        h.selectionManager.toolActive = true;
        h.selectionManager.select(2);
        const start1 = { ...h.state.groups[0].position };
        const start2 = { ...h.state.groups[1].position };

        // Drag piece 30 (group 3, not selected)
        h.renderer.triggerPiecePointerDown(
            30,
            fakePointerEvent({ clientX: 500, clientY: 500, pointerId: 1 }),
        );
        h.container.fire('pointermove', fakePointerEvent({ clientX: 550, clientY: 500, pointerId: 1 }));

        // Selected group 2 should be untouched
        expect(h.state.groups[1].position).toEqual(start2);
        // Group 1 (also unselected) untouched
        expect(h.state.groups[0].position).toEqual(start1);
    });

    it('with no multi-select, dragging only moves the dragged group', () => {
        const h = setup();
        // toolActive off — selection contents are ignored

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 500, clientY: 500, pointerId: 1 }),
        );
        h.container.fire('pointermove', fakePointerEvent({ clientX: 510, clientY: 500, pointerId: 1 }));

        expect(h.state.groups[0].position).toEqual({ x: 110, y: 100 });
        expect(h.state.groups[1].position).toEqual({ x: 200, y: 200 });
    });
});

describe('setupDragHandling — offset drag', () => {
    it('shifts a single-piece group up by 50px when the preference is enabled', () => {
        vi.mocked(loadOffsetDragPreference).mockReturnValue(true);
        const h = setup();
        const startY = h.state.groups[1].position.y; // group 2 has piece 20 only

        h.renderer.triggerPiecePointerDown(
            20,
            fakePointerEvent({ clientX: 500, clientY: 500, pointerId: 1 }),
        );

        expect(h.state.groups[1].position.y).toBe(startY - 50);
        expect(h.state.groups[1].position.x).toBe(200);
    });

    it('does not shift when the preference is disabled', () => {
        vi.mocked(loadOffsetDragPreference).mockReturnValue(false);
        const h = setup();
        const start = { ...h.state.groups[1].position };

        h.renderer.triggerPiecePointerDown(
            20,
            fakePointerEvent({ clientX: 500, clientY: 500, pointerId: 1 }),
        );

        expect(h.state.groups[1].position).toEqual(start);
    });

    it('does not shift a multi-piece group even when the preference is enabled', () => {
        vi.mocked(loadOffsetDragPreference).mockReturnValue(true);
        const h = setup();
        const start = { ...h.state.groups[0].position }; // group 1 has pieces 10 and 11

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 500, clientY: 500, pointerId: 1 }),
        );

        expect(h.state.groups[0].position).toEqual(start);
    });

    it('converts the screen-space offset through screenDeltaToWorld when zoomed', () => {
        vi.mocked(loadOffsetDragPreference).mockReturnValue(true);
        const groups = [makeGroup(2, [20], { x: 0, y: 0 })];
        const state = { groups } as unknown as GameState;
        const container = createFakeContainer();
        const renderer = createFakeRenderer();

        // Simulate 2× zoom: 50 screen px = 25 world px
        setupDragHandling({
            container: container as unknown as HTMLElement,
            renderer,
            getState: () => state,
            onStateChanged: vi.fn(),
            onDrop: vi.fn(),
            screenDeltaToWorld: (d) => ({ x: d.x / 2, y: d.y / 2 }),
        });

        renderer.triggerPiecePointerDown(
            20,
            fakePointerEvent({ clientX: 500, clientY: 500, pointerId: 1 }),
        );

        expect(state.groups[0].position).toEqual({ x: 0, y: -25 });
    });
});

describe('setupDragHandling — auto-pan integration', () => {
    let startSpy: ReturnType<typeof vi.spyOn>;
    let stopSpy: ReturnType<typeof vi.spyOn>;
    let updatePointerSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        startSpy = vi.spyOn(AutoPanController.prototype, 'start');
        stopSpy = vi.spyOn(AutoPanController.prototype, 'stop');
        updatePointerSpy = vi.spyOn(AutoPanController.prototype, 'updatePointer');
        startSpy.mockClear();
        stopSpy.mockClear();
        updatePointerSpy.mockClear();
    });

    it('calls AutoPanController.start with the dragged group id on pointerdown', () => {
        const h = setup();

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 100, clientY: 100, pointerId: 1 }),
        );

        expect(startSpy).toHaveBeenCalledWith(1);
    });

    it('calls AutoPanController.updatePointer on each pointermove during a drag', () => {
        const h = setup();

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 100, clientY: 100, pointerId: 1 }),
        );
        // updatePointer is called once on pointerdown
        const baseline = updatePointerSpy.mock.calls.length;

        h.container.fire('pointermove', fakePointerEvent({ clientX: 120, clientY: 120, pointerId: 1 }));
        h.container.fire('pointermove', fakePointerEvent({ clientX: 140, clientY: 140, pointerId: 1 }));

        expect(updatePointerSpy.mock.calls.length).toBe(baseline + 2);
        expect(updatePointerSpy).toHaveBeenLastCalledWith({ x: 140, y: 140 });
    });

    it('calls AutoPanController.stop when the drag ends with pointerup', () => {
        const h = setup();

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 500, clientY: 500, pointerId: 1 }),
        );
        h.container.fire('pointermove', fakePointerEvent({ clientX: 600, clientY: 600, pointerId: 1 }));
        stopSpy.mockClear();

        h.container.fire('pointerup', fakePointerEvent({ clientX: 600, clientY: 600, pointerId: 1 }));

        expect(stopSpy).toHaveBeenCalled();
    });

    it('calls AutoPanController.stop when the drag is cancelled by a second pointer (pinch)', () => {
        const h = setup();

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 500, clientY: 500, pointerId: 1 }),
        );
        // Second pointer arriving on the container cancels the drag
        h.container.fire('pointermove', fakePointerEvent({ clientX: 600, clientY: 600, pointerId: 2 }));

        // The next pointermove from pointer 1 will see drag cancelled
        // (because activePointers.size > 1 triggers cancelDrag in the controller).
        // setup-drag.ts catches that and stops auto-pan.
        stopSpy.mockClear();
        h.container.fire('pointermove', fakePointerEvent({ clientX: 700, clientY: 700, pointerId: 1 }));

        expect(stopSpy).toHaveBeenCalled();
    });

    it('does not create an AutoPanController when panViewport is omitted', () => {
        const h = setup({ panViewport: false });

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 100, clientY: 100, pointerId: 1 }),
        );
        h.container.fire('pointermove', fakePointerEvent({ clientX: 120, clientY: 120, pointerId: 1 }));
        h.container.fire('pointerup', fakePointerEvent({ clientX: 120, clientY: 120, pointerId: 1 }));

        expect(startSpy).not.toHaveBeenCalled();
        expect(updatePointerSpy).not.toHaveBeenCalled();
        expect(stopSpy).not.toHaveBeenCalled();
    });

    it('cleanup stops the auto-pan controller', () => {
        const h = setup();
        stopSpy.mockClear();

        h.cleanup();

        expect(stopSpy).toHaveBeenCalled();
    });
});

describe('setupDragHandling — pointer capture', () => {
    it('captures the pointer on the container at drag start', () => {
        const h = setup();

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 100, clientY: 100, pointerId: 42 }),
        );

        expect(h.container.setPointerCapture).toHaveBeenCalledWith(42);
    });

    it('releases the pointer capture on pointerup if it was captured', () => {
        const h = setup();

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 100, clientY: 100, pointerId: 42 }),
        );
        h.container.fire('pointermove', fakePointerEvent({ clientX: 120, clientY: 100, pointerId: 42 }));
        h.container.fire('pointerup', fakePointerEvent({ clientX: 120, clientY: 100, pointerId: 42 }));

        expect(h.container.releasePointerCapture).toHaveBeenCalledWith(42);
    });

    it('releases the pointer capture even on a tap (no-drag) path', () => {
        const h = setup();
        h.selectionManager.toolActive = true;

        h.renderer.triggerPiecePointerDown(
            10,
            fakePointerEvent({ clientX: 100, clientY: 100, pointerId: 42 }),
        );
        h.container.fire('pointerup', fakePointerEvent({ clientX: 100, clientY: 100, pointerId: 42 }));

        expect(h.container.releasePointerCapture).toHaveBeenCalledWith(42);
    });

    it('does not call releasePointerCapture if pointer was never captured', () => {
        const h = setup();

        // Pointerup without preceding pointerdown — no capture to release
        h.container.fire('pointerup', fakePointerEvent({ pointerId: 99 }));

        expect(h.container.releasePointerCapture).not.toHaveBeenCalled();
    });
});
