# New Game modal responsiveness — design

**Date:** 2026-07-22
**Status:** Approved

## Problem

The New Game dialog (`src/ui/new-game-dialog.ts`, styled as
`.size-picker-dialog` in `src/style.css`) has grown to 623px tall in its
default state and 845px with the Composable section expanded. The overlay
flex-centers it with no `max-height` and no scrolling, so on short
viewports (phone landscape is ~375px tall) both the top and the bottom of
the dialog extend past the viewport edges and are unreachable.

Two further pre-existing layout defects surfaced during investigation:

- The **"Puzzle Size" heading is orphaned**: it is appended directly under
  the dialog title, while the size grid it labels renders much further
  down, after the image-source rows.
- The Composable **"Tab style" segmented control overflows horizontally**
  (the "None" segment clips off the dialog's right edge) because
  `.dialog-row` is a non-wrapping flex row.

The info modal already solves the vertical-fit problem (`max-height: 80vh`
plus an internal scrolling body); the New Game dialog never got the same
treatment.

This fix is a prerequisite for the upcoming image-selection UI, which will
add more content to the dialog.

## Design

### Structure (`new-game-dialog.ts`)

The `New Game` title (`h2`) stays as a pinned, non-scrolling header. All
other content moves into a scrollable `.dialog-content` wrapper containing
two group containers:

- **Group A — settings:** Cut Style picker → Enable rotation → per-style
  option sections (fractal, wavy, composable sliders).
- **Group B — start:** image-source rows → "Puzzle Size" heading → size
  grid.

This fixes the orphaned heading (it now sits directly above its grid) and
moves the Composable sliders above the size grid — clicking a size starts
the game immediately, so all configuration belongs before it. In portrait
the groups simply stack.

### CSS — vertical fit

- `.size-picker-overlay` gains padding (16px) so the dialog never touches
  viewport edges.
- `.size-picker-dialog` becomes a flex column with `max-height: 100%`
  (relative to the padded overlay) and `overflow: hidden`.
- `.dialog-content` scrolls internally: `overflow-y: auto;
  overscroll-behavior: contain`. Dialog padding is rearranged so the
  scrollbar sits inside the dialog border, following the info-modal
  pattern.

### CSS — landscape two-column layout

One media query for short-and-wide viewports (approximately
`(min-width: 700px) and (max-height: 560px)`; breakpoints may be tuned
during verification):

- `.size-picker-dialog` widens (max-width ~680px).
- `.dialog-content` becomes a two-column grid (`1fr 1fr`, `align-items:
  start`) with Group A left and Group B right.
- Internal scrolling remains as fallback when even two columns don't fit
  (e.g. Composable open on a very short screen).

### CSS — row wrapping

`.dialog-row` gets `flex-wrap: wrap` so wide controls (the segmented
Tab-style picker) wrap below their label instead of clipping.

## Quality bar

Composable is dev-only; it must be **usable** in all viewports (reachable
controls, nothing clipped) but does not need to look polished.

## Out of scope / future considerations

- **Image-selection UI** (the motivating feature) comes in a follow-up.
- **Separate "Start" button:** picking a size immediately starts the game,
  which may not be obvious. If this re-layout makes that flow less
  discoverable, adding an explicit Start button is a candidate follow-up —
  noted here so the layout work keeps it in mind, not part of this change.
- No help-text (info modal) changes: layout-only, and the modal doesn't
  describe the dialog's layout.

## Testing

- Update the jsdom unit tests in `new-game-dialog.test.ts` for the new
  wrapper structure (dialog behavior/API unchanged).
- Playwright verification at phone-landscape (812×375), phone-portrait
  (375×667, 360×640), small portrait with Composable open, and desktop
  (1280×800), in both Classic and Composable states: full dialog reachable
  (scroll where needed), no horizontal clipping, size buttons clickable.
