# 90° rotation for Classic and Composable cut styles

## Goal

Let players opt into 90°-snap rotation for puzzles cut in the **Classic** and
**Composable** styles, the same way Fractal already supports it. The toggle
becomes orthogonal to cut style: one top-level "Enable rotation" option in the
new-game dialog, applicable to any style.

A future PR will add **free** (non-snapped) rotation for Composable. This
spec deliberately does not pre-build that — the existing
`rotationMode: 'none' | 'quarter-turn'` schema already accommodates a future
`'free'` value without a schema break, so the future PR has full design
freedom.

## Why this is small

Almost everything is already in place:

- **Model** — `PieceGroup.rotation` and `GameState.rotationMode` exist on every
  game regardless of cut style.
- **Generation** — `createNewGame` applies random initial rotations to every
  group when `rotationMode === 'quarter-turn'`, with no per-style branching
  (`game/init.ts:134-144`).
- **Gameplay** — `rotateGroup` (`game/rotate-group.ts`), merge-detection's
  same-rotation requirement (`merge-detection.ts:76`), `getWorldPosition`
  (`model/helpers.ts:203`), and the renderer's `rotation * 90` transform
  (`renderer/svg-dom-renderer.ts:244`) are already cut-style-agnostic.
- **Layout** — `getGroupVisualBounds` is rotation-aware, so
  `gatherAndZoomToFit` (which runs immediately after `createNewGame` on every
  fresh-game and shared-load path) lays rotated pieces out cleanly. Players
  never see the transient random spawn positions.
- **Sharing** — `SharePayload.r` is already independent of `SharePayload.c`. A
  classic-with-quarter-turn or composable-with-quarter-turn link round-trips
  today; we just haven't been generating them.
- **Persistence** — `resolveRotationMode` (`persistence/serialization.ts:261`)
  infers `'quarter-turn'` from any non-zero saved rotation, so saves from this
  PR load correctly without a schema bump.
- **Rotate-buttons UI** — toggled purely by `gameState.rotationMode ===
  'quarter-turn'` (`main.ts:773`), no per-style branching.

The work is contained to four touch points: the new-game dialog, the rotation
preference, the `startNewGame` wiring, and the info-modal help text.

## Touch points

### 1. New-game dialog

A new top-level dialog row, "Enable rotation" (using the existing
`appendCheckboxRow` helper), placed **between the cut-style picker and the
image-source section**. Always visible regardless of selected cut style.

`FractalDialogConfig` loses the `rotationEnabled` field. The fractal options
section keeps just "Borderless".

`NewGameSelection` gains a top-level `rotationEnabled: boolean`. The
`onSelect` callback returns it to `main.ts` alongside the existing fields.

### 2. Rotation preference

New module `src/ui/rotation-preference.ts`, mirroring the small dedicated
files in `src/ui/` (e.g. `offset-drag.ts`):

```ts
export const ROTATION_ENABLED_PREFERENCE_KEY = 'puzzle-rotation-enabled';
export function saveRotationEnabledPreference(value: boolean): void;
export function loadRotationEnabledPreference(): boolean; // defaults false
```

Built on the existing `createJsonPreference` helper.

`fractal-config.ts` drops `rotationEnabled` from `FractalConfigPreference`,
its parser, and its dialog wiring. No migration: existing saved fractal
configs deserialize fine because `parseFractalConfig` only required
`borderless`; the now-extraneous `rotationEnabled` field on stored JSON is
silently ignored, and the new preference defaults to `false` for everyone.
Existing players (a handful) re-tick the box once.

### 3. `startNewGame` wiring (`main.ts`)

Replace lines 619-622:

```ts
// before
const rotationMode: 'none' | 'quarter-turn' =
    cutStyle === 'fractal' && fractalConfig?.rotationEnabled
        ? 'quarter-turn'
        : 'none';

// after
const rotationMode: 'none' | 'quarter-turn' =
    rotationEnabled ? 'quarter-turn' : 'none';
```

The new-game button block (`main.ts:673-715`) loads the rotation preference
alongside the existing ones and passes it through `onSelect` →
`startNewGame`.

### 4. Help text (`info-modal.ts`)

- **How to Play** rotate-buttons bullet: change scope from "(fractal puzzles
  with rotation)" to "(when rotation is enabled)". Same gesture description,
  broader applicability.
- **Cut Styles** section: drop the "Enable rotation" sub-bullet under
  Fractal. The dialog's checkbox is self-documenting; the gesture is already
  explained in How to Play.

## Out of scope (deferred)

- Free rotation for Composable. Schema already accommodates it via the
  documented future `'free'` value of `rotationMode`.
- Per-style rotation defaults (e.g. composable-on, classic-off).
- Cosmetic spawn-bounds drift fixes for non-square pieces (gather pass
  hides the issue).
- Renaming or restructuring `FractalConfigPreference` beyond removing
  `rotationEnabled`.

## Risks

- **Classic pieces have visually obvious orientation cues** — flat outer-frame
  edges signal which side of the puzzle a piece belongs to. Rotation breaks
  that cue. This is the *point* of a rotation puzzle, but classic-with-rotation
  will feel different from fractal-with-rotation; not a bug.

## Tests

- `new-game-dialog.test.ts`: drop `rotationEnabled` from `FractalDialogConfig`
  literals; add coverage that the new top-level checkbox produces
  `rotationEnabled: true` in `onSelect` regardless of selected cut style.
- `rotation-preference.test.ts` (new): round-trip save/load, default-false on
  missing/invalid storage.
- `fractal-config.test.ts`: drop `rotationEnabled` from fixtures and
  assertions.
- `init.test.ts`: extend the existing `rotationMode === 'quarter-turn'` test
  with cases for `cutStyle: 'classic'` and `cutStyle: 'composable'`.
- `share-link.test.ts`: add round-trip cases with `c: 'classic', r:
  'quarter-turn'` and `c: 'composable', r: 'quarter-turn'` to lock in
  cross-style support.
- `info-modal.test.ts`: update assertions on the rotate help text to match the
  new wording.
- `reconstruct-groups.test.ts`: existing classic+quarter-turn parameter case
  continues to pass (no logic change).
