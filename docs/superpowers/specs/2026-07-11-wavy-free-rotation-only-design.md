# Wavy (and Composable) Become Free-Rotation-Only

**Date:** 2026-07-11
**Status:** Approved

## Problem

The new-game dialog offers a "Free rotation" sub-checkbox for Wavy and
Composable: with rotation enabled, those styles default to 90° (quarter-turn)
rotation unless the player also ticks the sub-checkbox. Triangles already
skips this — enabling rotation there simply means free rotation. Wavy (and
Composable, whose traced-tab configuration behaves like Wavy) should work the
same way: one rotation toggle, free rotation, no 90° option.

## Decision

Rotation mode for a new game becomes a pure function of cut style:

| Cut style | Rotation enabled → mode |
|---|---|
| Classic, Fractal | `quarter-turn` |
| Wavy, Triangles, Composable | `free` |
| (any, rotation disabled) | `none` |

The "Free rotation" sub-checkbox and all of its plumbing are removed.

## Changes

### `src/main.ts` — `startNewGame`

- Drop the `freeRotation` parameter.
- The mode decision becomes: rotation disabled → `'none'`; Classic/Fractal →
  `'quarter-turn'`; Wavy/Triangles/Composable → `'free'`.
- Generalize the existing "Triangles offers no quarter-turn" comment to
  explain why the traced-tab styles are free-only.

### `src/main.ts` — `__newComposableGame` dev hook

- The `rotation` override narrows from `'none' | 'quarter-turn' | 'free'` to
  `'none' | 'free'`; the hook no longer threads a separate free flag into
  `startNewGame`.

### `src/ui/new-game-dialog.ts`

- Remove the "Free rotation" sub-checkbox row and its visibility-toggling
  logic (currently tied to cut style + top-level rotation checkbox).
- Remove `freeRotation` from `NewGameOptions` and the saved-preferences
  interface.
- The top-level "Enable rotation" checkbox is unchanged.

### Preference removal

- Delete `src/ui/free-rotation-preference.ts`.
- Remove its exports from `src/ui/index.ts` and its load/save wiring in
  `src/main.ts`.
- The `puzzle-free-rotation-enabled` localStorage key simply stops being
  read. Orphaned preference keys are harmless; no migration.

### Help text (`src/ui/info-modal.ts`)

- The Rotate-buttons entry currently attributes free rotation to "Wavy and
  Triangles puzzles" and describes 90° rotation without naming styles.
  Update so 90° rotation is attributed to Classic and Fractal, and free
  rotation to Wavy and Triangles. Composable stays unmentioned (dev-only;
  no prod help copy per repo convention).

## Backward compatibility

Nothing outside new-game creation changes. `'quarter-turn'` remains a valid
`rotationMode` in saves, share links, serialization, and reconstruction:

- Classic and Fractal still create quarter-turn games.
- Existing Wavy quarter-turn saves and share links carry their
  `rotationMode` explicitly and must keep loading and playing exactly as
  before.

No PRNG calls are added, removed, or reordered anywhere in puzzle
generation, so the share-link reproducibility contract is untouched.

## Testing

- Update/extend tests around `startNewGame` mode selection: Wavy + rotation
  → `'free'`; Classic/Fractal + rotation → `'quarter-turn'`; rotation
  disabled → `'none'`.
- Update dialog tests: the "Free rotation" sub-checkbox no longer exists;
  `NewGameOptions` no longer carries `freeRotation`.
- Existing decode/reconstruct tests covering quarter-turn stay untouched
  and must keep passing.
