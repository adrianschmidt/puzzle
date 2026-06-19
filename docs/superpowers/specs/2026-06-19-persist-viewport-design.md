# Persist zoom & pan state across page reloads

Closes #420

## Problem

The app always reloads at the viewport's constructed default (`scale 1`,
`offset {0,0}`). On a saved-game reload, `initGame()` restores piece positions
but never touches `viewportTransform`, so the player loses the zoom level and
pan offset they had when they left. New games and the Gather button set the
view via `gatherAndZoomToFit()`, which produces a fitted (often zoomed-out)
view — so a reload at `scale 1` reads as "zoomed in" relative to where the
player last was.

## Goal

When the player reopens an in-progress puzzle from localStorage, restore the
zoom level and pan offset they last had. New-puzzle and share-link opens keep
their current explicit `gatherAndZoomToFit()` behavior.

## Scope decisions

- **Restore scope:** saved-game reloads only. Share links do not carry viewport
  (view state stays out of the share format); brand-new puzzles still gather &
  zoom to fit.
- **Fresh-puzzle reload:** uniform — `persistNewPuzzle()` saves the gathered
  viewport, and every reload restores whatever view was last persisted. The
  restored view equals what gather produced, so an untouched fresh puzzle looks
  identical on reload. No special-casing of "untouched" puzzles.

## Storage location

The viewport lives **inside the existing `puzzle-progress` blob**, not a new
localStorage key.

Rationale: the progress blob already has seed-pairing with the geometry blob,
torn-write detection, the cross-tab takeover guard (#404), and is cleared by
`clearSavedState()` on new game. Putting the viewport there inherits all of
that invalidation logic for free, keeping the viewport's lifecycle
automatically consistent with the puzzle it belongs to. A separate key would
require re-implementing seed-pairing and cross-tab guarding — more surface area
for exactly the tearing bugs #404 fixed.

Cost: a pan/zoom now rewrites the whole progress blob. This is debounced to
500ms (`SAVE_DEBOUNCE_MS`) and matches what drops and gathers already do, so it
is not a new class of write.

The viewport belongs in **progress**, not the static geometry blob, because it
changes as the player plays.

## Data shape

`ViewportState` (`scale: number`, `offset: Point`) is already JSON-safe.
Serialization defines its own structurally-identical type to avoid coupling the
persistence layer to the interaction module:

```ts
export interface SerializedViewport {
    scale: number;
    offset: Point;
}
```

Added as an optional field on `SerializedProgress`:

```ts
export interface SerializedProgress {
    version: number;
    seed?: number;
    groups: SerializedPieceGroup[];
    selection?: number[];
    completed: boolean;
    viewport?: SerializedViewport; // NEW
}
```

**No `STATE_VERSION` bump.** Treated exactly like the existing `selection`
field: additive, optional, and the state it represents lives outside
`GameState` (in `ViewportTransform`). Older builds ignore the unknown key and
still load the save; newer builds restore the viewport when present. Bumping the
version would instead make older builds reject the whole save during a deploy —
far worse than a viewport that fails to restore.

## Changes

### `src/persistence/serialization.ts`

- Add the `SerializedViewport` interface and the `viewport?` field on
  `SerializedProgress`.
- `serializeProgress(state, selection?, viewport?)`: when `viewport` is
  supplied, write it. Omitted/undefined leaves the field off the output.
- Add `readViewport(progress): SerializedViewport | undefined`, mirroring
  `readSelection`: returns `undefined` when the field is absent or malformed
  (non-finite `scale`, or `offset` without finite `x`/`y`). Never throws.

### `src/persistence/storage.ts`

- Thread an optional `viewport?: SerializedViewport` through:
  - `saveProgress(state, selection?, viewport?)`
  - `saveNewPuzzle(state, selection?, viewport?)`
  - `createDebouncedSave().save(state, selection?, viewport?)` — snapshot it
    alongside the pending state/selection, flush it at save time.
- `LoadOutcome` `'ok'` variant gains `viewport?: SerializedViewport`, populated
  via `readViewport(progress)`. The legacy single-key (`deserializeState`) path
  leaves it `undefined` — old saves have no stored viewport.

### `src/main.ts`

- `autoSave()` passes `viewportTransform.getState()` (a fresh immutable
  snapshot) as the viewport argument, so *every* debounced save captures the
  current view.
- `persistNewPuzzle()` passes `viewportTransform.getState()` to `saveNewPuzzle`,
  so a freshly gathered view is persisted immediately.
- `onViewportChanged` (currently `applyViewportTransform`) also calls
  `autoSave()`, so a pure pan/zoom with no piece movement still persists the
  view.
- Saved-game restore path (the `saved.status === 'ok'` branch): after
  `initGame(saved.state)` and `restorePersistedSelection(saved.selection)`, if
  `saved.viewport` is present, call `viewportTransform.setState(saved.viewport)`
  then `applyViewportTransform()`. `setState` already clamps `scale` to
  `[MIN_SCALE, MAX_SCALE]`. When absent (pre-feature saves), do nothing — the
  viewport keeps its default, exactly today's behavior (no regression).

### Not touched

Share-link load (`tryLoadSharedPuzzle`), new game (`startNewGame` /
`gatherAndZoomToFit`), the Gather button, and the Center View button all keep
their existing explicit viewport behavior.

## Snapshot correctness

`ViewportTransform.getState()` returns a deep-ish copy (`offset` is cloned), so
the value passed into `debouncedSave.save` is an immutable snapshot. Rapid pans
each call `autoSave()`, overwriting the pending viewport snapshot with the
latest; the debounce flush persists only the last one. The existing `pagehide`
/ `visibilitychange` → `flush()` handlers already persist a pending save before
the page goes away, so a pan made within the debounce window survives a fast
reload with no extra wiring.

## Testing (TDD)

Unit tests at the persistence layer (the `main.ts` entry wiring is verified by
build + a manual/Playwright reload check):

- `serializeProgress` includes `viewport` when passed, omits it when not.
- Round-trip: `serializeProgress(state, sel, vp)` → JSON → parse →
  `readViewport` returns the same `scale`/`offset`.
- `readViewport` tolerates: absent field (`undefined`), non-finite `scale`,
  missing/garbage `offset`, entirely non-object input.
- `loadSavedGame` returns `viewport` in the `ok` outcome when the progress blob
  carries one, and `undefined` for a legacy single-key save.
- `createDebouncedSave().save(...)` forwards the viewport to the written
  progress blob at flush time.

## Help text

No new toolbar button, gesture, keyboard shortcut, or setting — only an
invisible quality-of-life improvement to reload behavior. Per `CLAUDE.md` no
info-modal update is required. Confirm during implementation that the modal
makes no claim about load-time view that this would contradict.
