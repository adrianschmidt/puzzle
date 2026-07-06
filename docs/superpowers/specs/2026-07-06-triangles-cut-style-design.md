# Triangles cut style — design

**Date:** 2026-07-06
**Status:** Approved

## Goal

Release the triangular base cut generator to production as a new fixed-config
cut style named **Triangles**: jitter 0.5, flowing edges (smooth) enabled,
traced tabs. Follows the Wavy precedent — the configurable composable UI stays
dev-only; the preset ships a proven fixed config.

## Background constraints

- The triangular generator takes only `rows` from the size grid. Its column
  count derives from the frame aspect ratio (`cols ≈ (w/h)·rows·√3/2`, snapped
  to whole columns), so the piece count for a given size button varies with
  the image shape — and the random photo is fetched *after* the size button is
  clicked. Exact counts on the buttons are impossible; labels are approximate.
- `gameState.gridSize` (and the share-link `g` field) stores the *user-facing*
  grid; `scaleGrid` output is generation-only and is re-derived on decode from
  the encoded image size. Aspect-adaptive row selection is therefore
  share-link-safe.
- The generator draws exactly one outer PRNG value (sub-PRNG pattern), so the
  preset adds no new outer-stream calls and inherits reproducibility.
- The generator clamps rows to `MAX_ROWS = 16` and has no borderless support.

## Decisions (from brainstorming)

1. **Size buttons show static `~N pieces` labels** (like Fractal), no
   `cols × rows` dims. No dynamic label updates — picking a size closes the
   dialog and starts a new game with a new image.
2. **Row count is chosen adaptively at generation time** from the target count
   and the actual image aspect, so real counts land near the target for any
   photo shape.
3. **Rotation:** Triangles offers only the top-level "Enable rotation" toggle,
   and it enables **free rotation** directly (quarter-turn steps don't match a
   triangle lattice). The free-rotation sub-checkbox stays hidden for
   Triangles.
4. **Cut-style picker buttons must wrap** to a new line when they no longer
   fit, staying equal-width and aligned.

## Design

### 1. Cut style entry

- Id `'triangles'`, label "Triangles", short picker description.
- Listed after Wavy in `CUT_STYLE_OPTIONS` (`src/game/cut-styles.ts`),
  visible in prod (no dev gate). Classic remains the default style.

### 2. Strategy (`src/game/cut-style-strategies.ts`)

- `scaleGrid(userGrid, imageSize)`:
  - target = `userGrid.cols × userGrid.rows` (24/48/96/192);
  - pick the `rows` in 1..16 whose estimated triangle count is closest to the
    target, via an estimator that mirrors the generator's own column
    derivation (equilateral side from row height, `round(w/side)`, capped by
    the curve-budget column clamp) and per-strip triangle count;
  - return `{ cols: userGrid.cols, rows: chosenRows }` (the generator ignores
    `cols`). For a 3:2 landscape this lands at roughly rows 3/4/6/8.
    Extreme portraits (≳1:3) hit the MAX_ROWS clamp and produce fewer pieces
    than the target — accepted.
- `inscribePuzzleSize`: identity (full image).
- `generatePieces`: `generateComposablePuzzle` with the fixed config:
  - `baseCutGenerator: 'triangular'`,
    `baseCutConfig: { jitter: 0.5, smooth: true }`;
  - `tabGenerator: 'traced'`, `tabConfig: { traceSetVersion }`;
  - **no** `minPieceArea` — matches the dev-tested triangular path; column
    snapping already prevents sliver pieces;
  - `borderless: false`; `tabDebug` threaded through like Wavy.
- `configKey: 'trianglesConfig'` — `GameState.trianglesConfig` holds
  `{ traceSetVersion: number }`, pinned to `CURRENT_TRACE_SET_VERSION` at game
  creation (same future-proofing as Wavy's `tv`).

### 3. New-game dialog (`src/ui/new-game-dialog.ts`)

- Size buttons: for Triangles render `~N` + "pieces" and omit the dims line
  (same rendering branch as Fractal).
- Rotation: when the style is Triangles, hide the free-rotation sub-checkbox;
  the host maps rotation-enabled → `rotationMode: 'free'`.
- No sub-options section (no borderless; jitter/flowing/traced fixed).
- Traced-tab preload fires on selecting/opening with Triangles (like Wavy),
  and `main.ts`'s resume-path preload includes `cutStyle === 'triangles'`.

### 4. Cut-style picker layout (`src/style.css`)

`.cut-style-grid` changes from `display: flex` to CSS grid with
`repeat(auto-fill, minmax(110px, 1fr))` (starting value — tune visually so
3–4 buttons fit per row on desktop and 2 on narrow phones) so buttons wrap to
new lines as styles are added, staying equal-width and column-aligned.
`.cut-style-option` drops `flex: 1` (redundant under grid).

### 5. Share link & saves (`src/sharing/share-link.ts`, save state)

- `c: 'triangles'` plus new optional payload field `tf?: { tv: number }`
  (trace-set version pin), clamped on decode like Wavy's `wf.tv`.
- `GameState.trianglesConfig` round-trips through save files.
- Schema stays `v: 1`; existing links and saves are unaffected.

### 6. Info modal (`src/ui/info-modal.ts`)

- Add a Cut Styles entry, roughly: "Triangles — an irregular triangle lattice
  with flowing cuts and hand-traced tabs."
- Adjust rotation copy if it enumerates which styles support free rotation
  (Triangles: the rotation toggle gives free rotation).

### 7. Analytics

`cutStyle: 'triangles'` flows automatically through new-game/completion
events; include `traceSetVersion` in `NewGameData` like Wavy does.

## Error handling

No new failure modes: the generator already clamps rows/jitter and bounds its
curve budget against crafted links; decode clamps `tf.tv` the same way Wavy
does. Traced-chunk load failures follow the existing Wavy fallback/toast path.

## Testing

- Unit: rows-selection estimator (targets × aspects, MAX_ROWS clamp);
  strategy config shape (fixed jitter/smooth/traced, no minPieceArea, one
  outer-PRNG contract untouched); share-link round-trip for `c: 'triangles'`
  + `tf.tv`; dialog labels (`~N`, no dims, hidden free-rotation row for
  Triangles); rotation mapping (toggle → `'free'`).
- Verify via the real preload + registry path (traced generator sits behind a
  lazy stub), not direct imports.
