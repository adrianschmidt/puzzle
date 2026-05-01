# PointerRouter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the implicit pointer-event coordination between `ViewportController` and `setup-drag.ts` with a single `PointerRouter` that owns all container-level pointer events and emits pre-classified gesture events (piece-tap, piece-drag, background-pan, pinch, wheel-zoom).

**Architecture:** Additive-then-swap. New `PointerRouter` and the new `setup-interaction.ts` orchestrator land alongside the old code first, fully tested in isolation. Then `main.ts` switches to the new orchestrator in one commit; the old `setup-drag.ts` and `Renderer.onPiecePointerDown` are deleted; `DragController` and `ViewportController` are stripped of the responsibilities the router took over.

**Tech Stack:** Vite + TypeScript, vitest with jsdom for tests. Test pattern matches `src/interaction/viewport-controller.test.ts`: real `document.createElement('div')` container, spy on `addEventListener` to capture handlers, drive via a `fire(type, event)` helper using `as PointerEvent`-cast plain objects.

**Spec:** `docs/superpowers/specs/2026-05-01-pointer-router-design.md`

---

## File Structure

**Create:**
- `src/interaction/pointer-router.ts` — the `PointerRouter` class, `ClassifyTarget` type, `PointerRouterOptions` type. Single-purpose module: own container listeners, classify, dispatch.
- `src/interaction/pointer-router.test.ts` — full state-machine coverage. ≈600–800 LOC expected.
- `src/interaction/setup-interaction.ts` — the new orchestrator that wires `PointerRouter` + `DragController` + `ViewportController` + `AutoPanController`. Replaces `setup-drag.ts`.
- `src/interaction/setup-interaction.test.ts` — wiring tests (small; most logic moves to `pointer-router.test.ts`).

**Modify:**
- `src/renderer/types.ts` — add `pieceIdFromTarget(target)` to the `Renderer` interface; later in the plan, remove `onPiecePointerDown`.
- `src/renderer/svg-dom-renderer.ts` — implement `pieceIdFromTarget`; later remove `onPiecePointerDown` and the per-piece DOM listeners.
- `src/renderer/svg-dom-renderer.test.ts` — add `pieceIdFromTarget` tests; later replace `onPiecePointerDown` tests.
- `src/interaction/index.ts` — re-export `PointerRouter`, the `ClassifyTarget` type, and the new `setupInteraction`. Drop `setupDragHandling` and `ViewportControllerOptions` re-exports later.
- `src/interaction/drag-controller.ts` — strip the multi-pointer / pinch-grace / 2nd-finger-gate code; rename `cancelDragAndRestore → cancel`; collapse `DragCallbacks` to `{ moveGroup, bringToFront, requestRender }`.
- `src/interaction/drag-controller.test.ts` — remove tests for the dropped concerns; update names.
- `src/interaction/viewport-controller.ts` — make gesture-handler methods public; later strip listener-attachment, `activeTouches`, `panPointerId`/`panLastPoint`, `isBackgroundElement`.
- `src/interaction/viewport-controller.test.ts` — exercise the new public methods directly; remove tests for the dropped responsibilities.
- `src/main.ts` — replace `void new ViewportController({...})` + `setupDragHandling({...})` with one `setupInteraction({...})` call. Remove `isPieceElement`.

**Delete:**
- `src/interaction/setup-drag.ts`
- `src/interaction/setup-drag.test.ts`

---

## Conventions to follow

- 4-space indentation (matches existing files).
- Test files use `@vitest-environment jsdom` directive at top when DOM access is needed (matches existing test files in `src/interaction/`).
- Imports use `.js` extensions on TS source paths (matches `tsconfig.json` `allowImportingTsExtensions: true`).
- Module-level barrel `index.ts` re-exports the public surface.
- Conventional Commits style for messages (matches recent history: `refactor(interaction): ...`, `test(interaction): ...`).
- Test-driven: every new behaviour begins with a failing test.
- Frequent commits — one per task step where indicated.

---

## Task 1: Add `Renderer.pieceIdFromTarget` (additive, backward-compatible)

`onPiecePointerDown` stays; `pieceIdFromTarget` is added alongside. Both exist until Task 8.

**Files:**
- Modify: `src/renderer/types.ts`
- Modify: `src/renderer/svg-dom-renderer.ts`
- Modify: `src/renderer/svg-dom-renderer.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/svg-dom-renderer.test.ts`:

```ts
describe('pieceIdFromTarget', () => {
    it('returns the piece id when target is the SVG element itself', () => {
        const renderer = new SvgDomRenderer();
        renderer.init(host);
        renderer.renderState(makeStateWithPieces([7]));
        const svg = host.querySelector('svg[data-piece-id="7"]') as SVGSVGElement;

        expect(renderer.pieceIdFromTarget(svg)).toBe(7);
    });

    it('returns the piece id when target is a hit-area child of the SVG', () => {
        const renderer = new SvgDomRenderer();
        renderer.init(host);
        renderer.renderState(makeStateWithPieces([3]));
        const hitArea = host.querySelector('svg[data-piece-id="3"] [data-hit-area="true"]') as Element;

        expect(renderer.pieceIdFromTarget(hitArea)).toBe(3);
    });

    it('returns the piece id when target is an expanded-hit-area child', () => {
        const renderer = new SvgDomRenderer();
        renderer.init(host);
        renderer.renderState(makeStateWithPieces([5]));
        const expanded = host.querySelector('svg[data-piece-id="5"] [data-hit-area-expanded="true"]') as Element;

        expect(renderer.pieceIdFromTarget(expanded)).toBe(5);
    });

    it('returns null for an unrelated DOM node', () => {
        const renderer = new SvgDomRenderer();
        renderer.init(host);

        expect(renderer.pieceIdFromTarget(document.createElement('div'))).toBeNull();
    });

    it('returns null for null target', () => {
        const renderer = new SvgDomRenderer();
        renderer.init(host);

        expect(renderer.pieceIdFromTarget(null)).toBeNull();
    });
});
```

(`makeStateWithPieces` is the existing helper in this test file; reuse it.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/svg-dom-renderer.test.ts`
Expected: 5 new failures with "pieceIdFromTarget is not a function" or similar.

- [ ] **Step 3: Add to the `Renderer` interface**

In `src/renderer/types.ts`, add to the interface:

```ts
/**
 * Recover a piece id from a DOM event target. Returns null when the
 * target is not part of any rendered piece. Used by PointerRouter to
 * classify pointer events without per-piece listeners.
 */
pieceIdFromTarget(target: EventTarget | null): number | null;
```

- [ ] **Step 4: Implement in `SvgDomRenderer`**

Add to `src/renderer/svg-dom-renderer.ts` (alongside the other public methods):

```ts
pieceIdFromTarget(target: EventTarget | null): number | null {
    if (!(target instanceof Element)) return null;
    const svg = target.closest('svg[data-piece-id]');
    if (!svg) return null;
    const id = Number((svg as HTMLElement).dataset.pieceId);
    return Number.isFinite(id) ? id : null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/svg-dom-renderer.test.ts`
Expected: PASS for the 5 new tests; existing tests still pass.

- [ ] **Step 6: Run full build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/types.ts src/renderer/svg-dom-renderer.ts src/renderer/svg-dom-renderer.test.ts
git commit -m "feat(renderer): add pieceIdFromTarget for PointerRouter (refs #260)"
```

---

## Task 2: PointerRouter skeleton + types + wheel events

Build the file. Constructor attaches listeners, `destroy()` removes them. `wheel` events are dispatched / suppressed based on `classifyTarget`. No pointer logic yet — just the skeleton, types, and wheel.

**Files:**
- Create: `src/interaction/pointer-router.ts`
- Create: `src/interaction/pointer-router.test.ts`

- [ ] **Step 1: Write the failing tests for skeleton + wheel**

Create `src/interaction/pointer-router.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PointerRouter } from './pointer-router.js';
import type { ClassifyTarget } from './pointer-router.js';

interface FakePointerInit {
    pointerId?: number;
    pointerType?: 'mouse' | 'touch' | 'pen';
    clientX?: number;
    clientY?: number;
    target?: EventTarget | null;
}

function fakePointerEvent(o: FakePointerInit = {}): PointerEvent {
    return {
        pointerId: o.pointerId ?? 1,
        pointerType: o.pointerType ?? 'mouse',
        clientX: o.clientX ?? 0,
        clientY: o.clientY ?? 0,
        target: o.target ?? null,
    } as PointerEvent;
}

interface FakeWheelInit {
    deltaY?: number;
    clientX?: number;
    clientY?: number;
    target?: EventTarget | null;
}

function fakeWheelEvent(o: FakeWheelInit = {}): WheelEvent {
    return {
        deltaY: o.deltaY ?? 0,
        clientX: o.clientX ?? 0,
        clientY: o.clientY ?? 0,
        target: o.target ?? null,
        preventDefault: vi.fn(),
    } as unknown as WheelEvent;
}

interface RouterHarness {
    container: HTMLElement;
    classifyTarget: ReturnType<typeof vi.fn>;
    fire: (type: string, evt: Event) => void;
    callbacks: {
        onPieceTap: ReturnType<typeof vi.fn>;
        onPieceDrag: { start: ReturnType<typeof vi.fn>; move: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
        onBackgroundPan: { start: ReturnType<typeof vi.fn>; move: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
        onPinch: { start: ReturnType<typeof vi.fn>; move: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
        onWheelZoom: ReturnType<typeof vi.fn>;
    };
    nowMock: ReturnType<typeof vi.fn>;
    router: PointerRouter;
}

function createHarness(opts: { classifyTarget?: ClassifyTarget } = {}): RouterHarness {
    const handlers: Record<string, Array<(e: Event) => void>> = {};
    const container = document.createElement('div');
    container.addEventListener = vi.fn((type: string, cb: EventListenerOrEventListenerObject) => {
        (handlers[type] ??= []).push(cb as (e: Event) => void);
    }) as typeof container.addEventListener;
    container.removeEventListener = vi.fn((type: string, cb: EventListenerOrEventListenerObject) => {
        const arr = handlers[type] ?? [];
        const idx = arr.indexOf(cb as (e: Event) => void);
        if (idx >= 0) arr.splice(idx, 1);
    }) as typeof container.removeEventListener;
    container.setPointerCapture = vi.fn();
    container.hasPointerCapture = vi.fn(() => false);
    container.releasePointerCapture = vi.fn();

    const classifyTarget = vi.fn(opts.classifyTarget ?? ((_t) => ({ kind: 'ignore' as const })));

    const callbacks = {
        onPieceTap: vi.fn(),
        onPieceDrag: { start: vi.fn(), move: vi.fn(), end: vi.fn(), cancel: vi.fn() },
        onBackgroundPan: { start: vi.fn(), move: vi.fn(), end: vi.fn(), cancel: vi.fn() },
        onPinch: { start: vi.fn(), move: vi.fn(), end: vi.fn() },
        onWheelZoom: vi.fn(),
    };

    let nowValue = 0;
    const nowMock = vi.fn(() => nowValue);
    (nowMock as unknown as { advance: (ms: number) => void }).advance = (ms: number) => { nowValue += ms; };

    const router = new PointerRouter({
        container,
        classifyTarget,
        now: nowMock,
        ...callbacks,
    });

    return {
        container,
        classifyTarget,
        fire: (type, evt) => { for (const cb of handlers[type] ?? []) cb(evt); },
        callbacks,
        nowMock,
        router,
    };
}

describe('PointerRouter — construction & wheel', () => {
    it('attaches container listeners on construction', () => {
        const h = createHarness();
        expect(h.container.addEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
        expect(h.container.addEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
        expect(h.container.addEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
        expect(h.container.addEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
        expect(h.container.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), expect.objectContaining({ passive: false }));
    });

    it('removes listeners on destroy', () => {
        const h = createHarness();
        h.router.destroy();
        expect(h.container.removeEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
        expect(h.container.removeEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
        expect(h.container.removeEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
        expect(h.container.removeEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
        expect(h.container.removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function));
    });

    it('dispatches onWheelZoom for wheel events on a piece target and prevents default', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 1 }) });
        const evt = fakeWheelEvent();
        h.fire('wheel', evt);
        expect(h.callbacks.onWheelZoom).toHaveBeenCalledWith(evt);
        expect(evt.preventDefault).toHaveBeenCalled();
    });

    it('dispatches onWheelZoom for wheel events on a background target and prevents default', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'background' }) });
        const evt = fakeWheelEvent();
        h.fire('wheel', evt);
        expect(h.callbacks.onWheelZoom).toHaveBeenCalledWith(evt);
        expect(evt.preventDefault).toHaveBeenCalled();
    });

    it('does NOT dispatch onWheelZoom or call preventDefault for ignore targets', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'ignore' }) });
        const evt = fakeWheelEvent();
        h.fire('wheel', evt);
        expect(h.callbacks.onWheelZoom).not.toHaveBeenCalled();
        expect(evt.preventDefault).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail (compile error)**

Run: `npx vitest run src/interaction/pointer-router.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the skeleton with types**

Create `src/interaction/pointer-router.ts`:

```ts
/**
 * Single source of truth for container-level pointer events.
 *
 * Owns pointerdown/move/up/cancel/wheel listeners on a container, classifies
 * targets via `classifyTarget`, and emits pre-classified gesture events:
 * piece-tap, piece-drag.{start,move,end,cancel}, background-pan.{...},
 * pinch.{start,move,end}, wheel-zoom.
 *
 * See docs/superpowers/specs/2026-05-01-pointer-router-design.md for the
 * full state machine and arbitration rules.
 */

import type { Point } from '../model/types.js';

export type ClassifyTarget = (target: EventTarget | null) =>
    | { kind: 'piece'; pieceId: number }
    | { kind: 'background' }
    | { kind: 'ignore' };

export interface PointerRouterOptions {
    container: HTMLElement;
    classifyTarget: ClassifyTarget;
    /** Default 8 px. */
    tapThresholdPx?: number;
    /** Default `performance.now`. Override for tests. */
    now?: () => number;

    onPieceTap: (pieceId: number, evt: PointerEvent) => void;
    onPieceDrag: {
        start: (pieceId: number, evt: PointerEvent) => void;
        move: (evt: PointerEvent) => void;
        end: (evt: PointerEvent) => void;
        cancel: () => void;
    };
    onBackgroundPan: {
        start: (evt: PointerEvent) => void;
        move: (evt: PointerEvent) => void;
        end: (evt: PointerEvent) => void;
        cancel: () => void;
    };
    onPinch: {
        start: (a: PointerEvent, b: PointerEvent) => void;
        move: (a: PointerEvent, b: PointerEvent) => void;
        end: () => void;
    };
    onWheelZoom: (evt: WheelEvent) => void;
}

const DEFAULT_TAP_THRESHOLD_PX = 8;
const PINCH_GRACE_MS = 250;

interface TrackedPointer {
    pointerId: number;
    pointerType: string;
    targetKind: 'piece' | 'background';
    pieceId: number | null;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
}

type State =
    | { kind: 'idle' }
    | { kind: 'piece-candidate'; pointerId: number; pieceId: number; startX: number; startY: number }
    | { kind: 'background-candidate'; pointerId: number; startX: number; startY: number }
    | { kind: 'piece-drag'; pointerId: number; pieceId: number; startedAt: number }
    | { kind: 'background-pan'; pointerId: number };

type PinchState =
    | { kind: 'inactive' }
    | { kind: 'active'; a: number; b: number };

export class PointerRouter {
    private container: HTMLElement;
    private classifyTarget: ClassifyTarget;
    private tapThresholdPx: number;
    private now: () => number;
    private callbacks: Pick<PointerRouterOptions,
        'onPieceTap' | 'onPieceDrag' | 'onBackgroundPan' | 'onPinch' | 'onWheelZoom'>;

    private tracked = new Map<number, TrackedPointer>();
    private state: State = { kind: 'idle' };
    private pinch: PinchState = { kind: 'inactive' };

    private boundDown = (e: PointerEvent) => this.onPointerDown(e);
    private boundMove = (e: PointerEvent) => this.onPointerMove(e);
    private boundUp = (e: PointerEvent) => this.onPointerUp(e);
    private boundCancel = (e: PointerEvent) => this.onPointerCancel(e);
    private boundWheel = (e: WheelEvent) => this.onWheel(e);

    constructor(opts: PointerRouterOptions) {
        this.container = opts.container;
        this.classifyTarget = opts.classifyTarget;
        this.tapThresholdPx = opts.tapThresholdPx ?? DEFAULT_TAP_THRESHOLD_PX;
        this.now = opts.now ?? (() => performance.now());
        this.callbacks = {
            onPieceTap: opts.onPieceTap,
            onPieceDrag: opts.onPieceDrag,
            onBackgroundPan: opts.onBackgroundPan,
            onPinch: opts.onPinch,
            onWheelZoom: opts.onWheelZoom,
        };

        this.container.addEventListener('pointerdown', this.boundDown);
        this.container.addEventListener('pointermove', this.boundMove);
        this.container.addEventListener('pointerup', this.boundUp);
        this.container.addEventListener('pointercancel', this.boundCancel);
        this.container.addEventListener('wheel', this.boundWheel, { passive: false });
    }

    destroy(): void {
        this.container.removeEventListener('pointerdown', this.boundDown);
        this.container.removeEventListener('pointermove', this.boundMove);
        this.container.removeEventListener('pointerup', this.boundUp);
        this.container.removeEventListener('pointercancel', this.boundCancel);
        this.container.removeEventListener('wheel', this.boundWheel);
    }

    // --- Wheel ---------------------------------------------------

    private onWheel(evt: WheelEvent): void {
        const cls = this.classifyTarget(evt.target);
        if (cls.kind === 'ignore') return;
        evt.preventDefault();
        this.callbacks.onWheelZoom(evt);
    }

    // --- Pointer (stubs for now, filled in by later tasks) -------

    private onPointerDown(_evt: PointerEvent): void { /* Task 3 */ }
    private onPointerMove(_evt: PointerEvent): void { /* Task 3 */ }
    private onPointerUp(_evt: PointerEvent): void { /* Task 3 */ }
    private onPointerCancel(_evt: PointerEvent): void { /* Task 6 */ }

    // Tracked-pointer + state-machine helpers used by later tasks live here too.
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/interaction/pointer-router.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Run full build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/interaction/pointer-router.ts src/interaction/pointer-router.test.ts
git commit -m "feat(interaction): add PointerRouter skeleton with wheel handling (refs #260)"
```

---

## Task 3: PointerRouter — single-pointer paths (piece-tap, piece-drag, background-pan)

Implement `onPointerDown`, `onPointerMove`, `onPointerUp` for the IDLE → CANDIDATE → DRAG/PAN → IDLE flows, with the 8 px tap threshold. No multi-pointer / pinch logic in this task.

**Files:**
- Modify: `src/interaction/pointer-router.ts`
- Modify: `src/interaction/pointer-router.test.ts`

**Reference state-machine entries (from spec):** the IDLE, PIECE_CANDIDATE, BACKGROUND_CANDIDATE, PIECE_DRAG, BACKGROUND_PAN states and their single-pointer transitions.

- [ ] **Step 1: Write failing tests for piece-tap**

Append to `src/interaction/pointer-router.test.ts`:

```ts
describe('PointerRouter — piece tap', () => {
    it('emits onPieceTap on pointerup before threshold is crossed', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 7 }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 100, clientY: 100 }));
        const upEvt = fakePointerEvent({ pointerId: 1, clientX: 102, clientY: 101 });
        h.fire('pointerup', upEvt);

        expect(h.callbacks.onPieceTap).toHaveBeenCalledWith(7, upEvt);
        expect(h.callbacks.onPieceDrag.start).not.toHaveBeenCalled();
    });

    it('does not capture pointer for a tap', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 7 }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1 }));
        h.fire('pointerup', fakePointerEvent({ pointerId: 1 }));
        expect(h.container.setPointerCapture).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Write failing tests for piece-drag**

Append to the same file:

```ts
describe('PointerRouter — piece drag', () => {
    it('emits onPieceDrag.start when movement crosses tap threshold', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 7 }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 100, clientY: 100 }));
        const moveEvt = fakePointerEvent({ pointerId: 1, clientX: 110, clientY: 100 });
        h.fire('pointermove', moveEvt);

        expect(h.callbacks.onPieceDrag.start).toHaveBeenCalledWith(7, moveEvt);
        expect(h.callbacks.onPieceTap).not.toHaveBeenCalled();
    });

    it('captures pointer at drag start', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 7 }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 42, clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 42, clientX: 20, clientY: 0 }));

        expect(h.container.setPointerCapture).toHaveBeenCalledWith(42);
    });

    it('emits onPieceDrag.move for subsequent moves once dragging', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 7 }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 20, clientY: 0 })); // promote
        const second = fakePointerEvent({ pointerId: 1, clientX: 30, clientY: 0 });
        h.fire('pointermove', second);

        expect(h.callbacks.onPieceDrag.move).toHaveBeenCalledWith(second);
    });

    it('emits onPieceDrag.end and releases capture on pointerup', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 7 }) });
        (h.container.hasPointerCapture as ReturnType<typeof vi.fn>).mockReturnValue(true);
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 20, clientY: 0 })); // promote
        const upEvt = fakePointerEvent({ pointerId: 1, clientX: 30, clientY: 0 });
        h.fire('pointerup', upEvt);

        expect(h.callbacks.onPieceDrag.end).toHaveBeenCalledWith(upEvt);
        expect(h.container.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    it('does not promote when movement stays below threshold', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 7 }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 5, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 7, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 5 }));

        expect(h.callbacks.onPieceDrag.start).not.toHaveBeenCalled();
        expect(h.callbacks.onPieceDrag.move).not.toHaveBeenCalled();
    });

    it('uses Euclidean distance for the threshold check', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 7 }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        // 6,6 ≈ 8.49 px — over the 8 px threshold
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 6, clientY: 6 }));

        expect(h.callbacks.onPieceDrag.start).toHaveBeenCalled();
    });
});
```

- [ ] **Step 3: Write failing tests for background-pan**

Append:

```ts
describe('PointerRouter — background pan', () => {
    it('does not start pan on pointerdown alone', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'background' }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        expect(h.callbacks.onBackgroundPan.start).not.toHaveBeenCalled();
    });

    it('emits onBackgroundPan.start when movement crosses threshold and captures pointer', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'background' }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        const moveEvt = fakePointerEvent({ pointerId: 1, clientX: 20, clientY: 0 });
        h.fire('pointermove', moveEvt);

        expect(h.callbacks.onBackgroundPan.start).toHaveBeenCalledWith(moveEvt);
        expect(h.container.setPointerCapture).toHaveBeenCalledWith(1);
    });

    it('emits onBackgroundPan.move for subsequent moves once panning', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'background' }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 20, clientY: 0 }));
        const second = fakePointerEvent({ pointerId: 1, clientX: 30, clientY: 0 });
        h.fire('pointermove', second);

        expect(h.callbacks.onBackgroundPan.move).toHaveBeenCalledWith(second);
    });

    it('emits onBackgroundPan.end and releases capture on pointerup', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'background' }) });
        (h.container.hasPointerCapture as ReturnType<typeof vi.fn>).mockReturnValue(true);
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 20, clientY: 0 }));
        const upEvt = fakePointerEvent({ pointerId: 1, clientX: 25, clientY: 0 });
        h.fire('pointerup', upEvt);

        expect(h.callbacks.onBackgroundPan.end).toHaveBeenCalledWith(upEvt);
        expect(h.container.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    it('background pointerup before threshold is silent (no event)', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'background' }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointerup', fakePointerEvent({ pointerId: 1, clientX: 2, clientY: 0 }));

        expect(h.callbacks.onBackgroundPan.start).not.toHaveBeenCalled();
        expect(h.callbacks.onBackgroundPan.end).not.toHaveBeenCalled();
        expect(h.callbacks.onPieceTap).not.toHaveBeenCalled();
    });

    it('ignores pointerdown on ignore targets', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'ignore' }) });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 50, clientY: 0 }));
        h.fire('pointerup', fakePointerEvent({ pointerId: 1, clientX: 50, clientY: 0 }));

        expect(h.callbacks.onPieceTap).not.toHaveBeenCalled();
        expect(h.callbacks.onPieceDrag.start).not.toHaveBeenCalled();
        expect(h.callbacks.onBackgroundPan.start).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/interaction/pointer-router.test.ts`
Expected: the new tests fail; previous (Task 2) tests still pass.

- [ ] **Step 5: Implement single-pointer logic**

Replace the empty stubs in `src/interaction/pointer-router.ts`:

```ts
private onPointerDown(evt: PointerEvent): void {
    const cls = this.classifyTarget(evt.target);
    if (cls.kind === 'ignore') return;

    // Track this pointer (used for pinch detection in later tasks).
    this.tracked.set(evt.pointerId, {
        pointerId: evt.pointerId,
        pointerType: evt.pointerType,
        targetKind: cls.kind,
        pieceId: cls.kind === 'piece' ? cls.pieceId : null,
        startX: evt.clientX,
        startY: evt.clientY,
        lastX: evt.clientX,
        lastY: evt.clientY,
    });

    // Only the first pointer of a sequence can become a candidate.
    // (Multi-pointer arbitration arrives in Task 5.)
    if (this.state.kind !== 'idle') return;

    if (cls.kind === 'piece') {
        this.state = {
            kind: 'piece-candidate',
            pointerId: evt.pointerId,
            pieceId: cls.pieceId,
            startX: evt.clientX,
            startY: evt.clientY,
        };
    } else {
        this.state = {
            kind: 'background-candidate',
            pointerId: evt.pointerId,
            startX: evt.clientX,
            startY: evt.clientY,
        };
    }
}

private onPointerMove(evt: PointerEvent): void {
    const tracked = this.tracked.get(evt.pointerId);
    if (tracked) {
        tracked.lastX = evt.clientX;
        tracked.lastY = evt.clientY;
    }

    if (this.state.kind === 'piece-candidate' && evt.pointerId === this.state.pointerId) {
        if (this.exceedsTapThreshold(evt, this.state.startX, this.state.startY)) {
            const { pieceId, pointerId } = this.state;
            this.state = { kind: 'piece-drag', pointerId, pieceId, startedAt: this.now() };
            this.container.setPointerCapture(pointerId);
            this.callbacks.onPieceDrag.start(pieceId, evt);
        }
        return;
    }
    if (this.state.kind === 'background-candidate' && evt.pointerId === this.state.pointerId) {
        if (this.exceedsTapThreshold(evt, this.state.startX, this.state.startY)) {
            const { pointerId } = this.state;
            this.state = { kind: 'background-pan', pointerId };
            this.container.setPointerCapture(pointerId);
            this.callbacks.onBackgroundPan.start(evt);
        }
        return;
    }
    if (this.state.kind === 'piece-drag' && evt.pointerId === this.state.pointerId) {
        this.callbacks.onPieceDrag.move(evt);
        return;
    }
    if (this.state.kind === 'background-pan' && evt.pointerId === this.state.pointerId) {
        this.callbacks.onBackgroundPan.move(evt);
        return;
    }
}

private onPointerUp(evt: PointerEvent): void {
    this.tracked.delete(evt.pointerId);

    if (this.state.kind === 'piece-candidate' && evt.pointerId === this.state.pointerId) {
        const { pieceId } = this.state;
        this.state = { kind: 'idle' };
        this.callbacks.onPieceTap(pieceId, evt);
        return;
    }
    if (this.state.kind === 'background-candidate' && evt.pointerId === this.state.pointerId) {
        this.state = { kind: 'idle' };
        return; // silent — no onBackgroundTap in vocabulary yet
    }
    if (this.state.kind === 'piece-drag' && evt.pointerId === this.state.pointerId) {
        this.releaseCapture(evt.pointerId);
        this.state = { kind: 'idle' };
        this.callbacks.onPieceDrag.end(evt);
        return;
    }
    if (this.state.kind === 'background-pan' && evt.pointerId === this.state.pointerId) {
        this.releaseCapture(evt.pointerId);
        this.state = { kind: 'idle' };
        this.callbacks.onBackgroundPan.end(evt);
        return;
    }
}

private exceedsTapThreshold(evt: PointerEvent, startX: number, startY: number): boolean {
    const dx = evt.clientX - startX;
    const dy = evt.clientY - startY;
    return dx * dx + dy * dy >= this.tapThresholdPx * this.tapThresholdPx;
}

private releaseCapture(pointerId: number): void {
    if (this.container.hasPointerCapture(pointerId)) {
        this.container.releasePointerCapture(pointerId);
    }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/interaction/pointer-router.test.ts`
Expected: all PASS.

- [ ] **Step 7: Run full build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/interaction/pointer-router.ts src/interaction/pointer-router.test.ts
git commit -m "feat(interaction): PointerRouter single-pointer paths (refs #260)"
```

---

## Task 4: PointerRouter — pinch from idle, locked pair, end semantics

Add the multi-touch path: when 2 `pointerType === 'touch'` pointers are tracked from non-`ignore` targets, start a pinch with the locked pair. Pinch.move on either pair member's move; Pinch.end when either lifts. 3rd+ touches are tracked but ignored for pinch purposes. Mouse/pen never participate.

This task only covers pinch starting from the IDLE state — pinch arbitration with active drag/pan/candidate comes in Task 5.

**Files:**
- Modify: `src/interaction/pointer-router.ts`
- Modify: `src/interaction/pointer-router.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/interaction/pointer-router.test.ts`:

```ts
describe('PointerRouter — pinch (from idle)', () => {
    function pieceClassifier(): ClassifyTarget {
        return () => ({ kind: 'piece', pieceId: 1 });
    }

    it('starts a pinch when a 2nd touch pointer lands (both touches)', () => {
        const h = createHarness({ classifyTarget: pieceClassifier() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));

        expect(h.callbacks.onPinch.start).toHaveBeenCalledTimes(1);
        const [a, b] = h.callbacks.onPinch.start.mock.calls[0];
        expect([a.pointerId, b.pointerId].sort()).toEqual([1, 2]);
    });

    it('does not start a pinch from mouse + touch', () => {
        const h = createHarness({ classifyTarget: pieceClassifier() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0 }));
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));

        expect(h.callbacks.onPinch.start).not.toHaveBeenCalled();
    });

    it('emits onPinch.move when either pair member moves', () => {
        const h = createHarness({ classifyTarget: pieceClassifier() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 5, clientY: 0 }));

        expect(h.callbacks.onPinch.move).toHaveBeenCalledTimes(1);
        const [a, b] = h.callbacks.onPinch.move.mock.calls[0];
        // Both args are the latest known positions of the locked pair
        expect((a.pointerId === 1 ? a.clientX : b.clientX)).toBe(5);
    });

    it('locks the pair: a 3rd touch does not replace pair members', () => {
        const h = createHarness({ classifyTarget: pieceClassifier() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));
        h.callbacks.onPinch.start.mockClear();

        h.fire('pointerdown', fakePointerEvent({ pointerId: 3, pointerType: 'touch', clientX: 200, clientY: 0 }));
        expect(h.callbacks.onPinch.start).not.toHaveBeenCalled();

        h.fire('pointermove', fakePointerEvent({ pointerId: 3, pointerType: 'touch', clientX: 210, clientY: 0 }));
        expect(h.callbacks.onPinch.move).not.toHaveBeenCalled();
    });

    it('ends pinch when either pair member lifts', () => {
        const h = createHarness({ classifyTarget: pieceClassifier() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));
        h.fire('pointerup', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));

        expect(h.callbacks.onPinch.end).toHaveBeenCalledTimes(1);
    });

    it('lifting a non-pair-member 3rd touch does not end pinch', () => {
        const h = createHarness({ classifyTarget: pieceClassifier() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));
        h.fire('pointerdown', fakePointerEvent({ pointerId: 3, pointerType: 'touch', clientX: 200, clientY: 0 }));
        h.fire('pointerup', fakePointerEvent({ pointerId: 3, pointerType: 'touch', clientX: 200, clientY: 0 }));

        expect(h.callbacks.onPinch.end).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/interaction/pointer-router.test.ts`
Expected: the new pinch tests fail.

- [ ] **Step 3: Implement pinch from idle**

Modify `onPointerDown`, `onPointerMove`, and `onPointerUp` in `src/interaction/pointer-router.ts` to handle pinch. Add the helper `tryStartPinch` and the pinch-pair logic.

Replace `onPointerDown` body (additive — keep existing single-pointer logic, add pinch attempt at the top):

```ts
private onPointerDown(evt: PointerEvent): void {
    const cls = this.classifyTarget(evt.target);
    if (cls.kind === 'ignore') return;

    this.tracked.set(evt.pointerId, {
        pointerId: evt.pointerId,
        pointerType: evt.pointerType,
        targetKind: cls.kind,
        pieceId: cls.kind === 'piece' ? cls.pieceId : null,
        startX: evt.clientX,
        startY: evt.clientY,
        lastX: evt.clientX,
        lastY: evt.clientY,
    });

    // Try to start a pinch first — a 2nd touch landing supersedes any
    // single-pointer candidate logic.
    if (this.tryStartPinch(evt)) return;

    if (this.state.kind !== 'idle') return;

    if (cls.kind === 'piece') {
        this.state = {
            kind: 'piece-candidate',
            pointerId: evt.pointerId, pieceId: cls.pieceId,
            startX: evt.clientX, startY: evt.clientY,
        };
    } else {
        this.state = {
            kind: 'background-candidate',
            pointerId: evt.pointerId,
            startX: evt.clientX, startY: evt.clientY,
        };
    }
}
```

Add helpers in the class:

```ts
/**
 * Returns true and starts a pinch (with the locked pair = first two
 * touch pointers tracked) when the just-arrived pointerdown brings
 * the touch-pointer count to 2 from 1. Returns false otherwise.
 *
 * Single-pointer state cleanup (cancel-with-grace etc.) is added in
 * Task 5 — for now the only pre-condition is `state.kind === 'idle'`.
 */
private tryStartPinch(_evt: PointerEvent): boolean {
    if (this.pinch.kind !== 'inactive') return false;
    if (this.state.kind !== 'idle') return false;

    const touches = this.touchPointers();
    if (touches.length < 2) return false;

    const [a, b] = touches.slice(0, 2);
    this.pinch = { kind: 'active', a: a.pointerId, b: b.pointerId };
    this.callbacks.onPinch.start(this.toEvent(a), this.toEvent(b));
    return true;
}

private touchPointers(): TrackedPointer[] {
    return [...this.tracked.values()].filter(t => t.pointerType === 'touch');
}

/** Synthesize a PointerEvent-shape object from a TrackedPointer's last position. */
private toEvent(t: TrackedPointer): PointerEvent {
    return {
        pointerId: t.pointerId,
        pointerType: t.pointerType,
        clientX: t.lastX,
        clientY: t.lastY,
    } as PointerEvent;
}
```

Augment `onPointerMove` (add pinch handling — appended branches):

```ts
private onPointerMove(evt: PointerEvent): void {
    const tracked = this.tracked.get(evt.pointerId);
    if (tracked) {
        tracked.lastX = evt.clientX;
        tracked.lastY = evt.clientY;
    }

    // Single-pointer paths (unchanged from Task 3): piece-candidate,
    // background-candidate, piece-drag, background-pan.
    if (this.state.kind === 'piece-candidate' && evt.pointerId === this.state.pointerId) {
        if (this.exceedsTapThreshold(evt, this.state.startX, this.state.startY)) {
            const { pieceId, pointerId } = this.state;
            this.state = { kind: 'piece-drag', pointerId, pieceId, startedAt: this.now() };
            this.container.setPointerCapture(pointerId);
            this.callbacks.onPieceDrag.start(pieceId, evt);
        }
    } else if (this.state.kind === 'background-candidate' && evt.pointerId === this.state.pointerId) {
        if (this.exceedsTapThreshold(evt, this.state.startX, this.state.startY)) {
            const { pointerId } = this.state;
            this.state = { kind: 'background-pan', pointerId };
            this.container.setPointerCapture(pointerId);
            this.callbacks.onBackgroundPan.start(evt);
        }
    } else if (this.state.kind === 'piece-drag' && evt.pointerId === this.state.pointerId) {
        this.callbacks.onPieceDrag.move(evt);
    } else if (this.state.kind === 'background-pan' && evt.pointerId === this.state.pointerId) {
        this.callbacks.onBackgroundPan.move(evt);
    }

    // Pinch path — pair member moved.
    if (this.pinch.kind === 'active' &&
        (evt.pointerId === this.pinch.a || evt.pointerId === this.pinch.b)) {
        const ta = this.tracked.get(this.pinch.a);
        const tb = this.tracked.get(this.pinch.b);
        if (ta && tb) this.callbacks.onPinch.move(this.toEvent(ta), this.toEvent(tb));
    }
}
```

Augment `onPointerUp` (add pinch end):

```ts
private onPointerUp(evt: PointerEvent): void {
    // Pinch end fires BEFORE we untrack, so toEvent has fresh data
    // (and so the pinch-pair check sees the lifting pointer).
    const wasPinchPair = this.pinch.kind === 'active' &&
        (evt.pointerId === this.pinch.a || evt.pointerId === this.pinch.b);

    this.tracked.delete(evt.pointerId);

    if (this.state.kind === 'piece-candidate' && evt.pointerId === this.state.pointerId) {
        const { pieceId } = this.state;
        this.state = { kind: 'idle' };
        this.callbacks.onPieceTap(pieceId, evt);
    } else if (this.state.kind === 'background-candidate' && evt.pointerId === this.state.pointerId) {
        this.state = { kind: 'idle' };
    } else if (this.state.kind === 'piece-drag' && evt.pointerId === this.state.pointerId) {
        this.releaseCapture(evt.pointerId);
        this.state = { kind: 'idle' };
        this.callbacks.onPieceDrag.end(evt);
    } else if (this.state.kind === 'background-pan' && evt.pointerId === this.state.pointerId) {
        this.releaseCapture(evt.pointerId);
        this.state = { kind: 'idle' };
        this.callbacks.onBackgroundPan.end(evt);
    }

    if (wasPinchPair) {
        this.pinch = { kind: 'inactive' };
        this.callbacks.onPinch.end();
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/interaction/pointer-router.test.ts`
Expected: all PASS.

- [ ] **Step 5: Run full build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/interaction/pointer-router.ts src/interaction/pointer-router.test.ts
git commit -m "feat(interaction): PointerRouter pinch with locked pair (refs #260)"
```

---

## Task 5: PointerRouter — pinch arbitration with active drag, pan, and candidates

Implement the cancel-or-concurrent rules when a 2nd touch lands while a single-pointer gesture is in flight:

- `piece-candidate` → discard candidate, start pinch.
- `background-candidate` → discard candidate, start pinch.
- `piece-drag` and elapsed-since-promotion < 250 ms → cancel drag, start pinch.
- `piece-drag` and elapsed ≥ 250 ms → keep drag, start pinch concurrently. From here, drag-finger moves emit BOTH `onPieceDrag.move` AND `onPinch.move`.
- `background-pan` → cancel pan, start pinch (no grace).

When the drag-finger lifts during concurrent drag+pinch: emit `onPieceDrag.end` then `onPinch.end`. When the OTHER pinch finger lifts: emit `onPinch.end`; drag continues alone.

**Files:**
- Modify: `src/interaction/pointer-router.ts`
- Modify: `src/interaction/pointer-router.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
describe('PointerRouter — pinch arbitration with active gestures', () => {
    function piece(): ClassifyTarget { return () => ({ kind: 'piece', pieceId: 1 }); }
    function background(): ClassifyTarget { return () => ({ kind: 'background' }); }

    it('discards a piece-candidate when 2nd touch lands; starts pinch', () => {
        const h = createHarness({ classifyTarget: piece() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));
        h.fire('pointerup', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));

        expect(h.callbacks.onPieceTap).not.toHaveBeenCalled();
        expect(h.callbacks.onPinch.start).toHaveBeenCalled();
    });

    it('discards a background-candidate when 2nd touch lands; starts pinch', () => {
        const h = createHarness({ classifyTarget: background() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));

        expect(h.callbacks.onBackgroundPan.start).not.toHaveBeenCalled();
        expect(h.callbacks.onPinch.start).toHaveBeenCalled();
    });

    it('cancels piece-drag and starts pinch when 2nd touch lands inside grace window', () => {
        const h = createHarness({ classifyTarget: piece() });
        (h.container.hasPointerCapture as ReturnType<typeof vi.fn>).mockReturnValue(true);
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 0 }));
        // promote → drag-startedAt = 0 (nowMock)
        (h.nowMock as unknown as { advance: (ms: number) => void }).advance(100); // < 250ms
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));

        expect(h.callbacks.onPieceDrag.cancel).toHaveBeenCalledTimes(1);
        expect(h.container.releasePointerCapture).toHaveBeenCalledWith(1);
        expect(h.callbacks.onPinch.start).toHaveBeenCalledTimes(1);
    });

    it('keeps piece-drag and starts pinch concurrently when 2nd touch lands after grace', () => {
        const h = createHarness({ classifyTarget: piece() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 0 })); // promote
        (h.nowMock as unknown as { advance: (ms: number) => void }).advance(300); // ≥ 250ms
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));

        expect(h.callbacks.onPieceDrag.cancel).not.toHaveBeenCalled();
        expect(h.callbacks.onPinch.start).toHaveBeenCalledTimes(1);
    });

    it('emits onPieceDrag.move AND onPinch.move when drag-finger moves during concurrent', () => {
        const h = createHarness({ classifyTarget: piece() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 0 })); // promote
        (h.nowMock as unknown as { advance: (ms: number) => void }).advance(300);
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));
        h.callbacks.onPieceDrag.move.mockClear();
        h.callbacks.onPinch.move.mockClear();

        h.fire('pointermove', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 30, clientY: 0 }));

        expect(h.callbacks.onPieceDrag.move).toHaveBeenCalledTimes(1);
        expect(h.callbacks.onPinch.move).toHaveBeenCalledTimes(1);
    });

    it('drag-finger pointerup during concurrent: emits onPieceDrag.end then onPinch.end', () => {
        const h = createHarness({ classifyTarget: piece() });
        (h.container.hasPointerCapture as ReturnType<typeof vi.fn>).mockReturnValue(true);
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 0 }));
        (h.nowMock as unknown as { advance: (ms: number) => void }).advance(300);
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));

        h.fire('pointerup', fakePointerEvent({ pointerId: 1, pointerType: 'touch' }));

        expect(h.callbacks.onPieceDrag.end).toHaveBeenCalledTimes(1);
        expect(h.callbacks.onPinch.end).toHaveBeenCalledTimes(1);
    });

    it('non-drag pinch finger pointerup during concurrent: emits onPinch.end; drag continues', () => {
        const h = createHarness({ classifyTarget: piece() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 0 }));
        (h.nowMock as unknown as { advance: (ms: number) => void }).advance(300);
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));

        h.fire('pointerup', fakePointerEvent({ pointerId: 2, pointerType: 'touch' }));

        expect(h.callbacks.onPinch.end).toHaveBeenCalledTimes(1);
        expect(h.callbacks.onPieceDrag.end).not.toHaveBeenCalled();

        // Drag still alive
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 30, clientY: 0 }));
        expect(h.callbacks.onPieceDrag.move).toHaveBeenCalled();
    });

    it('cancels background-pan and starts pinch when 2nd touch lands (no grace)', () => {
        const h = createHarness({ classifyTarget: background() });
        (h.container.hasPointerCapture as ReturnType<typeof vi.fn>).mockReturnValue(true);
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 0 })); // promote pan
        (h.nowMock as unknown as { advance: (ms: number) => void }).advance(5000); // doesn't matter
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));

        expect(h.callbacks.onBackgroundPan.cancel).toHaveBeenCalledTimes(1);
        expect(h.container.releasePointerCapture).toHaveBeenCalledWith(1);
        expect(h.callbacks.onPinch.start).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/interaction/pointer-router.test.ts`
Expected: the new arbitration tests fail.

- [ ] **Step 3: Update `tryStartPinch` to handle arbitration**

Replace the body of `tryStartPinch`:

```ts
private tryStartPinch(_evt: PointerEvent): boolean {
    if (this.pinch.kind !== 'inactive') return false;

    const touches = this.touchPointers();
    if (touches.length < 2) return false;

    // Resolve the existing single-pointer state first.
    if (this.state.kind === 'piece-candidate') {
        this.state = { kind: 'idle' };
    } else if (this.state.kind === 'background-candidate') {
        this.state = { kind: 'idle' };
    } else if (this.state.kind === 'piece-drag') {
        const elapsed = this.now() - this.state.startedAt;
        if (elapsed < PINCH_GRACE_MS) {
            const { pointerId } = this.state;
            this.releaseCapture(pointerId);
            this.state = { kind: 'idle' };
            this.callbacks.onPieceDrag.cancel();
        }
        // else: drag survives concurrently (state stays piece-drag)
    } else if (this.state.kind === 'background-pan') {
        const { pointerId } = this.state;
        this.releaseCapture(pointerId);
        this.state = { kind: 'idle' };
        this.callbacks.onBackgroundPan.cancel();
    }

    const [a, b] = touches.slice(0, 2);
    this.pinch = { kind: 'active', a: a.pointerId, b: b.pointerId };
    this.callbacks.onPinch.start(this.toEvent(a), this.toEvent(b));
    return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/interaction/pointer-router.test.ts`
Expected: all PASS.

- [ ] **Step 5: Run full build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/interaction/pointer-router.ts src/interaction/pointer-router.test.ts
git commit -m "feat(interaction): PointerRouter pinch arbitration (refs #260)"
```

---

## Task 6: PointerRouter — `pointercancel` paths

When the OS yanks a pointer (e.g. the user backgrounds the tab), the router emits a cancel for any in-flight gesture. Per spec:

- `piece-candidate` / `background-candidate` → silent return to IDLE.
- `piece-drag` → emit `onPieceDrag.cancel`, release capture.
- `background-pan` → emit `onBackgroundPan.cancel`, release capture.
- pinch pair member → emit `onPinch.end` (no separate cancel for pinch).
- Concurrent drag + pinch: drag-finger cancel emits `onPieceDrag.cancel` + `onPinch.end`; non-drag pair-member cancel emits `onPinch.end` and drag survives.

**Files:**
- Modify: `src/interaction/pointer-router.ts`
- Modify: `src/interaction/pointer-router.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
describe('PointerRouter — pointercancel', () => {
    function piece(): ClassifyTarget { return () => ({ kind: 'piece', pieceId: 1 }); }
    function background(): ClassifyTarget { return () => ({ kind: 'background' }); }

    it('clears piece-candidate silently on pointercancel', () => {
        const h = createHarness({ classifyTarget: piece() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointercancel', fakePointerEvent({ pointerId: 1 }));
        expect(h.callbacks.onPieceTap).not.toHaveBeenCalled();
        expect(h.callbacks.onPieceDrag.cancel).not.toHaveBeenCalled();
    });

    it('emits onPieceDrag.cancel and releases capture on pointercancel during drag', () => {
        const h = createHarness({ classifyTarget: piece() });
        (h.container.hasPointerCapture as ReturnType<typeof vi.fn>).mockReturnValue(true);
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 20, clientY: 0 }));
        h.fire('pointercancel', fakePointerEvent({ pointerId: 1 }));

        expect(h.callbacks.onPieceDrag.cancel).toHaveBeenCalledTimes(1);
        expect(h.container.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    it('emits onBackgroundPan.cancel and releases capture on pointercancel during pan', () => {
        const h = createHarness({ classifyTarget: background() });
        (h.container.hasPointerCapture as ReturnType<typeof vi.fn>).mockReturnValue(true);
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 20, clientY: 0 }));
        h.fire('pointercancel', fakePointerEvent({ pointerId: 1 }));

        expect(h.callbacks.onBackgroundPan.cancel).toHaveBeenCalledTimes(1);
        expect(h.container.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    it('emits onPinch.end when a pair member is cancelled', () => {
        const h = createHarness({ classifyTarget: piece() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));
        h.fire('pointercancel', fakePointerEvent({ pointerId: 2, pointerType: 'touch' }));

        expect(h.callbacks.onPinch.end).toHaveBeenCalledTimes(1);
    });

    it('concurrent drag+pinch: cancel on drag-finger emits onPieceDrag.cancel + onPinch.end', () => {
        const h = createHarness({ classifyTarget: piece() });
        h.fire('pointerdown', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
        h.fire('pointermove', fakePointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 0 }));
        (h.nowMock as unknown as { advance: (ms: number) => void }).advance(300);
        h.fire('pointerdown', fakePointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 }));

        h.fire('pointercancel', fakePointerEvent({ pointerId: 1, pointerType: 'touch' }));

        expect(h.callbacks.onPieceDrag.cancel).toHaveBeenCalledTimes(1);
        expect(h.callbacks.onPinch.end).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/interaction/pointer-router.test.ts`
Expected: cancel tests fail.

- [ ] **Step 3: Implement `onPointerCancel`**

Add to `src/interaction/pointer-router.ts`:

```ts
private onPointerCancel(evt: PointerEvent): void {
    const wasPinchPair = this.pinch.kind === 'active' &&
        (evt.pointerId === this.pinch.a || evt.pointerId === this.pinch.b);

    this.tracked.delete(evt.pointerId);

    if (this.state.kind === 'piece-candidate' && evt.pointerId === this.state.pointerId) {
        this.state = { kind: 'idle' };
    } else if (this.state.kind === 'background-candidate' && evt.pointerId === this.state.pointerId) {
        this.state = { kind: 'idle' };
    } else if (this.state.kind === 'piece-drag' && evt.pointerId === this.state.pointerId) {
        this.releaseCapture(evt.pointerId);
        this.state = { kind: 'idle' };
        this.callbacks.onPieceDrag.cancel();
    } else if (this.state.kind === 'background-pan' && evt.pointerId === this.state.pointerId) {
        this.releaseCapture(evt.pointerId);
        this.state = { kind: 'idle' };
        this.callbacks.onBackgroundPan.cancel();
    }

    if (wasPinchPair) {
        this.pinch = { kind: 'inactive' };
        this.callbacks.onPinch.end();
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/interaction/pointer-router.test.ts`
Expected: all PASS.

- [ ] **Step 5: Run full build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/interaction/pointer-router.ts src/interaction/pointer-router.test.ts
git commit -m "feat(interaction): PointerRouter pointercancel handling (refs #260)"
```

---

## Task 7: ViewportController — expose gesture-handler public methods

`PointerRouter` needs to call `viewportController.handlePanStart(evt)`, `handlePanMove`, `handlePanEnd`, `handlePinchStart(a, b)`, `handlePinchMove(a, b)`, `handlePinchEnd`, `handleWheel(evt)`. Today these are private and entangled with the internal pan/touch tracking state.

This task makes the methods public, refactors internals so the existing private listeners delegate to them, and adds focused tests for the new public surface. Backward compatibility: the constructor still accepts the existing options shape; `setup-drag.ts` and `main.ts` are not yet touched.

**Files:**
- Modify: `src/interaction/viewport-controller.ts`
- Modify: `src/interaction/viewport-controller.test.ts`

- [ ] **Step 1: Write failing tests for the new public methods**

Append to `src/interaction/viewport-controller.test.ts`:

```ts
describe('ViewportController — public gesture handlers', () => {
    function setup() {
        const transform = new ViewportTransform();
        const onChanged = vi.fn();
        // Use the existing options ctor; we'll only call public handlers here.
        const container = document.createElement('div');
        const vc = new ViewportController({
            container,
            transform,
            onViewportChanged: onChanged,
            isPieceElement: () => false,
        });
        return { vc, transform, onChanged };
    }

    it('handlePanStart + handlePanMove translates the transform by the pointer delta', () => {
        const { vc, transform, onChanged } = setup();
        vc.handlePanStart(fakePointerEvent({ clientX: 100, clientY: 200 }));
        vc.handlePanMove(fakePointerEvent({ clientX: 110, clientY: 205 }));
        expect(transform.offset).toEqual({ x: 10, y: 5 });
        expect(onChanged).toHaveBeenCalled();
    });

    it('handlePinchStart + handlePinchMove zooms by the distance ratio', () => {
        const { vc, transform } = setup();
        vc.handlePinchStart(
            fakePointerEvent({ pointerId: 1, clientX: 100, clientY: 100 }),
            fakePointerEvent({ pointerId: 2, clientX: 200, clientY: 100 }),
        );
        vc.handlePinchMove(
            fakePointerEvent({ pointerId: 1, clientX: 100, clientY: 100 }),
            fakePointerEvent({ pointerId: 2, clientX: 300, clientY: 100 }),
        );
        // distance went from 100 → 200, factor 2 → scale doubled
        expect(transform.scale).toBeCloseTo(2.0, 5);
    });

    it('handlePanEnd is a no-op (pure state cleanup)', () => {
        const { vc } = setup();
        expect(() => vc.handlePanEnd()).not.toThrow();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/interaction/viewport-controller.test.ts`
Expected: FAIL — the new methods don't exist yet.

- [ ] **Step 3: Add public methods alongside the existing private ones**

In `src/interaction/viewport-controller.ts`, add new public methods that contain the math currently embedded in `handlePointerDown` / `handlePointerMove`. The old private methods stay (they keep doing pointer-tracking and delegating to the new methods) — this keeps Task 7 backward-compatible.

Add these public methods to the class:

```ts
/**
 * Begin tracking a pan from this pointer's position. Call when a
 * `pointerdown` (or PointerRouter pan-start) lands on background.
 */
handlePanStart(evt: PointerEvent): void {
    this.panLastPoint = { x: evt.clientX, y: evt.clientY };
}

/**
 * Apply a pan delta from the previous pointer position to the current one.
 */
handlePanMove(evt: PointerEvent): void {
    if (!this.panLastPoint) return;
    const dx = evt.clientX - this.panLastPoint.x;
    const dy = evt.clientY - this.panLastPoint.y;
    this.panLastPoint = { x: evt.clientX, y: evt.clientY };
    this.transform.pan({ x: dx, y: dy });
    this.onViewportChanged();
}

/** Reset pan tracking; safe to call regardless of state. */
handlePanEnd(): void {
    this.panLastPoint = null;
}

/**
 * Anchor a pinch with the given two pointer positions. Subsequent
 * `handlePinchMove` calls compute zoom factor + midpoint translation
 * relative to this anchor.
 */
handlePinchStart(a: PointerEvent, b: PointerEvent): void {
    const ta = { id: a.pointerId, x: a.clientX, y: a.clientY };
    const tb = { id: b.pointerId, x: b.clientX, y: b.clientY };
    this.lastPinchDist = touchDistance(ta, tb);
    this.lastPinchMidpoint = touchMidpoint(ta, tb);
}

handlePinchMove(a: PointerEvent, b: PointerEvent): void {
    if (this.lastPinchDist === null || this.lastPinchMidpoint === null) return;
    const ta = { id: a.pointerId, x: a.clientX, y: a.clientY };
    const tb = { id: b.pointerId, x: b.clientX, y: b.clientY };
    const newDist = touchDistance(ta, tb);
    const newMidpoint = touchMidpoint(ta, tb);

    const factor = newDist / this.lastPinchDist;
    if (factor !== 0 && isFinite(factor)) this.transform.zoom(factor, newMidpoint);

    const panDx = newMidpoint.x - this.lastPinchMidpoint.x;
    const panDy = newMidpoint.y - this.lastPinchMidpoint.y;
    this.transform.pan({ x: panDx, y: panDy });

    this.lastPinchDist = newDist;
    this.lastPinchMidpoint = newMidpoint;
    this.onViewportChanged();
}

handlePinchEnd(): void {
    this.lastPinchDist = null;
    this.lastPinchMidpoint = null;
}

/** Public accessor for `handleWheel` (was already private). */
handleWheel(evt: WheelEvent): void {
    if (!this.isBackgroundElement(evt.target) && !this.isPieceElement(evt.target)) return;
    evt.preventDefault();
    const delta = Math.max(-50, Math.min(50, evt.deltaY));
    const factor = 1 - delta * 0.005;
    this.transform.zoom(factor, { x: evt.clientX, y: evt.clientY });
    this.onViewportChanged();
}
```

(Replace the existing `private handleWheel` with this `public` version. Update the `boundWheel` field's signature accordingly.)

Inside the existing private `handlePointerDown` / `handlePointerMove`, replace the inline pan/pinch math with calls to the new public methods:

```ts
private handlePointerDown(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
        this.activeTouches.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
        if (this.activeTouches.size === 2) {
            const touches = Array.from(this.activeTouches.values());
            this.handlePinchStart(
                fakeEventFromTouch(touches[0]), fakeEventFromTouch(touches[1]),
            );
            this.panPointerId = null;
            this.panLastPoint = null;
            return;
        }
    }
    if (!this.isBackgroundElement(e.target)) return;
    if (this.panPointerId === null && this.activeTouches.size < 2) {
        this.panPointerId = e.pointerId;
        this.handlePanStart(e);
        this.container.setPointerCapture(e.pointerId);
    }
}

private handlePointerMove(e: PointerEvent): void {
    if (e.pointerType === 'touch' && this.activeTouches.has(e.pointerId)) {
        this.activeTouches.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
        if (this.activeTouches.size === 2) {
            const touches = Array.from(this.activeTouches.values());
            this.handlePinchMove(
                fakeEventFromTouch(touches[0]), fakeEventFromTouch(touches[1]),
            );
            return;
        }
    }
    if (this.panPointerId === e.pointerId && this.panLastPoint) {
        this.handlePanMove(e);
    }
}
```

Add a small helper at module level:

```ts
function fakeEventFromTouch(t: { id: number; x: number; y: number }): PointerEvent {
    return { pointerId: t.id, clientX: t.x, clientY: t.y, pointerType: 'touch' } as PointerEvent;
}
```

`handlePointerUp` also clears `panLastPoint` via `handlePanEnd()` and calls `handlePinchEnd()` when count drops below 2 — replace its body's "End pan" / "if we were in pinch mode" branches with calls to the new public methods.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/interaction/viewport-controller.test.ts`
Expected: all PASS, including the existing pan/pinch tests.

- [ ] **Step 5: Run full build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/interaction/viewport-controller.ts src/interaction/viewport-controller.test.ts
git commit -m "refactor(interaction): expose gesture-handler public methods on ViewportController (refs #260)"
```

---

## Task 8: New `setup-interaction.ts` orchestrator

Build the new factory function. It constructs `PointerRouter`, `DragController`, `ViewportController`, `AutoPanController`, and wires them via the router's hooks.

**Files:**
- Create: `src/interaction/setup-interaction.ts`
- Create: `src/interaction/setup-interaction.test.ts`
- Modify: `src/interaction/index.ts` — re-export `setupInteraction`, `PointerRouter`, `ClassifyTarget`.

- [ ] **Step 1: Write a focused integration test**

Create `src/interaction/setup-interaction.test.ts`. The bulk of the gesture-classification logic is covered in `pointer-router.test.ts`; this file only verifies the wiring. Keep it concise (~150 LOC).

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupInteraction } from './setup-interaction.js';
import { ViewportTransform } from './viewport-transform.js';
import { SelectionManager } from './selection-manager.js';
import type { Renderer, PiecePointerDownCallback } from '../renderer/types.js';
import type { GameState, PieceGroup } from '../model/types.js';

vi.mock('../ui/offset-drag.js', () => ({ loadOffsetDragPreference: vi.fn(() => false) }));

beforeEach(() => {
    globalThis.requestAnimationFrame = vi.fn(() => 1);
    globalThis.cancelAnimationFrame = vi.fn();
});

function makeGroup(id: number, pieceIds: number[]): PieceGroup {
    const pieces = new Map<number, { x: number; y: number }>();
    for (const pid of pieceIds) pieces.set(pid, { x: 0, y: 0 });
    return { id, pieces, position: { x: 0, y: 0 }, rotation: 0 };
}

function makeState(groups: PieceGroup[]): GameState {
    return {
        groups,
        gridSize: { rows: 1, cols: 1 },
        imageSize: { width: 100, height: 100 },
        cutStyle: 'classic',
    } as GameState;
}

function fakePointerEvent(o: Partial<PointerEvent> = {}): PointerEvent {
    return {
        pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, target: null,
        ...o,
    } as PointerEvent;
}

function createFakeRenderer(): Renderer & { fireOnPiece(id: number, e: PointerEvent): void } {
    return {
        init: vi.fn(),
        renderState: vi.fn(),
        bringGroupToFront: vi.fn(),
        setViewportTransform: vi.fn(),
        enableViewportTransition: vi.fn(),
        disableViewportTransition: vi.fn(),
        setGroupDragging: vi.fn(),
        setGroupSelected: vi.fn(),
        pieceIdFromTarget: vi.fn((t) => (t as { _pieceId?: number } | null)?._pieceId ?? null),
        onPiecePointerDown(_cb: PiecePointerDownCallback) { /* legacy, unused by setupInteraction */ },
        fireOnPiece() { /* not used */ },
    } as unknown as Renderer & { fireOnPiece(id: number, e: PointerEvent): void };
}

describe('setupInteraction', () => {
    it('cleanup() removes container listeners', () => {
        const container = document.createElement('div');
        const remove = vi.spyOn(container, 'removeEventListener');
        const cleanup = setupInteraction({
            container,
            renderer: createFakeRenderer(),
            viewportTransform: new ViewportTransform(),
            getState: () => makeState([makeGroup(1, [1])]),
            onStateChanged: vi.fn(),
            onDrop: vi.fn(),
            onViewportChanged: vi.fn(),
        });
        cleanup();
        expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function));
        expect(remove).toHaveBeenCalledWith('wheel', expect.any(Function));
    });

    it('a piece tap in select-mode toggles selection without moving the group', () => {
        const container = document.createElement('div');
        const renderer = createFakeRenderer();
        const selectionManager = new SelectionManager();
        selectionManager.toolActive = true;
        const onStateChanged = vi.fn();
        const state = makeState([makeGroup(7, [3])]);

        setupInteraction({
            container,
            renderer,
            viewportTransform: new ViewportTransform(),
            getState: () => state,
            onStateChanged,
            onDrop: vi.fn(),
            onViewportChanged: vi.fn(),
            selectionManager,
        });

        const pieceTarget = { _pieceId: 3 };
        // Pointerdown + pointerup with no movement = tap
        container.dispatchEvent(new Event('pointerdown')); // can't easily synth full PointerEvent; use addEventListener spy if needed
        // Use the captured listener directly:
        const downCb = (container.addEventListener as unknown as { mock: { calls: [string, EventListener][] } })
            .mock.calls.find(([t]) => t === 'pointerdown')![1] as (e: PointerEvent) => void;
        const upCb = (container.addEventListener as unknown as { mock: { calls: [string, EventListener][] } })
            .mock.calls.find(([t]) => t === 'pointerup')![1] as (e: PointerEvent) => void;
        downCb(fakePointerEvent({ target: pieceTarget as unknown as EventTarget, clientX: 100, clientY: 100 }));
        upCb(fakePointerEvent({ target: pieceTarget as unknown as EventTarget, clientX: 101, clientY: 100 }));

        expect(selectionManager.isSelected(7)).toBe(true);
        expect(renderer.setGroupSelected).toHaveBeenCalledWith(7, true);
    });
});
```

(This pattern uses `vi.spyOn` on a real DOM container; for tests requiring full event-listener capture across types, use the same pattern as `pointer-router.test.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/interaction/setup-interaction.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `setup-interaction.ts`**

Create `src/interaction/setup-interaction.ts` based on the wire-up sketch in the spec ("setup-interaction.ts (replaces setup-drag.ts)" section). Full file:

```ts
/**
 * Wire PointerRouter + DragController + ViewportController + AutoPanController
 * into the running app.
 *
 * Replaces setup-drag.ts. The router owns container listeners; this file
 * builds the four collaborators and connects them via the router's hooks.
 */

import type { GameState, Point } from '../model/types.js';
import { moveGroup, findGroupForPiece } from '../model/helpers.js';
import type { Renderer } from '../renderer/types.js';
import { DragController } from './drag-controller.js';
import type { ScreenDeltaToWorld } from './drag-controller.js';
import { ViewportController } from './viewport-controller.js';
import type { ViewportTransform } from './viewport-transform.js';
import { AutoPanController } from './auto-pan.js';
import { PointerRouter } from './pointer-router.js';
import type { ClassifyTarget } from './pointer-router.js';
import type { SelectionManager } from './selection-manager.js';
import { loadOffsetDragPreference } from '../ui/index.js';

export interface InteractionSetupOptions {
    container: HTMLElement;
    renderer: Renderer;
    viewportTransform: ViewportTransform;
    getState: () => GameState;
    onStateChanged: () => void;
    onDrop: (groupId: number) => void;
    onViewportChanged: () => void;
    screenDeltaToWorld?: ScreenDeltaToWorld;
    panViewport?: (screenDelta: Point) => void;
    selectionManager?: SelectionManager;
}

const OFFSET_DRAG_SCREEN_PX = 50;

export function setupInteraction(options: InteractionSetupOptions): () => void {
    const {
        container, renderer, viewportTransform, getState, onStateChanged,
        onDrop, onViewportChanged, screenDeltaToWorld, panViewport, selectionManager,
    } = options;

    const deltaToWorld = screenDeltaToWorld ?? ((d: Point) => d);

    const expandToSelection = (groupId: number): readonly number[] =>
        selectionManager?.expandToSelectionIfActive(groupId) ?? [groupId];

    const viewportController = new ViewportController(viewportTransform, onViewportChanged);

    const autoPan = panViewport
        ? new AutoPanController({
            panViewport,
            moveGroup(groupId, worldDelta) {
                for (const id of expandToSelection(groupId)) {
                    const group = getState().groups.find(g => g.id === id);
                    if (group) moveGroup(group, worldDelta);
                }
            },
            screenDeltaToWorld: deltaToWorld,
            requestRender: onStateChanged,
            getViewportSize: () => ({
                width: window.visualViewport?.width ?? window.innerWidth,
                height: window.visualViewport?.height ?? window.innerHeight,
            }),
        })
        : null;

    const dragController = new DragController(
        () => getState().groups,
        {
            moveGroup(groupId, delta) {
                for (const id of expandToSelection(groupId)) {
                    const group = getState().groups.find(g => g.id === id);
                    if (group) moveGroup(group, delta);
                }
            },
            bringToFront(groupId) {
                const ids = expandToSelection(groupId);
                for (let i = ids.length - 1; i >= 0; i--) {
                    renderer.bringGroupToFront(ids[i]);
                    renderer.setGroupDragging(ids[i], true);
                }
            },
            requestRender: onStateChanged,
            // Lifecycle teardown is owned by the router-hook layer
            // below, so these can be no-ops. They are removed in Task 10
            // when DragCallbacks is reduced.
            onDrop: () => {},
            onCancel: () => {},
        },
        undefined,
        screenDeltaToWorld,
    );

    function applyOffsetDragIfSinglePiece(groupId: number): void {
        const group = getState().groups.find(g => g.id === groupId);
        if (!group || group.pieces.size !== 1) return;
        if (!loadOffsetDragPreference()) return;
        const offset = deltaToWorld({ x: 0, y: -OFFSET_DRAG_SCREEN_PX });
        moveGroup(group, offset);
        onStateChanged();
    }

    const classifyTarget: ClassifyTarget = (target) => {
        const pieceId = renderer.pieceIdFromTarget(target);
        if (pieceId !== null) return { kind: 'piece', pieceId };
        if (target === container) return { kind: 'background' };
        if (target instanceof HTMLElement && target.dataset.puzzleTable === 'true') {
            return { kind: 'background' };
        }
        return { kind: 'ignore' };
    };

    const router = new PointerRouter({
        container,
        classifyTarget,

        onPieceTap: (pieceId, _evt) => {
            if (!selectionManager?.toolActive) return;
            const group = findGroupForPiece(pieceId, getState().groups);
            selectionManager.toggle(group.id);
            renderer.setGroupSelected(group.id, selectionManager.isSelected(group.id));
            onStateChanged();
        },

        onPieceDrag: {
            start: (pieceId, evt) => {
                dragController.handlePointerDown(pieceId, evt);
                const drag = dragController.getActiveDrag();
                if (!drag) return;
                applyOffsetDragIfSinglePiece(drag.groupId);
                autoPan?.start(drag.groupId);
                autoPan?.updatePointer({ x: evt.clientX, y: evt.clientY });
            },
            move: (evt) => {
                dragController.handlePointerMove(evt);
                autoPan?.updatePointer({ x: evt.clientX, y: evt.clientY });
            },
            end: (evt) => {
                const drag = dragController.getActiveDrag();
                if (!drag) return;
                const groupId = drag.groupId;
                dragController.handlePointerUp(evt);
                autoPan?.stop();
                for (const id of expandToSelection(groupId)) renderer.setGroupDragging(id, false);
                onDrop(groupId);
            },
            cancel: () => {
                const drag = dragController.getActiveDrag();
                if (!drag) return;
                const groupId = drag.groupId;
                dragController.cancel();
                autoPan?.stop();
                for (const id of expandToSelection(groupId)) renderer.setGroupDragging(id, false);
            },
        },

        onBackgroundPan: {
            start: (evt) => viewportController.handlePanStart(evt),
            move: (evt) => viewportController.handlePanMove(evt),
            end: () => viewportController.handlePanEnd(),
            cancel: () => viewportController.handlePanEnd(),
        },

        onPinch: {
            start: (a, b) => viewportController.handlePinchStart(a, b),
            move: (a, b) => viewportController.handlePinchMove(a, b),
            end: () => viewportController.handlePinchEnd(),
        },

        onWheelZoom: (evt) => viewportController.handleWheel(evt),
    });

    return () => {
        autoPan?.stop();
        router.destroy();
    };
}
```

**Note:** `dragController.cancel()` is called above. The current `DragController` exposes `cancelDragAndRestore()` instead. Add a temporary alias inside `DragController` so both names work for the duration of Tasks 8–9:

```ts
// In drag-controller.ts, alongside cancelDragAndRestore:
cancel(): void { this.cancelDragAndRestore(); }
```

The alias is removed in Task 11 when `cancelDragAndRestore` is officially renamed.

- [ ] **Step 4: Update barrel re-exports**

In `src/interaction/index.ts`, add:

```ts
export { PointerRouter } from './pointer-router.js';
export type { PointerRouterOptions, ClassifyTarget } from './pointer-router.js';
export { setupInteraction } from './setup-interaction.js';
export type { InteractionSetupOptions } from './setup-interaction.js';
```

(Keep the existing `setupDragHandling` re-export for now — it's removed in Task 9.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/interaction/setup-interaction.test.ts`
Expected: PASS.

Run: `npx vitest run`
Expected: full suite PASS — nothing else has been changed.

- [ ] **Step 6: Run full build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/interaction/setup-interaction.ts src/interaction/setup-interaction.test.ts \
        src/interaction/index.ts src/interaction/drag-controller.ts
git commit -m "feat(interaction): add setupInteraction orchestrator (refs #260)"
```

---

## Task 9: Switch `main.ts` to `setupInteraction`; delete old wiring

The big swap. Done as four small commits within this task so each step is independently green.

**Files:**
- Modify: `src/main.ts`
- Delete: `src/interaction/setup-drag.ts`
- Delete: `src/interaction/setup-drag.test.ts`
- Modify: `src/interaction/viewport-controller.ts` — drop the listener-attachment side
- Modify: `src/interaction/viewport-controller.test.ts` — drop tests for the now-removed listener side
- Modify: `src/renderer/types.ts` — remove `onPiecePointerDown`
- Modify: `src/renderer/svg-dom-renderer.ts` — remove `onPiecePointerDown` and per-piece listeners
- Modify: `src/renderer/svg-dom-renderer.test.ts` — remove `onPiecePointerDown` tests
- Modify: `src/interaction/index.ts` — drop `setupDragHandling` re-export

- [ ] **Step 1: Switch `main.ts`**

In `src/main.ts`:

1. Remove the `void new ViewportController({ ... })` block (the constructor signature is about to change anyway in Task 9c, but the old call wouldn't be needed even before that since `setupInteraction` constructs its own).
2. Remove `function isPieceElement(...)` (and any imports it relied on if no longer needed).
3. Replace the `setupDragHandling({ ... })` call with `setupInteraction({ ... })`. Add the two new fields: `viewportTransform: viewportTransform` and `onViewportChanged: applyViewportTransform`. (`applyViewportTransform` is the existing function in `main.ts`.)
4. Update the import to include `setupInteraction` and drop `setupDragHandling`, `ViewportController`.

Verify build:

```bash
npm run build && npx vitest run
```

Commit:

```bash
git add src/main.ts
git commit -m "refactor(main): wire setupInteraction; drop direct ViewportController usage (refs #260)"
```

- [ ] **Step 2: Delete `setup-drag.ts` and its tests**

```bash
git rm src/interaction/setup-drag.ts src/interaction/setup-drag.test.ts
```

In `src/interaction/index.ts`, remove:

```ts
export { setupDragHandling } from './setup-drag.js';
export type { DragSetupOptions } from './setup-drag.js';
```

Verify:

```bash
npm run build && npx vitest run
```

Commit:

```bash
git add src/interaction/index.ts
git commit -m "refactor(interaction): delete setup-drag.ts (now setup-interaction.ts) (refs #260)"
```

- [ ] **Step 3: Strip `ViewportController` listener-attachment**

In `src/interaction/viewport-controller.ts`:

1. Change the constructor signature to `constructor(transform: ViewportTransform, onViewportChanged: () => void)`.
2. Remove the `container`, `isPieceElement` fields and their constructor params.
3. Delete `boundWheel`, `boundPointerDown`, `boundPointerMove`, `boundPointerUp` field initializations and the `addEventListener` calls in the constructor.
4. Delete `destroy()`.
5. Delete `private isBackgroundElement(...)`. The wheel handler in Task 7 still uses it — rewrite `handleWheel` to no longer pre-filter by target (PointerRouter already does that):

```ts
handleWheel(evt: WheelEvent): void {
    evt.preventDefault();
    const delta = Math.max(-50, Math.min(50, evt.deltaY));
    const factor = 1 - delta * 0.005;
    this.transform.zoom(factor, { x: evt.clientX, y: evt.clientY });
    this.onViewportChanged();
}
```

6. Delete the now-unused `private handlePointerDown` / `handlePointerMove` / `handlePointerUp` methods, `panPointerId`, `panLastPoint` (replace with a single `private lastPanPoint: Point | null = null` used by `handlePanStart/Move/End`), `activeTouches`, and the `fakeEventFromTouch` helper introduced in Task 7.

In `src/interaction/viewport-controller.test.ts`:
- Drop tests asserting listener attachment / removal, `setPointerCapture` calls (these are router responsibilities now), `activeTouches` behaviour, and the `isBackgroundElement` filter.
- Update the `setup()` helper used for the public-handlers tests to construct via the new minimal signature: `new ViewportController(transform, onChanged)`.

Verify:

```bash
npm run build && npx vitest run
```

Commit:

```bash
git add src/interaction/viewport-controller.ts src/interaction/viewport-controller.test.ts
git commit -m "refactor(interaction): strip ViewportController listener-attachment (refs #260)"
```

- [ ] **Step 4: Strip `Renderer.onPiecePointerDown`**

In `src/renderer/types.ts`: remove `onPiecePointerDown` from the `Renderer` interface and the `PiecePointerDownCallback` type alias if it's no longer used.

In `src/renderer/svg-dom-renderer.ts`:
- Remove the private `callback` field and the public `onPiecePointerDown` method.
- Inside the per-piece SVG construction, remove the `handlePointerDown` closure and the two `addEventListener('pointerdown', handlePointerDown)` calls on `expandedHitArea` and `hitArea`.

In `src/renderer/svg-dom-renderer.test.ts`: remove the `describe('onPiecePointerDown', ...)` block.

Verify:

```bash
npm run build && npx vitest run
```

Commit:

```bash
git add src/renderer/types.ts src/renderer/svg-dom-renderer.ts src/renderer/svg-dom-renderer.test.ts
git commit -m "refactor(renderer): drop onPiecePointerDown (PointerRouter uses pieceIdFromTarget) (refs #260)"
```

---

## Task 10: Cleanup `DragController` internals

Strip the multi-pointer / pinch-grace responsibilities the router now owns. Rename `cancelDragAndRestore → cancel`. Reduce `DragCallbacks` to `{ moveGroup, bringToFront, requestRender }`.

**Files:**
- Modify: `src/interaction/drag-controller.ts`
- Modify: `src/interaction/drag-controller.test.ts`

- [ ] **Step 1: Update test file — remove tests for the dropped concerns**

In `src/interaction/drag-controller.test.ts`, delete tests that exercise:
- `handleAnyPointerDown` / `handleAnyPointerUp`
- the pinch-grace window (`PINCH_CANCEL_WINDOW_MS`-related tests)
- the 2nd-finger gate inside `handlePointerDown` (the boolean return value)
- `DragCallbacks.onDrop` and `DragCallbacks.onCancel` callbacks fired by the controller (these no longer exist; the router-driven `setup-interaction.ts` does the teardown directly)

Rename references to `cancelDragAndRestore` → `cancel` everywhere in this file.

Run: `npx vitest run src/interaction/drag-controller.test.ts`
Expected: tests for the stripped functionality fail to compile (those tests were just deleted, so the file should still compile — but the controller still has the old API). The remaining tests still pass.

- [ ] **Step 2: Strip `DragController`**

In `src/interaction/drag-controller.ts`:

1. Remove the `downPointers: Set<number>`, `firstPointerDownTime`, `now: () => number` fields.
2. Remove the `now` constructor parameter.
3. Remove the `PINCH_CANCEL_WINDOW_MS` constant.
4. Remove the `handleAnyPointerDown` and `handleAnyPointerUp` methods.
5. In `handlePointerDown`, remove the 2nd-finger gate (`if (this.downPointers.size > 0 && ...) return false`). Change the return type from `boolean` to `void`. Update the JSDoc.
6. Rename `cancelDragAndRestore` → `cancel`. Remove the temporary `cancel()` alias added in Task 8.
7. In `DragCallbacks`, remove `onDrop` and `onCancel`. Reduce to `{ moveGroup, bringToFront, requestRender }`.
8. In `cancel()`, remove the `this.callbacks.onCancel(...)` call (no longer in the type).
9. In `handlePointerUp`, remove the `this.callbacks.onDrop(groupId)` call (no longer in the type).

- [ ] **Step 3: Run tests**

Run: `npm run build && npx vitest run`
Expected: PASS. The `setup-interaction.ts` callbacks already match the new shape (only `moveGroup`, `bringToFront`, `requestRender`); the lifecycle teardown (auto-pan stop, `setGroupDragging(false)`, `onDrop`) is in the router-hook layer.

- [ ] **Step 4: Commit**

```bash
git add src/interaction/drag-controller.ts src/interaction/drag-controller.test.ts
git commit -m "refactor(interaction): drop multi-pointer/pinch responsibilities from DragController (refs #260)"
```

---

## Self-review checklist

Run through this before opening the PR:

- [ ] **Spec coverage:** every section of the spec has at least one task implementing it. Walk the spec section-by-section and verify.
- [ ] **Build green at each commit:** `git log --oneline` shows the migration commits in order; `git checkout` each in turn and run `npm run build && npx vitest run` to confirm.
- [ ] **Test counts:** `pointer-router.test.ts` has ≥30 tests covering the state machine. `setup-interaction.test.ts` is small (≤10 tests). `drag-controller.test.ts` and `viewport-controller.test.ts` are slimmed.
- [ ] **No `setupDragHandling`, `onPiecePointerDown`, `cancelDragAndRestore`, `handleAnyPointer*`, `PINCH_CANCEL_WINDOW_MS`, or `isPieceElement` references remain.** Run: `git grep -nE 'setupDragHandling|onPiecePointerDown|cancelDragAndRestore|handleAnyPointer|PINCH_CANCEL_WINDOW_MS|isPieceElement'` — expected: no matches.
- [ ] **`info-modal.ts` not touched** — no player-visible changes per spec.
- [ ] **PR description** lists the behaviour changes (deferred drag, deferred pan, locked pinch pair, drag-start-time grace anchor) so the reviewer knows what to test in the preview deploy.
