# Portrait aspect-ratio support — design

**Date:** 2026-07-15
**Status:** Approved (pending spec review)

## Problem

The puzzle app only ever builds landscape puzzles. On a portrait screen
(a phone held upright) the puzzle is a wide rectangle that wastes most of
the viewport. We want a new puzzle to match the shape of the screen it's
created on: a portrait viewport should produce a portrait puzzle from a
portrait image.

Two things are hardcoded to landscape today:

1. The Unsplash request pins `orientation: 'landscape'`
   (`src/images/unsplash.ts:72`).
2. Every grid preset in `PUZZLE_SIZE_OPTIONS` is landscape (`cols > rows`:
   6×4, 8×6, 12×8, 16×12 — `src/game/puzzle-sizes.ts`).

Everything downstream is already aspect-agnostic: `resolve-image.ts`
derives the image size from the photo's real dimensions; the fractal
`inscribeToGridAspect` and the triangular generator already reason about
both wider- and taller-than-grid cases; the renderer uses
`preserveAspectRatio="xMidYMid slice"`; and the share/save payload encodes
the grid (`g`) and image size (`is`) explicitly.

## Decision summary

- **Orientation is auto-only for now**, derived from the viewport aspect
  ratio at the moment a new puzzle is generated. No UI control. It is
  threaded as an explicit parameter so a Landscape/Portrait/Auto control
  can be added later without reshaping the code.
- **Portrait puzzles transpose the selected grid preset** (6×4 → 4×6),
  keeping the piece count identical. No new presets.
- **All three image sources honor orientation**: Unsplash (request param),
  the blank canvas (swapped dimensions), and the bundled first-run /
  fallback image (a new portrait asset added alongside the landscape one).
- **The `cols × rows` dimensions are removed from the size-picker buttons.**
  Only the piece count is shown. (It was already omitted for 2 of the 4
  cut styles, and piece count is what players care about.)

## Reproducibility (why this is safe)

Orientation is decided **once**, in `startNewGame`, before generation. It
never gets its own stored field — it only *chooses the inputs* (grid shape
and image) that are already part of the reproducibility contract:

- A puzzle built in portrait stores a portrait grid + portrait image size
  in its save and share link. Replaying a share link or save reconstructs
  the puzzle **from that stored payload** and never calls `startNewGame`,
  so the recipient's own viewport is irrelevant — a portrait puzzle stays
  portrait on a landscape screen, exactly as intended for an
  "exact-copy" share.
- Orientation adds **zero** `random()` calls. It changes the grid and
  image *inputs* to generation; the number and order of PRNG calls for a
  given grid is unchanged. The existing share-link PRNG contract is not
  touched, and no sub-PRNG isolation is needed.

## Components

### New: `src/app/orientation.ts`

```ts
import type { Size, GridSize } from '../model/types.js';

export type Orientation = 'landscape' | 'portrait';

/** Portrait when the viewport is taller than wide; square counts as landscape. */
export function orientationForViewport(size: Size): Orientation {
    return size.height > size.width ? 'portrait' : 'landscape';
}

/**
 * Normalize a grid to an orientation. Landscape puts the long axis
 * horizontal (cols >= rows); portrait puts it vertical (rows >= cols).
 * Defined by normalization, not a blind swap, so it is correct regardless
 * of the input grid's current orientation.
 */
export function orientGridSize(grid: GridSize, o: Orientation): GridSize {
    const long = Math.max(grid.cols, grid.rows);
    const short = Math.min(grid.cols, grid.rows);
    return o === 'portrait'
        ? { cols: short, rows: long }
        : { cols: long, rows: short };
}
```

Small, pure, and independently testable — no dependence on `main.ts` state.

### `src/images/unsplash.ts`

Thread orientation through the request builder and fetch:

- `buildRandomPhotoUrl(accessKey, query?, orientation: Orientation = 'landscape')`
  — sets `orientation` from the argument instead of the hardcoded literal.
- `fetchRandomImage(accessKey, fetchFn?, query?, orientation?)` — forwards
  it to `buildRandomPhotoUrl`.

Default stays `'landscape'` so any caller not yet updated is unchanged.

### `src/app/resolve-image.ts`

`resolveUnsplashImage(accessKey, imageCategory, vibrant, orientation, fetchFn?)`
forwards `orientation` to `fetchRandomImage`. The existing size math is
unchanged: it fixes `displayWidth = 1080` and derives height from the
photo's real aspect ratio, which already yields a correct tall image for
portrait photos (e.g. 1080×1620), well under the `MAX_IMAGE_DIM` cap.

### `src/app/bundled-image.ts`

Add a portrait asset next to the existing landscape one and a selector:

- Keep `BUNDLED_IMAGE_URL` / `BUNDLED_IMAGE_SIZE` / `BUNDLED_IMAGE_ATTRIBUTION`
  (landscape) **untouched** — old saves/links reference them.
- Add `BUNDLED_PORTRAIT_IMAGE_URL`, `BUNDLED_PORTRAIT_IMAGE_SIZE`,
  `BUNDLED_PORTRAIT_IMAGE_ATTRIBUTION` for the new asset.
- Add `pickBundledImage(orientation): { url; size; attribution }`.

**New asset:** the photo the user chose,
`https://unsplash.com/photos/q5BV6DBTpFM` (pastel buildings, portrait).
During implementation: download it into `public/` (e.g.
`first-puzzle-portrait.jpg`) sized to 1080px wide like the delivered
Unsplash regulars, record its real pixel dimensions in
`BUNDLED_PORTRAIT_IMAGE_SIZE`, and fill in the photographer name / profile
URL / photo URL (with `utm_source=puzzle&utm_medium=referral`) in the
attribution, matching the format of the existing landscape entry.

### `src/main.ts` — `startNewGame`

The single decision point. Right after it reads `viewport`
(`main.ts:918`):

```ts
const orientation = orientationForViewport(viewport);
gridSize = orientGridSize(gridSize, orientation);
```

Then image selection uses `orientation`:

- **Default (first-run / fallback):** `pickBundledImage(orientation)`
  supplies `imageUrl` / `imageSize` / `attribution` instead of the fixed
  landscape constants.
- **Blank:** build the canvas at `720×1080` when portrait, `1080×720`
  when landscape (`imageSize` matches).
- **Unsplash:** pass `orientation` into `resolveUnsplashImage`.

`createNewGame(imageUrl, imageSize, viewport, gridSize, …)` is called with
the already-transposed grid; nothing downstream changes.

### `src/ui/new-game-dialog.ts` — size picker

Remove the `size-picker-dims` (`${cols} × ${rows}`) element from
`buildSizeSection`'s `updateLabels`. Keep the count (with the `~` prefix
for the approximate cut styles) and the "pieces" label. `isApproximate`
stays — it still drives the `~` prefix. The now-unused `.size-picker-dims`
CSS rule is removed as well.

## Data flow

```
New Game click
  → dialog → NewGameSelection { sizeId, cutStyleId, … }   (no orientation field)
  → onSelect → startNewGame(gridSize = toGridSize(option), …)
      → viewport = { app.clientWidth||innerWidth, app.clientHeight||innerHeight }
      → orientation = orientationForViewport(viewport)
      → gridSize   = orientGridSize(gridSize, orientation)
      → image:
          blank    → oriented white canvas
          unsplash → resolveUnsplashImage(…, orientation)
          default  → pickBundledImage(orientation)
      → createNewGame(imageUrl, imageSize, viewport, gridSize, …)
      → save / share encode the portrait grid + image size
Share-link / save load  → decodePayload → reconstruct from stored g + is
      (never calls startNewGame; recipient viewport ignored)
```

## Edge cases

- **Square viewport** → landscape (the existing default; `>` not `>=`).
- **Degenerate viewport** (0 width/height): `orientationForViewport`
  returns landscape for any non-taller-than-wide case, so a `0×0` fallback
  is landscape — safe.
- **Grid already portrait** (future-proofing / non-preset grids):
  `orientGridSize` normalizes rather than blind-swaps, so it's idempotent
  and correct regardless of the input's orientation.
- **`nature` category query** (`'nature landscape'`, image-categories.ts):
  left unchanged. "landscape" here is a scenery search term, not an aspect
  hint; Unsplash still returns portrait-cropped scenery under
  `orientation=portrait`.

## Testing

Tests live next to their source (repo convention):

- **`src/app/orientation.test.ts`** (new): `orientationForViewport` for
  landscape / portrait / square / degenerate; `orientGridSize` for
  landscape normalization, portrait transposition, and already-portrait
  input.
- **`src/images/unsplash.test.ts`**: `buildRandomPhotoUrl` emits
  `orientation=portrait` and `orientation=landscape`; default is landscape.
- **`src/app/resolve-image.test.ts`**: orientation is forwarded to the
  fetch; a mocked portrait response yields a portrait `imageSize`.
- **`src/app/bundled-image.test.ts`** (new or extended): `pickBundledImage`
  returns the correct URL / size / attribution per orientation.
- **`src/ui/new-game-dialog.test.ts`**: size-picker buttons no longer
  render a dims element (update any existing assertion on `.size-picker-dims`).

## Help text

No `info-modal.ts` change. "The puzzle matches your screen's shape" is
behavior a player would naturally expect, and the repo's help-text rule is
to document only the non-obvious. Auto orientation is invisible and
expected; adding copy would only lengthen the modal.

## Files touched

- **New:** `src/app/orientation.ts`, `src/app/orientation.test.ts`
- **New asset:** `public/first-puzzle-portrait.jpg`
- `src/images/unsplash.ts` (+ test)
- `src/app/resolve-image.ts` (+ test)
- `src/app/bundled-image.ts` (+ test)
- `src/main.ts` (`startNewGame`: derive orientation, transpose grid,
  oriented blank, `pickBundledImage`)
- `src/ui/new-game-dialog.ts` (remove size-picker dims) + CSS + test

## Out of scope (deliberately deferred)

- A user-facing Landscape/Portrait/Auto control. The parameter threading
  makes this a small follow-up.
- Re-orienting an already-generated puzzle when the device rotates.
- Portrait-specific piece-count presets (transposition reuses the existing
  counts).
