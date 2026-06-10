# Marquee / Drag-Box Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a marquee (drag-a-box) gesture that rubber-band-selects every piece group inside the box, gated behind the multi-select tool (or desktop Shift+drag), with an info-modal setting for intersect-vs-contained semantics.

**Architecture:** A new `MarqueeController` owns the transient overlay and turns a screen-space box into an additive selection. `PointerRouter` is untouched — `setupInteraction` branches its existing `onBackgroundPan.{start,move,end,cancel}` hooks between the viewport pan and the marquee based on tool/Shift state at gesture start. Hit semantics come from a new boolean preference mirroring `offset-drag`.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom), vanilla DOM. Existing helpers: `getGroupVisualBounds`, `ViewportTransform.worldToScreen`, `SelectionManager`, `createBooleanPreference`.

---

## File Structure

- Create: `src/ui/marquee-contain.ts` — boolean preference for hit semantics.
- Create: `src/ui/marquee-contain.test.ts` — preference tests.
- Modify: `src/ui/index.ts` — re-export the new preference loaders.
- Create: `src/interaction/marquee-controller.ts` — gesture/overlay/selection logic + pure geometry helpers.
- Create: `src/interaction/marquee-controller.test.ts` — controller + geometry tests.
- Modify: `src/interaction/setup-interaction.ts` — construct the controller, branch the background-drag hooks.
- Modify: `src/interaction/setup-interaction.test.ts` — routing tests (+ `appendChild` on FakeContainer).
- Modify: `src/style.css` — `.marquee-box` overlay style.
- Modify: `src/ui/info-modal.ts` — Settings checkbox + How-to-Play help text.
- Modify: `src/ui/info-modal.test.ts` — checkbox test.

---

## Task 1: Hit-semantics preference

**Files:**
- Create: `src/ui/marquee-contain.ts`
- Test: `src/ui/marquee-contain.test.ts`
- Modify: `src/ui/index.ts:164-166`

- [ ] **Step 1: Write the failing test**

Create `src/ui/marquee-contain.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    loadMarqueeContainPreference,
    saveMarqueeContainPreference,
    MARQUEE_CONTAIN_KEY,
} from './marquee-contain.js';

describe('marquee-contain', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('defaults to disabled (intersect) when nothing is saved', () => {
        expect(loadMarqueeContainPreference()).toBe(false);
    });

    it('returns true when saved as "true"', () => {
        localStorage.setItem(MARQUEE_CONTAIN_KEY, 'true');
        expect(loadMarqueeContainPreference()).toBe(true);
    });

    it('saves and loads round-trip', () => {
        saveMarqueeContainPreference(true);
        expect(loadMarqueeContainPreference()).toBe(true);

        saveMarqueeContainPreference(false);
        expect(loadMarqueeContainPreference()).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/marquee-contain.test.ts`
Expected: FAIL — cannot resolve `./marquee-contain.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/marquee-contain.ts`:

```ts
/**
 * Marquee hit-semantics setting — persistence and defaults.
 *
 * When disabled (the default), a marquee selects every group whose bounds
 * the box touches (intersect). When enabled, only groups whose bounds lie
 * fully inside the box are selected (contain).
 *
 * Disabled by default. Users can change it in the info modal.
 */

import { createBooleanPreference } from './preference-store.js';

/** localStorage key for the marquee hit-semantics preference. */
export const MARQUEE_CONTAIN_KEY = 'puzzle-marquee-contain';

const store = createBooleanPreference({
    key: MARQUEE_CONTAIN_KEY,
    defaultValue: false,
});

/**
 * Load the marquee-contain preference. Returns false (intersect) if nothing
 * is saved.
 */
export const loadMarqueeContainPreference = store.load;

/** Save the marquee-contain preference. */
export const saveMarqueeContainPreference = store.save;
```

- [ ] **Step 4: Add the re-export**

In `src/ui/index.ts`, immediately after the `offset-drag.js` re-export block (currently lines 164-166):

```ts
export {
    loadMarqueeContainPreference,
    saveMarqueeContainPreference,
    MARQUEE_CONTAIN_KEY,
} from './marquee-contain.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/ui/marquee-contain.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/ui/marquee-contain.ts src/ui/marquee-contain.test.ts src/ui/index.ts
git commit -m "feat: add marquee hit-semantics preference (#390)"
```

---

## Task 2: MarqueeController + geometry

**Files:**
- Create: `src/interaction/marquee-controller.ts`
- Test: `src/interaction/marquee-controller.test.ts`

The controller is split into two testable pieces: a pure `groupScreenRect` projection helper, and the `MarqueeController` class whose hit-testing consumes pre-projected rects (so its tests need no real geometry).

- [ ] **Step 1: Write the failing test**

Create `src/interaction/marquee-controller.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    MarqueeController,
    groupScreenRect,
    type ScreenRect,
} from './marquee-controller.js';
import { SelectionManager } from './selection-manager.js';
import type { PieceGroup, Point } from '../model/types.js';
import { makeRectPiece, buildPiecesById } from '../test-helpers/fixtures.js';

function evt(clientX: number, clientY: number): PointerEvent {
    return { clientX, clientY } as PointerEvent;
}

function makeController(opts: {
    rects: ReadonlyArray<{ id: number; rect: ScreenRect }>;
    contain?: boolean;
    selection: SelectionManager;
    committed: () => void;
    container: HTMLElement;
}): MarqueeController {
    return new MarqueeController({
        container: opts.container,
        selectionManager: opts.selection,
        isContainMode: () => opts.contain ?? false,
        getGroupScreenRects: () => opts.rects,
        onSelectionCommitted: opts.committed,
    });
}

describe('MarqueeController', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    it('creates an overlay on start and removes it on end', () => {
        const selection = new SelectionManager();
        const c = makeController({ rects: [], selection, committed: vi.fn(), container });

        c.start(evt(10, 10));
        expect(container.querySelector('.marquee-box')).not.toBeNull();

        c.end(evt(20, 20));
        expect(container.querySelector('.marquee-box')).toBeNull();
    });

    it('removes the overlay on cancel without changing selection', () => {
        const selection = new SelectionManager();
        selection.toolActive = true;
        const committed = vi.fn();
        const c = makeController({
            rects: [{ id: 1, rect: { left: 0, top: 0, right: 10, bottom: 10 } }],
            selection, committed, container,
        });

        c.start(evt(0, 0));
        c.move(evt(100, 100));
        c.cancel();

        expect(container.querySelector('.marquee-box')).toBeNull();
        expect(selection.hasSelection).toBe(false);
        expect(committed).not.toHaveBeenCalled();
    });

    it('intersect mode selects every group the box touches', () => {
        const selection = new SelectionManager();
        selection.toolActive = true;
        const committed = vi.fn();
        const c = makeController({
            rects: [
                { id: 1, rect: { left: 5, top: 5, right: 15, bottom: 15 } },   // overlaps
                { id: 2, rect: { left: 500, top: 500, right: 510, bottom: 510 } }, // far away
            ],
            selection, committed, container,
        });

        c.start(evt(0, 0));
        c.end(evt(20, 20)); // box (0,0)-(20,20)

        expect([...selection.selectedGroupIds]).toEqual([1]);
        expect(committed).toHaveBeenCalledTimes(1);
    });

    it('contain mode selects only fully-enclosed groups', () => {
        const selection = new SelectionManager();
        selection.toolActive = true;
        const c = makeController({
            contain: true,
            rects: [
                { id: 1, rect: { left: 5, top: 5, right: 15, bottom: 15 } },   // inside
                { id: 2, rect: { left: 15, top: 15, right: 25, bottom: 25 } }, // pokes out
            ],
            selection, committed: vi.fn(), container,
        });

        c.start(evt(0, 0));
        c.end(evt(20, 20)); // box (0,0)-(20,20)

        expect([...selection.selectedGroupIds]).toEqual([1]);
    });

    it('is additive — keeps prior selection and adds matches', () => {
        const selection = new SelectionManager();
        selection.toolActive = true;
        selection.select(9);
        const c = makeController({
            rects: [{ id: 1, rect: { left: 5, top: 5, right: 15, bottom: 15 } }],
            selection, committed: vi.fn(), container,
        });

        c.start(evt(0, 0));
        c.end(evt(20, 20));

        expect([...selection.selectedGroupIds].sort()).toEqual([1, 9]);
    });

    it('does not commit when the box matches nothing new', () => {
        const selection = new SelectionManager();
        selection.toolActive = true;
        const committed = vi.fn();
        const c = makeController({
            rects: [{ id: 1, rect: { left: 500, top: 500, right: 510, bottom: 510 } }],
            selection, committed, container,
        });

        c.start(evt(0, 0));
        c.end(evt(20, 20));

        expect(selection.hasSelection).toBe(false);
        expect(committed).not.toHaveBeenCalled();
    });
});

describe('groupScreenRect', () => {
    const identity = (p: Point): Point => p;

    function makeGroup(id: number, x: number, y: number): PieceGroup {
        return { id, pieces: new Map([[1, { x: 0, y: 0 }]]), position: { x, y }, rotation: 0 };
    }

    it('projects a group\'s world bounds through worldToScreen', () => {
        const piece = makeRectPiece({ id: 1, width: 100, height: 40 });
        const group = makeGroup(7, 10, 20);

        const rect = groupScreenRect(group, buildPiecesById([piece]), identity);

        expect(rect).not.toBeNull();
        expect(rect!.left).toBeCloseTo(10);
        expect(rect!.top).toBeCloseTo(20);
        expect(rect!.right).toBeCloseTo(110);
        expect(rect!.bottom).toBeCloseTo(60);
    });

    it('applies scale and offset from worldToScreen', () => {
        const piece = makeRectPiece({ id: 1, width: 100, height: 40 });
        const group = makeGroup(7, 0, 0);
        const w2s = (p: Point): Point => ({ x: p.x * 2 + 5, y: p.y * 2 + 5 });

        const rect = groupScreenRect(group, buildPiecesById([piece]), w2s);

        expect(rect!.left).toBeCloseTo(5);
        expect(rect!.right).toBeCloseTo(205);
        expect(rect!.bottom).toBeCloseTo(85);
    });

    it('returns null for an empty group', () => {
        const group: PieceGroup = { id: 1, pieces: new Map(), position: { x: 0, y: 0 }, rotation: 0 };
        expect(groupScreenRect(group, buildPiecesById([]), identity)).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/interaction/marquee-controller.test.ts`
Expected: FAIL — cannot resolve `./marquee-controller.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/interaction/marquee-controller.ts`:

```ts
/**
 * Marquee (drag-box) selection.
 *
 * Owns one rubber-band gesture: a transient screen-space overlay rectangle,
 * and, on release, an additive selection of every group whose projected
 * screen bounds match the box. Whether a group "matches" depends on the
 * intersect-vs-contain setting read at release time.
 *
 * The gesture is driven by `setupInteraction`, which forwards the same
 * background-drag pointer events the router emits for a viewport pan.
 */

import { getGroupVisualBounds } from '../game/index.js';
import type { GameState, PieceGroup, Point } from '../model/types.js';
import type { SelectionManager } from './selection-manager.js';

export interface ScreenRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface MarqueeControllerOptions {
    /** Parent for the transient overlay element. */
    container: HTMLElement;
    selectionManager: SelectionManager;
    /** Read at release time so a setting change applies without a rebuild. */
    isContainMode: () => boolean;
    /**
     * Projected screen rectangles for every selectable group, evaluated at
     * release time against the current viewport transform.
     */
    getGroupScreenRects: () => ReadonlyArray<{ id: number; rect: ScreenRect }>;
    /** Called once after a marquee adds at least one group to the selection. */
    onSelectionCommitted: () => void;
}

export class MarqueeController {
    private opts: MarqueeControllerOptions;
    private overlay: HTMLElement | null = null;
    private startX = 0;
    private startY = 0;

    constructor(opts: MarqueeControllerOptions) {
        this.opts = opts;
    }

    /** Whether a marquee gesture is currently in progress. */
    get active(): boolean {
        return this.overlay !== null;
    }

    start(evt: PointerEvent): void {
        this.startX = evt.clientX;
        this.startY = evt.clientY;

        const overlay = document.createElement('div');
        overlay.className = 'marquee-box';
        overlay.style.left = `${this.startX}px`;
        overlay.style.top = `${this.startY}px`;
        overlay.style.width = '0px';
        overlay.style.height = '0px';
        this.overlay = overlay;
        this.opts.container.appendChild(overlay);
    }

    move(evt: PointerEvent): void {
        if (!this.overlay) return;
        const r = this.normalizedRect(evt.clientX, evt.clientY);
        this.overlay.style.left = `${r.left}px`;
        this.overlay.style.top = `${r.top}px`;
        this.overlay.style.width = `${r.right - r.left}px`;
        this.overlay.style.height = `${r.bottom - r.top}px`;
    }

    end(evt: PointerEvent): void {
        if (!this.overlay) return;
        const marquee = this.normalizedRect(evt.clientX, evt.clientY);
        this.removeOverlay();

        const contain = this.opts.isContainMode();
        let changed = false;
        for (const { id, rect } of this.opts.getGroupScreenRects()) {
            const hit = contain
                ? rectContains(marquee, rect)
                : rectsIntersect(marquee, rect);
            if (hit && !this.opts.selectionManager.isSelected(id)) {
                this.opts.selectionManager.select(id);
                changed = true;
            }
        }
        if (changed) this.opts.onSelectionCommitted();
    }

    cancel(): void {
        this.removeOverlay();
    }

    private removeOverlay(): void {
        this.overlay?.remove();
        this.overlay = null;
    }

    private normalizedRect(x: number, y: number): ScreenRect {
        return {
            left: Math.min(this.startX, x),
            top: Math.min(this.startY, y),
            right: Math.max(this.startX, x),
            bottom: Math.max(this.startY, y),
        };
    }
}

/**
 * Project a group's rotation-aware, tab-inclusive world bounds into a
 * screen-space rectangle. Returns null for a group with no findable
 * geometry (so callers can skip it). The viewport has no rotation, so an
 * axis-aligned world box maps to an axis-aligned screen box.
 */
export function groupScreenRect(
    group: PieceGroup,
    piecesById: GameState['piecesById'],
    worldToScreen: (p: Point) => Point,
): ScreenRect | null {
    const vb = getGroupVisualBounds(group, piecesById);
    if (vb.width === 0 && vb.height === 0) return null;

    const tl = worldToScreen({
        x: group.position.x + vb.minX,
        y: group.position.y + vb.minY,
    });
    const br = worldToScreen({
        x: group.position.x + vb.minX + vb.width,
        y: group.position.y + vb.minY + vb.height,
    });
    return { left: tl.x, top: tl.y, right: br.x, bottom: br.y };
}

function rectsIntersect(a: ScreenRect, b: ScreenRect): boolean {
    return !(b.right < a.left || b.left > a.right || b.bottom < a.top || b.top > a.bottom);
}

function rectContains(outer: ScreenRect, inner: ScreenRect): boolean {
    return (
        inner.left >= outer.left &&
        inner.right <= outer.right &&
        inner.top >= outer.top &&
        inner.bottom <= outer.bottom
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/interaction/marquee-controller.test.ts`
Expected: PASS (all `MarqueeController` and `groupScreenRect` tests).

- [ ] **Step 5: Commit**

```bash
git add src/interaction/marquee-controller.ts src/interaction/marquee-controller.test.ts
git commit -m "feat: add MarqueeController for drag-box selection (#390)"
```

---

## Task 3: Overlay CSS

**Files:**
- Modify: `src/style.css` (after the `.merge-pulse` / selection block, ~line 443)

- [ ] **Step 1: Add the style**

Append after the `@keyframes merge-pulse { ... }` block in `src/style.css`:

```css
/* Marquee (drag-box) selection overlay — screen-space, non-interactive */
.marquee-box {
  position: fixed;
  pointer-events: none;
  z-index: 100;
  border: 1px solid var(--ui-accent);
  background: color-mix(in srgb, var(--ui-accent) 20%, transparent);
}
```

- [ ] **Step 2: Verify the app still builds**

Run: `npx tsc --noEmit`
Expected: no errors (CSS change is inert to the type-checker; this confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add src/style.css
git commit -m "feat: style the marquee selection box (#390)"
```

---

## Task 4: Wire the marquee into setupInteraction

**Files:**
- Modify: `src/interaction/setup-interaction.ts`
- Test: `src/interaction/setup-interaction.test.ts`

- [ ] **Step 1: Extend the test helpers**

In `src/interaction/setup-interaction.test.ts`:

1. Add `appendChild` to the FakeContainer. In the `FakeContainer` interface add:

```ts
    appendChild: ReturnType<typeof vi.fn>;
```

and in `createFakeContainer()`'s returned object (after `releasePointerCapture`), add:

```ts
        appendChild: vi.fn(),
```

2. The `fakePointerEvent` helper (~line 90) does **not** currently carry `shiftKey`. Add it. Extend its `overrides` type with `shiftKey: boolean;` and add to the returned object:

```ts
        shiftKey: overrides.shiftKey ?? false,
```

The marquee branch reads `evt.shiftKey`, so without this the Shift test cannot work. The `fakePointerEvent` signature takes a single overrides object (no event-type first arg) — match the existing call sites.

- [ ] **Step 2: Write the failing routing tests**

Add this suite at the end of the file. It keys off the overlay-append signal (`marquee.start` calls `container.appendChild`); the pan path never appends. This avoids depending on viewport-pan internals, which would not move the offset without an intermediate `handlePanMove`.

```ts
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

    it('draws a marquee (appends an overlay) when the tool is active', () => {
        const container = createFakeContainer();
        const selectionManager = new SelectionManager();
        selectionManager.toolActive = true;
        setup(container, selectionManager);

        dragBackground(container);

        expect(container.appendChild).toHaveBeenCalled();
    });

    it('pans (no overlay) when the tool is inactive and no Shift', () => {
        const container = createFakeContainer();
        const selectionManager = new SelectionManager();
        setup(container, selectionManager);

        dragBackground(container);

        expect(container.appendChild).not.toHaveBeenCalled();
    });

    it('Shift+drag with the tool off draws a marquee and activates the tool', () => {
        const container = createFakeContainer();
        const selectionManager = new SelectionManager();
        setup(container, selectionManager);

        dragBackground(container, { shiftKey: true });

        expect(selectionManager.toolActive).toBe(true);
        expect(container.appendChild).toHaveBeenCalled();
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/interaction/setup-interaction.test.ts`
Expected: FAIL — `appendChild` not called for the tool-active case (marquee not wired yet), and the Shift case does not activate the tool.

- [ ] **Step 4: Add imports**

In `src/interaction/setup-interaction.ts`, alongside the existing interaction imports add:

```ts
import { MarqueeController, groupScreenRect } from './marquee-controller.js';
import type { ScreenRect } from './marquee-controller.js';
```

and extend the existing `../ui/index.js` import (currently `import { loadOffsetDragPreference } from '../ui/index.js';`) to:

```ts
import { loadOffsetDragPreference, loadMarqueeContainPreference } from '../ui/index.js';
```

- [ ] **Step 5: Construct the MarqueeController**

In `setupInteraction`, after the `dragController` is created (after the block ending at the `screenDeltaToWorld,` argument, ~line 95) and before `applyOffsetDragIfSinglePiece`, insert:

```ts
    const marquee = selectionManager
        ? new MarqueeController({
            container,
            selectionManager,
            isContainMode: () => loadMarqueeContainPreference(),
            getGroupScreenRects: () => {
                const state = getState();
                const rects: Array<{ id: number; rect: ScreenRect }> = [];
                for (const group of state.groups) {
                    const rect = groupScreenRect(
                        group,
                        state.piecesById,
                        (p) => viewportTransform.worldToScreen(p),
                    );
                    if (rect) rects.push({ id: group.id, rect });
                }
                return rects;
            },
            onSelectionCommitted: onStateChanged,
        })
        : null;

    // Whether the in-progress background drag is a viewport pan or a marquee.
    // Decided once at drag start and held until the gesture resolves.
    let backgroundMode: 'pan' | 'marquee' = 'pan';
```

- [ ] **Step 6: Branch the onBackgroundPan hooks**

Replace the existing `onBackgroundPan` block:

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

with:

```ts
        onBackgroundPan: {
            start: (evt) => {
                rotationFocus?.clearFocus();
                const wantMarquee =
                    !!marquee && !!selectionManager &&
                    (selectionManager.toolActive || evt.shiftKey);
                if (wantMarquee) {
                    backgroundMode = 'marquee';
                    // Shift+drag with the tool off enters multi-select so the
                    // resulting selection is live (moves together, deselect
                    // button appears).
                    if (evt.shiftKey && !selectionManager.toolActive) {
                        selectionManager.toolActive = true;
                    }
                    marquee.start(evt);
                } else {
                    backgroundMode = 'pan';
                    viewportController.handlePanStart(evt);
                }
            },
            move: (evt) => {
                if (backgroundMode === 'marquee') marquee?.move(evt);
                else viewportController.handlePanMove(evt);
            },
            end: (evt) => {
                if (backgroundMode === 'marquee') marquee?.end(evt);
                else viewportController.handlePanEnd();
            },
            cancel: () => {
                if (backgroundMode === 'marquee') marquee?.cancel();
                else viewportController.handlePanEnd();
            },
        },
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/interaction/setup-interaction.test.ts`
Expected: PASS (existing tests + 3 new marquee-routing tests).

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/interaction/setup-interaction.ts src/interaction/setup-interaction.test.ts
git commit -m "feat: route background drag to marquee when selecting (#390)"
```

---

## Task 5: Info-modal setting + help text

**Files:**
- Modify: `src/ui/info-modal.ts`
- Test: `src/ui/info-modal.test.ts`

- [ ] **Step 1: Write the failing test**

Inspect `src/ui/info-modal.test.ts` for how the modal is mounted (it renders into a container and the `offset-drag-toggle` testid may already be asserted). Add a test mirroring the existing toggle coverage:

Existing tests mount with `createInfoModal({ container })` (all other args are optional) and clear `localStorage` in `beforeEach`. Match that:

```ts
it('toggles the marquee-contain preference from the settings checkbox', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    createInfoModal({ container });

    const checkbox = container.querySelector<HTMLInputElement>(
        '[data-testid="marquee-contain-toggle"]',
    );
    expect(checkbox).not.toBeNull();
    expect(checkbox!.checked).toBe(false); // intersect default

    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event('change'));

    expect(localStorage.getItem('puzzle-marquee-contain')).toBe('true');
});
```

Place it inside an appropriate `describe` (e.g. the Settings/"Piece outline setting" area). If that block lacks a `localStorage.clear()` in its `beforeEach`, add `localStorage.clear();` at the top of this test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/info-modal.test.ts`
Expected: FAIL — no element with testid `marquee-contain-toggle`.

- [ ] **Step 3: Add the setting builder and import**

In `src/ui/info-modal.ts`, add to the imports the new loader/saver (find the existing `loadOffsetDragPreference`/`saveOffsetDragPreference` import and add alongside):

```ts
import {
    loadMarqueeContainPreference,
    saveMarqueeContainPreference,
} from './marquee-contain.js';
```

(If the file imports those offset-drag helpers via `./index.js`, add the marquee ones to that same `./index.js` import instead, to match the local convention.)

Add a builder function next to `buildOffsetDragSetting` (after it, ~line 407):

```ts
function buildMarqueeContainSetting(): HTMLElement {
    const setting = document.createElement('div');
    setting.className = 'info-setting';

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'info-setting-toggle';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'form-checkbox';
    checkbox.dataset.testid = 'marquee-contain-toggle';
    checkbox.checked = loadMarqueeContainPreference();
    checkbox.addEventListener('change', () => {
        saveMarqueeContainPreference(checkbox.checked);
    });

    const text = document.createElement('span');
    text.className = 'info-setting-label';
    text.textContent = 'Enclose to select';

    toggleLabel.appendChild(checkbox);
    toggleLabel.appendChild(text);
    setting.appendChild(toggleLabel);

    const desc = document.createElement('p');
    desc.className = 'info-setting-description';
    desc.textContent =
        'When dragging a selection box, select only pieces fully inside the ' +
        'box instead of every piece the box touches.';
    setting.appendChild(desc);

    return setting;
}
```

- [ ] **Step 4: Mount the setting**

In `buildSettingsSection`, after `section.appendChild(buildOffsetDragSetting());` (~line 224) add:

```ts
    section.appendChild(buildMarqueeContainSetting());
```

- [ ] **Step 5: Update the How-to-Play help text**

Replace the Multi-select bullet's text node (the string starting `' (top-left) — When active, tap pieces...'`, ~line 141) with:

```ts
        ' (top-left) — When active, tap pieces to add/remove them from a selection, or drag a box on empty space to select every group it touches; drag any selected piece to move the whole selection together. On a computer you can also hold Shift and drag a box to start selecting without turning the tool on first. Tap ✕ (bottom) to deselect all. Your selection is remembered if you reload, and cleared when you deselect all or start a new game.',
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/ui/info-modal.test.ts`
Expected: PASS (new test + existing tests).

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/ui/info-modal.ts src/ui/info-modal.test.ts
git commit -m "feat: add marquee setting and help text (#390)"
```

---

## Task 6: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 2: Lint + type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean. (If `npm run lint` is not the project's script name, check `package.json` scripts and run the configured linter.)

- [ ] **Step 3: Manual smoke (optional, recommended)**

Run the dev server (`npm run dev`), then:
- Turn on the multi-select tool; drag a box over several pieces → they get the selected glow; drag one selected piece → all move together.
- Toggle "Enclose to select" in the info modal; redo the box → only fully-enclosed pieces select.
- With the tool off on desktop, Shift+drag a box → tool turns on and pieces select.
- With the tool off and no Shift, drag the background → it still pans.

---

## Self-Review notes

- **Spec coverage:** gating (Task 4: tool-or-Shift, Shift activates tool); intersect-vs-contain setting + intersect default (Tasks 1, 5); additive union (Task 2); overlay (Tasks 2, 3); help text (Task 5); touch + mouse parity (gesture rides the existing pointer-type-agnostic background-pan path). All covered.
- **No PointerRouter change:** confirmed — the router already emits `onBackgroundPan.{start,move,end,cancel}` with the `PointerEvent` (including `shiftKey`) for `end`/`start`.
- **Type consistency:** `ScreenRect`, `groupScreenRect`, `MarqueeController`, `getGroupScreenRects`, `isContainMode`, `onSelectionCommitted` used identically across Tasks 2 and 4. Preference names `loadMarqueeContainPreference`/`saveMarqueeContainPreference`/`MARQUEE_CONTAIN_KEY` consistent across Tasks 1, 4, 5.
- **Reproducibility contract:** no `random()` calls added — irrelevant to this feature.
