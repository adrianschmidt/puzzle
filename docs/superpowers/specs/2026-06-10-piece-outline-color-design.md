# User-pickable 1px piece-outline colour (#392)

## Problem

When the "Outline" piece-edge style is selected, the 1px silhouette is
always **black** — the colour isn't configurable. We want the user to
pick the outline colour from the same extended palette as the background
picker (built in #391 / PR #405), applied live and persisted across
reloads.

Depends on #391, which is merged: the reusable swatch picker
(`src/ui/swatch-picker.ts`), the palette (`src/ui/palette.ts` +
`src/palette.css`), and the `PaletteSwatch` shape all exist.

## Decisions (from brainstorming)

- **Reuse the extended palette and swatch picker.** The outline-colour
  picker feeds `PALETTE_SWATCHES` to `createSwatchPicker`, exactly like
  the background picker — no new colour source, no new picker component.
- **Default `gray-darker-3`** (`#080808`). It's a palette member, so it
  highlights as the selected swatch in the picker, and it's effectively
  black in both light and dark mode (`#080808` in each) — so existing
  users see no visible change from today's hardcoded black.
- **Colour-preview trigger button.** The picker's trigger button (shown
  inside the Piece-outline setting when "Outline" is active) shows the
  currently-chosen outline colour as its own background, so the active
  choice is visible at a glance.
- **Picker lives in the info modal**, inside the existing Piece-outline
  setting, revealed only when the "Outline" edge style is active (hidden
  for "None" / "Shadow"). Unlike the background picker it is *not* a
  toolbar button.
- **Storage: one key per style, scoped to the style id.** Key
  `puzzle-piece-outline-color`, CSS var `--piece-outline-color`,
  following the convention **`puzzle-piece-<styleId>-color`** /
  **`--piece-<styleId>-color`**. This sits beside the existing edge-style
  key `puzzle-piece-outline` (none/shadow/outline). See "Forward
  compatibility" below — this naming is the deliberate choice that lets a
  future per-style colour (e.g. a Shadow colour) be added with **no
  migration**.
- **Not in the save/share format.** Like the background colour and the
  edge-style preference, the outline colour is a UI preference only —
  no PRNG / reproducibility concern (`serialization.ts` / `share-link.ts`
  untouched).
- **No OS-theme re-apply needed.** Palette colours flip between
  light/dark shades for free via CSS (`var(--color-<id>)`), and the
  outline has no luminance-derived chrome to recompute (unlike the
  background, which drives `data-ui-scheme`). So, unlike
  `applyBackgroundColor`, there is no `onColorSchemeChange` listener.

## Architecture

### `src/ui/piece-outline-filter.ts` — un-hardcode `flood-color`

The injected `<feFlood>` currently sets the presentation attribute
`flood-color="black"` (line 43). A presentation attribute cannot hold a
`var()`, so instead set the colour via **CSS** on the element, reading
the custom property with a near-black fallback:

```ts
flood.style.setProperty('flood-color', 'var(--piece-outline-color, #080808)');
```

(Drop the hardcoded `flood-color="black"` attribute.) Because the flood
colour now reads a CSS variable, changing `--piece-outline-color`
recolours the outline live, with no JS touching the filter after install.
The `#080808` fallback (= `gray-darker-3`) keeps the outline black if the
property is somehow never set.

### `src/ui/piece-outline-color.ts` (new) — palette-backed preference

Mirrors `background-color.ts` but simpler: brand-new key, so **no legacy
migration**.

```ts
export type PieceOutlineColorPreset = PaletteSwatch;

export const PIECE_OUTLINE_COLOR_PRESETS: readonly PieceOutlineColorPreset[]
    = PALETTE_SWATCHES;                       // the full extended palette

export const DEFAULT_PIECE_OUTLINE_COLOR_ID = 'gray-darker-3';
export const PIECE_OUTLINE_COLOR_PREFERENCE_KEY = 'puzzle-piece-outline-color';
export const CSS_CUSTOM_PROPERTY = '--piece-outline-color';

// createStringPreference({ key, allowed: <palette ids>, defaultValue })
export const savePieceOutlineColorPreference: (id: string) => void;
export const loadPieceOutlineColorPreference: () => string;
export function getPieceOutlineColorPreset(id: string): PieceOutlineColorPreset;

// Sets --piece-outline-color on documentElement to the preset's
// `var(--color-<id>)` reference (CSS resolves + theme-flips it).
export function applyPieceOutlineColor(id: string): void;
```

A module-load guard asserts `DEFAULT_PIECE_OUTLINE_COLOR_ID` is a real
palette id (same pattern as `background-color.ts`).

### `src/ui/piece-outline-color-picker.ts` (new) — thin adapter

A wrapper over `createSwatchPicker`, mirroring `background-color-picker.ts`:

```ts
export interface PieceOutlineColorPickerOptions {
    container: HTMLElement;
    selectedId: string;
    onSelect: (id: string) => void;
}
export function createPieceOutlineColorPicker(
    options: PieceOutlineColorPickerOptions,
): () => void;
```

It passes `PIECE_OUTLINE_COLOR_PRESETS` with:
- `button.className: 'outline-color-button'` — a CSS rule sets its
  `background: var(--piece-outline-color)` so the trigger previews the
  current colour (the colour-preview button decision);
- `button.title` / `ariaLabel: 'Outline colour'`;
- `panelClassName: 'outline-color-panel'` so the popover anchors
  independently of the background picker's panel;
- `columnCount: 20`.

### `src/ui/info-modal.ts` — embed the picker in `buildPieceOutlineSetting`

After the three edge-style preset buttons, append a colour-picker row in
its own container, shown only when the active edge style is `outline`:

- Build a `div.outline-color-row` (with a small label, e.g. "Outline
  colour"). Toggle a hidden class on it based on the active style.
- Create the picker into that container via
  `createPieceOutlineColorPicker({ container, selectedId:
  loadPieceOutlineColorPreference(), onSelect })`; in `onSelect`, call
  `savePieceOutlineColorPreference(id)` + `applyPieceOutlineColor(id)`.
  (The filter updates live because its flood-colour reads the CSS var.)
- In the existing edge-style button click handler, after
  `applyPieceOutline(preset.id)`, show the colour row iff
  `preset.id === 'outline'`, else hide it. Set initial visibility from
  the loaded edge-style id.
- Update the setting's description (or add a short note) to mention that
  the outline colour is chosen here when "Outline" is selected — this
  satisfies the `CLAUDE.md` help-text trigger for the Settings section.

### `src/main.ts` — apply the saved colour at startup

After `applyPieceOutline(loadPieceOutlinePreference())` (line 1208), add:

```ts
applyPieceOutlineColor(loadPieceOutlineColorPreference());
```

No `onColorSchemeChange` registration (see the decision above).

### `src/style.css` — trigger-button preview + panel anchor

- `.outline-color-button { background: var(--piece-outline-color); }`
  plus the shared swatch-picker-button sizing/affordances (reuse the
  existing button rules; this only overrides the background to preview
  the colour). Ensure a visible border so a near-black preview is
  distinguishable from the modal background.
- `.outline-color-panel` positioning so the popover stays within the
  modal / viewport on mobile (the swatch grid itself reuses the existing
  `.swatch-grid` / `.swatch` rules).
- `.outline-color-row` layout (label + button on a line) and its hidden
  state.

## Forward compatibility

The user flagged that a Shadow-colour option (or some other new option)
may come later, and wants to avoid a future migration.

The chosen storage scheme already guarantees that:

- Each style's colour is its **own** localStorage key, scoped to the
  style id: `puzzle-piece-<styleId>-color` (here `puzzle-piece-outline-color`),
  with a matching CSS var `--piece-<styleId>-color`.
- Adding a Shadow colour later is then **purely additive**: a new key
  `puzzle-piece-shadow-color` + `--piece-shadow-color` (parametrising the
  `drop-shadow(...)` colour in `PIECE_OUTLINE_PRESETS`). It never touches
  the existing outline key, so **no migration** — and the same holds for
  any new style not yet conceived.
- The trap deliberately avoided is a *generic* key (e.g.
  `puzzle-piece-edge-color`, as if one colour covered all styles): that
  would force a migration the day per-style colours are wanted. Scoping
  to the style id sidesteps it.
- One key per colour (not a single JSON blob) also matches the repo
  convention and keeps a parse failure on one colour from losing the
  others.

This PR does **not** build the generalised multi-style mechanism (YAGNI);
it just commits to the naming convention so the future addition is a
clean parallel module + key.

## Testing (TDD)

- `piece-outline-filter.test.ts`: the injected `<feFlood>` no longer
  hardcodes `flood-color="black"`; its CSS `flood-color` references
  `var(--piece-outline-color` (with the `#080808` fallback). Existing
  install/idempotency assertions stay.
- `piece-outline-color.test.ts`: default id resolves to a real palette
  swatch; `loadPieceOutlineColorPreference` returns the default when
  unset, a saved valid id round-trips, and an invalid/unknown saved value
  falls back to the default; `PIECE_OUTLINE_COLOR_PRESETS` equals the
  palette (each `color` a `var(--color-…)` reference);
  `applyPieceOutlineColor(id)` sets `--piece-outline-color` on
  `documentElement` to the preset's `var(--color-<id>)`, and an unknown
  id applies the default preset's colour.
- `piece-outline-color-picker.test.ts`: delegates to the generic picker
  with the palette swatches and the `outline-color-button` /
  `outline-color-panel` classes; cleanup removes the button.
- `info-modal.test.ts`: the outline-colour row is hidden when the loaded
  edge style is `none`/`shadow` and visible when it's `outline`;
  clicking the "Outline" edge-style button reveals the row and clicking
  "None"/"Shadow" hides it; selecting a swatch persists
  (`puzzle-piece-outline-color`) and applies the CSS var. Update the
  existing Piece-outline help-text assertion for the new description.

## Out of scope

- A Shadow-colour (or any other per-style colour) option — only the
  outline colour is built; the storage convention leaves room for it.
- Any change to the save/share format (UI preference only).
- The toolbar / background picker — untouched.
