# PointerRouter — design

Refactor `src/interaction/` so a single `PointerRouter` owns container-level
pointer events and dispatches pre-classified gesture events to the existing
controllers. Closes [#260](https://github.com/adrianschmidt/puzzle/issues/260).

## Context

`ViewportController` and `setup-drag.ts` both attach pointer listeners to
the same `app` container. Coordination between them is implicit:

- A pointerdown on a piece reaches `DragController` via the renderer's
  per-piece pointerdown indirection, AND bubbles to the container where
  `ViewportController` adds the touch to `activeTouches` for pinch
  detection.
- A pointerdown on background goes only to `ViewportController` for
  pan; `DragController` is unaware.
- When a 2nd touch lands during a drag, pinch starts in
  `ViewportController` while `DragController` cancels its drag inside
  `handleAnyPointerDown` (within a 250 ms grace window).
- Pointer capture is taken twice: once by `setup-drag.ts` for the drag,
  once by `ViewportController` for the pan.
- The "tap vs drag" 8 px threshold is policy that lives inside
  `setup-drag.ts`, alongside the speculative-drag-then-rollback that
  implements tap-toggle-selection.

The behaviour mostly works, but the policy ("when does a pointerdown
on a piece become a pinch?", "what happens to a tap candidate when a
pinch starts?") is emergent rather than designed. New input modes will
compound the implicit coordination.

## Decisions

| Question | Decision |
|---|---|
| Migration shape | Full migration in one PR. End-state has `PointerRouter` as the single source of pointer truth. |
| Event model | Pre-classified atomic gesture events (validated via spike at PR #340 and confirmed via preview deploy). |
| Tap-vs-drag threshold | 8 px movement, deferred-promotion (drag-start happens on the first move that crosses the threshold, not at pointerdown). |
| Background-pan threshold | Symmetric with piece-drag: defer pan-start until 8 px. Reserves "tap on background" as a future event. |
| Pinch arbitration anchor | Time since *drag-start* (the promotion moment), not time since first pointerdown. |
| Pinch arbitration policy | 2nd touch within 250 ms of drag-start cancels the drag and starts pinch. After 250 ms, pinch starts concurrently with the drag (hold-while-pinch is preserved). |
| Pan vs pinch | Pinch always wins. Pan has no grace window; a 2nd touch always cancels pan and starts pinch. |
| Pinch-pair locking | The first two `pointerType === 'touch'` pointers form THE pinch pair for the duration. 3rd+ touches are tracked but don't participate. Either pair member lifting ends pinch. |
| Time-based promotion | Out of scope. The state machine has the right shape to add a long-press timer later without touching consumers. |

## Architecture

New module layout under `src/interaction/`:

```
pointer-router.ts          (NEW) — owns container listeners, classifies, dispatches
pointer-router.test.ts     (NEW)
drag-controller.ts         (shrinks)
viewport-controller.ts     (shrinks; no longer attaches its own listeners)
setup-interaction.ts       (replaces setup-drag.ts) — builds + wires the four pieces
auto-pan.ts                (unchanged)
selection-manager.ts       (unchanged)
viewport-transform.ts      (unchanged)
```

Responsibility split:

| Concern | Today | After refactor |
|---|---|---|
| Container `pointerdown/move/up/cancel` | `ViewportController` + `setup-drag` (both) | **`PointerRouter` (only)** |
| Container `wheel` | `ViewportController` | **`PointerRouter`** |
| Per-piece `pointerdown` listeners | Renderer (`onPiecePointerDown`) | **Removed** (router uses `pieceIdFromTarget`) |
| Tap-vs-drag classification | `setup-drag` (`tapCandidate`, 8 px check) | **`PointerRouter`** |
| `downPointers` / first-pointer time | `DragController` | **`PointerRouter`** |
| Pinch arbitration (drag-vs-pinch) | `DragController` (grace window) | **`PointerRouter`** |
| Pinch math (zoom factor, midpoint) | `ViewportController` | `ViewportController` |
| Pan math | `ViewportController` | `ViewportController` |
| Single drag lifecycle | `DragController` | `DragController` (simpler) |
| Pointer capture | `ViewportController` + `setup-drag` (both) | **`PointerRouter` (only)** |
| Auto-pan lifecycle | `setup-drag` | `setup-interaction` (unchanged behaviour) |

## `PointerRouter` API

```ts
type ClassifyTarget = (target: EventTarget | null) =>
    | { kind: 'piece'; pieceId: number }
    | { kind: 'background' }
    | { kind: 'ignore' };

interface PointerRouterOptions {
    container: HTMLElement;
    classifyTarget: ClassifyTarget;
    tapThresholdPx?: number;        // default 8
    now?: () => number;             // default performance.now (testability)

    onPieceTap:        (pieceId: number, evt: PointerEvent)        => void;
    onPieceDrag: {
        start:  (pieceId: number, evt: PointerEvent) => void;
        move:   (evt: PointerEvent)                  => void;
        end:    (evt: PointerEvent)                  => void;
        cancel: ()                                   => void;
    };
    onBackgroundPan: {
        start:  (evt: PointerEvent) => void;
        move:   (evt: PointerEvent) => void;
        end:    (evt: PointerEvent) => void;
        cancel: ()                  => void;
    };
    onPinch: {
        start: (a: PointerEvent, b: PointerEvent) => void;
        move:  (a: PointerEvent, b: PointerEvent) => void;
        end:   ()                                  => void;
    };
    onWheelZoom: (evt: WheelEvent) => void;
}

class PointerRouter {
    constructor(options: PointerRouterOptions);
    destroy(): void;          // remove all container listeners
}
```

No public state-inspection methods. The router is a black-box dispatcher.

### Event-stream guarantees

Consumers can rely on:

1. Every `onPieceDrag.start` is followed by exactly one of
   `onPieceDrag.end` or `onPieceDrag.cancel`. Never both, never neither.
2. Every `onBackgroundPan.start` is followed by exactly one of
   `onBackgroundPan.end` or `onBackgroundPan.cancel`.
3. `onPinch.start` is always followed by `onPinch.end`. There is no
   separate cancel for pinch — end-state is the same regardless of cause.
4. `onPieceTap` and `onPieceDrag.start` are mutually exclusive for a
   given pointer sequence.
5. `onPieceDrag` and `onPinch` may be concurrent (after the 250 ms grace
   window). `onBackgroundPan` and `onPinch` may not — pan always cancels
   on pinch start.
6. Pointer capture is the router's responsibility. Capture is taken at
   drag/pan promotion and released on end/cancel. Consumers never call
   `setPointerCapture`.

## Classification state machine

```
IDLE
  ├─ pointerdown 'piece'          → PIECE_CANDIDATE
  ├─ pointerdown 'background'     → BACKGROUND_CANDIDATE
  └─ pointerdown 'ignore'         → IDLE (event not tracked)

PIECE_CANDIDATE (1 pointer, < 8 px moved)
  ├─ pointermove ≥ 8 px           → PIECE_DRAG       (emit onPieceDrag.start, capture)
  ├─ pointerup                    → IDLE             (emit onPieceTap)
  └─ 2nd touch lands              → PINCH            (discard candidate)

BACKGROUND_CANDIDATE (1 pointer, < 8 px moved)
  ├─ pointermove ≥ 8 px           → BACKGROUND_PAN   (emit onBackgroundPan.start, capture)
  ├─ pointerup                    → IDLE             (silent — no onBackgroundTap in vocabulary yet)
  └─ 2nd touch lands              → PINCH            (discard candidate)

PIECE_DRAG (active drag, single pointer)
  ├─ pointermove                  → emit onPieceDrag.move
  ├─ pointerup                    → IDLE             (emit onPieceDrag.end, release capture)
  ├─ pointercancel                → IDLE             (emit onPieceDrag.cancel)
  └─ 2nd touch lands:
        if elapsed-since-promotion < 250 ms
                                  → PINCH            (emit onPieceDrag.cancel, then onPinch.start)
        else
                                  → PIECE_DRAG+PINCH (concurrent; emit onPinch.start)

BACKGROUND_PAN (active pan, single pointer)
  ├─ pointermove                  → emit onBackgroundPan.move
  ├─ pointerup                    → IDLE             (emit onBackgroundPan.end, release capture)
  ├─ pointercancel                → IDLE             (emit onBackgroundPan.cancel)
  └─ 2nd touch lands              → PINCH            (always cancel pan, no grace)

PINCH (locked pair: first two touch pointers that triggered pinch)
  ├─ pointermove on a pair member → emit onPinch.move(a, b)
  ├─ pointerup on a pair member   → IDLE             (emit onPinch.end)
  └─ pointerdown                  → tracked as downPointer; does NOT replace pinch pair

PIECE_DRAG + PINCH (concurrent; drag-finger is one of the pinch pair)
  ├─ pointermove on drag finger   → emit onPieceDrag.move AND onPinch.move
  ├─ pointermove on other finger  → emit onPinch.move only
  ├─ drag-finger pointerup        → IDLE             (emit onPieceDrag.end + onPinch.end)
  ├─ other pinch finger pointerup → PIECE_DRAG       (emit onPinch.end; drag continues)
  └─ pointercancel on drag finger → IDLE             (emit onPieceDrag.cancel + onPinch.end)
```

**Wheel events:** dispatched as `onWheelZoom(evt)` whenever the target
classifies as `'piece'` or `'background'`. Targets classified as
`'ignore'` are passed through (default browser scroll). The router
calls `evt.preventDefault()` for the dispatched cases.

**Pointer-tracking scope:** the router tracks `downPointers` only for
pointers whose initial `pointerdown` landed on a `'piece'` or
`'background'` target. Pointers on `'ignore'` targets are not tracked
at all. Pinch can only fire from a pair drawn from tracked touch
pointers.

**Pinch participants:** mouse/pen never participate in pinch. Only
`pointerType === 'touch'` pointers count toward the pinch pair.

## Renderer change

`Renderer.onPiecePointerDown(callback)` is replaced by
`Renderer.pieceIdFromTarget(target): number | null`, a pure DOM →
piece-ID translator that uses the existing `data-piece-id` attribute
the renderer already sets on each piece's `<svg>`.

```ts
pieceIdFromTarget(target: EventTarget | null): number | null {
    if (!(target instanceof Element)) return null;
    const svg = target.closest('svg[data-piece-id]');
    if (!svg) return null;
    const id = Number((svg as HTMLElement).dataset.pieceId);
    return Number.isFinite(id) ? id : null;
}
```

The renderer stops attaching its own per-piece `pointerdown` listeners.
The corresponding tests in `svg-dom-renderer.test.ts` are replaced by
focused tests for `pieceIdFromTarget` covering: hit-area child,
expanded-hit-area child, the SVG itself, an unrelated DOM node, and
`null`.

`main.ts:isPieceElement` is removed. The new `classifyTarget` (router
constructor option) is built inside `setup-interaction.ts` from
`renderer.pieceIdFromTarget` plus a small inline check for the
container / `data-puzzle-table="true"` element.

## `DragController` shrinkage

Removed:

- `downPointers: Set<number>` and `firstPointerDownTime: number | null`
- `now: () => number` constructor parameter
- `handleAnyPointerDown(event)` and `handleAnyPointerUp(event)`
- The 2nd-finger gate inside `handlePointerDown` (router pre-filters)
- The pinch grace-window logic and `PINCH_CANCEL_WINDOW_MS` constant
- `handlePointerDown`'s boolean return value
- `DragCallbacks.onDrop` and `DragCallbacks.onCancel` (lifecycle teardown moves to `setup-interaction.ts`)

Renamed: `cancelDragAndRestore()` → `cancel()`. It still restores the
drag's `startPosition` and clears state.

Public surface after:

```ts
class DragController {
    constructor(
        groups: () => PieceGroup[],
        callbacks: { moveGroup; bringToFront; requestRender },
        getViewportSize?: () => { width: number; height: number },
        screenDeltaToWorld?: ScreenDeltaToWorld,
    );
    getActiveDrag(): DragState | null;
    handlePointerDown(pieceId: number, event: PointerEvent): void;
    handlePointerMove(event: PointerEvent): void;
    handlePointerUp(event: PointerEvent): void;
    cancel(): void;
}
```

## `ViewportController` shrinkage

Removed:

- `container: HTMLElement` and `isPieceElement` constructor params
- `boundWheel`, `boundPointerDown`, `boundPointerMove`, `boundPointerUp`
- `addEventListener(...)` / `removeEventListener(...)` calls and
  `destroy()` (no listeners to clean up)
- `panPointerId`, `panLastPoint` map → simplified to a single
  `lastPanPoint: Point | null` updated from incoming pan events
- `activeTouches: Map<number, TouchPoint>` (router owns multi-touch
  tracking)
- `isBackgroundElement(target)` private method
- The `pointerType === 'touch'` gate inside the pinch path (router
  pre-filters)

Pinch math state (`lastPinchDist`, `lastPinchMidpoint`) stays — it's
math, and `ViewportController` is the math layer. The router emits
absolute positions; the controller computes deltas.

Public surface after:

```ts
class ViewportController {
    constructor(transform: ViewportTransform, onViewportChanged: () => void);
    handleWheel(evt: WheelEvent): void;
    handlePanStart(evt: PointerEvent): void;
    handlePanMove(evt: PointerEvent): void;
    handlePanEnd(): void;
    handlePinchStart(a: PointerEvent, b: PointerEvent): void;
    handlePinchMove(a: PointerEvent, b: PointerEvent): void;
    handlePinchEnd(): void;
}
```

`touchDistance` and `touchMidpoint` remain exported helpers — still
used internally by the controller's pinch math.

## `setup-interaction.ts` (replaces `setup-drag.ts`)

The orchestration layer. Same public surface (a factory that returns a
cleanup function), with two added options for viewport-controller
construction (`viewportTransform`, `onViewportChanged`).

```ts
export function setupInteraction(options: InteractionSetupOptions): () => void {
    const { container, renderer, viewportTransform,
            getState, onStateChanged, onDrop, onViewportChanged,
            screenDeltaToWorld, panViewport, selectionManager } = options;

    const viewportController = new ViewportController(
        viewportTransform,
        onViewportChanged,
    );

    const dragController = new DragController(
        () => getState().groups,
        {
            moveGroup:    (id, delta) => { /* expand-to-selection + moveGroup */ },
            bringToFront: (id)        => { /* expand-to-selection + bringToFront + setGroupDragging(true) */ },
            requestRender: onStateChanged,
        },
        undefined,
        screenDeltaToWorld,
    );

    const autoPan = panViewport ? new AutoPanController({ ... }) : null;

    const classifyTarget: ClassifyTarget = (target) => {
        const pieceId = renderer.pieceIdFromTarget(target);
        if (pieceId !== null) return { kind: 'piece', pieceId };
        if (target === container) return { kind: 'background' };
        if (target instanceof HTMLElement && target.dataset.puzzleTable === 'true')
            return { kind: 'background' };
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
                applyOffsetDragIfSinglePiece(drag.groupId);     // -50 px shift
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
                for (const id of expandToSelection(groupId))
                    renderer.setGroupDragging(id, false);
                onDrop(groupId);                                 // merge-detection
            },
            cancel: () => {
                const drag = dragController.getActiveDrag();
                if (!drag) return;
                const groupId = drag.groupId;
                dragController.cancel();                         // restores startPosition
                autoPan?.stop();
                for (const id of expandToSelection(groupId))
                    renderer.setGroupDragging(id, false);
            },
        },

        onBackgroundPan: {
            start:  (evt) => viewportController.handlePanStart(evt),
            move:   (evt) => viewportController.handlePanMove(evt),
            end:    ()    => viewportController.handlePanEnd(),
            cancel: ()    => viewportController.handlePanEnd(),
        },

        onPinch: {
            start: (a, b) => viewportController.handlePinchStart(a, b),
            move:  (a, b) => viewportController.handlePinchMove(a, b),
            end:   ()     => viewportController.handlePinchEnd(),
        },

        onWheelZoom: (evt) => viewportController.handleWheel(evt),
    });

    return () => {
        autoPan?.stop();
        router.destroy();
    };
}
```

`main.ts` changes: the standalone `new ViewportController({...})` call
goes away (now constructed inside `setupInteraction`); the
`setupDragHandling({...})` call becomes `setupInteraction({...})` with
two extra params; `isPieceElement` is removed.

## Testing strategy

| File | Change |
|---|---|
| `pointer-router.test.ts` | **NEW**. State-machine coverage: classification per target kind, tap-vs-drag promotion, candidate-discard on 2nd finger, pinch grace window (in-grace cancel, post-grace concurrent), pan-pinch always-cancel, pinch-pair locking under 3+ fingers, wheel filtering, `pointercancel` paths, capture/release. Same fake-container + spy-on-`addEventListener` pattern used today in `setup-drag.test.ts` and `viewport-controller.test.ts`. |
| `drag-controller.test.ts` | **Slim**. Remove tests for `handleAnyPointer{Down,Up}`, `downPointers`, pinch grace, the 2nd-finger gate, the boolean return. Keep core lifecycle (start → move → drop), pointer clamping, screen-to-world delta, and `cancel()` position restoration. |
| `viewport-controller.test.ts` | **Slim**. Remove tests asserting listener attachment, `panPointerId`, `activeTouches`, `isBackgroundElement`. Keep math: pan delta application, pinch zoom factor, midpoint translation, wheel zoom factor + clamp. |
| `setup-drag.test.ts` → `setup-interaction.test.ts` | Renamed and slimmed. Tests that previously double-covered router-level logic (tap threshold, 2nd-finger gating) move to `pointer-router.test.ts`. The remainder covers wiring: drag-start triggers offset-drag + auto-pan, pan-cancel triggers viewport teardown, multi-select expansion in `moveGroup`/`bringToFront` callbacks. |
| `svg-dom-renderer.test.ts` | Replace `onPiecePointerDown` tests with `pieceIdFromTarget` tests: hit-area child, expanded-hit-area child, the SVG itself, unrelated DOM, `null`. |

## Migration order

Designed so each commit keeps `npm run build` and `npm test` green:

1. **Add `pieceIdFromTarget` to the renderer** (alongside
   `onPiecePointerDown`, both work). Add tests. No callers yet.
2. **Add `PointerRouter` + `pointer-router.test.ts`.** Not wired into
   the app. Stand-alone class, fully tested.
3. **Add `setup-interaction.ts` alongside `setup-drag.ts`.** Not yet
   imported by `main.ts`. Tests added.
4. **Switch `main.ts`** to call `setupInteraction` instead of
   `setupDragHandling` + `new ViewportController({...})`. Delete
   `setup-drag.ts`, `setup-drag.test.ts`. Remove `ViewportController`'s
   constructor listener-attachment + `destroy`. Remove
   `Renderer.onPiecePointerDown` and the per-piece DOM listeners.
   Remove `main.ts:isPieceElement`.
5. **Cleanup sweep:** strip dead code from `DragController`
   (`handleAnyPointer*`, `downPointers`, `firstPointerDownTime`, `now`
   ctor param, pinch grace constants, the 2nd-finger gate, the boolean
   return); rename `cancelDragAndRestore → cancel`; reduce
   `DragCallbacks` to `{ moveGroup, bringToFront, requestRender }`.
   Strip `ViewportController` (`activeTouches`, `panPointerId`,
   `panLastPoint`, listener-fields, `isPieceElement` ctor param,
   `isBackgroundElement`). Update affected tests.

## Out of scope

- Behaviour changes beyond those listed in *Decisions* (deferred
  drag-start / pan-start, locked pinch pair, drag-start-time grace
  anchor).
- Long-press / time-based promotion. The state machine has the right
  shape to add a long-press timer later without touching consumers; no
  implementation in this PR.
- New gestures (lasso selection on background, etc.).
- Changes to `AutoPanController`, `SelectionManager`,
  `ViewportTransform`, or persistence/save formats.
- `info-modal.ts` updates — none of the visible behaviour changes are
  player-noticeable in a way that changes the *How to Play* copy.
