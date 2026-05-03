# Piece-Anchored Rotation Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple piece rotation from the multi-select tool. Tapping a piece raises a transient pair of CCW/CW rotate buttons next to that piece's group; the buttons fade in fast, sit for repeated use, and fade out softly after a 5-second idle window or instantly on any non-rotate action.

**Architecture:** A new tiny `RotationFocus` model in `src/interaction/` tracks one short-lived `focusedGroupId`. `PointerRouter` gains an `onBackgroundTap` callback. `setupInteraction` calls `rotationFocus.setFocus(group.id)` on every piece tap and `clearFocus()` on every other gesture (drag start, background tap, pan start, pinch start, wheel zoom). `rotate-buttons.ts` is rewritten to subscribe to focus changes, render a screen-positioned pair flanking the focused group's bounding box (clamped to viewport), own a 5-second idle timer, and distinguish a quick "user-dismiss" fade-out (~100 ms, pointer-events off) from a slow "idle-timeout" fade-out (~750 ms, pointer-events stay on so a click rescues the pair).

**Tech Stack:** TypeScript, Vitest + jsdom, Vite. Pure DOM (no framework). Project has no linter beyond `tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-05-03-rotation-focus-buttons-design.md`

---

## File Structure

**Create:**
- `src/interaction/rotation-focus.ts` — `RotationFocus` class
- `src/interaction/rotation-focus.test.ts` — its tests

**Modify:**
- `src/interaction/pointer-router.ts` + `src/interaction/pointer-router.test.ts` — add optional `onBackgroundTap` callback
- `src/interaction/setup-interaction.ts` + `src/interaction/setup-interaction.test.ts` — wire focus to all gestures; pass `onBackgroundTap` through to `PointerRouter`
- `src/interaction/index.ts` — export `RotationFocus`
- `src/ui/rotate-buttons.ts` — full rewrite (piece-anchored, fade-driven)
- `src/ui/rotate-buttons.test.ts` — full rewrite to match new API
- `src/main.ts` — remove auto-enable line, construct `RotationFocus`, wire it through, change `onRotate` to use `focusedGroupId`, provide screen-bounds helper, clear focus on `initGame()`
- `src/ui/info-modal.ts` — update Cut Styles → Fractal copy and How to Play → Rotate copy
- `src/style.css` — replace fixed bottom-left positioning of `.rotate-button` with absolute screen-positioning + fade transition classes

---

## Verification commands (run in repo root)

- Type check: `npx tsc --noEmit`
- All tests: `npm test`
- Single test file: `npx vitest run path/to/file.test.ts`
- Single test by name: `npx vitest run path/to/file.test.ts -t "test name fragment"`

A task is "green" when both type-check and the affected test files pass.

---

## Task 1: Add `RotationFocus` model

**Files:**
- Create: `src/interaction/rotation-focus.ts`
- Create: `src/interaction/rotation-focus.test.ts`
- Modify: `src/interaction/index.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/interaction/rotation-focus.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { RotationFocus } from './rotation-focus.js';

describe('RotationFocus', () => {
    it('starts with no focused group', () => {
        const focus = new RotationFocus();
        expect(focus.focusedGroupId).toBeNull();
    });

    it('setFocus sets the focused group id', () => {
        const focus = new RotationFocus();
        focus.setFocus(7);
        expect(focus.focusedGroupId).toBe(7);
    });

    it('clearFocus resets the focused group to null', () => {
        const focus = new RotationFocus();
        focus.setFocus(7);
        focus.clearFocus();
        expect(focus.focusedGroupId).toBeNull();
    });

    it('onChange fires when focus is set from null', () => {
        const focus = new RotationFocus();
        const cb = vi.fn();
        focus.onChange(cb);
        focus.setFocus(7);
        expect(cb).toHaveBeenCalledExactlyOnceWith(7);
    });

    it('onChange fires when focus moves to a different id', () => {
        const focus = new RotationFocus();
        focus.setFocus(7);
        const cb = vi.fn();
        focus.onChange(cb);
        focus.setFocus(8);
        expect(cb).toHaveBeenCalledExactlyOnceWith(8);
    });

    it('onChange fires when focus is cleared from a set value', () => {
        const focus = new RotationFocus();
        focus.setFocus(7);
        const cb = vi.fn();
        focus.onChange(cb);
        focus.clearFocus();
        expect(cb).toHaveBeenCalledExactlyOnceWith(null);
    });

    it('onChange does NOT fire when setting to the same id', () => {
        const focus = new RotationFocus();
        focus.setFocus(7);
        const cb = vi.fn();
        focus.onChange(cb);
        focus.setFocus(7);
        expect(cb).not.toHaveBeenCalled();
    });

    it('onChange does NOT fire when clearing while already null', () => {
        const focus = new RotationFocus();
        const cb = vi.fn();
        focus.onChange(cb);
        focus.clearFocus();
        expect(cb).not.toHaveBeenCalled();
    });

    it('onChange returns an unsubscribe function', () => {
        const focus = new RotationFocus();
        const cb = vi.fn();
        const unsubscribe = focus.onChange(cb);
        unsubscribe();
        focus.setFocus(7);
        expect(cb).not.toHaveBeenCalled();
    });

    it('multiple subscribers all receive notifications', () => {
        const focus = new RotationFocus();
        const a = vi.fn();
        const b = vi.fn();
        focus.onChange(a);
        focus.onChange(b);
        focus.setFocus(7);
        expect(a).toHaveBeenCalledExactlyOnceWith(7);
        expect(b).toHaveBeenCalledExactlyOnceWith(7);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
npx vitest run src/interaction/rotation-focus.test.ts
```

Expected: failure ("Cannot find module './rotation-focus.js'").

- [ ] **Step 3: Implement `RotationFocus`**

Create `src/interaction/rotation-focus.ts`:

```ts
/**
 * Rotation focus — tracks the single piece-group most recently tapped
 * by the user, used to anchor the floating rotate buttons. Independent
 * of SelectionManager: focus is short-lived and cleared by virtually
 * any non-rotate interaction.
 */

export type RotationFocusChangeCallback = (focusedGroupId: number | null) => void;

export class RotationFocus {
    private _focusedGroupId: number | null = null;
    private listeners: RotationFocusChangeCallback[] = [];

    get focusedGroupId(): number | null {
        return this._focusedGroupId;
    }

    setFocus(groupId: number): void {
        if (this._focusedGroupId === groupId) return;
        this._focusedGroupId = groupId;
        this.notify();
    }

    clearFocus(): void {
        if (this._focusedGroupId === null) return;
        this._focusedGroupId = null;
        this.notify();
    }

    onChange(callback: RotationFocusChangeCallback): () => void {
        this.listeners.push(callback);
        return () => {
            const idx = this.listeners.indexOf(callback);
            if (idx >= 0) this.listeners.splice(idx, 1);
        };
    }

    private notify(): void {
        const value = this._focusedGroupId;
        for (const listener of this.listeners) {
            listener(value);
        }
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
npx vitest run src/interaction/rotation-focus.test.ts
```

Expected: all 10 tests pass.

- [ ] **Step 5: Re-export from `src/interaction/index.ts`**

Add to `src/interaction/index.ts` (after the `SelectionManager` exports around line 4):

```ts
export { RotationFocus } from './rotation-focus.js';
export type { RotationFocusChangeCallback } from './rotation-focus.js';
```

- [ ] **Step 6: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```
git add src/interaction/rotation-focus.ts src/interaction/rotation-focus.test.ts src/interaction/index.ts
git commit -m "feat(interaction): add RotationFocus model"
```

---

## Task 2: Add `onBackgroundTap` callback to `PointerRouter`

**Files:**
- Modify: `src/interaction/pointer-router.ts`
- Modify: `src/interaction/pointer-router.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `src/interaction/pointer-router.test.ts`. Find the `describe('PointerRouter — background pan', () => { ... })` block and append a new `describe` block immediately after it (before `describe('PointerRouter — pinch (from idle)', ...)`):

```ts
describe('PointerRouter — background tap', () => {
    function background(): ClassifyTarget { return () => ({ kind: 'background' }); }

    it('fires onBackgroundTap when a background pointerdown→up stays under the threshold', () => {
        const h = createHarness({ classifyTarget: background() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        const upEvt = fakePointerEvent({ pointerId: 1, clientX: 2, clientY: 1 });
        h.fire('pointerup', upEvt);

        expect(h.callbacks.onBackgroundTap).toHaveBeenCalledExactlyOnceWith(upEvt);
    });

    it('does NOT fire onBackgroundTap if movement crossed the threshold (becomes pan)', () => {
        const h = createHarness({ classifyTarget: background() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 20, clientY: 0 }));
        h.fire('pointerup', fakePointerEvent({ pointerId: 1, clientX: 25, clientY: 0 }));

        expect(h.callbacks.onBackgroundTap).not.toHaveBeenCalled();
    });

    it('does NOT fire onBackgroundTap on pointercancel', () => {
        const h = createHarness({ classifyTarget: background() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointercancel', fakePointerEvent({ pointerId: 1 }));

        expect(h.callbacks.onBackgroundTap).not.toHaveBeenCalled();
    });

    it('does NOT fire onBackgroundTap on a piece tap', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 1 }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointerup', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));

        expect(h.callbacks.onBackgroundTap).not.toHaveBeenCalled();
    });

    it('callback is optional (no error when not provided)', () => {
        // Construct a router without onBackgroundTap by going through the
        // PointerRouter constructor directly (the harness always supplies one).
        const container = document.createElement('div');
        container.setPointerCapture = vi.fn();
        container.hasPointerCapture = vi.fn(() => false);
        container.releasePointerCapture = vi.fn();

        const router = new PointerRouter({
            container,
            classifyTarget: () => ({ kind: 'background' }),
            onPieceTap: vi.fn(),
            onPieceDrag: { start: vi.fn(), move: vi.fn(), end: vi.fn(), cancel: vi.fn() },
            onBackgroundPan: { start: vi.fn(), move: vi.fn(), end: vi.fn(), cancel: vi.fn() },
            onPinch: { start: vi.fn(), move: vi.fn(), end: vi.fn() },
            onWheelZoom: vi.fn(),
        });

        expect(() => {
            container.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 }));
            container.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 1, clientY: 0 }));
        }).not.toThrow();

        router.destroy();
    });
});
```

Also update the harness's `callbacks` type literal at the top of the file. Find the `RouterHarness` interface (around line 44) and change the `callbacks` field by adding the new key:

Replace:
```ts
        onWheelZoom: ReturnType<typeof vi.fn>;
    };
```

With:
```ts
        onWheelZoom: ReturnType<typeof vi.fn>;
        onBackgroundTap: ReturnType<typeof vi.fn>;
    };
```

And inside `createHarness`, find the `const callbacks = { ... }` literal (around line 76). Replace:
```ts
        onWheelZoom: vi.fn(),
    };
```

With:
```ts
        onWheelZoom: vi.fn(),
        onBackgroundTap: vi.fn(),
    };
```

- [ ] **Step 2: Run the tests to verify they fail**

```
npx vitest run src/interaction/pointer-router.test.ts
```

Expected: the new "background tap" tests fail (callback not invoked); existing tests still pass.

- [ ] **Step 3: Add the optional callback to `PointerRouter`**

In `src/interaction/pointer-router.ts`:

(a) Add the new field to `PointerRouterOptions` (after `onWheelZoom`, before the closing `}` around line 49):

```ts
    /** Optional. Fired when a background pointerdown/up resolves without crossing the tap threshold. */
    onBackgroundTap?: (evt: PointerEvent) => void;
```

(b) Update the `Pick<...>` type in the class field around line 81:

```ts
    private callbacks: Pick<PointerRouterOptions,
        'onPieceTap' | 'onPieceDrag' | 'onBackgroundPan' | 'onPinch' | 'onWheelZoom' | 'onBackgroundTap'>;
```

(c) Wire it in the constructor's callbacks initialiser (around line 99):

```ts
        this.callbacks = {
            onPieceTap: opts.onPieceTap,
            onPieceDrag: opts.onPieceDrag,
            onBackgroundPan: opts.onBackgroundPan,
            onPinch: opts.onPinch,
            onWheelZoom: opts.onWheelZoom,
            onBackgroundTap: opts.onBackgroundTap,
        };
```

(d) Fire the callback in `onPointerUp`. Find the `else if (this.state.kind === 'background-candidate' ...)` branch (around line 219) that currently just resets to idle:

Replace:
```ts
        } else if (this.state.kind === 'background-candidate' && evt.pointerId === this.state.pointerId) {
            this.state = { kind: 'idle' };
        } else if (this.state.kind === 'piece-drag' && evt.pointerId === this.state.pointerId) {
```

With:
```ts
        } else if (this.state.kind === 'background-candidate' && evt.pointerId === this.state.pointerId) {
            this.state = { kind: 'idle' };
            this.callbacks.onBackgroundTap?.(evt);
        } else if (this.state.kind === 'piece-drag' && evt.pointerId === this.state.pointerId) {
```

- [ ] **Step 4: Run the tests to verify they pass**

```
npx vitest run src/interaction/pointer-router.test.ts
```

Expected: all tests pass (new + existing).

- [ ] **Step 5: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```
git add src/interaction/pointer-router.ts src/interaction/pointer-router.test.ts
git commit -m "feat(pointer-router): add onBackgroundTap callback"
```

---

## Task 3: Wire `RotationFocus` through `setupInteraction`

**Files:**
- Modify: `src/interaction/setup-interaction.ts`
- Modify: `src/interaction/setup-interaction.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `src/interaction/setup-interaction.test.ts`. Add an import for `RotationFocus` near the existing imports:

```ts
import { RotationFocus } from './rotation-focus.js';
```

Append the following block at the end of the existing `describe('setupInteraction', () => { ... })`:

```ts
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
            container.fire('pointerdown', fakePointerEvent({ target: null, pointerId: 1, clientX: 100, clientY: 100 }));
            container.fire('pointerup', fakePointerEvent({ pointerId: 1, clientX: 101, clientY: 100 }));

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

            container.fire('pointerdown', fakePointerEvent({ target: null, pointerId: 1, clientX: 100, clientY: 100 }));
            container.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 130, clientY: 100 })); // promote pan

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
```

- [ ] **Step 2: Run the tests to verify they fail**

```
npx vitest run src/interaction/setup-interaction.test.ts
```

Expected: the seven new "rotation focus" tests fail (TS error first — `rotationFocus` not in `InteractionSetupOptions`); existing tests still pass.

- [ ] **Step 3: Update `InteractionSetupOptions` and wire focus events**

In `src/interaction/setup-interaction.ts`:

(a) Import `RotationFocus`:

```ts
import type { RotationFocus } from './rotation-focus.js';
```

(b) Add to `InteractionSetupOptions` (after `selectionManager?: SelectionManager;`):

```ts
    rotationFocus?: RotationFocus;
```

(c) Destructure it in `setupInteraction(options)`:

Find the existing destructure (around line 38):
```ts
    const {
        container, renderer, viewportTransform, getState, onStateChanged,
        onDrop, onViewportChanged, screenDeltaToWorld, panViewport, selectionManager,
    } = options;
```

Replace with:
```ts
    const {
        container, renderer, viewportTransform, getState, onStateChanged,
        onDrop, onViewportChanged, screenDeltaToWorld, panViewport, selectionManager,
        rotationFocus,
    } = options;
```

(d) Update the `onPieceTap` handler. Find it (around line 116):

```ts
        onPieceTap: (pieceId, _evt) => {
            if (!selectionManager?.toolActive) return;
            const group = getGroupForPiece(getState(), pieceId);
            selectionManager.toggle(group.id);
            renderer.setGroupSelected(group.id, selectionManager.isSelected(group.id));
            onStateChanged();
        },
```

Replace with:
```ts
        onPieceTap: (pieceId, _evt) => {
            const group = getGroupForPiece(getState(), pieceId);
            rotationFocus?.setFocus(group.id);
            if (!selectionManager?.toolActive) return;
            selectionManager.toggle(group.id);
            renderer.setGroupSelected(group.id, selectionManager.isSelected(group.id));
            onStateChanged();
        },
```

(e) Update `onPieceDrag.start` (around line 125) to clear focus first:

Find:
```ts
            start: (pieceId, evt) => {
                dragController.handlePointerDown(pieceId, evt);
                const drag = dragController.getActiveDrag();
                if (!drag) return;
                applyOffsetDragIfSinglePiece(drag.groupId);
                autoPan?.start(drag.groupId);
                autoPan?.updatePointer({ x: evt.clientX, y: evt.clientY });
            },
```

Replace with:
```ts
            start: (pieceId, evt) => {
                rotationFocus?.clearFocus();
                dragController.handlePointerDown(pieceId, evt);
                const drag = dragController.getActiveDrag();
                if (!drag) return;
                applyOffsetDragIfSinglePiece(drag.groupId);
                autoPan?.start(drag.groupId);
                autoPan?.updatePointer({ x: evt.clientX, y: evt.clientY });
            },
```

(f) Update `onBackgroundPan.start` (around line 157):

Find:
```ts
        onBackgroundPan: {
            start: (evt) => viewportController.handlePanStart(evt),
            move: (evt) => viewportController.handlePanMove(evt),
            end: () => viewportController.handlePanEnd(),
            cancel: () => viewportController.handlePanEnd(),
        },
```

Replace with:
```ts
        onBackgroundPan: {
            start: (evt) => {
                rotationFocus?.clearFocus();
                viewportController.handlePanStart(evt);
            },
            move: (evt) => viewportController.handlePanMove(evt),
            end: () => viewportController.handlePanEnd(),
            cancel: () => viewportController.handlePanEnd(),
        },
```

(g) Update `onPinch.start` (around line 163):

Find:
```ts
        onPinch: {
            start: (a, b) => viewportController.handlePinchStart(a, b),
            move: (a, b) => viewportController.handlePinchMove(a, b),
            end: () => viewportController.handlePinchEnd(),
        },
```

Replace with:
```ts
        onPinch: {
            start: (a, b) => {
                rotationFocus?.clearFocus();
                viewportController.handlePinchStart(a, b);
            },
            move: (a, b) => viewportController.handlePinchMove(a, b),
            end: () => viewportController.handlePinchEnd(),
        },
```

(h) Update `onWheelZoom` (around line 169):

Find:
```ts
        onWheelZoom: (evt) => viewportController.handleWheel(evt),
```

Replace with:
```ts
        onWheelZoom: (evt) => {
            rotationFocus?.clearFocus();
            viewportController.handleWheel(evt);
        },
```

(i) Add the new `onBackgroundTap` wiring inside the `new PointerRouter({ ... })` literal (after the `onWheelZoom` line):

```ts
        onBackgroundTap: () => {
            rotationFocus?.clearFocus();
        },
```

- [ ] **Step 4: Run the tests to verify they pass**

```
npx vitest run src/interaction/setup-interaction.test.ts
```

Expected: all tests pass (the 7 new + the existing 4).

- [ ] **Step 5: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```
git add src/interaction/setup-interaction.ts src/interaction/setup-interaction.test.ts
git commit -m "feat(interaction): wire RotationFocus through setupInteraction"
```

---

## Task 4: CSS — replace bottom-left positioning with absolute screen positioning + fade classes

**Files:**
- Modify: `src/style.css`

- [ ] **Step 1: Edit `src/style.css`**

Find the existing rotate-button block (lines 205–244):

```css
/* Rotate CW/CCW buttons (bottom-left, fractal-only) */
.rotate-button {
  position: absolute;
  bottom: 24px;
  z-index: 9999;
  width: 44px;
  height: 44px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ui-fg);
  background: var(--ui-overlay);
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}

.rotate-button--ccw { left: 12px; }
.rotate-button--cw { left: 64px; }

.rotate-button:hover:not(:disabled) {
  background: var(--ui-overlay-hover);
  border-color: var(--ui-border-hover);
}

.rotate-button:active:not(:disabled) {
  background: var(--ui-overlay-active);
}

.rotate-button:disabled {
  opacity: 0.35;
  cursor: default;
}
```

Replace with:

```css
/*
 * Rotate CW/CCW buttons — float next to the focused piece.
 * `top`/`left` are set inline by rotate-buttons.ts based on the
 * focused group's screen-space bounding box.
 */
.rotate-button {
  position: absolute;
  z-index: 9999;
  width: 44px;
  height: 44px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ui-fg);
  background: var(--ui-overlay);
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  opacity: 0;
}

.rotate-button:hover {
  background: var(--ui-overlay-hover);
  border-color: var(--ui-border-hover);
}

.rotate-button:active {
  background: var(--ui-overlay-active);
}

/* Fade-in: snappy, near-instant. */
.rotate-button--fade-in {
  opacity: 1;
  transition: opacity 100ms ease-out;
}

/* Quick fade-out (user dismissed): symmetric with fade-in. */
.rotate-button--fade-out-quick {
  opacity: 0;
  transition: opacity 100ms ease-out;
  pointer-events: none;
}

/* Slow fade-out (idle timer expired): pointer-events stay enabled
   so a tap during the fade rescues the pair. */
.rotate-button--fade-out-slow {
  opacity: 0;
  transition: opacity 750ms ease-out;
}
```

Then find the small-screen overrides block (around line 1122):

```css
  .rotate-button {
    bottom: 16px;
    width: 36px;
    height: 36px;
  }

  .rotate-button--ccw { left: 8px; }
  .rotate-button--cw { left: 50px; }
```

Replace with:

```css
  .rotate-button {
    width: 36px;
    height: 36px;
  }
```

- [ ] **Step 2: Type-check (CSS doesn't affect TS but smoke-test the rest still passes)**

```
npx tsc --noEmit && npm test
```

Expected: type-check passes; some `rotate-buttons` tests will still fail because the new module hasn't been written yet (they assert the old layout). That's expected — leave them broken; they'll be replaced in Task 5.

> **Note:** Do NOT commit yet. The CSS change leaves the build "ugly" (no buttons visible at all on rotation puzzles) until Task 5 lands. Bundle the CSS change into the Task 5 commit, OR commit the CSS now with an explicit follow-up commit. We commit now so the working tree is clean for Task 5.

- [ ] **Step 3: Commit the CSS in isolation**

```
git add src/style.css
git commit -m "style(rotate-button): replace fixed positioning with float + fade classes"
```

---

## Task 5: Rewrite `rotate-buttons.ts` and its tests

This is the largest task. The new module:
- Subscribes to `RotationFocus.onChange`.
- On focus set: builds a fresh DOM pair at the clamped screen position, fades in, starts a 5-second idle timer.
- On user-dismiss focus-clear: applies quick fade-out + `pointer-events: none`, removes from DOM after the transition.
- On focus-change-to-different-id: quick-fades the old pair, builds a new pair for the new id.
- Idle timer expiry: applies slow fade-out (pointer-events stay enabled). At fade end, removes the pair AND calls `clearFocus()`.
- Click on a slowly-fading pair: cancels the fade, restores opacity, restarts the timer, and runs the rotation.
- `show()`/`hide()` gate everything — when hidden, focus changes are ignored and any visible pair is torn down.

**Files:**
- Modify: `src/ui/rotate-buttons.ts` (full rewrite)
- Modify: `src/ui/rotate-buttons.test.ts` (full rewrite)

- [ ] **Step 1: Replace `src/ui/rotate-buttons.test.ts` with the new test file**

Overwrite the entire file with:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```
npx vitest run src/ui/rotate-buttons.test.ts
```

Expected: every test fails (TS error first — new option fields in `createRotateButtons` are not in the existing signature).

- [ ] **Step 3: Replace `src/ui/rotate-buttons.ts` with the new implementation**

Overwrite the entire file with:

```ts
/**
 * Rotate buttons — a transient pair of CCW/CW buttons that flanks the
 * group most recently tapped by the user. The pair fades in fast, sits
 * for repeated rotations, and fades out softly after a 5-second idle
 * window or instantly on any non-rotate action.
 *
 * The host is responsible for projecting the focused group's bounding
 * box from world space into screen space (via getFocusedGroupScreenBounds);
 * we just place the buttons next to it, clamped to viewport.
 */

import type { RotationFocus } from '../interaction/rotation-focus.js';
import type { RotationDirection } from '../game/rotate-group.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const BUTTON_SIZE_PX = 44;
const BUTTON_GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 12;
const IDLE_TIMEOUT_MS = 5000;
const QUICK_FADE_MS = 100;
const SLOW_FADE_MS = 750;

export interface RotateButtonsOptions {
    container: HTMLElement;
    rotationFocus: RotationFocus;
    /** Rotate the given group by 90° in the given direction. */
    onRotate: (groupId: number, direction: RotationDirection) => void;
    /**
     * Project the focused group's visual bounds into screen-space.
     * Return `null` when the group cannot be located (e.g. just removed).
     */
    getFocusedGroupScreenBounds: (
        groupId: number,
    ) => { left: number; right: number; top: number; bottom: number } | null;
    /**
     * Current viewport size in CSS pixels. Defaults to
     * `visualViewport` (or `window.innerWidth/Height` as fallback).
     */
    getViewportSize?: () => { width: number; height: number };
}

export interface RotateButtonsHandle {
    show: () => void;
    hide: () => void;
    destroy: () => void;
}

interface ActivePair {
    groupId: number;
    ccw: HTMLButtonElement;
    cw: HTMLButtonElement;
    idleTimerId: ReturnType<typeof setTimeout> | null;
    /** Timeout that removes the pair after a fade-out completes. */
    removalTimerId: ReturnType<typeof setTimeout> | null;
    /** Fadeout-end listener — bound on the CCW button (either button works). */
    transitionEndListener: ((e: Event) => void) | null;
    /** Mode the pair is currently in. */
    state: 'visible' | 'fade-out-quick' | 'fade-out-slow';
}

function makeRotateIcon(mirror: boolean): SVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    if (mirror) {
        svg.setAttribute('transform', 'scale(-1,1)');
    }

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M21 12a9 9 0 1 1-3.1-6.8');
    svg.appendChild(path);

    const arrow = document.createElementNS(SVG_NS, 'polyline');
    arrow.setAttribute('points', '21 3 21 9 15 9');
    svg.appendChild(arrow);

    return svg;
}

function makeButton(modifier: 'ccw' | 'cw', label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = `rotate-button rotate-button--${modifier}`;
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.appendChild(makeRotateIcon(modifier === 'ccw'));
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

export function createRotateButtons(
    options: RotateButtonsOptions,
): RotateButtonsHandle {
    const {
        container,
        rotationFocus,
        onRotate,
        getFocusedGroupScreenBounds,
        getViewportSize = defaultViewportSize,
    } = options;

    let shown = false;
    let active: ActivePair | null = null;
    let unsubscribeFocus: (() => void) | null = null;

    function placeButton(button: HTMLButtonElement, leftPx: number, topPx: number): void {
        button.style.left = `${leftPx}px`;
        button.style.top = `${topPx}px`;
    }

    function spawnPair(groupId: number): void {
        const bounds = getFocusedGroupScreenBounds(groupId);
        if (!bounds) return;
        const viewport = getViewportSize();

        const ccw = makeButton('ccw', 'Rotate selection 90° counter-clockwise');
        const cw = makeButton('cw', 'Rotate selection 90° clockwise');

        const midY = (bounds.top + bounds.bottom) / 2;
        const naturalCcwLeft = bounds.left - BUTTON_GAP_PX - BUTTON_SIZE_PX;
        const naturalCwLeft = bounds.right + BUTTON_GAP_PX;
        const naturalTop = midY - BUTTON_SIZE_PX / 2;

        const maxLeft = viewport.width - BUTTON_SIZE_PX - VIEWPORT_MARGIN_PX;
        const maxTop = viewport.height - BUTTON_SIZE_PX - VIEWPORT_MARGIN_PX;

        const ccwLeft = clamp(naturalCcwLeft, VIEWPORT_MARGIN_PX, maxLeft);
        const cwLeft = clamp(naturalCwLeft, VIEWPORT_MARGIN_PX, maxLeft);
        const topPx = clamp(naturalTop, VIEWPORT_MARGIN_PX, maxTop);

        placeButton(ccw, ccwLeft, topPx);
        placeButton(cw, cwLeft, topPx);

        ccw.classList.add('rotate-button--fade-in');
        cw.classList.add('rotate-button--fade-in');

        ccw.addEventListener('click', () => handleRotateClick('ccw'));
        cw.addEventListener('click', () => handleRotateClick('cw'));

        container.appendChild(ccw);
        container.appendChild(cw);

        active = {
            groupId,
            ccw,
            cw,
            idleTimerId: null,
            removalTimerId: null,
            transitionEndListener: null,
            state: 'visible',
        };
        startIdleTimer();
    }

    function handleRotateClick(direction: RotationDirection): void {
        if (!active) return;
        const groupId = active.groupId;

        // Rescue from slow fade-out (clicking a slowly-fading pair counts as
        // re-engagement — restore opacity, restart the idle timer).
        if (active.state === 'fade-out-slow') {
            cancelPairRemoval(active);
            active.ccw.classList.remove('rotate-button--fade-out-slow');
            active.cw.classList.remove('rotate-button--fade-out-slow');
            active.ccw.classList.add('rotate-button--fade-in');
            active.cw.classList.add('rotate-button--fade-in');
            active.state = 'visible';
        }

        startIdleTimer();
        onRotate(groupId, direction);
    }

    function startIdleTimer(): void {
        if (!active) return;
        if (active.idleTimerId !== null) clearTimeout(active.idleTimerId);
        active.idleTimerId = setTimeout(() => {
            startSlowFadeOut();
        }, IDLE_TIMEOUT_MS);
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
        active.ccw.classList.remove('rotate-button--fade-in');
        active.cw.classList.remove('rotate-button--fade-in');
        active.ccw.classList.add('rotate-button--fade-out-slow');
        active.cw.classList.add('rotate-button--fade-out-slow');
        scheduleRemoval(SLOW_FADE_MS, /* clearFocusOnRemove */ true);
    }

    function startQuickFadeOut(pair: ActivePair): void {
        // Cancel any in-flight removal — could be a slow fade that's
        // being upgraded to a quick fade because focus moved away.
        cancelPairRemoval(pair);
        if (pair.idleTimerId !== null) {
            clearTimeout(pair.idleTimerId);
            pair.idleTimerId = null;
        }
        pair.state = 'fade-out-quick';
        pair.ccw.classList.remove('rotate-button--fade-in', 'rotate-button--fade-out-slow');
        pair.cw.classList.remove('rotate-button--fade-in', 'rotate-button--fade-out-slow');
        pair.ccw.classList.add('rotate-button--fade-out-quick');
        pair.cw.classList.add('rotate-button--fade-out-quick');
        schedulePairRemoval(pair, QUICK_FADE_MS, /* clearFocusOnRemove */ false);
    }

    function scheduleRemoval(fallbackMs: number, clearFocusOnRemove: boolean): void {
        if (!active) return;
        schedulePairRemoval(active, fallbackMs, clearFocusOnRemove);
    }

    function schedulePairRemoval(
        pair: ActivePair,
        fallbackMs: number,
        clearFocusOnRemove: boolean,
    ): void {
        const onEnd = () => {
            if (pair.removalTimerId !== null) {
                clearTimeout(pair.removalTimerId);
                pair.removalTimerId = null;
            }
            pair.transitionEndListener = null;
            pair.ccw.removeEventListener('transitionend', onEnd);
            pair.ccw.remove();
            pair.cw.remove();
            if (active === pair) active = null;
            if (clearFocusOnRemove) rotationFocus.clearFocus();
        };
        pair.transitionEndListener = onEnd;
        pair.ccw.addEventListener('transitionend', onEnd);
        // Fallback in case transitionend doesn't fire (e.g. element was
        // removed before the transition kicked in, or display: none).
        pair.removalTimerId = setTimeout(onEnd, fallbackMs + 100);
    }

    function cancelPairRemoval(pair: ActivePair): void {
        if (pair.removalTimerId !== null) {
            clearTimeout(pair.removalTimerId);
            pair.removalTimerId = null;
        }
        if (pair.transitionEndListener !== null) {
            pair.ccw.removeEventListener('transitionend', pair.transitionEndListener);
            pair.transitionEndListener = null;
        }
    }

    function teardownActive(): void {
        if (!active) return;
        if (active.idleTimerId !== null) clearTimeout(active.idleTimerId);
        if (active.removalTimerId !== null) clearTimeout(active.removalTimerId);
        if (active.transitionEndListener !== null) {
            active.ccw.removeEventListener('transitionend', active.transitionEndListener);
        }
        active.ccw.remove();
        active.cw.remove();
        active = null;
    }

    function handleFocusChange(focusedGroupId: number | null): void {
        if (!shown) return;
        if (focusedGroupId === null) {
            // User dismissed: quick fade-out the current pair.
            if (active) startQuickFadeOut(active);
            return;
        }
        if (active && active.groupId === focusedGroupId) {
            // Same group — no-op (RotationFocus only fires on change).
            return;
        }
        if (active) {
            // Switching pieces: quick-fade old, spawn new.
            const old = active;
            active = null;
            startQuickFadeOut(old);
        }
        spawnPair(focusedGroupId);
    }

    return {
        show() {
            if (shown) return;
            shown = true;
            unsubscribeFocus = rotationFocus.onChange(handleFocusChange);
            // If focus is already set when shown, treat it like a focus event.
            if (rotationFocus.focusedGroupId !== null) {
                spawnPair(rotationFocus.focusedGroupId);
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```
npx vitest run src/ui/rotate-buttons.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Type-check**

```
npx tsc --noEmit
```

Expected: no errors yet — the `src/ui/index.ts` re-exports still match (the `RotateButtonsOptions` and `RotateButtonsHandle` names are preserved). `main.ts` will fail because it still calls the old API; that gets fixed in Task 6. **For now, build the affected test files only** to keep the loop tight:

```
npx vitest run src/ui/rotate-buttons.test.ts src/interaction/rotation-focus.test.ts
```

Both green.

> **Note:** The full `npm test` and `npx tsc --noEmit` will fail until Task 6 lands. That's expected — Task 5 deliberately commits an intermediate state to keep the diff reviewable.

- [ ] **Step 6: Commit**

```
git add src/ui/rotate-buttons.ts src/ui/rotate-buttons.test.ts
git commit -m "feat(rotate-buttons): rewrite as piece-anchored fade-in/out pair"
```

---

## Task 6: Wire `RotationFocus` and the new `rotate-buttons` API into `main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add the `RotationFocus` import**

In `src/main.ts`, find the import block that already imports from `./interaction/index.js` (around line 5):

```ts
import { setupInteraction, ViewportTransform } from './interaction/index.js';
```

Replace with:
```ts
import { setupInteraction, ViewportTransform, RotationFocus } from './interaction/index.js';
```

Also find and remove the now-unused-style direct import at line 40:
```ts
import { SelectionManager } from './interaction/selection-manager.js';
```

(keep it — `SelectionManager` is still used for the multi-select tool. No change needed here. Mentioning explicitly so the implementer doesn't accidentally remove it.)

Add a new import for the visual-bounds helper near the existing `getGroupVisualBounds` import (line 12):
```ts
// (no change — getGroupVisualBounds is already imported)
```

- [ ] **Step 2: Construct the `RotationFocus`**

In `src/main.ts`, find the existing `SelectionManager` construction (around line 188):

```ts
// Multi-select tool
const selectionManager = new SelectionManager();
```

Add immediately after:
```ts
// Floating rotate-buttons focus tracker
const rotationFocus = new RotationFocus();
```

- [ ] **Step 3: Add a screen-bounds helper**

Add this helper function in `src/main.ts` near the other small helpers (e.g. just above `function autoSave()` around line 388):

```ts
/**
 * Project the visual bounds of the given group from world space into
 * screen space, using the current viewport transform. Returns `null` if
 * the group is no longer in the game state.
 */
function getFocusedGroupScreenBounds(
    groupId: number,
): { left: number; right: number; top: number; bottom: number } | null {
    const group = gameState?.groupsById.get(groupId);
    if (!group) return null;
    const local = getGroupVisualBounds(group, gameState.piecesById);
    const worldLeft = group.position.x + local.minX;
    const worldTop = group.position.y + local.minY;
    const worldRight = worldLeft + local.width;
    const worldBottom = worldTop + local.height;
    const tl = viewportTransform.worldToScreen({ x: worldLeft, y: worldTop });
    const br = viewportTransform.worldToScreen({ x: worldRight, y: worldBottom });
    return { left: tl.x, top: tl.y, right: br.x, bottom: br.y };
}
```

- [ ] **Step 4: Remove the auto-enable of multi-select for rotation puzzles**

Find this block in `initGame()` (around line 408–412):

```ts
function initGame(state: GameState): void {
    removeCompletionOverlay();
    selectionManager.clearAll();
    // Rotation requires selecting groups before the rotate buttons engage;
    // turn the multi-select tool on by default so this path is discoverable.
    selectionManager.toolActive = state.rotationMode === 'quarter-turn';
```

Replace with:

```ts
function initGame(state: GameState): void {
    removeCompletionOverlay();
    selectionManager.clearAll();
    rotationFocus.clearFocus();
```

- [ ] **Step 5: Pass `rotationFocus` through to `setupInteraction`**

In the existing `setupInteraction({ ... })` call (around line 428), find the call's options object and add `rotationFocus,` next to `selectionManager,` (which is the last property today):

Find:
```ts
    cleanupDrag = setupInteraction({
        container: app,
        renderer,
        viewportTransform,
        getState: () => gameState,
        onStateChanged: () => {
            ...
        },
        onDrop: (groupId: number) => {
            ...
        },
        onViewportChanged: applyViewportTransform,
        screenDeltaToWorld: (delta) => viewportTransform.screenDeltaToWorld(delta),
        panViewport: (screenDelta) => {
            viewportTransform.pan(screenDelta);
            applyViewportTransform();
        },
        selectionManager,
    });
```

Add `rotationFocus,` after the `selectionManager,` line:

```ts
        selectionManager,
        rotationFocus,
    });
```

- [ ] **Step 6: Update the rotate-buttons construction**

Find the existing `createRotateButtons({ ... })` call (around line 726):

```ts
const rotateButtons = createRotateButtons({
    container: app,
    selectionManager,
    onRotate: (direction) => {
        if (!gameState || !selectionManager.hasSelection) return;

        for (const groupId of selectionManager.selectedGroupIds) {
            const group = gameState.groupsById.get(groupId);
            if (group) {
                rotateGroup(group, gameState.piecesById, direction);
            }
        }

        renderer.renderState(gameState);
        for (const selectedId of selectionManager.selectedGroupIds) {
            renderer.setGroupSelected(selectedId, true);
        }
        autoSave();
    },
});
```

Replace with:

```ts
const rotateButtons = createRotateButtons({
    container: app,
    rotationFocus,
    onRotate: (groupId, direction) => {
        if (!gameState) return;
        const group = gameState.groupsById.get(groupId);
        if (!group) return;

        rotateGroup(group, gameState.piecesById, direction);

        renderer.renderState(gameState);
        // Re-apply selection visuals after re-render (rotation re-renders the group).
        for (const selectedId of selectionManager.selectedGroupIds) {
            renderer.setGroupSelected(selectedId, true);
        }
        autoSave();
    },
    getFocusedGroupScreenBounds,
});
```

- [ ] **Step 7: Clear focus in completion path**

Find `function showCompletionOverlay()` (around line 110) and add a focus-clear call at the top:

Replace:
```ts
function showCompletionOverlay(): void {
    if (currentCompletionHide) return;
    currentCompletionHide = renderCompletionOverlay({
        container: app,
        state: gameState,
        onDismiss: () => {
            currentCompletionHide = null;
        },
    });
}
```

With:
```ts
function showCompletionOverlay(): void {
    if (currentCompletionHide) return;
    rotationFocus.clearFocus();
    currentCompletionHide = renderCompletionOverlay({
        container: app,
        state: gameState,
        onDismiss: () => {
            currentCompletionHide = null;
        },
    });
}
```

- [ ] **Step 8: Type-check and run all tests**

```
npx tsc --noEmit && npm test
```

Expected: no type errors; all tests pass.

If any pre-existing test asserts `selectionManager.toolActive === true` on a rotation puzzle path, it will fail. Search for those:

```
grep -rn "toolActive" src/
```

If there are stale references, update them to expect `false` for rotation puzzles. (At plan-write time only the test in `src/ui/select-tool-button.test.ts` exercises `toolActive` and does so with explicit assignment, so this should be a non-issue. Verify and fix any new fallout.)

- [ ] **Step 9: Smoke-test in the browser**

```
npm run dev
```

In the browser:
1. Open the app. Click the New Game button → choose Fractal cut style → tick "Enable rotation" → start.
2. Verify the multi-select tool button does NOT appear active by default.
3. Tap a piece → verify CCW/CW buttons fade in flanking that piece.
4. Tap CCW or CW → piece rotates 90°; buttons stay put.
5. Wait ~5 seconds without tapping → buttons fade out softly.
6. Tap a piece again → buttons fade in. Tap on background → buttons quick-fade out.
7. Tap one piece, then quickly tap another → first pair quick-fades, second fades in next to the new piece.
8. Pan the viewport, pinch-zoom, scroll-wheel → if buttons were visible they fade out.
9. Drag a piece → buttons fade out as the drag begins.
10. Confirm a non-rotation puzzle (regular cut, fractal without rotation) does NOT show buttons regardless of taps.

If anything misbehaves, report it back; otherwise commit:

- [ ] **Step 10: Commit**

```
git add src/main.ts
git commit -m "feat(main): wire RotationFocus into interaction and rotate-buttons"
```

---

## Task 7: Update info-modal help text

**Files:**
- Modify: `src/ui/info-modal.ts`

- [ ] **Step 1: Update the Rotate-buttons help line in How to Play**

In `src/ui/info-modal.ts`, find the buttons sub-list inside `buildHowToPlaySection()` (around line 131–135):

```ts
    appendInlineLi(buttons, [
        '↺ ↻ ',
        ['strong', 'Rotate'],
        ' (bottom-left, fractal only) — Rotate every selected group 90° counter-clockwise or clockwise',
    ]);
```

Replace with:

```ts
    appendInlineLi(buttons, [
        '↺ ↻ ',
        ['strong', 'Rotate'],
        ' (fractal puzzles with rotation) — Tap any piece to bring up the ↺ / ↻ buttons next to it; tap them to rotate that piece (and anything merged with it) 90°. They fade out after a few seconds or when you tap elsewhere.',
    ]);
```

- [ ] **Step 2: Update the Fractal "Enable rotation" explanation in Cut Styles**

Find the same block (around line 174–177):

```ts
    appendInlineLi(fractalSub, [
        ['strong', 'Enable rotation'],
        ' — Pieces start at random 90° rotations; solve orientation as well as position. Multi-select is turned on by default so you can pick the pieces to rotate, then use the ↺ / ↻ buttons.',
    ]);
```

Replace with:

```ts
    appendInlineLi(fractalSub, [
        ['strong', 'Enable rotation'],
        ' — Pieces start at random 90° rotations; solve orientation as well as position. Tap a piece to reveal the ↺ / ↻ buttons next to it, then tap to rotate.',
    ]);
```

- [ ] **Step 3: Run the tests**

```
npx vitest run src/ui/info-modal.test.ts
```

Expected: tests pass. (`info-modal.test.ts` doesn't pin the exact wording — verify by reading the file if anything fails.)

- [ ] **Step 4: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```
git add src/ui/info-modal.ts
git commit -m "docs(info-modal): update rotation help text for piece-anchored buttons"
```

---

## Final verification

- [ ] **Run full test suite**

```
npm test
```

Expected: all tests pass.

- [ ] **Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Production build**

```
npm run build
```

Expected: clean build, no warnings about unused imports or dead code.

- [ ] **Browser smoke test (one more time)**

Re-run the smoke test from Task 6, Step 9. Pay particular attention to:
- Slow fade rescue: tap a piece, wait until buttons begin fading slowly (~5 s in), then tap a rotate button — the rotation should happen and the buttons snap back to full opacity.
- Quick fade: tap a piece, then tap the background — buttons should disappear quickly.
- Cross-fade: tap piece A, then tap piece B before A's buttons have fully gone — A quick-fades, B fades in at B's position.

---

## Self-review checklist (run after writing the plan, before handing off)

- [x] Spec coverage: every section of the spec is covered. RotationFocus (Task 1), onBackgroundTap (Task 2), focus wiring (Task 3), CSS (Task 4), rotate-buttons rewrite + fade modes + idle timer + click-rescue (Task 5), main.ts integration + auto-enable removal + screen-bounds helper (Task 6), info-modal text (Task 7).
- [x] Type consistency: `setFocus(id)` / `clearFocus()` / `focusedGroupId` / `onChange(cb)` are used identically in Tasks 1, 3, 5, 6. `getFocusedGroupScreenBounds(groupId)` returns `{left,right,top,bottom}|null` in both Task 5 (consumer) and Task 6 (provider). `onRotate(groupId, direction)` signature matches in Tasks 5 and 6. CSS class names `rotate-button--fade-in`, `rotate-button--fade-out-quick`, `rotate-button--fade-out-slow` match between Task 4 (definition) and Task 5 (use).
- [x] No placeholders: every code block is concrete; no "implement appropriately" or "handle edge cases" hand-waves.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-03-rotation-focus-buttons.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
