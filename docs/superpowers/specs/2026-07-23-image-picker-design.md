# New Game image picker — design

**Date:** 2026-07-23
**Status:** Approved

## Problem

The New Game dialog offers no way to see or choose the puzzle image. The
"Image" control is a two-entry dropdown (Random photo / Blank), and the
actual photo is fetched server-side-random from Unsplash's
`/photos/random` only after the game starts — the player first sees their
image when the pieces appear.

Players should be able to pick from a small selection of candidate
images, refresh that selection, or still opt for a surprise.

## Interaction model

The dialog's "click to start" trigger moves from the size grid to the
image controls:

- **Image buttons are the triggers.** Clicking any of the four candidate
  thumbnails, **Surprise me**, or **Blank puzzle** immediately dismisses
  the dialog and starts a new puzzle with that image plus all
  currently-set options. There is no selected-thumbnail state and no
  image-mode toggle.
- **Size becomes an option like any other.** The 2×2 size-button grid is
  replaced by a `select`, persisted exactly as the size preference is
  today. The approximate-count labels used for fractal/triangles
  (`~N pieces`) move into the option labels and still update when the
  cut style changes.
- Rationale: players tend to have a preferred size they reuse across
  games, so re-clicking it every time is wasted motion — but choosing an
  image is a genuinely per-game decision.

## UI & layout

- **Grouping:** the size select joins the settings group (cut style,
  rotation, per-style options, picture type, vibrant). The start group
  becomes purely the image picker, so in the wide two-column layout the
  left column holds all options and the right column is the action. Its
  heading reads **"Pick an image to start"** to make the affordance
  explicit.
- **Image section layout,** top to bottom:
  - Header row: the heading plus a refresh (↻) icon button. Refresh
    re-rolls the four candidates and is the one image-adjacent control
    that does *not* start a game — hence icon-only and placed in the
    header, visually distinct from the trigger buttons.
  - 2×2 grid of four photo thumbnails, styled after the existing
    selectable-grid pattern (`.cut-style-grid`). Thumbnails hotlink
    Unsplash `urls.small`, cropped uniformly with `object-fit: cover`,
    alt text from the photo description. The grid has a fixed aspect so
    dialog height stays stable while loading (skeleton tiles).
    - Each thumbnail carries a photographer-credit overlay (linked,
      UTM-tagged, per Unsplash attribution guidelines) on a bottom
      gradient scrim; credits hide during loading and after an error.
  - A row with two labelled buttons: **🎲 Surprise me** and
    **Blank puzzle**.
- **Picture Type** and **Vibrant colours** controls are unchanged;
  changing either re-fetches the candidates.

## Data flow

- `src/images/unsplash.ts` gains a multi-fetch variant using
  `/photos/random?count=4` — one API request returns four photos (same
  quota cost as today's single-photo fetch; note the Unsplash rate limit
  is per-application across all users, acceptable at current scale).
  Response parsing is shared with the existing single-photo path. Each
  candidate carries URL, dimensions, attribution, and
  `download_location`.
- New `src/ui/image-picker.ts` (the dialog module is already ~725
  lines) owns candidate state (loading / loaded / error), fetch triggers
  (dialog open, category or vibrant change, refresh) with stale-response
  protection, and invokes a callback when an image button is clicked.
- `NewGameSelection` gains an image-choice field: a concrete photo
  (URL, dimensions, attribution, download location), `'surprise'`, or
  `'blank'`, replacing the current `imageSource` string internally.
- `startNewGame`:
  - concrete photo → used directly, no second API call; the URL is
    trusted once resolved, exactly like the existing random path (the
    bundled-image fallback applies at fetch time — there is no
    load-time fallback on either path);
  - `'surprise'` → the existing random-fetch path, unchanged;
  - `'blank'` → the existing blank-canvas path, unchanged.
- Per Unsplash API guidelines, a used photo's `download_location` is
  triggered at game start (not on thumbnail display). Check whether the
  current random path already does this and make both paths consistent.
- Candidate fetches use the same orientation logic as today's
  random-image fetch.

## Degradation & errors

- Fetch failure (offline, rate-limited): the grid shows a small inline
  error with the refresh button as retry; Surprise me and Blank still
  work (Surprise already falls back to the bundled image). The error
  message is announced politely to screen readers (`aria-live="polite"`).
- No API key configured (dev builds): the thumbnail grid is hidden and
  the section degrades to Surprise me + Blank.
- Share links and saves are untouched — they already store the resolved
  image URL, size, and attribution verbatim, and the cut-seed PRNG
  contract is not involved in image choice.

## Persistence

- Size, cut style, rotation, category, and vibrant preferences persist
  exactly as today.
- `puzzle-image-source` keeps being written on start (`random` for a
  thumbnail or Surprise me, `blank` for Blank) because first-run
  detection depends on the key existing; no UI default reads it anymore.
- A picked thumbnail is a per-game choice and is not persisted as a
  preference.
- First-run behaviour (bundled `first-puzzle.jpg`, no fetch) is
  unchanged.

## Help text

The info modal describes starting a game by picking a size; that copy is
now wrong and must be rewritten to the new flow in the same PR (required
under the repo help-text rule). Audit the Settings section for the
removed "Image" dropdown wording. Keep additions minimal per the repo
convention.

## Testing

Vitest, tests colocated with source:

- multi-photo response parsing next to `unsplash.ts`;
- picker state logic (fetch triggers, stale-response protection, error
  states, callback wiring) next to `image-picker.ts`;
- `startNewGame` image-resolution branching where practical.

## Analytics

`new-game-started` gains `imagePicked` (boolean) for fresh unsplash
games: `true` when the player tapped a specific candidate thumbnail,
`false` for "Surprise me". Absent for shared/resumed games and
non-photo sources.
