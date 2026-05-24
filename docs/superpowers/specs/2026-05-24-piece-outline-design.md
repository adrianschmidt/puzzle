# Piece outline — design

## Summary

Replace the resting-state drop-shadow on puzzle groups (currently
`drop-shadow(0 2px 4px ...)` on every `[data-group-id]`) with a
user-selectable **Piece outline** setting in the info modal's Settings
section. Three options:

- **None** — no filter on resting pieces.
- **Shadow** (default) — symmetric soft shadow:
  `drop-shadow(0 0 4px rgba(0, 0, 0, 0.35))`. Same depth intent as
  today, but rotation-invariant.
- **Outline** — a sharp 1px black silhouette around each group, drawn
  via an inline SVG `<filter>` that uses `feMorphology dilate` and
  composites the original on top. Referenced from CSS as
  `filter: url(#piece-outline)`.

The setting is persisted in `localStorage` under
`puzzle-piece-outline` and applied at boot via a single CSS custom
property `--piece-edge-filter` on `document.documentElement`. The
existing `.selected`, `.dragging`, and `.merge-pulse` filter rules
become compositions of `var(--piece-edge-filter, none)` plus their own
glow/lift layers, so the user's choice is preserved in every group
state. The drag-lift shadow becomes symmetric (`0 0 12px`) so it
doesn't reintroduce a rotation tell.

Outline colour is fixed black for v1. A user-pickable outline colour is
a follow-up.

## Goals

- Eliminate the rotation tell: no resting-state filter has a non-zero
  offset, so rotating a singleton group through the rotation transform
  on its `<div>` no longer rotates a directional shadow.
- Eliminate the tab/blank distortion on light backgrounds: users who
  notice the dark shadow halo can switch to **None** or **Outline**.
- Preserve depth cue for users who like the current look: **Shadow** is
  the default and looks identical to today's shadow apart from being
  centred rather than offset by 2px.
- Keep the selection glow, drag lift, and merge pulse working in all
  three modes.
- Keep the in-app help text in sync with the new setting (per the
  repo's `CLAUDE.md` rule).

## Non-goals

- User-pickable outline colour. (Follow-up.)
- Per-piece outlines (vs. group-perimeter). The filter is on the group
  `<div>`, so the dilation operates on the union of pieces and only
  the outer silhouette is outlined — exactly how today's shadow
  behaves. No change to per-piece DOM.
- Re-introducing a directional shadow on rotation puzzles via a
  different mechanism. (User has an idea for a later asymmetric
  variant that doesn't reveal rotation; out of scope here.)
- Changing the selection glow or merge-pulse animation timing.

## User-facing behaviour

### Info modal — Settings section

A new setting block, rendered immediately after **Snap distance** and
before **Offset drag**:

```
Piece outline
The visual edge drawn around each piece group.
[ None ]   [ Shadow ]   [ Outline ]
```

Styled identically to the existing **Snap distance** three-way picker
(same `info-setting` / button-row CSS). Selecting an option:

1. Saves the new id to `localStorage`.
2. Applies the new CSS variable value on `document.documentElement`,
   so the change is visible immediately without reload.

### Visual specs per mode

| Mode | `--piece-edge-filter` value | Rendered effect |
|---|---|---|
| None | `none` | No edge effect on resting pieces. |
| Shadow | `drop-shadow(0 0 4px rgba(0, 0, 0, 0.35))` | Soft symmetric dark halo, ~4px radius. |
| Outline | `url(#piece-outline)` | Sharp 1px black silhouette hugging the group's outer edge. |

`.selected`, `.dragging`, `.merge-pulse` compose
`var(--piece-edge-filter, none)` with their existing glow/lift
filters, so e.g. a selected group in **Outline** mode shows the 1px
outline AND the blue selection glow.

The `.dragging` lift glow changes from
`drop-shadow(0 6px 12px rgba(0, 0, 0, 0.45))` to
`drop-shadow(0 0 12px rgba(0, 0, 0, 0.45))` (zero offset). Same blur,
same darkness — drag still looks "lifted" because of the wider, darker
halo, but no directional bias.

### Help text

The info modal's Settings text gets a new entry describing the three
options. Wording matches the existing terse style of **Snap distance**
and **Offset drag**.

## Implementation

### New file: `src/ui/piece-outline.ts`

Mirrors `src/ui/background-colour.ts`. Exports:

```ts
export interface PieceOutlinePreset {
    id: string;          // 'none' | 'shadow' | 'outline'
    label: string;       // 'None' | 'Shadow' | 'Outline'
    description: string; // shown under the button (matches tolerance pattern)
    filter: string;      // CSS value for --piece-edge-filter
}

export const PIECE_OUTLINE_PRESETS: readonly PieceOutlinePreset[];
export const DEFAULT_PIECE_OUTLINE_ID = 'shadow';
export const PIECE_OUTLINE_PREFERENCE_KEY = 'puzzle-piece-outline';
export const CSS_CUSTOM_PROPERTY = '--piece-edge-filter';

export function getPieceOutlinePreset(id: string): PieceOutlinePreset;
export function loadPieceOutlinePreference(): string;
export function savePieceOutlinePreference(id: string): void;
export function applyPieceOutline(id: string): void;
```

Uses `createIdPreferenceStore` for persistence (same pattern as the
background-colour module — same legacy-order handling not needed
since this is brand new, but the helper is the established pattern).
`applyPieceOutline(id)` sets the CSS custom property on
`document.documentElement`.

### New file: `src/ui/piece-outline-filter.ts`

Tiny module responsible for injecting the SVG filter `<defs>` into the
DOM at boot. The filter:

```svg
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <filter id="piece-outline" x="-10%" y="-10%" width="120%" height="120%">
      <feMorphology in="SourceGraphic" operator="dilate" radius="1" result="dilated"/>
      <feFlood flood-color="black" result="colour"/>
      <feComposite in="colour" in2="dilated" operator="in" result="outline"/>
      <feMerge>
        <feMergeNode in="outline"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
</svg>
```

Exports a single function `installPieceOutlineFilter()` that appends
this SVG to `document.body` (idempotent: a second call is a no-op).
Called from `main.ts` near the existing background-colour boot block.

The filter region `(-10%, -10%, 120%, 120%)` gives 10% padding around
the element bounding box so the 1px dilation isn't clipped at the
edges. (Default region is `(-10%, -10%, 120%, 120%)` already, but
specifying it makes intent explicit.)

### `src/style.css` changes

Replace the resting-state block:

```css
/* before */
[data-group-id] {
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.35));
}
```

with:

```css
[data-group-id] {
    filter: var(--piece-edge-filter, drop-shadow(0 0 4px rgba(0, 0, 0, 0.35)));
}
```

The fallback in `var(..., …)` matches the default preset so an
unstyled boot (e.g. tests that don't call `applyPieceOutline`) still
gets the symmetric shadow.

Update `.selected`, `.dragging`, `.merge-pulse`, and the
`@keyframes merge-pulse` to compose against the variable:

```css
[data-group-id].selected {
    filter: var(--piece-edge-filter, none)
            drop-shadow(0 0 6px rgba(60, 130, 255, 0.9))
            drop-shadow(0 0 14px rgba(60, 130, 255, 0.7))
            drop-shadow(0 0 24px rgba(60, 130, 255, 0.4));
}

[data-group-id].selected.dragging {
    filter: var(--piece-edge-filter, none)
            drop-shadow(0 0 12px rgba(0, 0, 0, 0.45))
            drop-shadow(0 0 6px rgba(60, 130, 255, 0.9))
            drop-shadow(0 0 14px rgba(60, 130, 255, 0.7))
            drop-shadow(0 0 24px rgba(60, 130, 255, 0.4));
}

[data-group-id].dragging {
    filter: var(--piece-edge-filter, none)
            drop-shadow(0 0 12px rgba(0, 0, 0, 0.45));
}

@keyframes merge-pulse {
    0%   { filter: var(--piece-edge-filter, none) brightness(1.2); }
    100% { filter: var(--piece-edge-filter, none) brightness(1); }
}
```

The selection-without-base fallback is `none` (not the default
shadow) so that selection styling doesn't pile two different shadows
on top of one another in the rare case `--piece-edge-filter` is unset
but `.selected` is applied. In practice the variable is always set
after boot.

### `src/ui/info-modal.ts` changes

Add `buildPieceOutlineSetting()` mirroring `buildToleranceSetting`. It
renders a `info-setting` block with a row of three buttons (None /
Shadow / Outline), each with a short description. Clicking saves and
applies. Append to `buildSettingsSection` between the tolerance and
offset-drag rows.

Also update the help-text region of the info modal (the prose that
explains how each setting behaves) to describe the new option. Three
short sentences, one per mode.

### `src/ui/index.ts` changes

Re-export the new `piece-outline.ts` symbols, mirroring the existing
`background-colour.ts` re-exports.

### `src/main.ts` changes

Near `applyBackgroundColour(initialColourId)` (main.ts:1015-1017),
add:

```ts
installPieceOutlineFilter();
const initialPieceOutlineId = loadPieceOutlinePreference();
applyPieceOutline(initialPieceOutlineId);
```

No picker wiring is needed — the info-modal Settings section is the
only entry point.

### Tests

New unit tests, kept next to the source per repo convention:

- `src/ui/piece-outline.test.ts`
  - default returns `'shadow'` when localStorage is empty
  - save round-trips
  - unknown id loads as default
  - `applyPieceOutline(id)` sets the CSS custom property to the
    preset's `filter` value
  - `applyPieceOutline('shadow')` after `applyPieceOutline('outline')`
    overwrites cleanly
- `src/ui/piece-outline-filter.test.ts`
  - first call appends an SVG with `<filter id="piece-outline">`
  - second call is a no-op (no duplicate)
- Info-modal tests: extend the existing settings tests to assert that
  the new row renders, that clicking each button updates the saved
  preference, and that the CSS variable changes on click.

No regression risk for existing tests except the renderer tests that
inspect computed style — none of those exist today.

## Constraints and edge cases

### Outer PRNG contract

This change does not touch puzzle generation. No new `random()` calls,
no changes to share-link reproducibility. The
`project_share_link_prng_contract` constraint is irrelevant here.

### Save-format compatibility

Pure UI/preference change. No save-format version bump. No migration
needed. Old saves load unchanged; `puzzle-piece-outline` defaults to
`'shadow'` for users who haven't picked one.

### Browser support

`filter: url(#id)` on HTML elements is supported in all modern
browsers (Chrome, Firefox, Safari, Edge). `feMorphology` is part of
SVG 1.1 baseline — supported everywhere. No new polyfills.

### Filter region

`feMorphology dilate radius="1"` expands the rendered bitmap by 1px on
each side. SVG filter default region (`x="-10%" y="-10%"
width="120%" height="120%"`) gives a 10% pad around the bounding box,
which is comfortable for a 1px dilation at all puzzle scales. No
tuning needed.

### `feMorphology` colour preservation

Pure `feMorphology` dilates including colours. We need a black
outline regardless of source colour, hence the
`feFlood` → `feComposite operator="in"` step that recolours the
dilated region. The original `SourceGraphic` is then composited on top
via `feMerge` so the visible piece appears unchanged and only the 1px
fringe is black.

### Hit testing

The filter is purely visual. SVG hit testing uses the piece paths and
expanded hit areas (`svg-dom-renderer.ts:336-351`), not the rendered
output. A 1px outline doesn't change hit areas. Verified by reading
the renderer — no logic depends on visual silhouette.

### Performance

Three filters all run on the GPU. `feMorphology` is more expensive
than `drop-shadow` per pixel, but it's applied to a small bounding
box per group, not the whole canvas, and pieces are repainted only on
drag / merge / rotation. No measurable regression expected. If
profiling shows otherwise, the fallback is to swap the SVG filter for
the stacked-drop-shadow approach.

## Help-text update

Per the repo's `CLAUDE.md` rule about keeping the info modal in sync
with new user-visible features. The Settings-section structure in
`info-modal.ts` puts a one-line description directly under each
setting's label (see `buildToleranceSetting`'s
`info-setting-description` p element). The new **Piece outline** block
follows the same pattern: a single descriptive sentence like

> The visual edge drawn around each piece group.

The three button labels (**None** / **Shadow** / **Outline**) are
self-explanatory; their `tolerance-option-desc`-style sub-text
explains each in a phrase ("No edge", "Soft halo", "Sharp 1px line").
No additional prose elsewhere in the modal needs touching — the **How
to Play** and **Cut Styles** sections are unaffected by this change.

## Out of scope / follow-ups

- **Outline colour picker.** Same UX as the background-colour picker:
  a small swatch button next to the **Outline** option that opens a
  popover. Adds a second `localStorage` key
  `puzzle-piece-outline-colour` and a CSS variable
  `--piece-outline-colour` consumed by the `feFlood` element. The
  filter would re-read the variable on colour change. Deferred to a
  separate PR.

- **Future asymmetric "shadow" mode that doesn't reveal rotation.**
  User mentioned an idea for this. Out of scope; revisit when the
  idea is ready.
