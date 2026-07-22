# New Game Modal Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the New Game dialog fit any viewport: pinned title + internally scrolling body, a two-column layout on short-and-wide (phone landscape) viewports, wrapping dialog rows, and the "Puzzle Size" heading reunited with its grid.

**Architecture:** DOM restructure in `src/ui/new-game-dialog.ts` (scrollable `.dialog-content` wrapper containing a settings group and a start group), plus CSS in `src/style.css` following the info-modal max-height/internal-scroll pattern and one short-and-wide media query. No behavior/API changes.

**Tech Stack:** Vanilla TS + CSS, Vitest (jsdom) unit tests, raw-CSS guard tests (`style.css?raw` pattern from `src/style.test.ts`), Playwright MCP for visual verification against `npm run dev`.

**Spec:** `docs/superpowers/specs/2026-07-22-new-game-modal-responsive-design.md`

## Global Constraints

- American English in all identifiers, comments, and code artifacts.
- Composable is dev-only: must be **usable** (reachable, not clipped) at all viewports, need not be polished.
- No help-text (info modal) changes — layout-only change.
- No new "Start" button — picking a size still starts the game (future consideration only).
- Match existing code style: JSDoc-style section comments in CSS, `dialog-*` / `size-picker-*` class naming.

---

### Task 1: Restructure the dialog DOM (wrapper + groups + heading fix)

**Files:**
- Modify: `src/ui/new-game-dialog.ts:601-708` (the `createNewGameDialog` body)
- Test: `src/ui/new-game-dialog.test.ts`

**Interfaces:**
- Consumes: existing section builders in the same file (unchanged).
- Produces: DOM classes later tasks style: `.dialog-content` (scrollable body, direct child of `.size-picker-dialog`), `.dialog-group.dialog-group--settings`, `.dialog-group.dialog-group--start`. The `.size-picker-title` `h2` stays a direct child of the dialog. Inside the start group, `.size-picker-subtitle` is the immediate previous sibling of `.size-picker-grid`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/new-game-dialog.test.ts`:

```ts
describe('createNewGameDialog — responsive layout structure', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    function openDialog(): void {
        createNewGameDialog({ container, selectedSizeId: '48', onSelect: vi.fn() });
    }

    it('keeps the title outside the scrollable content wrapper', () => {
        openDialog();
        const dialog = container.querySelector('.size-picker-dialog')!;
        const title = dialog.querySelector('.size-picker-title')!;
        expect(title.parentElement).toBe(dialog);
        expect(dialog.querySelector('.dialog-content')).not.toBeNull();
        expect(dialog.querySelector('.dialog-content .size-picker-title')).toBeNull();
    });

    it('places every section inside the scrollable content wrapper', () => {
        openDialog();
        const content = container.querySelector('.dialog-content')!;
        for (const selector of [
            '.cut-style-section',
            '.rotation-row',
            '.image-source-section',
            '.size-picker-grid',
            '.composable-sliders',
        ]) {
            expect(content.querySelector(selector), selector).not.toBeNull();
        }
    });

    it('splits sections into settings and start groups for the two-column layout', () => {
        openDialog();
        const settings = container.querySelector('.dialog-group--settings')!;
        const start = container.querySelector('.dialog-group--start')!;
        expect(settings.querySelector('.cut-style-section')).not.toBeNull();
        expect(settings.querySelector('.rotation-row')).not.toBeNull();
        // Fractal and wavy borderless sections share the .cut-style-options class.
        expect(settings.querySelectorAll('.cut-style-options')).toHaveLength(2);
        expect(settings.querySelector('.composable-sliders')).not.toBeNull();
        expect(start.querySelector('.image-source-section')).not.toBeNull();
        expect(start.querySelector('.size-picker-grid')).not.toBeNull();
    });

    it('renders the "Puzzle Size" heading immediately above the size grid', () => {
        openDialog();
        const subtitle = container.querySelector('.size-picker-subtitle')!;
        expect(subtitle.textContent).toBe('Puzzle Size');
        expect(subtitle.nextElementSibling?.classList.contains('size-picker-grid')).toBe(true);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/new-game-dialog.test.ts`
Expected: the four new tests FAIL (no `.dialog-content` / `.dialog-group--*` elements; subtitle's next sibling is the cut-style section). All pre-existing tests PASS.

- [ ] **Step 3: Implement the restructure**

In `src/ui/new-game-dialog.ts`, inside `createNewGameDialog`:

(a) Delete the early subtitle append (keep the element creation — it moves into the start group):

```ts
    const sizeSubtitle = document.createElement('h3');
    sizeSubtitle.className = 'size-picker-subtitle';
    sizeSubtitle.textContent = 'Puzzle Size';
```

(the line `dialog.appendChild(sizeSubtitle);` is removed).

(b) Replace the final append block

```ts
    dialog.appendChild(cutStyleSection);
    dialog.appendChild(rotationRow);
    dialog.appendChild(fractalSection.element);
    dialog.appendChild(wavySection.element);
    dialog.appendChild(imageSourceSection.element);
    dialog.appendChild(sizeSection.element);
    dialog.appendChild(composableSection.element);
```

with:

```ts
    // Scrollable body: the title stays pinned above; everything else lives in
    // two groups so the short-and-wide layout can place them side by side.
    // Settings (cut style + its options) come first; the start group (image +
    // size grid) last, since picking a size launches the game.
    const content = document.createElement('div');
    content.className = 'dialog-content';

    const settingsGroup = document.createElement('div');
    settingsGroup.className = 'dialog-group dialog-group--settings';
    settingsGroup.appendChild(cutStyleSection);
    settingsGroup.appendChild(rotationRow);
    settingsGroup.appendChild(fractalSection.element);
    settingsGroup.appendChild(wavySection.element);
    settingsGroup.appendChild(composableSection.element);

    const startGroup = document.createElement('div');
    startGroup.className = 'dialog-group dialog-group--start';
    startGroup.appendChild(imageSourceSection.element);
    startGroup.appendChild(sizeSubtitle);
    startGroup.appendChild(sizeSection.element);

    content.appendChild(settingsGroup);
    content.appendChild(startGroup);
    dialog.appendChild(content);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/new-game-dialog.test.ts`
Expected: ALL tests PASS (new structure tests and every pre-existing test — they query with deep `querySelector`, so the wrapper is transparent to them).

- [ ] **Step 5: Commit**

```bash
git add src/ui/new-game-dialog.ts src/ui/new-game-dialog.test.ts
git commit -m "refactor(new-game-dialog): wrap content in scrollable groups, fix orphaned heading"
```

---

### Task 2: CSS — vertical fit and row wrapping

**Files:**
- Modify: `src/style.css` (`.size-picker-overlay` ~line 564, `.size-picker-dialog` ~575, `.size-picker-title` ~587, `.dialog-row` ~739)
- Test: `src/style.test.ts`

**Interfaces:**
- Consumes: `.dialog-content` / `.dialog-group` DOM structure from Task 1.
- Produces: top-level CSS rules `.dialog-content { overflow-y: auto; … }` and a flex-column `.size-picker-dialog` that Task 3's media query extends. The top-level `.dialog-content` rule MUST appear before any media query that also targets it (the guard test finds the first occurrence).

- [ ] **Step 1: Write the failing guard tests**

Append to `src/style.test.ts` (reuses the existing `ruleBody` helper — all three selectors are flat top-level rules):

```ts
/**
 * Guards for the new-game dialog's viewport fit. The dialog once rendered
 * taller than short viewports with no max-height and no scrolling, clipping
 * both ends unreachably (see the 2026-07-22 responsive-modal spec). Nothing
 * but these assertions would catch an accidental revert of the CSS wiring.
 */
describe('new-game dialog responsive CSS', () => {
    it('caps the dialog height and scrolls inside, not outside', () => {
        const body = ruleBody(styleCss, '.size-picker-dialog');
        expect(body).toMatch(/max-height:\s*100%/);
        expect(body).toMatch(/flex-direction:\s*column/);
        expect(body).toMatch(/overflow:\s*hidden/);
    });

    it('scrolls the dialog body internally', () => {
        const body = ruleBody(styleCss, '.dialog-content');
        expect(body).toMatch(/overflow-y:\s*auto/);
        expect(body).toMatch(/overscroll-behavior:\s*contain/);
    });

    it('lets dialog rows wrap instead of clipping wide controls', () => {
        expect(ruleBody(styleCss, '.dialog-row')).toMatch(/flex-wrap:\s*wrap/);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/style.test.ts`
Expected: the three new tests FAIL (`rule ".dialog-content" not found`; missing properties). Pre-existing glow tests PASS.

- [ ] **Step 3: Implement the CSS**

In `src/style.css`:

(a) `.size-picker-overlay` — add padding so the dialog never touches viewport edges:

```css
.size-picker-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.6);
  z-index: 10001;
  animation: fade-in 0.2s ease-out;
}
```

(b) `.size-picker-dialog` — flex column capped at the overlay's (padded) height; horizontal padding moves onto the title and content so the scrollbar sits inside the rounded border:

```css
.size-picker-dialog {
  background: var(--ui-surface);
  border: 1px solid var(--ui-border-subtle);
  border-radius: 16px;
  padding: 24px 0 0;
  max-width: 360px;
  width: 90%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  animation: pop-in 0.25s ease-out;
}
```

(c) `.size-picker-title` — pick up the horizontal padding it lost from the dialog:

```css
.size-picker-title {
  text-align: center;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--ui-fg);
  margin: 0 24px 20px;
}
```

(d) New rule, directly after the `.size-picker-title` block:

```css
/*
 * Scrollable body of the new-game dialog — the title above stays pinned.
 * Carries the dialog's horizontal + bottom padding so the scrollbar hugs
 * the dialog edge without escaping the rounded corners.
 */
.dialog-content {
  overflow-y: auto;
  overscroll-behavior: contain;
  min-height: 0;
  padding: 0 24px 24px;
}
```

(e) `.dialog-row` — allow wrapping (fixes the clipped Composable "Tab style" segmented control):

```css
.dialog-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/style.test.ts`
Expected: ALL tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/style.css src/style.test.ts
git commit -m "fix(new-game-dialog): cap dialog height with internal scrolling"
```

---

### Task 3: CSS — two-column layout for short-and-wide viewports

**Files:**
- Modify: `src/style.css` (append after the `.dialog-row-value` / segmented-control block, i.e. after the dialog's other rules; MUST be after the top-level `.dialog-content` rule)

**Interfaces:**
- Consumes: `.dialog-content`, `.dialog-group--settings`, `.dialog-group--start` from Tasks 1–2.
- Produces: nothing later tasks depend on; breakpoints (`min-width: 700px`, `max-height: 560px`, `max-width: 680px`) may be tuned in Task 4.

- [ ] **Step 1: Add the media query**

```css
/*
 * Short-and-wide viewports (phone landscape): the stacked dialog cannot fit,
 * so lay the two content groups side by side — settings left, image + size
 * right — and widen the dialog to hold them. The internal scroll from
 * .dialog-content remains the fallback when even two columns overflow
 * (e.g. Composable's sliders open on a very short screen).
 */
@media (min-width: 700px) and (max-height: 560px) {
  .size-picker-dialog {
    max-width: 680px;
  }

  .dialog-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 24px;
    align-items: start;
  }
}
```

No unit test: jsdom does not compute layout, and the breakpoint values are expected to be tuned during Task 4 verification — a raw-CSS guard here would just pin numbers we're about to adjust. Visual verification in Task 4 covers it.

- [ ] **Step 2: Run the full unit suite (regression check)**

Run: `npm test`
Expected: ALL tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/style.css
git commit -m "feat(new-game-dialog): two-column layout on short wide viewports"
```

---

### Task 4: Visual verification and breakpoint tuning

**Files:**
- Modify (only if tuning is needed): `src/style.css`

**Interfaces:**
- Consumes: everything above, plus a running dev server.

- [ ] **Step 1: Type-check and build**

Run: `npm run build`
Expected: clean tsc + vite build, no errors.

- [ ] **Step 2: Start the dev server**

Run: `npm run dev -- --port 5199 --strictPort` (background)
Expected: serving at `http://localhost:5199/puzzle/`.

- [ ] **Step 3: Verify in Playwright at each viewport**

For each viewport, open `http://localhost:5199/`, click **New Game**, screenshot, and check the listed criteria. For scroll checks, evaluate on `.dialog-content`: `el.scrollTop = el.scrollHeight` must expose the bottom of the size grid.

| Viewport | State | Must hold |
|---|---|---|
| 812×375 (phone landscape) | Classic | Two columns; title visible; dialog fully inside viewport or internally scrollable to reach all controls; a size button at the grid's bottom is clickable |
| 812×375 | Composable selected | All controls reachable via internal scroll; "Tab style" segments not clipped horizontally (usable is enough — dev-only) |
| 375×667 (phone portrait) | Classic | Single column; "Puzzle Size" heading directly above grid; whole dialog reachable (scroll if needed) |
| 360×640 (small portrait) | Composable selected | All controls reachable via internal scroll |
| 1280×800 (desktop) | Classic | Single centered column, unchanged look apart from heading position |

Also confirm on one viewport that backdrop click and Escape still dismiss (the padded overlay area counts as backdrop).

- [ ] **Step 4: Tune breakpoints if a criterion fails**

Adjust only the three values in the Task 3 media query (`min-width: 700px`, `max-height: 560px`, `max-width: 680px`) and re-verify the failing viewport. Do not restructure.

- [ ] **Step 5: Run the full suite one final time**

Run: `npm test`
Expected: ALL tests PASS.

- [ ] **Step 6: Commit (only if Step 4 changed anything)**

```bash
git add src/style.css
git commit -m "fix(new-game-dialog): tune responsive breakpoints after device verification"
```
