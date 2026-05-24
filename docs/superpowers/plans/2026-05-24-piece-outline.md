# Piece outline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rotation-revealing, halo-distorting resting-state drop-shadow on puzzle groups with a user-selectable **Piece outline** setting (None / Shadow / Outline) in the info modal. Closes #374.

**Architecture:** Single CSS custom property `--piece-edge-filter` on `document.documentElement` drives the resting-state look. Three modes: `none`, a symmetric soft `drop-shadow`, or `url(#piece-outline)` — an SVG `<filter>` with `feMorphology dilate` for a sharp 1px black silhouette. The existing `.selected`, `.dragging`, and `.merge-pulse` filter rules compose against the variable so the choice is preserved in every group state. The drag-lift shadow goes symmetric too (no y-offset) to eliminate rotation tells across the board.

**Tech Stack:** TypeScript, Vite, Vitest (`@vitest-environment jsdom`), CSS custom properties, SVG filters.

**Spec:** `docs/superpowers/specs/2026-05-24-piece-outline-design.md`.

---

## File Structure

| File | New / Modified | Responsibility |
|---|---|---|
| `src/ui/piece-outline.ts` | New | Preset list, `localStorage` persistence (`createIdPreferenceStore`), `applyPieceOutline(id)` that sets the CSS custom property on `documentElement`. |
| `src/ui/piece-outline.test.ts` | New | Unit tests for presets, save/load, `applyPieceOutline`. |
| `src/ui/piece-outline-filter.ts` | New | Idempotent `installPieceOutlineFilter()` that injects a hidden `<svg>` with the `feMorphology` filter `<defs>` into `document.body`. |
| `src/ui/piece-outline-filter.test.ts` | New | Idempotency test, presence of `<filter id="piece-outline">`. |
| `src/style.css` | Modified | Resting `[data-group-id]`, `.selected`, `.dragging`, `.merge-pulse`, and `@keyframes merge-pulse` rules switch to `var(--piece-edge-filter, …)`. Drag-lift becomes symmetric. New `.preset-option*` classes replace `.tolerance-option*` (rename) so both settings share styles. |
| `src/ui/info-modal.ts` | Modified | New `buildPieceOutlineSetting()` (mirrors `buildToleranceSetting`). Inserted between tolerance and offset-drag rows. Tolerance setting uses the new `.preset-option*` class names. |
| `src/ui/info-modal.test.ts` | Modified | New tests for the piece-outline row rendering and click behaviour. |
| `src/ui/index.ts` | Modified | Re-export `piece-outline.ts` symbols (mirrors existing `background-colour` re-exports). |
| `src/main.ts` | Modified | Call `installPieceOutlineFilter()` and `applyPieceOutline(loadPieceOutlinePreference())` near the existing background-colour boot block. |

---

## Task 1: Create `piece-outline.ts` preference module

**Files:**
- Create: `src/ui/piece-outline.ts`
- Test: `src/ui/piece-outline.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/piece-outline.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    PIECE_OUTLINE_PRESETS,
    DEFAULT_PIECE_OUTLINE_ID,
    PIECE_OUTLINE_PREFERENCE_KEY,
    CSS_CUSTOM_PROPERTY,
    getPieceOutlinePreset,
    savePieceOutlinePreference,
    loadPieceOutlinePreference,
    applyPieceOutline,
} from './piece-outline.js';

describe('PIECE_OUTLINE_PRESETS', () => {
    it('has exactly three presets in order: none, shadow, outline', () => {
        expect(PIECE_OUTLINE_PRESETS.map((p) => p.id)).toEqual([
            'none',
            'shadow',
            'outline',
        ]);
    });

    it('default id is "shadow"', () => {
        expect(DEFAULT_PIECE_OUTLINE_ID).toBe('shadow');
    });

    it('each preset has id, label, description, and filter', () => {
        for (const preset of PIECE_OUTLINE_PRESETS) {
            expect(preset.id).toBeTruthy();
            expect(preset.label).toBeTruthy();
            expect(preset.description).toBeTruthy();
            expect(preset.filter).toBeTruthy();
        }
    });

    it('none preset has filter "none"', () => {
        expect(getPieceOutlinePreset('none').filter).toBe('none');
    });

    it('shadow preset uses a zero-offset drop-shadow (rotation-invariant)', () => {
        expect(getPieceOutlinePreset('shadow').filter).toMatch(
            /^drop-shadow\(\s*0\s+0\s+/,
        );
    });

    it('outline preset references the piece-outline SVG filter', () => {
        expect(getPieceOutlinePreset('outline').filter).toBe('url(#piece-outline)');
    });
});

describe('savePieceOutlinePreference / loadPieceOutlinePreference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('saves and loads an id', () => {
        savePieceOutlinePreference('outline');
        expect(loadPieceOutlinePreference()).toBe('outline');
    });

    it('returns the default when nothing is saved', () => {
        expect(loadPieceOutlinePreference()).toBe(DEFAULT_PIECE_OUTLINE_ID);
    });

    it('returns the default for an unknown saved id', () => {
        localStorage.setItem(PIECE_OUTLINE_PREFERENCE_KEY, 'not-a-mode');
        expect(loadPieceOutlinePreference()).toBe(DEFAULT_PIECE_OUTLINE_ID);
    });
});

describe('applyPieceOutline', () => {
    beforeEach(() => {
        document.documentElement.style.removeProperty(CSS_CUSTOM_PROPERTY);
    });

    it('sets the CSS custom property to the preset filter', () => {
        applyPieceOutline('outline');
        expect(
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY),
        ).toBe('url(#piece-outline)');
    });

    it('overwrites on subsequent calls', () => {
        applyPieceOutline('outline');
        applyPieceOutline('none');
        expect(
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY),
        ).toBe('none');
    });

    it('falls back to the default preset for an unknown id', () => {
        applyPieceOutline('not-a-mode');
        expect(
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY),
        ).toBe(getPieceOutlinePreset(DEFAULT_PIECE_OUTLINE_ID).filter);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/piece-outline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the implementation**

Create `src/ui/piece-outline.ts`:

```ts
/**
 * Piece-outline presets and persistence.
 *
 * Three modes for the resting-state edge effect on puzzle groups:
 * - "none":    no filter on resting groups.
 * - "shadow":  symmetric soft drop-shadow (rotation-invariant).
 * - "outline": sharp 1px black silhouette via the SVG filter installed
 *              by `installPieceOutlineFilter` (piece-outline-filter.ts).
 *
 * The chosen filter value is written to the
 * `--piece-edge-filter` custom property on `documentElement`, where
 * `[data-group-id]` and its state variants read it via `var(...)`.
 */

import { createIdPreferenceStore } from './preference-store.js';

export interface PieceOutlinePreset {
    /** Stable string identifier used in localStorage. */
    id: string;
    /** Display label shown in the info modal. */
    label: string;
    /** Short description shown under the label. */
    description: string;
    /** CSS value applied to the --piece-edge-filter custom property. */
    filter: string;
}

export const PIECE_OUTLINE_PRESETS: readonly PieceOutlinePreset[] = [
    {
        id: 'none',
        label: 'None',
        description: 'No edge',
        filter: 'none',
    },
    {
        id: 'shadow',
        label: 'Shadow',
        description: 'Soft halo',
        filter: 'drop-shadow(0 0 4px rgba(0, 0, 0, 0.35))',
    },
    {
        id: 'outline',
        label: 'Outline',
        description: 'Sharp 1px line',
        filter: 'url(#piece-outline)',
    },
] as const;

export const DEFAULT_PIECE_OUTLINE_ID = 'shadow';
export const PIECE_OUTLINE_PREFERENCE_KEY = 'puzzle-piece-outline';
export const CSS_CUSTOM_PROPERTY = '--piece-edge-filter';

const store = createIdPreferenceStore({
    key: PIECE_OUTLINE_PREFERENCE_KEY,
    presets: PIECE_OUTLINE_PRESETS,
    defaultId: DEFAULT_PIECE_OUTLINE_ID,
    legacyOrder: [],
});

export const getPieceOutlinePreset = store.getPreset;
export const savePieceOutlinePreference = store.save;
export const loadPieceOutlinePreference = store.load;

export function applyPieceOutline(id: string): void {
    const preset = getPieceOutlinePreset(id);
    document.documentElement.style.setProperty(
        CSS_CUSTOM_PROPERTY,
        preset.filter,
    );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/piece-outline.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/piece-outline.ts src/ui/piece-outline.test.ts
git commit -m "feat(ui): add piece-outline preference module"
```

---

## Task 2: Create `piece-outline-filter.ts` SVG filter installer

**Files:**
- Create: `src/ui/piece-outline-filter.ts`
- Test: `src/ui/piece-outline-filter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/piece-outline-filter.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { installPieceOutlineFilter } from './piece-outline-filter.js';

describe('installPieceOutlineFilter', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    it('appends a <filter id="piece-outline"> to the document', () => {
        installPieceOutlineFilter();
        const filter = document.querySelector('filter#piece-outline');
        expect(filter).toBeTruthy();
    });

    it('uses feMorphology dilate with radius 1', () => {
        installPieceOutlineFilter();
        const morph = document.querySelector(
            'filter#piece-outline feMorphology',
        );
        expect(morph?.getAttribute('operator')).toBe('dilate');
        expect(morph?.getAttribute('radius')).toBe('1');
    });

    it('composites the original SourceGraphic on top via feMerge', () => {
        installPieceOutlineFilter();
        const mergeNodes = document.querySelectorAll(
            'filter#piece-outline feMerge feMergeNode',
        );
        expect(mergeNodes.length).toBe(2);
        expect(mergeNodes[1].getAttribute('in')).toBe('SourceGraphic');
    });

    it('uses the SVG namespace for filter elements', () => {
        installPieceOutlineFilter();
        const filter = document.querySelector('filter#piece-outline');
        expect(filter?.namespaceURI).toBe('http://www.w3.org/2000/svg');
    });

    it('is idempotent — a second call does not duplicate the filter', () => {
        installPieceOutlineFilter();
        installPieceOutlineFilter();
        const filters = document.querySelectorAll('filter#piece-outline');
        expect(filters.length).toBe(1);
    });

    it('host <svg> is visually hidden (no layout impact)', () => {
        installPieceOutlineFilter();
        const svg = document.querySelector('svg[data-piece-outline-host]');
        expect(svg).toBeTruthy();
        expect(svg?.getAttribute('width')).toBe('0');
        expect(svg?.getAttribute('height')).toBe('0');
        expect(svg?.getAttribute('aria-hidden')).toBe('true');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/piece-outline-filter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the implementation**

Create `src/ui/piece-outline-filter.ts`:

```ts
/**
 * Inject the SVG `<filter id="piece-outline">` used by the Outline
 * mode of the Piece outline setting. The filter dilates the source
 * graphic by 1px, recolours that ring black, then composites the
 * original on top — producing a sharp 1px silhouette around the
 * group `<div>` it's applied to via `filter: url(#piece-outline)`.
 *
 * The filter is hosted in a zero-sized, aria-hidden `<svg>` so it
 * occupies no layout space and is excluded from a11y trees.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const HOST_DATASET_KEY = 'pieceOutlineHost';
const HOST_DATASET_ATTR = 'data-piece-outline-host';

export function installPieceOutlineFilter(): void {
    if (document.querySelector(`svg[${HOST_DATASET_ATTR}]`)) {
        return;
    }

    const host = document.createElementNS(SVG_NS, 'svg');
    host.setAttribute('width', '0');
    host.setAttribute('height', '0');
    host.setAttribute('aria-hidden', 'true');
    host.dataset[HOST_DATASET_KEY] = '';
    host.style.position = 'absolute';

    const defs = document.createElementNS(SVG_NS, 'defs');
    const filter = document.createElementNS(SVG_NS, 'filter');
    filter.setAttribute('id', 'piece-outline');
    filter.setAttribute('x', '-10%');
    filter.setAttribute('y', '-10%');
    filter.setAttribute('width', '120%');
    filter.setAttribute('height', '120%');

    const morph = document.createElementNS(SVG_NS, 'feMorphology');
    morph.setAttribute('in', 'SourceGraphic');
    morph.setAttribute('operator', 'dilate');
    morph.setAttribute('radius', '1');
    morph.setAttribute('result', 'dilated');
    filter.appendChild(morph);

    const flood = document.createElementNS(SVG_NS, 'feFlood');
    flood.setAttribute('flood-color', 'black');
    flood.setAttribute('result', 'colour');
    filter.appendChild(flood);

    const composite = document.createElementNS(SVG_NS, 'feComposite');
    composite.setAttribute('in', 'colour');
    composite.setAttribute('in2', 'dilated');
    composite.setAttribute('operator', 'in');
    composite.setAttribute('result', 'outline');
    filter.appendChild(composite);

    const merge = document.createElementNS(SVG_NS, 'feMerge');
    const outlineNode = document.createElementNS(SVG_NS, 'feMergeNode');
    outlineNode.setAttribute('in', 'outline');
    merge.appendChild(outlineNode);
    const sourceNode = document.createElementNS(SVG_NS, 'feMergeNode');
    sourceNode.setAttribute('in', 'SourceGraphic');
    merge.appendChild(sourceNode);
    filter.appendChild(merge);

    defs.appendChild(filter);
    host.appendChild(defs);
    document.body.appendChild(host);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/piece-outline-filter.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/piece-outline-filter.ts src/ui/piece-outline-filter.test.ts
git commit -m "feat(ui): inject SVG feMorphology filter for piece outline"
```

---

## Task 3: Rename `.tolerance-option*` CSS classes to generic `.preset-option*`

**Why this task:** Task 5 introduces a second info-modal setting (Piece outline) with the same three-button visual layout as the existing Snap distance setting. The CSS classes are currently named `.tolerance-option*` which would force either misnaming or duplication. A targeted rename keeps the styles DRY for the two callsites.

**Files:**
- Modify: `src/style.css:1136-1190`
- Modify: `src/ui/info-modal.ts:232-265`

- [ ] **Step 1: Rename CSS classes in `src/style.css`**

In `src/style.css`, replace lines 1136-1190 (the `.tolerance-option*` block) with the same rules under `.preset-option*` names:

```css
.preset-options {
  display: flex;
  gap: 8px;
}

.preset-option {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 10px 8px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 10px;
  background: var(--ui-overlay-subtle);
  color: var(--ui-fg);
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}

.preset-option:hover {
  background: var(--ui-overlay-hover);
  border-color: var(--ui-border);
}

.preset-option:active {
  transform: scale(0.97);
  background: var(--ui-overlay-hover);
}

.preset-option.selected {
  border-color: rgba(100, 160, 255, 0.6);
  background: rgba(100, 160, 255, 0.1);
}

.preset-option.selected:hover {
  border-color: rgba(100, 160, 255, 0.8);
  background: rgba(100, 160, 255, 0.15);
}

.preset-option-label {
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1;
}

.preset-option-desc {
  font-size: 0.65rem;
  opacity: 0.6;
  margin-top: 3px;
}
```

- [ ] **Step 2: Update class references in `info-modal.ts`**

In `src/ui/info-modal.ts`, inside `buildToleranceSetting` (around lines 232-265), replace the four class strings:

| Before | After |
|---|---|
| `tolContainer.className = 'tolerance-options';` | `tolContainer.className = 'preset-options';` |
| `button.className = 'tolerance-option';` | `button.className = 'preset-option';` |
| `labelSpan.className = 'tolerance-option-label';` | `labelSpan.className = 'preset-option-label';` |
| `descSpan.className = 'tolerance-option-desc';` | `descSpan.className = 'preset-option-desc';` |

Also update the selector inside the click handler:

```ts
tolContainer
    .querySelectorAll('.preset-option')
    .forEach((btn) => btn.classList.remove('selected'));
```

Leave `tolContainer.dataset.testid = 'tolerance-options';` and the per-button `data-testid="tolerance-${preset.label.toLowerCase()}"` unchanged — those are test selectors that should stay setting-specific.

- [ ] **Step 3: Verify no other references to `.tolerance-option`**

Run: `grep -rn 'tolerance-option' src/`
Expected: only test files mentioning `data-testid` strings, no `className` or CSS rule references.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (the tolerance setting still renders and behaves identically — only class names changed).

- [ ] **Step 5: Commit**

```bash
git add src/style.css src/ui/info-modal.ts
git commit -m "refactor(ui): rename .tolerance-option* CSS classes to generic .preset-option*"
```

---

## Task 4: Switch resting/selected/dragging/merge-pulse filters to `var(--piece-edge-filter)`

**Files:**
- Modify: `src/style.css:357-421`

- [ ] **Step 1: Update the four `[data-group-id]` filter rules and the keyframes**

In `src/style.css`, replace the existing piece/group shadow block (lines 356-421) with the composing version. The exact existing block is:

```css
/* Piece/group shadows for depth */
[data-group-id] {
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.35));
}
```

…followed lower at lines 392-421 by the `.selected`, `.selected.dragging`, `.dragging`, `.merge-pulse`, and `@keyframes merge-pulse` rules.

Replace each as follows.

`[data-group-id]` resting state (line 357-359):

```css
/* Piece/group edge — value driven by the Piece outline setting. */
[data-group-id] {
  filter: var(--piece-edge-filter, drop-shadow(0 0 4px rgba(0, 0, 0, 0.35)));
}
```

`.selected` (lines 392-398):

```css
/* Selected group highlight — must be clearly visible on any background */
[data-group-id].selected {
  filter: var(--piece-edge-filter, none)
          drop-shadow(0 0 6px rgba(60, 130, 255, 0.9))
          drop-shadow(0 0 14px rgba(60, 130, 255, 0.7))
          drop-shadow(0 0 24px rgba(60, 130, 255, 0.4));
}
```

`.selected.dragging` (lines 400-406):

```css
/* Selected + dragging: keep the glow while lifted */
[data-group-id].selected.dragging {
  filter: var(--piece-edge-filter, none)
          drop-shadow(0 0 12px rgba(0, 0, 0, 0.45))
          drop-shadow(0 0 6px rgba(60, 130, 255, 0.9))
          drop-shadow(0 0 14px rgba(60, 130, 255, 0.7))
          drop-shadow(0 0 24px rgba(60, 130, 255, 0.4));
}
```

`.dragging` (lines 408-411):

```css
/* Lifted shadow when a group is being dragged — symmetric, no rotation tell */
[data-group-id].dragging {
  filter: var(--piece-edge-filter, none)
          drop-shadow(0 0 12px rgba(0, 0, 0, 0.45));
}
```

`@keyframes merge-pulse` (lines 418-421):

```css
@keyframes merge-pulse {
  0%   { filter: var(--piece-edge-filter, none) brightness(1.2); }
  100% { filter: var(--piece-edge-filter, none) brightness(1); }
}
```

The `.merge-pulse` class rule itself (line 414-416) stays unchanged — it just references the animation.

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass. CSS changes don't affect unit-test behaviour.

- [ ] **Step 3: Commit**

```bash
git add src/style.css
git commit -m "refactor(ui): drive group filters from --piece-edge-filter custom property"
```

---

## Task 5: Add the "Piece outline" setting to the info modal

**Files:**
- Modify: `src/ui/info-modal.ts`
- Test: `src/ui/info-modal.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/info-modal.test.ts` (inside the file, after the existing `describe` blocks):

```ts
describe('createInfoModal — Piece outline setting', () => {
    let container: HTMLElement;
    let modal: ReturnType<typeof createInfoModal>;

    beforeEach(() => {
        localStorage.clear();
        document.documentElement.style.removeProperty('--piece-edge-filter');
        container = document.createElement('div');
        document.body.appendChild(container);
        modal = createInfoModal({ container });
        modal.open();
    });

    afterEach(() => {
        modal.close();
        container.remove();
    });

    it('renders three Piece outline buttons (None, Shadow, Outline)', () => {
        const buttons = document.querySelectorAll(
            '[data-testid^="piece-outline-"]',
        );
        expect(buttons.length).toBe(3);
        const labels = Array.from(buttons).map(
            (b) => b.querySelector('.preset-option-label')?.textContent,
        );
        expect(labels).toEqual(['None', 'Shadow', 'Outline']);
    });

    it('marks Shadow as selected by default', () => {
        const shadowBtn = document.querySelector(
            '[data-testid="piece-outline-shadow"]',
        );
        expect(shadowBtn?.classList.contains('selected')).toBe(true);
    });

    it('clicking Outline persists the choice and updates the CSS variable', () => {
        const outlineBtn = document.querySelector(
            '[data-testid="piece-outline-outline"]',
        ) as HTMLButtonElement;
        outlineBtn.click();

        expect(localStorage.getItem('puzzle-piece-outline')).toBe('outline');
        expect(
            document.documentElement.style.getPropertyValue('--piece-edge-filter'),
        ).toBe('url(#piece-outline)');
        expect(outlineBtn.classList.contains('selected')).toBe(true);
    });

    it('clicking a second option deselects the first', () => {
        const noneBtn = document.querySelector(
            '[data-testid="piece-outline-none"]',
        ) as HTMLButtonElement;
        const outlineBtn = document.querySelector(
            '[data-testid="piece-outline-outline"]',
        ) as HTMLButtonElement;

        outlineBtn.click();
        noneBtn.click();

        expect(noneBtn.classList.contains('selected')).toBe(true);
        expect(outlineBtn.classList.contains('selected')).toBe(false);
    });
});
```

Make sure `afterEach` is imported from `vitest` at the top of the file (the existing imports likely already cover this — confirm in the file).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/info-modal.test.ts -t "Piece outline"`
Expected: FAIL — buttons not found.

- [ ] **Step 3: Add the `buildPieceOutlineSetting` builder and wire it in**

In `src/ui/info-modal.ts`, add to the import block at the top:

```ts
import {
    PIECE_OUTLINE_PRESETS,
    loadPieceOutlinePreference,
    savePieceOutlinePreference,
    applyPieceOutline,
} from './piece-outline.js';
```

Inside `buildSettingsSection`, insert the new builder between the tolerance row and the offset-drag row:

```ts
function buildSettingsSection(args: {
    onToleranceChanged?: (id: string) => void;
}): HTMLElement {
    const section = document.createElement('section');
    section.className = 'info-section';

    const heading = document.createElement('h3');
    heading.textContent = 'Settings';
    section.appendChild(heading);

    section.appendChild(buildToleranceSetting(args.onToleranceChanged));
    section.appendChild(buildPieceOutlineSetting());
    section.appendChild(buildOffsetDragSetting());

    return section;
}
```

Add the builder itself (placed near `buildToleranceSetting`):

```ts
function buildPieceOutlineSetting(): HTMLElement {
    const setting = document.createElement('div');
    setting.className = 'info-setting';

    const label = document.createElement('label');
    label.className = 'info-setting-label';
    label.textContent = 'Piece outline';
    setting.appendChild(label);

    const desc = document.createElement('p');
    desc.className = 'info-setting-description';
    desc.textContent = 'The visual edge drawn around each piece group.';
    setting.appendChild(desc);

    const container = document.createElement('div');
    container.className = 'preset-options';
    container.dataset.testid = 'piece-outline-options';

    const currentId = loadPieceOutlinePreference();
    for (const preset of PIECE_OUTLINE_PRESETS) {
        const button = document.createElement('button');
        button.className = 'preset-option';
        button.type = 'button';
        button.dataset.testid = `piece-outline-${preset.id}`;
        if (preset.id === currentId) {
            button.classList.add('selected');
        }

        const labelSpan = document.createElement('span');
        labelSpan.className = 'preset-option-label';
        labelSpan.textContent = preset.label;
        button.appendChild(labelSpan);

        const descSpan = document.createElement('span');
        descSpan.className = 'preset-option-desc';
        descSpan.textContent = preset.description;
        button.appendChild(descSpan);

        button.addEventListener('click', () => {
            savePieceOutlinePreference(preset.id);
            applyPieceOutline(preset.id);
            container
                .querySelectorAll('.preset-option')
                .forEach((btn) => btn.classList.remove('selected'));
            button.classList.add('selected');
        });

        container.appendChild(button);
    }

    setting.appendChild(container);
    return setting;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/info-modal.test.ts -t "Piece outline"`
Expected: all four new tests pass.

Then run the rest of the info-modal tests to confirm no regressions:

Run: `npx vitest run src/ui/info-modal.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/info-modal.ts src/ui/info-modal.test.ts
git commit -m "feat(ui): add Piece outline setting to info modal"
```

---

## Task 6: Re-export from `src/ui/index.ts` and wire boot in `src/main.ts`

**Files:**
- Modify: `src/ui/index.ts`
- Modify: `src/main.ts:1015-1017`

- [ ] **Step 1: Re-export from `src/ui/index.ts`**

In `src/ui/index.ts`, near the existing `background-colour` re-exports (around lines 81-87), add:

```ts
export {
    PIECE_OUTLINE_PRESETS,
    DEFAULT_PIECE_OUTLINE_ID,
    PIECE_OUTLINE_PREFERENCE_KEY,
    getPieceOutlinePreset,
    savePieceOutlinePreference,
    loadPieceOutlinePreference,
    applyPieceOutline,
} from './piece-outline.js';
export type { PieceOutlinePreset } from './piece-outline.js';

export { installPieceOutlineFilter } from './piece-outline-filter.js';
```

- [ ] **Step 2: Add boot wiring in `src/main.ts`**

In `src/main.ts`, find the existing background-colour boot block (around lines 1015-1017):

```ts
// Set up the Background Colour picker
const initialColourId = loadColourPreference();
applyBackgroundColour(initialColourId);
```

Insert directly before it:

```ts
// Install the SVG filter used by the "Outline" piece-outline mode and
// apply the saved preference.
installPieceOutlineFilter();
applyPieceOutline(loadPieceOutlinePreference());
```

Add the corresponding imports at the top of `src/main.ts` alongside the existing ui imports. Find the existing imports from `./ui/index.js` (or `./ui/background-colour.js` etc. — match the style already used in `main.ts`) and add:

```ts
import {
    installPieceOutlineFilter,
    loadPieceOutlinePreference,
    applyPieceOutline,
} from './ui/index.js';
```

(If `main.ts` imports the existing UI symbols from individual modules rather than `./ui/index.js`, mirror that style by importing from `./ui/piece-outline.js` and `./ui/piece-outline-filter.js` directly. Run `grep -n "from './ui/" src/main.ts` to see the dominant style and match it.)

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 4: Type-check the project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/index.ts src/main.ts
git commit -m "feat: wire piece-outline filter and preference at app boot"
```

---

## Task 7: Manual visual verification in a browser

**Files:** None — interactive testing only.

The CSS/SVG combination has visual properties that unit tests can't fully validate (the filter only renders on a real browser; jsdom doesn't paint pixels). This task runs the dev server and walks through each mode.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Open the URL it prints (usually `http://localhost:5173/puzzle/`).

- [ ] **Step 2: Verify default (Shadow) on a dark background**

- Start a new puzzle with the default Midnight background.
- Open the info modal, scroll to Settings, confirm **Piece outline** shows **Shadow** as selected.
- Drag a single piece around. The shadow should look like a soft symmetric halo — no directional bias.
- Rotate a single piece (if a rotation cut style is active). The halo must not rotate with the piece — it should look identical at every rotation.

- [ ] **Step 3: Switch to None and verify**

- Click **None** in the Piece outline setting.
- Pieces should have no halo at all in resting state.
- Drag a piece — the symmetric drag halo (`drop-shadow(0 0 12px ...)`) should still appear.
- Select a group — the blue selection glow should still appear.

- [ ] **Step 4: Switch to Outline and verify**

- Click **Outline**.
- Each group should now have a sharp 1px black silhouette around its outer perimeter.
- Adjacent pieces within the same group share one outer outline — the outline must NOT appear between pieces inside a group (this is automatic because the filter applies to the group `<div>`).
- Rotate a piece. The outline must remain a uniform 1px (no rotation tell, no fuzzing).
- Drag a group. The drag halo composes with the outline — both visible.

- [ ] **Step 5: Switch background to Light and re-verify Outline**

- Change the background colour to **Light** (one of the pale presets).
- In **Outline** mode the outline should still be visible (1px black on a light background).
- In **Shadow** mode you can confirm the original distortion complaint from issue #374 is gone (the symmetric halo is less perceptually distorting than the offset one, but on pale backgrounds the halo is still visible by design).

- [ ] **Step 6: Reload and confirm persistence**

- Pick any non-default mode (e.g. Outline).
- Hard-reload the page.
- Reopen the info modal — confirm the saved mode is selected and applied.

- [ ] **Step 7: Stop the dev server**

Stop with Ctrl+C in the terminal where `npm run dev` is running.

(No commit — this task is verification only.)

---

## Task 8: Open the PR

**Files:** None.

- [ ] **Step 1: Push the branch**

Run: `git push -u origin HEAD`

- [ ] **Step 2: Open the PR with a closing keyword**

Per the repo's memory rule (`feedback_pr_closing_keyword`), include `Closes #374` as a standalone line at the top of the PR body so the issue auto-closes on merge.

Run:

```bash
gh pr create --title "feat: user-selectable piece outline (none/shadow/outline)" --body "$(cat <<'EOF'
Closes #374

## Summary

- New **Piece outline** setting in the info modal (None / Shadow / Outline). Default: Shadow.
- Resting-state group filter is now driven by `--piece-edge-filter`. The default Shadow mode is a symmetric `drop-shadow(0 0 4px ...)` — same depth cue as before but rotation-invariant, so pieces in rotation puzzles no longer telegraph their orientation through shadow direction.
- Outline mode is implemented as an SVG `<filter>` with `feMorphology dilate radius=1` plus a flood-recolour-and-merge composite, applied to the group `<div>` so each group gets one outer silhouette (no internal piece-to-piece outlines).
- Drag-lift shadow is also symmetric (`0 0 12px` instead of `0 6px 12px`) so dragging doesn't reintroduce rotation tells.
- `.tolerance-option*` CSS classes renamed to generic `.preset-option*` (shared between the two settings).

## Test plan

- [ ] `npx vitest run` — all unit tests pass, including new `piece-outline*` and `info-modal` cases.
- [ ] `npx tsc --noEmit` — clean.
- [ ] Manual: each of None / Shadow / Outline produces the expected visual effect at rest, while dragging, and while selected.
- [ ] Manual: rotating a singleton piece in **any** mode shows no rotation tell from the filter.
- [ ] Manual: in **Outline** mode, groups show a single outer outline; no internal piece-to-piece outline.
- [ ] Manual: preference persists across reload.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(No commit — the PR is the output.)

---

## Self-Review Notes

- **Spec coverage:**
  - Three modes (None/Shadow/Outline), default Shadow → Task 1.
  - `--piece-edge-filter` custom property + `var(...)` composition → Task 4.
  - SVG `feMorphology` filter → Task 2.
  - Info-modal setting rendering and click behaviour → Task 5.
  - Boot wiring → Task 6.
  - Help-text update (per-setting description, no separate prose) → Task 5 (`info-setting-description` paragraph in `buildPieceOutlineSetting`).
  - Drag-lift becomes symmetric → Task 4.
  - Selection/drag/merge-pulse compose with the variable → Task 4.
  - Test coverage (`piece-outline.test.ts`, `piece-outline-filter.test.ts`, info-modal additions) → Tasks 1, 2, 5.
- **Type consistency:** `PieceOutlinePreset.filter`, `applyPieceOutline(id: string)`, `loadPieceOutlinePreference(): string`, `installPieceOutlineFilter(): void`, the `CSS_CUSTOM_PROPERTY` constant value `--piece-edge-filter`, and the `'piece-outline-${id}'` testids are used consistently across Tasks 1, 2, 5, 6.
- **No placeholders:** every code step contains the actual code; every command is exact.
