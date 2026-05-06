# Free rotation — design

## Summary

Add a third rotation mode, `'free'`, that lets the player rotate piece-groups
to any angle (not just multiples of 90°). Available only with the **composable**
cut style, gated on a sub-checkbox inside the existing composable options
section in the new-game dialog. Two adjacent groups can merge when their
rotations are within ±10° of alignment; on merge, the moved group's rotation
snaps to match the target's (mirroring how positions already snap on merge).

The interaction model replaces the two CCW/CW buttons with a single round
"rotate handle" anchored below the focused group's bbox. A drag that originates
on the handle rotates the group such that the angle from the group's bbox
centre to the pointer remains constant — i.e. the pointer "drags" the handle
around the bbox centre on a virtual dial. Works on both touch and mouse.

## Goals

- Free, continuous rotation of groups in composable puzzles.
- Single-input gesture that works on phone, tablet, and desktop.
- Clean migration path from the existing quarter-turn data representation.
- Share-link round-trip with negligible visual error.

## Non-goals

- Free rotation for classic or fractal cut styles. (Their pieces' "cardinal
  directions" are obvious, so quarter-turn continues to fit those styles.)
- Inertia / momentum on rotation release.
- An angle-readout overlay or angular tick marks during the drag. (Possible
  follow-up after we play with a deploy.)
- A snap-to-90 affordance during free-rotation drag.

## Mode model

`GameState.rotationMode` gains a third value:

```ts
rotationMode?: 'none' | 'quarter-turn' | 'free';
```

`'free'` is composable-only. If a saved game or share link reports
`rotationMode: 'free'` with `cutStyle !== 'composable'`, treat it defensively
as `'quarter-turn'`.

## New-game dialog

The top-level "Enable rotation" checkbox stays exactly as it is today —
applies to any cut style and toggles between `'none'` and `'quarter-turn'`
(or `'free'`, see below).

A new sub-checkbox **"Free rotation"** is appended inside the composable
options section, after the existing sliders and "Disable Tabs". It is
rendered only when:

- "Enable rotation" is checked, **and**
- cut style is composable.

If either condition is false, the sub-checkbox is hidden (its state is
preserved in the DOM but not surfaced).

On submit, `rotationMode` is computed as:

- `'free'` if `rotationEnabled && cutStyle === 'composable' && freeChecked`
- `'quarter-turn'` if `rotationEnabled` (and the above doesn't apply)
- `'none'` otherwise

A new `puzzle-free-rotation-enabled` localStorage preference (parallel to the
existing `puzzle-rotation-enabled` one) stores the sub-checkbox state across
sessions.

## Internal rotation representation

`PieceGroup.rotation` changes from a quarter-turn count to a float-degrees
value:

```ts
// before
rotation: 0 | 1 | 2 | 3;

// after
rotation: number; // float, in [0, 360)
```

- Quarter-turn mode stores `0 / 90 / 180 / 270` (clean integers).
- Free mode stores any float in `[0, 360)`.

A new helper `normaliseDegrees(deg: number): number` returns a value in
`[0, 360)`, used wherever rotations are compared, displayed, or persisted.
The existing `normaliseQuarterTurns` stays for quarter-turn book-keeping
(still useful when adding ±90° in `rotateGroup` calls from the
quarter-turn buttons).

### Save-format migration

Per the project's "keep old save-format migrations" rule, add a new
save-format version that maps the old `rotation: 0|1|2|3` field to
`rotation: number` by `oldValue * 90`. All previous migration steps stay.
The runtime model is always degrees post-migration.

## `rotateGroup` refactor

Generalise the function from "rotate by a fixed direction" to "rotate by an
arbitrary delta in degrees", keeping its existing bbox-centre pivot:

```ts
// before
rotateGroup(group, piecesById, direction: 'cw' | 'ccw'): PieceGroup

// after
rotateGroup(group, piecesById, deltaDegrees: number): PieceGroup
```

The current "preserve bbox-centre in world space" math generalises directly
from quarter-turns to arbitrary float deltas:

```
position' = position + R_old(centreLocal) − R_new(centreLocal)
```

where `R_θ(p)` is the standard 2D rotation of point `p` by `θ` degrees.
`rotatePoint` already supports arbitrary angles in radians; the boundary
between degrees and radians lives inside `rotateGroup` and the gesture
handler — everywhere else the unit is degrees.

Quarter-turn callers (`onRotate('cw' | 'ccw')` from `rotate-buttons.ts`) pass
`+90` or `-90` and get the existing behaviour bit-for-bit. The
`RotationDirection` type stays as a UI-level concept inside `rotate-buttons.ts`
and maps to `±90` at the call site.

## Init randomisation

In `init.ts`, the existing `rotationMode === 'quarter-turn'` branch
randomises each group's rotation to one of `{0, 1, 2, 3}` (post-unification:
`{0, 90, 180, 270}`) using the puzzle's seeded PRNG. Add a parallel
`rotationMode === 'free'` branch that uses the **same PRNG instance** to draw
each group's rotation as `prng() * 360` (float). Drawing from the same PRNG
preserves seeded share-link reproducibility — the PRNG call-count contract
matters here exactly as it does for cut generation.

## Merge detection with angular tolerance

`checkEdgeAlignment` (in `merge-detection.ts`) currently has an exact
rotation gate: `if (movedGroup.rotation !== targetGroup.rotation) reject`.
Replace it with a wrap-aware tolerance check, applied unconditionally
regardless of mode:

```ts
const MERGE_ROTATION_TOLERANCE_DEG = 10;

function signedAngularDelta(a: number, b: number): number {
    // Returns the smallest signed delta in (-180, 180].
    const raw = ((a - b) % 360 + 540) % 360 - 180;
    return raw;
}

if (Math.abs(signedAngularDelta(movedGroup.rotation, targetGroup.rotation))
        > MERGE_ROTATION_TOLERANCE_DEG) {
    return { aligned: false, snapDelta: ZERO };
}
```

In quarter-turn mode the rotations are always clean integer values
(0/90/180/270), so the tolerance check produces identical accept/reject
decisions to the previous exact equality — quarter-turn behaviour is
unchanged.

### Snap-on-merge order

When both rotation and position checks pass, the merge step:

1. **Snap rotation.** Set `movedGroup.rotation = targetGroup.rotation` and
   adjust `movedGroup.position` so the group's bbox centre stays fixed in
   world space (use `rotateGroup(...delta...)` with `delta = target − moved`).
2. **Compute position snap.** Recompute world endpoint positions from the
   now-rotation-corrected moved group; compute the position snap delta
   from the (now-aligned) endpoints.
3. **Apply position snap and merge** (existing behaviour).

This preserves the current invariant that on merge, the moved group is the
one that gets cleaned up to match the target.

## Drag-handle component

New file `src/ui/rotate-handle.ts`. Lifecycle and DOM patterns parallel
`rotate-buttons.ts`:

- Subscribes to `RotationFocus.onChange`.
- Spawns a single button on focus; quick-fades on focus change to a different
  group; slow-fades after 5 s idle and clears focus on full fade-out.
- Re-tap of the same group during quick-fade rescues the handle, mirroring
  the existing rotate-buttons rescue path.

`RotationFocus` is **unchanged** — it continues to track only the focused
group ID. The pivot for the gesture is the group's bbox centre, so no per-
piece information is needed.

### Visuals

- **Shape:** fully round (`border-radius: 50%`), 44 px diameter.
- **Icon:** bidirectional rotation glyph — two opposing curved arrows
  forming a closed circle (or one circular path with arrowheads at both
  ends). Distinct from the unidirectional curved-arrow used by the
  quarter-turn buttons; the round shape signals "free spin" while the
  rectangular CCW/CW buttons signal "fixed step."

### Spawn position

Centred horizontally below the focused group's world-space bbox bottom,
with the existing `BUTTON_GAP_PX` and viewport-edge margin/clamping. Uses
the same `getFocusedGroupScreenBounds` projection that `rotate-buttons`
already consumes:

```
naturalLeft = (bounds.left + bounds.right) / 2 − BUTTON_SIZE / 2
naturalTop  = bounds.bottom + BUTTON_GAP_PX
```

Clamped to viewport with `VIEWPORT_MARGIN_PX`.

### Mode-aware UI swap

In `main.ts`, the existing wiring that creates `rotate-buttons` becomes
conditional on rotation mode:

- `rotationMode === 'quarter-turn'` → create `rotate-buttons` (today's pair).
- `rotationMode === 'free'` → create `rotate-handle` (new single round button).
- `rotationMode === 'none'` → create neither.

### Gesture math

On `pointerdown` on the handle:

```
pivotLocal = group's local bbox centre (already computed by getGroupLocalBounds)
P = group.position + rotate(pivotLocal, group.rotation)   // world-space pivot
Q0 = screenToWorld(event.clientX, event.clientY)
R0 = group.rotation
θ0 = atan2(Q0.y - P.y, Q0.x - P.x)
```

On each `pointermove`:

```
Q = screenToWorld(event.clientX, event.clientY)
θ = atan2(Q.y - P.y, Q.x - P.x)
R_new = normaliseDegrees(R0 + (θ - θ0) * 180 / π)
delta = signedAngularDelta(R_new, group.rotation)
rotateGroup(group, piecesById, delta)
// re-render
```

`P` is captured once at touchstart and held fixed for the duration of the
drag — this is what makes the bbox centre stay put.

On `pointerup`: stop. Run merge detection on the rotated group (positional
mate check + angular check via the unified 10° tolerance). If merge
candidate found, perform the snap-on-merge sequence above.

On `pointercancel` or 2nd-finger cancel: stop, leave the group at its
current rotation, no rollback.

### Pointer capture and visual coupling

The handle calls `setPointerCapture` on its own DOM element so that
`pointermove`/`pointerup` continue to fire even when the pointer leaves the
button. During the drag, the handle is **rendered at the pointer's screen
position** (i.e. follows the finger), decoupled from its piece-anchored
resting position. On release, the handle returns to its anchor — which has
moved because the group has rotated and the bbox bottom shifted.

(The world-space bbox shape wobbles as the group rotates, since the local
bbox is fixed but its rotated extents change with angle. The bbox **centre**
stays fixed throughout the drag — the `rotateGroup` invariant — so the
gesture math is unaffected; only the resting anchor position shifts on
release.)

### Multi-finger arbitration

While drag is active, the handle component listens for `pointerdown` on the
canvas (or `window`). Any additional pointer landing immediately cancels
the rotation drag and releases pointer capture. The group keeps its current
rotation (no rollback). The canvas's `PointerRouter` continues to route the
new finger normally, so pinch-zoom can start cleanly.

No auto-pan during rotation drag — the pivot is the group's bbox centre,
and dragging the pointer to the screen edge has no useful effect on rotation.

## Share-link encoding

Two encoding sites in `share-link.ts`:

- `pr.mr` (merged-group rotations): currently quarter-turn integers per
  group. Change to integer `0–359` degrees per group:
  `Math.round(g.rotation) % 360`.
- `sr` (sparse solo-piece rotations): currently `(pieceId, rotation)` pairs
  with rotation in `0–3`, encoded only when non-zero. In free mode, every
  solo piece will have a non-zero random rotation, so the sparse encoding
  becomes effectively dense. Keep the format and accept the size hit;
  composable free-rotation puzzles are not large in practice.

On decode, the integer `0–359` value is restored as a float `rotation`
directly. The 10° merge tolerance dominates the 0.5° round-trip error
introduced by the integer rounding, so a shared puzzle plays the same as
the original.

The PRNG-call-count contract for procedural cut generation is unaffected —
this change touches only the post-cut rotation values.

## Help-text update

Update `info-modal.ts`'s **How to Play**, **Cut Styles**, and **Settings**
sections in the same PR as the drag-handle UI:

- **How to Play**: a paragraph describing the rotate handle for free
  rotation — single round button below the focused group, drag to rotate,
  follows finger, second touch cancels.
- **Cut Styles**: under composable, mention that free rotation is available.
- **Settings**: document the new sub-checkbox.

## Testing

New / extended tests:

- `rotate-group.test.ts`: arbitrary-angle inputs (e.g. 47°, 350°), bbox-
  centre invariant holds across non-quarter-turn deltas, exact 90°/180°/
  270° still produce identical positional results to today.
- `merge-detection.test.ts`: angular tolerance gate accepts within ±10°,
  rejects beyond, wraps correctly across the 0/360° boundary; quarter-turn
  rotations still merge identically to today; snap-on-merge produces
  matching post-merge rotations.
- `init.test.ts`: free-rotation init draws float angles in `[0, 360)` and
  is reproducible from the same seed.
- `share-link.test.ts`: round-trip free-mode rotations through encode →
  decode within 1° rounding tolerance; quarter-turn round-trips are
  unchanged.
- `new-game-dialog.test.ts`: "Free rotation" sub-checkbox visibility gated
  on `rotationEnabled && cutStyle === 'composable'`; submission produces
  the correct `rotationMode` for each combination of toggles.
- New `rotate-handle.test.ts`: gesture math (touchstart captures pivot,
  pointermove computes correct `R_new` for synthetic angles, pointerup
  runs merge detection); 2nd pointerdown cancels drag; idle timeout / quick-
  fade lifecycle parallel to rotate-buttons tests.
- Save-format migration test: old quarter-turn saves load with rotation in
  degrees (0 / 90 / 180 / 270).

## Implementation split

Two PRs:

1. **Rotation-as-degrees refactor.** Mechanical: `PieceGroup.rotation: number`,
   `rotateGroup(deltaDegrees)`, save-format migration, `normaliseDegrees`
   helper, update all consumers. **No new feature.** Quarter-turn mode
   continues to behave identically. Tests that previously asserted
   `rotation === 1` now assert `rotation === 90`.
2. **Free-rotation feature.** Adds `rotationMode: 'free'`, init randomisation,
   merge-detection angular tolerance, share-link encoding update, new-game
   dialog sub-checkbox + preference, `rotate-handle` component, mode-aware
   UI swap in `main.ts`, help-text update. End-to-end shippable.

## Risks and unknowns

- **10° tolerance feel.** The chosen value is a starting guess. Tune on the
  PR-2 dev-deploy if it feels too forgiving or too strict.
- **Bidirectional icon design.** SVG to be drawn during PR 2 implementation —
  not a spec-level decision. A symmetric two-arrow circular glyph is the
  default direction.
- **Share-link size for fully-unsolved free-mode puzzles.** Solo pieces all
  carry a rotation pair, so links grow versus quarter-turn. Acceptable for
  composable puzzle sizes; revisit only if it becomes an issue in the wild.
