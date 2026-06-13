# Marquee / drag-box selection — design

Implements [#390](https://github.com/adrianschmidt/puzzle/issues/390).

## Problem

There's no fast way to select many pieces at once. With the multi-select
tool active, the player taps pieces one at a time. A marquee (drag-a-box)
gesture should let the player rubber-band a region and select every group
inside it.

## Existing building blocks

- `SelectionManager` (`src/interaction/selection-manager.ts`) — `select()`,
  `toggle()`, `clearAll()`, `toolActive`, `expandToSelectionIfActive()`.
- `PointerRouter` (`src/interaction/pointer-router.ts`) — already captures a
  background drag and emits `onBackgroundPan.{start,move,end,cancel}`. The
  consumer decides what those mean; the router needs **no changes**.
- `setupInteraction` (`src/interaction/setup-interaction.ts`) — wires the
  router; `onBackgroundPan` currently always drives the viewport pan.
- `getGroupVisualBounds` (`src/game/group-bounds.ts`) — rotation-aware,
  tab-inclusive axis-aligned world bounds, as offsets from `group.position`.
- `viewportTransform.worldToScreen` — world → client-pixel projection.
- `renderer.setGroupSelected(groupId, selected)` — toggles the `.selected`
  visual.
- Preference + settings pattern: `createBooleanPreference`
  (`src/ui/preference-store.js`) + a checkbox built like `buildOffsetDragSetting`
  in `src/ui/info-modal.ts`.

## Approach

### Gating (which background drags become a marquee)

A background drag becomes a **marquee** instead of a **pan** when, at gesture
start, either:

- the multi-select tool is active (`selectionManager.toolActive`), **or**
- the desktop modifier is held (`evt.shiftKey`).

Otherwise the drag pans the viewport exactly as today. The decision is made
once at `start` and held for the whole gesture.

> **As shipped:** the gate is `selectionManager.marqueeActive || evt.shiftKey`,
> **not** `toolActive`. A dedicated marquee toggle was added rather than
> overloading the multi-select tool, so multi-select can be on while a
> one-finger background drag still pans — the opposite of the "while the tool
> is on … does not pan" trade-off described below. The marquee only takes over
> a background drag when its own toggle is armed or Shift is held. The
> tool-activation side effect still applies: arming the marquee (or the
> Shift+drag shortcut) turns the multi-select tool on so the resulting
> selection is live.

When a Shift-triggered marquee starts while the tool is **off**, starting the
marquee also **activates the tool** (`selectionManager.toolActive = true`).
This keeps the resulting selection live — without it the highlighted groups
would not move together and the deselect button would behave inconsistently.
Activating the tool also lights up the tool button, giving clear feedback that
the app entered multi-select mode.

Accepted trade-off (called out in the issue): while the tool is on, a
one-finger background drag is a marquee and therefore does **not** pan.
Panning remains available via two-finger pinch-drag and wheel/zoom; desktop
users can also pan by not holding Shift with the tool off.

### MarqueeController

New unit: `src/interaction/marquee-controller.ts`. Owns a single marquee
gesture and the transient overlay.

Dependencies (injected):

- `container: HTMLElement` — overlay parent.
- `getState: () => GameState` — to iterate groups and read `piecesById`.
- `worldToScreen: (Point) => Point` — projection (from the viewport transform).
- `selectionManager: SelectionManager`.
- `setGroupSelected: (groupId, selected) => void` — re-apply visuals.
- `onSelectionCommitted: () => void` — re-render + autosave after a marquee.
- `isContainMode: () => boolean` — read the hit-semantics preference.

Lifecycle:

- `start(evt)` — record start client point; create a semi-transparent overlay
  `<div>` (`position: fixed`, `pointer-events: none`), append to `container`.
- `move(evt)` — set the overlay's `left/top/width/height` from the normalized
  rect between start and current client point.
- `end(evt)` — build the screen-space marquee rect; for each group, project
  its `getGroupVisualBounds` corners through `worldToScreen` to an
  axis-aligned screen rect; test against the marquee rect per
  `isContainMode()` (intersect vs fully-contained); `select()` every match
  (additive union with the current selection); call `setGroupSelected` for
  each newly selected group; remove the overlay; call `onSelectionCommitted`.
- `cancel()` — remove the overlay; leave the selection untouched.

The viewport has no rotation (only scale + translate), so an axis-aligned
world rect projects to an axis-aligned screen rect; both rect tests are plain
AABB comparisons.

### setupInteraction wiring

Replace the body of the `onBackgroundPan` hooks with a per-gesture branch held
in a small closure variable (e.g. `backgroundMode: 'pan' | 'marquee'`):

- `start(evt)`: if `selectionManager?.toolActive || evt.shiftKey`, set mode to
  `marquee`. If it's the Shift path and the tool is off, set
  `selectionManager.toolActive = true`. Start the `MarqueeController`. Else set
  mode to `pan` and call the existing `viewportController.handlePanStart`.
- `move`/`end`/`cancel`: dispatch to the marquee controller or the viewport
  controller based on the remembered mode.

`MarqueeController` is constructed alongside the other collaborators in
`setupInteraction`, wired to the same `renderer.setGroupSelected`, the
re-render+autosave path used elsewhere, and the hit-semantics preference
loader.

### Hit-semantics setting

- New preference module `src/ui/marquee-contain.ts` mirroring
  `offset-drag.ts`: `createBooleanPreference({ key: 'puzzle-marquee-contain',
  defaultValue: false })`, exporting `loadMarqueeContainPreference` /
  `saveMarqueeContainPreference`.
- `defaultValue: false` ⇒ **intersect is the default** (box selects any group
  it touches). When enabled, only fully-enclosed groups are selected.
- A checkbox in the info-modal **Settings** section built like
  `buildOffsetDragSetting`, label "Marquee selects only fully enclosed
  pieces", with a one-line description. `testid`: `marquee-contain-toggle`.

### Help text (required by CLAUDE.md)

In `src/ui/info-modal.ts`:

- Extend the **Multi-select** bullet in *How to Play* to mention dragging a box
  to select every group inside it, and that on desktop Shift+drag starts a
  marquee even when the tool is off.
- The new settings checkbox carries its own description (covered above).

## Testing

- `marquee-controller.test.ts`:
  - overlay is created on `start`, resized on `move`, removed on `end` and
    `cancel`;
  - intersect mode selects touching groups; contain mode selects only fully
    enclosed groups (table-driven against projected bounds);
  - selection is additive (pre-existing selection survives, new matches add);
  - `cancel` leaves the selection unchanged;
  - `onSelectionCommitted` fires on `end`, not on `cancel`.
- `setup-interaction` branch coverage: background drag routes to marquee when
  the tool is active or Shift is held; routes to pan otherwise; Shift-with-
  tool-off flips `toolActive` to true.
- `marquee-contain` preference: load/save round-trip and default of `false`.

## Out of scope

- Auto-pan while marqueeing past the viewport edge.
- A per-marquee subtract/toggle mode (only additive union in v1).
- Any change to single-tap selection or background pan when neither gate
  applies.
