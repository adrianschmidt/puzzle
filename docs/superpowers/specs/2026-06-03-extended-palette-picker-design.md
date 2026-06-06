# Extended-palette background colour picker (#391)

## Problem

The background colour picker offers only 12 hardcoded presets. We want a
much wider palette, ported from lime-elements'
`color-palette-extended.css`, presented as a compact grid of swatches
(no labels) — and factored so the piece-outline colour picker (#392) can
reuse it.

## Decisions (from brainstorming)

- **Palette**: all 20 hues × 7 tones = **140 colours**. The five
  lime-elements tones (lighter, light, default, dark, darker) plus two
  extrapolated rows (`darker-2`, `darker-3`) so each column continues
  darkening to a deep near-black — see "Extra darker rows" below. Exclude
  the Lime brand colours, the deprecated brand colours, absolute
  white/black, and the **contrast greyscale** (the `gray` hue already
  covers neutral greys).
- **Dark mode**: implemented the lime-elements way — the colours are
  **CSS custom properties** defined in a stylesheet, with a
  `@media (prefers-color-scheme: dark)` block that redefines every
  variable to its dimmer dark shade. Anything that renders a colour uses
  `var(--color-<id>)`, so the whole app flips between light and dark
  shades **for free, with no JS**, the instant the OS theme changes. The
  contrast greyscale is *not* included, so there is no light/dark
  inversion to worry about — our UI is colour-driven and the user picks
  the background, so inverting greys would be wrong anyway.
- **Reference by name**: a swatch id is `"<hue>-<tone>"`, e.g.
  `"blue-default"`. Never by index.
- **Migrate old preferences to the nearest new swatch**: a saved value
  from before the palette switch — one of the old 12 preset ids, or an
  even-older bare integer index into them — maps to its nearest
  equivalent in the new palette (curated for hue character: greys→greys,
  tinted pastels stay in their hue family), so a returning user keeps a
  similar background. Anything unrecognised still falls back to the
  default. (This satisfies #391's "existing saved preferences still
  resolve to a sensible color" criterion. The earlier plan to drop
  migration assumed index-based storage; name-keyed swatches make a
  ~12-line nearest map cheap, so it's worth doing.)
- **Default**: a fixed dark hue — `indigo-darker` (`#1a237e`), closest to
  the old "midnight" navy.
- **Layout**: a popover like limel-color-picker — 20 columns (one per
  hue) × 5 rows (tones, lighter→darker). No scroll; swatches shrink to
  fit, so 100 swatches work on mobile.
- **Help text**: unchanged. The existing toolbar line ("🎨 Background —
  Change table colour") stays; naming the palette adds no value to the
  reader.

## Architecture

### `src/palette.css` (new) — colour variables, single source of truth

A hand-written stylesheet holding all 100 hue variables, transcribed
from lime's `color-palette-extended.css` (hues only — brand, deprecated
brand, white/black, contrast greyscale, and the shadow/button tokens are
excluded). Light values on `:root`; a `@media (prefers-color-scheme:
dark)` block redefines every variable to its dark shade:

```css
:root {
  --color-red-lighter: #ffcdd2;
  /* …100 light values… */
  --color-glaucous-darker: #254758;
}
@media (prefers-color-scheme: dark) {
  :root {
    --color-red-lighter: #ef9a9a;
    /* …100 dark values… */
    --color-glaucous-darker: #224150;
  }
}
```

Variable naming: `--color-<hue>-<tone>` (matches lime). Anything that
shows a palette colour references `var(--color-<hue>-<tone>)`, so the OS
dark-mode flip is handled entirely by CSS. Imported once from `main.ts`.

### `src/ui/palette.ts` (new) — swatch metadata

No colour values live here (CSS owns them). It enumerates the swatches
and exposes the OS-change hook used to refresh the luminance-derived
chrome scheme.

```ts
export const PALETTE_HUES = [
    'red', 'pink', 'magenta', 'purple', 'violet', 'indigo', 'blue',
    'sky', 'cyan', 'teal', 'green', 'lime', 'grass', 'yellow', 'amber',
    'orange', 'coral', 'brown', 'gray', 'glaucous',
] as const;

export const PALETTE_TONES = [
    'lighter', 'light', 'default', 'dark', 'darker', 'darker-2', 'darker-3',
] as const;

export interface PaletteSwatch {
    id: string;        // "<hue>-<tone>", e.g. "blue-default"
    label: string;     // "blue default"
    value: string;     // "var(--color-blue-default)"
}

export const PALETTE_SWATCHES: readonly PaletteSwatch[]; // 100 entries

// Subscribe to OS colour-scheme changes (to refresh the chrome scheme).
export function onColorSchemeChange(cb: () => void): () => void;
```

`PALETTE_SWATCHES` is built in tone-major order (rows = tones, columns =
hues) so a 20-column grid mirrors the limel-color-picker layout.

### `src/ui/background-colour.ts` (rewrite presets + persistence)

- `BACKGROUND_COLOUR_PRESETS` is derived from `PALETTE_SWATCHES`, with
  `colour` set to the swatch's `var(--color-<id>)` reference. Because the
  preset stores a *variable reference*, not a resolved hex, every swatch
  and the applied background flip with the OS theme automatically — and
  there is no stale-value problem.
- Persistence switches from `createIdPreferenceStore` (with its
  `legacyOrder`) to `createStringPreference({ key, allowed, defaultValue })`:
  - `key`: `puzzle-background-colour` (unchanged).
  - `allowed`: the 140 palette ids.
  - `defaultValue`: `DEFAULT_COLOUR_ID = 'indigo-darker'`.
- `loadColourPreference()` wraps the store with a legacy migration: a
  recognised old preset id or integer index resolves to its nearest new
  swatch via a small `LEGACY_COLOUR_MAP` (a module-load guard asserts
  every target is a real swatch); a current id loads as-is; anything else
  falls back to the default.
- `getColourPreset(id)` looks up the swatch (falls back to default).
- `applyBackgroundColour(id)`:
  - set `--puzzle-bg-colour` and `document.body.style.backgroundColor`
    to the preset's `var(--color-<id>)` reference (CSS resolves it),
  - read the **resolved** colour via
    `getComputedStyle(document.body).backgroundColor` and set
    `document.documentElement.dataset.uiScheme` to `'light'`/`'dark'`
    from its luminance.
- `isLightColour(colour)` parses an `rgb()/rgba()` string (from
  `getComputedStyle`) or a hex string, then applies the existing
  luminance > 0.4 test. The luminance maths is unchanged; only the input
  parsing is added.

Why `getComputedStyle` rather than a JS hex table: CSS owns the values
(single source of truth) and the resolved colour already reflects the
current OS theme, so the chrome scheme is computed from exactly what is
rendered.

### `src/main.ts` — OS-theme reactivity

- Import `src/palette.css` so the variables are defined.
- On startup, after the initial `applyBackgroundColour`, register
  `onColorSchemeChange(() => applyBackgroundColour(currentId))`. The
  background **colour** itself flips for free via CSS; this listener
  exists only to recompute the luminance-derived `data-ui-scheme` chrome
  (which CSS cannot do). `currentId` is updated in the picker's
  `onSelect`.

### `src/ui/swatch-picker.ts` (new) — reusable picker (sets up #392)

Generic button + dismissable popover + swatch grid:

```ts
export interface SwatchPickerOptions {
    container: HTMLElement;
    button: { icon: string; title: string };
    swatches: readonly { id: string; label: string; colour: string }[];
    selectedId: string;
    onSelect: (id: string) => void;
    columnCount?: number;   // default 20
    ariaLabel: string;
}
export function createSwatchPicker(options: SwatchPickerOptions): () => void;
```

It owns: swatch element creation, the grid panel (`role="listbox"`,
swatches `role="option"`), and the popover wiring via
`attachDismissablePopover` (lifted from the current
`background-colour-picker.ts`). Returns a cleanup function.

### `src/ui/background-colour-picker.ts` — thin adapter

`createBackgroundColourPicker(options)` passes `BACKGROUND_COLOUR_PRESETS`
(whose `colour` is a `var(--color-<id>)` reference) to `createSwatchPicker`
with the 🎨 button, `ariaLabel: 'Background colour'`, and the persistence
wiring in `onSelect`. No OS-theme handling is needed in the picker —
because swatch colours are variable references, they flip with the theme
via CSS automatically.

### `src/style.css` — grid layout (mirrors limel-color-picker)

Replace `.bg-colour-panel` / `.bg-colour-swatch` rules with a reusable
`.swatch-grid` / `.swatch` set:

- `.swatch-grid`: `display: grid;
  grid-template-columns: repeat(20, minmax(0, 1fr)); gap: 4px;`
  popover with `max-width: calc(100vw - 16px)` and positioned so it stays
  within the viewport on mobile (no horizontal overflow — unlike the
  current corner-anchored 6-column panel).
- `.swatch`: `aspect-ratio: 1; border-radius: 3px;` square; hover/active
  affordances as today.
- `.swatch--selected`: rendered as a circle (`border-radius: 50%`) with
  the existing selected ring.
- Keep `.bg-colour-button` styles (or rename to a shared `.swatch-picker-button`).

## Extra darker rows (`darker-2`, `darker-3`)

The five lime tones don't go dark enough — the darkest (`darker`) is only
mid-dark for many hues. Each column gets two extrapolated rows that
continue its darkening. They are computed once (offline) in **OKLCH**:
take the column's `darker` tone, step its lightness down by the column's
own `dark → darker` step (clamped to a sensible perceptual range so no
column stalls like yellow or collapses like gray), fade chroma in
proportion to lightness, and hold the hue. Values are written as static
hex in `palette.css` (both the light and dark blocks), same as the other
tones — there is no runtime colour maths. Tone names are `darker-2` /
`darker-3` (not `darkest`, to leave room and keep an ordinal scheme).

## Testing (TDD)

- `palette.test.ts`: exactly 140 swatches; ids match `<hue>-<tone>`;
  labels are `"<hue> <tone>"`; every swatch's `value` is
  `var(--color-<id>)`; tone-major ordering; `onColorSchemeChange`
  subscribes/unsubscribes to the mocked `matchMedia` `change` event.
- `palette.css`: covered structurally by `palette.test.ts` reading the
  file and asserting it defines a `--color-<id>` variable for every
  swatch in both the `:root` and the `@media (prefers-color-scheme: dark)`
  block (guards against a missing/extra variable).
- `background-colour.test.ts`: default id resolves to a swatch; an old
  string id (`"midnight"`) and an old integer index (`"3"`) migrate to
  their nearest new swatch, every migration target round-trips to a real
  swatch, and an unrecognised value / out-of-range index falls back to
  the default; `BACKGROUND_COLOUR_PRESETS` has 140 entries whose `colour`
  is a `var(--color-…)` reference; `applyBackgroundColour` sets
  `--puzzle-bg-colour` to the variable reference and sets `data-ui-scheme`
  from the resolved colour (`getComputedStyle` stubbed), warning when it
  can't resolve; `isLightColour` handles both `rgb()` and hex inputs.
- `swatch-picker.test.ts`: renders one swatch per entry; marks the
  selected one (`aria-selected`, `--selected` class); clicking a swatch
  calls `onSelect(id)` and dismisses; cleanup removes the button.
- `background-colour-picker.test.ts`: rewritten against the new
  structure (palette-derived swatches, delegates to the generic picker).

## Out of scope

- The outline-colour picker (#392) — this PR only builds the reusable
  picker it will consume.
- Any change to the save/share format (background colour is a UI
  preference only; no PRNG/reproducibility concern).
- Help-text changes (explicitly none).
```
