# Adaptive selection glow (luminance-flip)

## Problem

The multi-select highlight is a 3-layer `drop-shadow` glow on
`[data-group-id].selected`, colored by `--ui-accent`, which is hardcoded to
`--color-violet-light` (`src/style.css:29`). The glow reads well on most
solid background swatches but **washes out on the violet/purple-family
backgrounds** — a violet glow on a violet background of similar lightness has
almost no edge separation.

The eye separates edges mostly by **lightness**, not hue. On the default
dark-indigo background the violet glow is visible purely because it is much
lighter than the background. It fails when the background is *both* close in
hue *and* close in lightness.

Goal: keep the purple identity, add no user-facing option, and guarantee the
glow stays visible — specifically by guaranteeing **lightness** separation.

## Approach

Keep the violet hue always; flip only its **lightness** to oppose the
background, reusing the light/dark scheme the app already derives.

`applyBackgroundColor` (`src/ui/background-color.ts`) already resolves the
chosen background to a concrete `rgb()` and sets
`document.documentElement.dataset.uiScheme = 'light' | 'dark'` from its
relative luminance (threshold 0.4). It already re-runs on background change
and on OS color-scheme change. We key the glow off that existing signal — no
new JS.

### Changes (CSS only, `src/style.css`)

1. **`:root`** (near line 36): introduce a dedicated variable
   ```css
   --selection-glow: var(--color-violet-lighter);
   ```
   Dark backgrounds (the default scheme) get a pale violet — a notch lighter
   than the chrome accent (`--color-violet-light`), for maximum lightness
   separation from the background. This does change the dark-background glow
   slightly (paler, higher-contrast) rather than preserving the old accent tone.

2. **`[data-ui-scheme="light"]`** block (line 47): override it
   ```css
   --selection-glow: var(--color-violet-darker);
   ```
   On light backgrounds the glow becomes a dark violet, reading like a
   colored shadow instead of a same-lightness wash.

3. **Retarget the two selection rules** from `var(--ui-accent)` to
   `var(--selection-glow)`:
   - `[data-group-id].selected` (lines 403–405)
   - `[data-group-id].selected.dragging` (lines 412–414)

   The `.dragging`-only rule (line 418, a plain black shadow) is unaffected.

### Why a new variable, not flipping `--ui-accent`

`--ui-accent` also colors buttons, borders, checkboxes, swatches, and links
(many call sites in `style.css`). Flipping it wholesale by scheme would
restyle all chrome per background. A dedicated `--selection-glow` confines
the change to exactly the selection highlight.

## The one tuning knob

The light-scheme tone. Shipped value is `--color-violet-darker`
(`#311b92` light / `#29167f` dark), one step darker than the `--color-violet-dark`
starting point, chosen so the glow still reads as a colored shadow on the very
light backgrounds (`violet-lighter`, `yellow-lighter`, etc.). Single-line change,
eyeballed on dev-deploy.

## Testing

CSS-only; no new JS logic. The luminance→`data-ui-scheme` path is already
covered by `src/ui/background-color.test.ts`. Add a small guard asserting the
`.selected` rules reference `--selection-glow` (not `--ui-accent`) so an
accidental revert is caught. Primary verification is visual on dev-deploy:
choose a light-violet background, select a group, confirm the glow reads.

## Not touched

- `--ui-accent` and the rest of the UI chrome.
- The PRNG / share-link reproducibility contract (no generation involvement).
- The info-modal: it describes multi-select but never the glow's color, and
  "the selection highlight stays visible on any background" is behavior a
  player expects — no help-text change (per `CLAUDE.md`).

## Iteration path if insufficient

If the two-tone flip is not enough on mid-lightness violet backgrounds near
the 0.4 threshold, escalate that specific case with a targeted hue-shift
(compute hue distance from violet in `applyBackgroundColor`, swap
`--selection-glow` to a contrasting hue only for the purple family). The
variable seam added here is the same one that escalation would drive.
