# Extended-palette background colour picker (#391)

## Problem

The background colour picker offers only 12 hardcoded presets. We want a
much wider palette, ported from lime-elements'
`color-palette-extended.css`, presented as a compact grid of swatches
(no labels) — and factored so the piece-outline colour picker (#392) can
reuse it.

## Decisions (from brainstorming)

- **Palette**: all 20 hues × 5 tones = **100 colours**. Exclude the Lime
  brand colours, the deprecated brand colours, absolute white/black, and
  the **contrast greyscale** (the `gray` hue already covers neutral
  greys).
- **Dark mode**: hues **dim slightly when the OS is in dark mode**
  (`prefers-color-scheme: dark`). The contrast greyscale is *not*
  included, so there is no light/dark inversion to worry about — our UI
  is colour-driven and the user picks the background, so inverting greys
  would be wrong anyway.
- **Reference by name**: a swatch id is `"<hue>-<tone>"`, e.g.
  `"blue-default"`. Never by index.
- **No back-compat**: the old 12 presets and the legacy integer-index
  migration are thrown out. A saved value that is no longer a valid id
  falls back to the default. (Userbase is effectively one person;
  backwards compatibility for the selected background is not worth the
  tech debt.)
- **Default**: a fixed dark hue — `indigo-darker` (`#1a237e`), closest to
  the old "midnight" navy.
- **Layout**: a popover like limel-color-picker — 20 columns (one per
  hue) × 5 rows (tones, lighter→darker). No scroll; swatches shrink to
  fit, so 100 swatches work on mobile.
- **Help text**: unchanged. The existing toolbar line ("🎨 Background —
  Change table colour") stays; naming the palette adds no value to the
  reader.

## Architecture

### `src/ui/palette.ts` (new) — palette data, single source of truth

Plain JS data copied from lime's `color-palette-extended.css`. Each
swatch carries both its light- and dark-mode hex so the existing
`isLightColour(hex)` luminance logic keeps working with no
`getComputedStyle`.

```ts
export const PALETTE_HUES = [
    'red', 'pink', 'magenta', 'purple', 'violet', 'indigo', 'blue',
    'sky', 'cyan', 'teal', 'green', 'lime', 'grass', 'yellow', 'amber',
    'orange', 'coral', 'brown', 'gray', 'glaucous',
] as const;

export const PALETTE_TONES = [
    'lighter', 'light', 'default', 'dark', 'darker',
] as const;

export interface PaletteSwatch {
    id: string;        // "<hue>-<tone>", e.g. "blue-default"
    label: string;     // "blue default"
    light: string;     // "#2196f3"
    dark: string;      // "#1e88e5"
}

export const PALETTE_SWATCHES: readonly PaletteSwatch[]; // 100 entries
```

Helpers:

- `prefersDarkScheme(): boolean` — wraps
  `matchMedia('(prefers-color-scheme: dark)').matches`.
- `activeHex(swatch): string` — returns `dark` or `light` per OS mode.
- `onColorSchemeChange(cb): () => void` — registers a `matchMedia`
  listener, returns an unsubscribe.

The light/dark hex pairs are transcribed from the two blocks of lime's
CSS (`:root` and `@media (prefers-color-scheme: dark)`), hues only.

### `src/ui/background-colour.ts` (rewrite presets + persistence)

- `BACKGROUND_COLOUR_PRESETS` is derived from `PALETTE_SWATCHES`
  (id/label/colour where colour is resolved per OS mode at apply time).
- Persistence switches from `createIdPreferenceStore` (with its
  `legacyOrder`) to `createStringPreference({ key, allowed, defaultValue })`:
  - `key`: `puzzle-background-colour` (unchanged).
  - `allowed`: the 100 palette ids.
  - `defaultValue`: `DEFAULT_COLOUR_ID = 'indigo-darker'`.
  - A saved value outside `allowed` (including the old `0..11` indices
    and the old string ids like `midnight`) is rejected → default.
- `getColourPreset(id)` looks up the swatch (falls back to default).
- `applyBackgroundColour(id)`:
  - resolve `activeHex` for the swatch under the current OS mode,
  - set `--puzzle-bg-colour` + `document.body.style.backgroundColor`,
  - set `document.documentElement.dataset.uiScheme` from
    `isLightColour(hex)` (logic unchanged).
- `isLightColour(hex)` is unchanged.

### `src/main.ts` — OS-theme reactivity

On startup, after the initial `applyBackgroundColour`, register
`onColorSchemeChange(() => applyBackgroundColour(currentId))` so the
background re-resolves (and chrome scheme recomputes) when the OS flips
between light and dark. `currentId` is updated in the picker's
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

`createBackgroundColourPicker(options)` builds the palette swatch list
(resolving `colour` via `activeHex`) and delegates to
`createSwatchPicker` with the 🎨 button, `ariaLabel: 'Background colour'`,
and the persistence wiring in `onSelect`. Re-resolves swatch colours on
OS-theme change while open is not required (popover is transient); the
applied background does react via the `main.ts` listener.

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

## Testing (TDD)

- `palette.test.ts`: exactly 100 swatches; ids match `<hue>-<tone>`;
  labels are `"<hue> <tone>"`; every swatch has non-empty `light` and
  `dark` hex; `activeHex` follows the mocked `matchMedia`.
- `background-colour.test.ts`: default id resolves to a swatch; an
  unknown id, an old numeric index (`"3"`), and an old string id
  (`"midnight"`) all fall back to the default; `applyBackgroundColour`
  sets the custom property and `data-ui-scheme`; `isLightColour`
  unchanged.
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
