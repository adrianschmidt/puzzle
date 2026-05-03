# Piece-anchored rotation buttons

## Background

Rotation puzzles (`rotationMode === 'quarter-turn'`, fractal cut style) currently
use the multi-select tool as the rotation-target picker:

- `initGame()` auto-enables `selectionManager.toolActive` when the puzzle has
  rotation, so the user can immediately tap pieces to add them to the selection
  and then press the bottom-left rotate buttons.
- The rotate buttons act on `selectionManager.selectedGroupIds`.
- Because multi-select is on by default for these puzzles, tapping the
  background does **not** clear the selection — that would be disastrous in a
  real multi-select session — so the only way to "release" a piece you just
  rotated is to re-tap it.

Two pieces of user feedback motivate this redesign:

1. The rotate buttons sit far from the piece they rotate (bottom-left corner).
2. Re-tapping the same piece to deselect it after rotating feels clumsy.

## Goals

- Decouple rotation from multi-select. Make rotation work even when
  multi-select is off.
- Place the rotate buttons next to the piece they will rotate, so the
  connection is visually obvious.
- Stop auto-enabling multi-select for rotation puzzles.
- Keep the multi-select tool unchanged for its actual purpose (moving multiple
  groups together).
- Preserve the puzzle-laying experience as a calm, mostly-wordless interaction.
  The new affordance must not flicker, jitter, or otherwise call attention to
  itself.

## Non-goals

- Reworking the multi-select tool itself.
- Animated bounding-box tracking of the buttons during rotation (we
  deliberately keep buttons static once placed — see Placement).
- Hover / keyboard affordances on desktop.
- Polishing the corner cases of "rotation focus + multi-select active at the
  same time" beyond the basics; the user accepts oddities here for v1.

## Design

### Concept

Tapping a piece raises a transient, piece-anchored "rotate this" affordance:
two buttons (CCW and CW) flanking the focused group's bounding box. The
buttons fade in fast, sit there while the user rotates as many times as they
like, and fade out softly after a short idle window or after any non-rotate
interaction.

There is **no persistent "selected for rotation" state** — focus is short-lived
and exists only to anchor the floating buttons.

### Focus lifecycle

A new `RotationFocus` model owns one piece of state: `focusedGroupId: number |
null`. Focus is set by piece taps and cleared by basically everything else.

| Event | Effect on focus |
|---|---|
| Tap a piece (clean tap, no drag) | `setFocus(group.id)` |
| Re-tap the same focused piece | No-op for focus; resets the idle timer |
| Tap a different piece | `setFocus(other.id)` (transitions focus) |
| Click a rotate button | Rotates the focused group; resets the idle timer; does **not** change focus |
| Idle for 5 seconds (no rotate-button click) | `clearFocus()` |
| Tap on background | `clearFocus()` |
| Drag start (piece or background pan) | `clearFocus()` |
| Pinch start, wheel zoom | `clearFocus()` |
| New game / puzzle completion | `clearFocus()` |

Group merges cannot occur while focus is set: any drag that could trigger a
merge first clears focus on `drag start`. Likewise, viewport pan/zoom clears
focus, so we never have to reposition buttons in response to viewport changes.

### Placement

For a focused group, the buttons are placed in **screen space** at tap time,
then frozen until focus clears.

- The focused group's visual bounding box is projected from world coordinates
  to screen coordinates using the current viewport transform.
- CCW button: positioned at `bbox.left - gap - buttonWidth`, vertically
  centered on `bbox.midY`.
- CW button: positioned at `bbox.right + gap`, vertically centered on
  `bbox.midY`.
- Each button is independently clamped to stay fully inside the viewport with a
  small margin (e.g., 12 px). Both X and Y clamp.

This naturally handles the corner cases:

- **Group too large for the viewport**: its left edge is off-screen, so the
  CCW button pins to the viewport's left edge. Same for CW on the right.
- **Group near a viewport edge**: the button on that side hugs the viewport
  edge.
- **Group panned off-screen vertically**: the buttons clamp to the top/bottom
  of the viewport. (In practice this case is unlikely, since panning clears
  focus.)

Buttons are **not** repositioned after rotation. Rotating shifts the group's
bounding box, but moving the buttons under the user's finger would be jarring
and would prevent rapid repeated rotations. The buttons stay where they
appeared until focus clears.

### Visual treatment

The piece itself gets no extra highlight — the floating buttons are the only
indication of focus.

Animation:

- **Fade in**: ~80–120 ms ease. Snappy enough to feel essentially instant,
  just smoothing the appearance.
- **Fade out**: ~250–350 ms ease. Softer.
- **Switching pieces (A → B)**: fade A out and fade B in in parallel —
  independent DOM elements, so cross-fade falls out for free.
- During fade-out a button-pair has `pointer-events: none`, so a clearly-going-
  away pair can never absorb a click.

### Interaction with multi-select

`RotationFocus` is independent of `SelectionManager`. Both can be set
simultaneously.

- Tapping a piece while multi-select is active still toggles its selection
  (existing behavior); it **also** sets the rotation focus on that group.
- Re-tapping the same piece in multi-select still toggles it out of the
  selection; the focus is unchanged (so the buttons remain anchored to that
  group, even though it's no longer "selected"). This is the small wart the
  user accepted for v1.
- Rotation always acts on the **focused group only**, never on the
  multi-selection. Multi-select is for moving groups together, not rotating.

## Code-level changes

### New: `RotationFocus`

A small standalone module in `src/interaction/`:

```ts
class RotationFocus {
    focusedGroupId: number | null;
    setFocus(groupId: number): void;
    clearFocus(): void;
    onChange(cb: (focusedGroupId: number | null) => void): () => void;
}
```

Lives next to `SelectionManager` but is unrelated to it. No merge/prune
plumbing — focus cannot survive a merge (drag clears it first).

### `PointerRouter`

Add a callback for the "tap on background that didn't pan" case, which
currently silently returns to idle:

```ts
onBackgroundTap?: (evt: PointerEvent) => void;
```

Fired from the `background-candidate` → `pointerup` branch when the threshold
was never crossed.

### `setup-interaction.ts`

Takes a new `rotationFocus: RotationFocus` option. Wires:

- Piece tap → always `rotationFocus.setFocus(group.id)`. (The existing
  multi-select toggle still runs when `selectionManager.toolActive`.)
- Piece drag start → `rotationFocus.clearFocus()`.
- Background tap (new callback) → `rotationFocus.clearFocus()`.
- Background pan start → `rotationFocus.clearFocus()`.
- Pinch start → `rotationFocus.clearFocus()`.
- Wheel zoom → `rotationFocus.clearFocus()`.

### `rotate-buttons.ts`

Rewritten. The handle's `show()`/`hide()` API stays (still gated by
`rotationMode`), but the rendering is completely new.

```ts
createRotateButtons({
    container,
    rotationFocus,
    onRotate,
    getFocusedGroupScreenBounds,  // (groupId) => { left, right, top, bottom } | null
});
```

Internally:

- When enabled (`show()` was called), subscribes to `rotationFocus.onChange`.
- On `setFocus(id)`:
    - Compute screen-space bounds.
    - Build a fresh pair of button elements at the computed position
      (clamped to viewport).
    - Fade in.
    - Start a 5-second idle timer.
- On rotate-button click:
    - Invoke `onRotate(direction)`.
    - Reset the idle timer.
    - Do not move or destroy the buttons.
- On `clearFocus()` (or idle-timer expiry):
    - Apply `pointer-events: none` and the fade-out class.
    - On `transitionend` (or fallback timeout), remove from DOM.
- When `hide()` is called or the puzzle's `rotationMode` becomes `'none'`,
  unsubscribe and tear down any visible pair.
- When `show()` is called and `rotationFocus` already has a focused group, the
  initial subscription is treated like a focus-set event (a pair fades in).

### `main.ts`

- Remove the auto-enable: drop `selectionManager.toolActive = state.rotationMode
  === 'quarter-turn'` at line 412.
- Construct `const rotationFocus = new RotationFocus()`; pass it to
  `setupInteraction` and `createRotateButtons`.
- Wire `onRotate` to read `rotationFocus.focusedGroupId` rather than iterating
  `selectionManager.selectedGroupIds`.
- Provide `getFocusedGroupScreenBounds(groupId)` to rotate-buttons. It composes
  `getGroupVisualBounds`, the group's world position, and the current viewport
  transform.
- `initGame()` calls `rotationFocus.clearFocus()` (covers new game and
  re-init; covers completion via subsequent state changes).
- The completion path (after the win animation) explicitly clears focus too,
  so the celebratory zoom doesn't leave dangling buttons.

### `info-modal.ts`

Two help-text edits:

- **How to Play → Rotate**: change the line to "Tap a piece to bring up the ↺ ↻
  buttons next to it; tap them to rotate that piece's group."
- **Cut Styles → Fractal → Enable rotation**: drop the "Multi-select is turned
  on by default" sentence; mention that tapping a piece reveals the rotate
  buttons.

## Tests

- `RotationFocus`: set, clear, onChange notifications, no notification on
  redundant transitions.
- `PointerRouter`: new `onBackgroundTap` callback fires when a background
  pointerup arrives without crossing the threshold; does not fire after a pan.
- `setup-interaction`: piece tap sets focus regardless of multi-select state;
  drag start, background tap, pan start, pinch start, and wheel zoom all clear
  focus; piece tap also still toggles multi-select when the tool is active.
- `rotate-buttons`: subscribing to focus shows/hides the pair; rotate-button
  clicks invoke `onRotate` and reset the idle timer; idle timer expiry clears
  focus; `hide()` removes any visible pair.
- `main.ts` integration coverage already in place via existing tests; update
  any test that asserted `toolActive === true` for rotation puzzles to assert
  it's `false`, and add coverage that tapping a piece on a rotation puzzle
  fades in the buttons.

## Risks and mitigations

- **Existing tests break** because of the auto-enable removal — straightforward
  to update.
- **Saved games**: no schema change. Multi-select tool state isn't persisted, so
  resumed rotation puzzles simply won't have multi-select on by default
  anymore. Acceptable.
- **Returning users** who learned the current flow may be momentarily confused
  when their tap on a piece doesn't add it to a selection. The info modal
  update covers it; the new affordance is also more obvious in practice.
- **Multi-select + focus dual-state weirdness** is accepted for v1. We can
  iterate based on real usage.
