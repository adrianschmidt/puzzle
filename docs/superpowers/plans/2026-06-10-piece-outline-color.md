# Piece-outline colour picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick the 1px piece-outline colour from the extended palette, applied live and persisted across reloads.

**Architecture:** Un-hardcode the SVG outline filter's `flood-color` so it reads a `--piece-outline-color` CSS variable; drive that variable from a new palette-backed preference module; reuse the existing `createSwatchPicker` (#391) via a thin adapter embedded in the info modal's Piece-outline setting, revealed only when "Outline" is active. The outline colour is a UI preference only (not in the save/share format).

**Tech Stack:** TypeScript, Vite, Vitest (jsdom), plain DOM (no framework). Tests run with `npx vitest run <file>`.

---

## File Structure

- **Create** `src/ui/piece-outline-color.ts` — palette-backed preference (key `puzzle-piece-outline-color`, var `--piece-outline-color`, default `gray-darker-3`) + `applyPieceOutlineColor`.
- **Create** `src/ui/piece-outline-color.test.ts` — its unit tests.
- **Create** `src/ui/piece-outline-color-picker.ts` — thin adapter over `createSwatchPicker`.
- **Create** `src/ui/piece-outline-color-picker.test.ts` — its unit tests.
- **Modify** `src/ui/piece-outline-filter.ts` — `<feFlood>` reads the CSS var instead of hardcoded `black`.
- **Modify** `src/ui/piece-outline-filter.test.ts` — assert the new flood-colour wiring.
- **Modify** `src/ui/index.ts` — re-export the new module + picker.
- **Modify** `src/ui/info-modal.ts` — embed the colour picker in `buildPieceOutlineSetting`, toggle its visibility, update help text.
- **Modify** `src/ui/info-modal.test.ts` — tests for the embedded picker + visibility.
- **Modify** `src/main.ts` — apply the saved outline colour at startup.
- **Modify** `src/style.css` — trigger-button preview + popover anchor + row layout.

Background reference (mirror these): `src/ui/background-color.ts`, `src/ui/background-color.test.ts`, `src/ui/background-color-picker.ts`, `src/ui/background-color-picker.test.ts`.

---

## Task 1: Un-hardcode the outline filter's flood-colour

**Files:**
- Modify: `src/ui/piece-outline-filter.ts:42-45`
- Test: `src/ui/piece-outline-filter.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block at the end of `src/ui/piece-outline-filter.test.ts` (inside the file, after the existing `describe`'s closing — i.e. append a second top-level `describe`):

```ts
describe('installPieceOutlineFilter — configurable flood colour', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    it('drives feFlood flood-color from the --piece-outline-color variable', () => {
        installPieceOutlineFilter();
        const flood = document.querySelector(
            'filter#piece-outline feFlood',
        ) as SVGElement;
        // No hardcoded colour attribute any more.
        expect(flood.getAttribute('flood-color')).toBeNull();
        // Reads the CSS variable, with a near-black fallback.
        expect(flood.style.getPropertyValue('flood-color')).toBe(
            'var(--piece-outline-color, #080808)',
        );
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/piece-outline-filter.test.ts`
Expected: FAIL — the new test sees `flood-color="black"` attribute set and an empty `style` flood-color.

- [ ] **Step 3: Write minimal implementation**

In `src/ui/piece-outline-filter.ts`, replace the `feFlood` block (currently lines 42-45):

```ts
    const flood = document.createElementNS(SVG_NS, 'feFlood');
    flood.setAttribute('flood-color', 'black');
    flood.setAttribute('result', 'color');
    filter.appendChild(flood);
```

with:

```ts
    const flood = document.createElementNS(SVG_NS, 'feFlood');
    // Read the outline colour from a CSS custom property so the picker can
    // recolour the outline live (a presentation attribute can't hold a
    // var()). The `#080808` fallback (= gray-darker-3) keeps the outline
    // black if the property is never set.
    flood.style.setProperty(
        'flood-color',
        'var(--piece-outline-color, #080808)',
    );
    flood.setAttribute('result', 'color');
    filter.appendChild(flood);
```

Also update the file's top-of-module comment: change "recolors that ring black" to "recolors that ring with the outline colour (the `--piece-outline-color` custom property, defaulting to near-black)".

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/piece-outline-filter.test.ts`
Expected: PASS (all existing tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add src/ui/piece-outline-filter.ts src/ui/piece-outline-filter.test.ts
git commit -m "feat: drive piece-outline flood-color from a CSS variable (#392)"
```

---

## Task 2: Outline-colour preference module

**Files:**
- Create: `src/ui/piece-outline-color.ts`
- Test: `src/ui/piece-outline-color.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/ui/piece-outline-color.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    PIECE_OUTLINE_COLOR_PRESETS,
    DEFAULT_PIECE_OUTLINE_COLOR_ID,
    PIECE_OUTLINE_COLOR_PREFERENCE_KEY,
    CSS_CUSTOM_PROPERTY,
    getPieceOutlineColorPreset,
    savePieceOutlineColorPreference,
    loadPieceOutlineColorPreference,
    applyPieceOutlineColor,
} from './piece-outline-color.js';

describe('PIECE_OUTLINE_COLOR_PRESETS', () => {
    it('exposes the full palette (140 presets)', () => {
        expect(PIECE_OUTLINE_COLOR_PRESETS.length).toBe(140);
    });

    it('each preset color is a var(--color-…) reference', () => {
        for (const p of PIECE_OUTLINE_COLOR_PRESETS) {
            expect(p.color).toMatch(/^var\(--color-[a-z]+-[a-z0-9-]+\)$/);
        }
    });

    it('the default id is near-black gray-darker-3 and is a real preset', () => {
        expect(DEFAULT_PIECE_OUTLINE_COLOR_ID).toBe('gray-darker-3');
        expect(
            PIECE_OUTLINE_COLOR_PRESETS.some(
                (p) => p.id === DEFAULT_PIECE_OUTLINE_COLOR_ID,
            ),
        ).toBe(true);
    });
});

describe('getPieceOutlineColorPreset', () => {
    it('returns the matching preset', () => {
        const preset = getPieceOutlineColorPreset('blue-default');
        expect(preset.id).toBe('blue-default');
        expect(preset.color).toBe('var(--color-blue-default)');
    });

    it('falls back to the default for an unknown id', () => {
        expect(getPieceOutlineColorPreset('nope').id).toBe(
            DEFAULT_PIECE_OUTLINE_COLOR_ID,
        );
    });
});

describe('loadPieceOutlineColorPreference', () => {
    beforeEach(() => localStorage.clear());

    it('returns the default when nothing is saved', () => {
        expect(loadPieceOutlineColorPreference()).toBe(
            DEFAULT_PIECE_OUTLINE_COLOR_ID,
        );
    });

    it('round-trips a valid id', () => {
        savePieceOutlineColorPreference('green-dark');
        expect(loadPieceOutlineColorPreference()).toBe('green-dark');
    });

    it('falls back to default for an unrecognized value', () => {
        localStorage.setItem(PIECE_OUTLINE_COLOR_PREFERENCE_KEY, 'totally-unknown');
        expect(loadPieceOutlineColorPreference()).toBe(
            DEFAULT_PIECE_OUTLINE_COLOR_ID,
        );
    });
});

describe('applyPieceOutlineColor', () => {
    beforeEach(() => {
        document.documentElement.style.removeProperty(CSS_CUSTOM_PROPERTY);
    });

    it('sets the custom property to the variable reference', () => {
        applyPieceOutlineColor('blue-default');
        expect(
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY),
        ).toBe('var(--color-blue-default)');
    });

    it('falls back to the default preset for an unknown id', () => {
        applyPieceOutlineColor('not-a-color');
        expect(
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY),
        ).toBe(`var(--color-${DEFAULT_PIECE_OUTLINE_COLOR_ID})`);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/piece-outline-color.test.ts`
Expected: FAIL — `Cannot find module './piece-outline-color.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/piece-outline-color.ts`:

```ts
/**
 * Piece-outline colour presets and persistence.
 *
 * The "Outline" piece-edge style draws a 1px silhouette whose colour the
 * user picks from the extended palette (see `palette.ts` / `palette.css`).
 * Each preset's `color` is a `var(--color-<id>)` reference, so the chosen
 * outline colour flips between light/dark shades with the OS theme for
 * free. The choice is saved by its stable string id.
 *
 * The localStorage key and CSS variable are scoped to the *outline* style
 * specifically (`puzzle-piece-outline-color` / `--piece-outline-color` —
 * the `puzzle-piece-<styleId>-color` convention). A future per-style
 * colour (e.g. a Shadow colour) is then a new, independent key: purely
 * additive, no migration.
 */

import { createStringPreference } from './preference-store.js';
import { PALETTE_SWATCHES, type PaletteSwatch } from './palette.js';
import type { SwatchEntry } from './swatch-picker.js';

/** An outline-colour preset is a palette swatch (`{ id, label, color }`). */
export type PieceOutlineColorPreset = PaletteSwatch;

/**
 * Default outline colour — near-black `gray-darker-3` (#080808). It's a
 * palette member (so it highlights as selected in the picker) and is
 * effectively black in both light and dark mode, matching the old
 * hardcoded outline.
 */
export const DEFAULT_PIECE_OUTLINE_COLOR_ID = 'gray-darker-3';

/** localStorage key for the saved outline colour. */
export const PIECE_OUTLINE_COLOR_PREFERENCE_KEY = 'puzzle-piece-outline-color';

/** CSS custom property the outline filter's flood-color reads. */
export const CSS_CUSTOM_PROPERTY = '--piece-outline-color';

const swatchById = new Map<string, PaletteSwatch>(
    PALETTE_SWATCHES.map((s) => [s.id, s]),
);

const defaultSwatchOrUndef = swatchById.get(DEFAULT_PIECE_OUTLINE_COLOR_ID);
if (defaultSwatchOrUndef === undefined) {
    throw new Error(
        `DEFAULT_PIECE_OUTLINE_COLOR_ID '${DEFAULT_PIECE_OUTLINE_COLOR_ID}' is not a palette swatch id`,
    );
}
const defaultSwatch: PaletteSwatch = defaultSwatchOrUndef;

/**
 * Available outline colours (the full palette). `satisfies` documents that
 * a preset is a valid `SwatchEntry`, so it feeds the swatch picker directly.
 */
export const PIECE_OUTLINE_COLOR_PRESETS: readonly PieceOutlineColorPreset[] =
    PALETTE_SWATCHES satisfies readonly SwatchEntry[];

const ALLOWED_IDS = PALETTE_SWATCHES.map((s) => s.id);

const store = createStringPreference({
    key: PIECE_OUTLINE_COLOR_PREFERENCE_KEY,
    allowed: ALLOWED_IDS,
    defaultValue: DEFAULT_PIECE_OUTLINE_COLOR_ID,
});

export const savePieceOutlineColorPreference = store.save;
export const loadPieceOutlineColorPreference = store.load;

/** Get the preset for an id, or the default preset for an unknown id. */
export function getPieceOutlineColorPreset(
    id: string,
): PieceOutlineColorPreset {
    return swatchById.get(id) ?? defaultSwatch;
}

/**
 * Apply an outline colour by writing its `var(--color-<id>)` reference to
 * the `--piece-outline-color` custom property on the document root, where
 * the SVG outline filter's flood-color reads it. CSS resolves the value
 * and flips it with the OS theme.
 */
export function applyPieceOutlineColor(id: string): void {
    const preset = getPieceOutlineColorPreset(id);
    document.documentElement.style.setProperty(
        CSS_CUSTOM_PROPERTY,
        preset.color,
    );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/piece-outline-color.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/piece-outline-color.ts src/ui/piece-outline-color.test.ts
git commit -m "feat: add palette-backed piece-outline colour preference (#392)"
```

---

## Task 3: Outline-colour picker adapter

**Files:**
- Create: `src/ui/piece-outline-color-picker.ts`
- Test: `src/ui/piece-outline-color-picker.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/ui/piece-outline-color-picker.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the piece-outline colour picker adapter.
 */

import { describe, it, expect, vi } from 'vitest';
import { createPieceOutlineColorPicker } from './piece-outline-color-picker.js';
import { PIECE_OUTLINE_COLOR_PRESETS } from './piece-outline-color.js';

describe('createPieceOutlineColorPicker', () => {
    it('adds the outline-color button to the container', () => {
        const container = document.createElement('div');
        const cleanup = createPieceOutlineColorPicker({
            container,
            selectedId: PIECE_OUTLINE_COLOR_PRESETS[0].id,
            onSelect: vi.fn(),
        });
        expect(container.querySelector('button.outline-color-button')).toBeTruthy();
        cleanup();
    });

    it('opens a grid with one swatch per preset and reports selections', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const onSelect = vi.fn();
        const cleanup = createPieceOutlineColorPicker({
            container,
            selectedId: 'gray-darker-3',
            onSelect,
        });

        (
            container.querySelector(
                'button.outline-color-button',
            ) as HTMLButtonElement
        ).click();
        const swatches = container.querySelectorAll('.swatch-grid .swatch');
        expect(swatches.length).toBe(PIECE_OUTLINE_COLOR_PRESETS.length);
        // The adapter supplies its own panel-positioning class.
        expect(
            container.querySelector('.swatch-grid.outline-color-panel'),
        ).toBeTruthy();

        (
            container.querySelector(
                '[data-swatch-id="blue-default"]',
            ) as HTMLButtonElement
        ).click();
        expect(onSelect).toHaveBeenCalledWith('blue-default');

        cleanup();
        document.body.removeChild(container);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/piece-outline-color-picker.test.ts`
Expected: FAIL — `Cannot find module './piece-outline-color-picker.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/piece-outline-color-picker.ts`:

```ts
/**
 * Piece-outline colour picker — a swatch-grid picker for the 1px outline
 * colour, shown in the info modal's Piece-outline setting when the
 * "Outline" style is active. A thin adapter over the reusable
 * `createSwatchPicker`, feeding it the extended palette.
 *
 * The trigger button has no icon; it previews the current outline colour
 * via CSS (`.outline-color-button` background = `var(--piece-outline-color)`).
 */

import { PIECE_OUTLINE_COLOR_PRESETS } from './piece-outline-color.js';
import { createSwatchPicker } from './swatch-picker.js';

export interface PieceOutlineColorPickerOptions {
    /** The container to append the button to. */
    container: HTMLElement;
    /** Currently selected colour id. */
    selectedId: string;
    /** Called when the player selects a colour. Receives the preset id. */
    onSelect: (id: string) => void;
}

/**
 * Create and attach the outline colour picker (button + popover).
 * Returns a cleanup function that removes the picker from the DOM.
 */
export function createPieceOutlineColorPicker(
    options: PieceOutlineColorPickerOptions,
): () => void {
    return createSwatchPicker({
        container: options.container,
        button: {
            // No glyph — the button's background previews the current colour.
            icon: '',
            title: 'Outline colour',
            className: 'outline-color-button',
        },
        ariaLabel: 'Outline colour',
        panelClassName: 'outline-color-panel',
        swatches: PIECE_OUTLINE_COLOR_PRESETS,
        selectedId: options.selectedId,
        onSelect: options.onSelect,
        columnCount: 20,
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/piece-outline-color-picker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/piece-outline-color-picker.ts src/ui/piece-outline-color-picker.test.ts
git commit -m "feat: add piece-outline colour picker adapter (#392)"
```

---

## Task 4: Re-export the new APIs from the UI barrel

**Files:**
- Modify: `src/ui/index.ts:103` (after the `installPieceOutlineFilter` export)

No new test — these exports are exercised by `main.ts` (Task 6) and the build (Task 8).

- [ ] **Step 1: Add the exports**

In `src/ui/index.ts`, immediately after the line:

```ts
export { installPieceOutlineFilter } from './piece-outline-filter.js';
```

insert:

```ts
export {
    PIECE_OUTLINE_COLOR_PRESETS,
    DEFAULT_PIECE_OUTLINE_COLOR_ID,
    getPieceOutlineColorPreset,
    savePieceOutlineColorPreference,
    loadPieceOutlineColorPreference,
    applyPieceOutlineColor,
} from './piece-outline-color.js';
export type { PieceOutlineColorPreset } from './piece-outline-color.js';

export { createPieceOutlineColorPicker } from './piece-outline-color-picker.js';
export type { PieceOutlineColorPickerOptions } from './piece-outline-color-picker.js';
```

- [ ] **Step 2: Verify the barrel type-checks**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/ui/index.ts
git commit -m "feat: re-export piece-outline colour APIs from the UI barrel (#392)"
```

---

## Task 5: Embed the picker in the info modal's Piece-outline setting

**Files:**
- Modify: `src/ui/info-modal.ts` (imports near line 24-29; `buildPieceOutlineSetting` lines 279-331)
- Test: `src/ui/info-modal.test.ts` (Piece-outline `describe`, after line 323)

- [ ] **Step 1: Write the failing tests**

In `src/ui/info-modal.test.ts`, inside the existing
`describe('createInfoModal — Piece outline setting', …)` block (append these
`it`s before its closing `});` at line 324):

```ts
    it('hides the outline-colour row by default (Shadow active)', () => {
        createInfoModal({ container });
        const row = document.querySelector(
            '[data-testid="piece-outline-color-row"]',
        ) as HTMLElement;
        expect(row).toBeTruthy();
        expect(row.hidden).toBe(true);
    });

    it('reveals the colour row when Outline is selected, hides it for None', () => {
        createInfoModal({ container });
        const row = document.querySelector(
            '[data-testid="piece-outline-color-row"]',
        ) as HTMLElement;
        const outlineBtn = document.querySelector(
            '[data-testid="piece-outline-outline"]',
        ) as HTMLButtonElement;
        const noneBtn = document.querySelector(
            '[data-testid="piece-outline-none"]',
        ) as HTMLButtonElement;

        outlineBtn.click();
        expect(row.hidden).toBe(false);

        noneBtn.click();
        expect(row.hidden).toBe(true);
    });

    it('shows the colour row on open when Outline is the saved style', () => {
        localStorage.setItem('puzzle-piece-outline', 'outline');
        createInfoModal({ container });
        const row = document.querySelector(
            '[data-testid="piece-outline-color-row"]',
        ) as HTMLElement;
        expect(row.hidden).toBe(false);
    });

    it('selecting a swatch persists the colour and sets the CSS variable', () => {
        localStorage.setItem('puzzle-piece-outline', 'outline');
        createInfoModal({ container });

        (
            document.querySelector(
                'button.outline-color-button',
            ) as HTMLButtonElement
        ).click();
        (
            document.querySelector(
                '[data-swatch-id="blue-default"]',
            ) as HTMLButtonElement
        ).click();

        expect(localStorage.getItem('puzzle-piece-outline-color')).toBe(
            'blue-default',
        );
        expect(
            document.documentElement.style.getPropertyValue(
                '--piece-outline-color',
            ),
        ).toBe('var(--color-blue-default)');
    });
```

Also extend the `beforeEach` in that `describe` (currently at lines 260-265) to clear the outline-colour custom property, so tests don't leak into each other. Change it to:

```ts
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        localStorage.clear();
        document.documentElement.style.removeProperty('--piece-edge-filter');
        document.documentElement.style.removeProperty('--piece-outline-color');
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/info-modal.test.ts`
Expected: FAIL — no `piece-outline-color-row` element exists yet.

- [ ] **Step 3: Add the imports**

In `src/ui/info-modal.ts`, the existing import block (lines 24-29) is:

```ts
import {
    PIECE_OUTLINE_PRESETS,
    loadPieceOutlinePreference,
    savePieceOutlinePreference,
    applyPieceOutline,
} from './piece-outline.js';
```

Immediately after it, add:

```ts
import {
    loadPieceOutlineColorPreference,
    savePieceOutlineColorPreference,
    applyPieceOutlineColor,
} from './piece-outline-color.js';
import { createPieceOutlineColorPicker } from './piece-outline-color-picker.js';
```

- [ ] **Step 4: Implement the picker row in `buildPieceOutlineSetting`**

In `src/ui/info-modal.ts`, update the description text. Change (line 290):

```ts
    desc.textContent = 'The visual edge drawn around each piece group.';
```

to:

```ts
    desc.textContent =
        'The visual edge drawn around each piece group. With "Outline" ' +
        'selected, pick its colour below.';
```

Then, inside the `for (const preset of PIECE_OUTLINE_PRESETS)` loop, the click
handler currently ends (lines 317-324):

```ts
        button.addEventListener('click', () => {
            savePieceOutlinePreference(preset.id);
            applyPieceOutline(preset.id);
            container
                .querySelectorAll('.preset-option')
                .forEach((btn) => btn.classList.remove('selected'));
            button.classList.add('selected');
        });
```

Add a visibility update as the last line of that handler body (so it reads):

```ts
        button.addEventListener('click', () => {
            savePieceOutlinePreference(preset.id);
            applyPieceOutline(preset.id);
            container
                .querySelectorAll('.preset-option')
                .forEach((btn) => btn.classList.remove('selected'));
            button.classList.add('selected');
            updateColorRowVisibility(preset.id);
        });
```

Finally, replace the tail of the function (currently lines 329-330):

```ts
    setting.appendChild(container);
    return setting;
```

with:

```ts
    setting.appendChild(container);

    // Outline-colour picker — only meaningful for the "Outline" style, so
    // it's revealed/hidden as the active edge style changes.
    const colorRow = document.createElement('div');
    colorRow.className = 'outline-color-row';
    colorRow.dataset.testid = 'piece-outline-color-row';

    const colorLabel = document.createElement('span');
    colorLabel.className = 'info-setting-label';
    colorLabel.textContent = 'Outline colour';
    colorRow.appendChild(colorLabel);

    createPieceOutlineColorPicker({
        container: colorRow,
        selectedId: loadPieceOutlineColorPreference(),
        onSelect: (colorId) => {
            savePieceOutlineColorPreference(colorId);
            applyPieceOutlineColor(colorId);
        },
    });

    function updateColorRowVisibility(styleId: string): void {
        colorRow.hidden = styleId !== 'outline';
    }
    updateColorRowVisibility(currentId);

    setting.appendChild(colorRow);
    return setting;
```

Note: `currentId` is the already-loaded edge-style id (defined at line 297,
`const currentId = loadPieceOutlinePreference();`). `updateColorRowVisibility`
is a function declaration, so it's hoisted and usable in the click handlers
defined above it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/ui/info-modal.test.ts`
Expected: PASS (existing Piece-outline tests + the four new ones).

- [ ] **Step 6: Commit**

```bash
git add src/ui/info-modal.ts src/ui/info-modal.test.ts
git commit -m "feat: pick the piece-outline colour in the info modal (#392)"
```

---

## Task 6: Apply the saved outline colour at startup

**Files:**
- Modify: `src/main.ts` (import block lines 25-45; startup lines 1207-1208)

No unit test (wiring in `main.ts` isn't unit-tested in this repo); covered by the build and the Task 8 manual verification.

- [ ] **Step 1: Add the imports**

In `src/main.ts`, within the `import { … } from './ui/index.js';` block, after
the line `    applyPieceOutline,` (line 35), add:

```ts
    loadPieceOutlineColorPreference,
    applyPieceOutlineColor,
```

- [ ] **Step 2: Apply the colour on startup**

In `src/main.ts`, the block at lines 1205-1208 is:

```ts
// Install the SVG filter used by the "Outline" piece-outline mode and
// apply the saved preference.
installPieceOutlineFilter();
applyPieceOutline(loadPieceOutlinePreference());
```

Change it to:

```ts
// Install the SVG filter used by the "Outline" piece-outline mode and
// apply the saved style + colour preferences. The colour itself flips
// with the OS theme via CSS, so (unlike the background) no re-apply on
// theme change is needed.
installPieceOutlineFilter();
applyPieceOutline(loadPieceOutlinePreference());
applyPieceOutlineColor(loadPieceOutlineColorPreference());
```

- [ ] **Step 3: Verify the build type-checks**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: apply the saved piece-outline colour on startup (#392)"
```

---

## Task 7: Styles for the picker button, popover, and row

**Files:**
- Modify: `src/style.css` (append after the `.swatch--selected:hover` rule, around line 938)

No unit test (CSS); verified visually in Task 8.

- [ ] **Step 1: Add the CSS**

In `src/style.css`, after the `.swatch--selected:hover { … }` rule (ends ~line
938), add:

```css
/* Piece-outline colour picker — lives inline inside the info modal's
   Piece-outline setting (unlike the toolbar background button, so it is
   NOT absolutely positioned). The trigger button previews the current
   outline colour as its own background; the popover anchors to the row. */
.outline-color-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  position: relative; /* anchor for the absolutely-positioned popover */
  margin-top: 8px;
}

.outline-color-row[hidden] {
  display: none;
}

.outline-color-button {
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  cursor: pointer;
  background: var(--piece-outline-color, #080808);
  transition: border-color 0.15s ease;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}

.outline-color-button:hover {
  border-color: var(--ui-border-hover);
}

/* Outline-picker popover, anchored under its button within the row. */
.outline-color-panel {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  z-index: 10000;
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: PASS (`tsc` + `vite build` succeed).

- [ ] **Step 3: Commit**

```bash
git add src/style.css
git commit -m "feat: style the piece-outline colour picker (#392)"
```

---

## Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS — all suites green, including the new `piece-outline-color`,
`piece-outline-color-picker`, updated `piece-outline-filter`, and
`info-modal` tests.

- [ ] **Step 2: Build (type-check + bundle)**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Lint (if configured)**

Run: `npx eslint src/ui/piece-outline-color.ts src/ui/piece-outline-color-picker.ts src/ui/piece-outline-filter.ts src/ui/info-modal.ts src/main.ts`
Expected: no errors. (If `eslint` isn't installed/configured, skip.)

- [ ] **Step 4: Manual verification in the app**

Run: `npm run dev`, open the app, then:
1. Open the info modal → Settings → Piece outline. With "Shadow" (default)
   active, the **Outline colour** row is hidden.
2. Click **Outline**. The colour row appears; the preview button shows
   near-black; pieces gain a 1px near-black outline.
3. Click the preview button → the palette grid opens. Pick a bright colour
   (e.g. blue). The outline recolours **live** to that colour; the preview
   button updates.
4. Reload the page. The chosen colour persists (outline is still blue) and
   the picker shows it selected.
5. Switch the OS theme light↔dark: the outline colour flips with the
   palette (a near-black default stays near-black).

- [ ] **Step 5: Confirm help text**

Confirm `src/ui/info-modal.ts`'s Piece-outline description now mentions
choosing the outline colour (the `CLAUDE.md` Settings help-text trigger).
No other help section (How to Play, Cut Styles) needs changes — this is a
Settings-only addition.

- [ ] **Step 6: Final review of the diff**

Run: `git diff origin/main --stat`
Expected: the 10 files from the File Structure section, nothing else.

---

## Self-Review notes (for the implementer)

- **Spec coverage:** AC1 (pick from palette, applies live) → Tasks 1+5+7;
  AC2 (persists) → Task 2 + Task 5 swatch-selection test; AC3 (default
  black) → Task 2 default `gray-darker-3` (#080808); AC4 (help text) →
  Task 5 description change. Forward-compat (style-scoped key) → Task 2.
- **Storage convention:** key `puzzle-piece-outline-color`, var
  `--piece-outline-color` — consistent across Tasks 1, 2, 5, 6, 7.
- **Naming consistency:** `applyPieceOutlineColor`,
  `loadPieceOutlineColorPreference`, `savePieceOutlineColorPreference`,
  `createPieceOutlineColorPicker`, `PIECE_OUTLINE_COLOR_PRESETS`,
  `DEFAULT_PIECE_OUTLINE_COLOR_ID` — used identically in every task that
  references them.
```
