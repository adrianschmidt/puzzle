# Control Contrast Over Pieces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the floating in-app controls stay legible when same-tone pieces sit directly behind them, by backing them with an opposite-tone scrim instead of the current faint same-tone overlay.

**Architecture:** Pure CSS change in `src/style.css`. Add a dedicated `--ui-control-scrim*` variable trio (dark scrim in the dark scheme, light scrim in the light scheme) and repoint the `background` of the nine floating-over-pieces controls to it. The shared `--ui-overlay*` family is left untouched so modal/dialog internals are unaffected.

**Tech Stack:** Vanilla CSS (custom properties), Vite. No automated test (CSS-only); verification is visual via the dev server.

**Spec:** `docs/superpowers/specs/2026-06-02-control-contrast-over-pieces-design.md`

---

## Background the implementer must know

- The controls' light/dark **foreground** is chosen from background luminance
  (`isLightColour()` in `src/ui/background-colour.ts`), which sets
  `document.documentElement.dataset.uiScheme` to `light` or `dark`. The CSS in
  `src/style.css` flips variables between the `:root` block (dark scheme) and
  the `[data-ui-scheme="light"]` block.
- **Do not touch `--ui-overlay*`.** It is redefined and reused by modal
  internals (`.size-picker-dialog`, `.info-modal`, `.bg-colour-panel` and their
  children). Two `background: var(--ui-overlay…)` lines that look identical to
  control lines belong to modals and must stay: line ~817
  (`.info-modal-solve-btn`) and line ~1001 (`.info-modal-close:hover`).
- **Editing mechanic — anchor on the selector.** The strings
  `background: var(--ui-overlay);`, `…-hover);`, and `…-active);` each appear
  many times. When editing, include the rule's selector line (and, for the
  resting state, the lines between the selector and the `background` line) in
  the Edit `old_string` so the match is unique. `replace_all` is **not** safe
  here.
- Line numbers below are pre-edit (before Task 1 adds variables). After Task 1
  inserts lines into the two scheme blocks near the top, every control line
  number shifts down by 8. Prefer matching on selector text over trusting the
  raw numbers.

---

## Task 1: Add the `--ui-control-scrim*` variable trio

**Files:**
- Modify: `src/style.css` (`:root` block ~line 10; `[data-ui-scheme="light"]` block ~line 29)

- [ ] **Step 1: Add the dark-scheme scrim variables to `:root`**

In the `:root` block, immediately after the line
`  --ui-overlay-active: rgba(255, 255, 255, 0.25);` insert:

```css
  /* Floating-control scrim — opposite tone to the foreground so controls
     stay legible over same-tone pieces (issue #388). Dark scheme = dark scrim. */
  --ui-control-scrim: rgba(0, 0, 0, 0.45);
  --ui-control-scrim-hover: rgba(0, 0, 0, 0.55);
  --ui-control-scrim-active: rgba(0, 0, 0, 0.65);
```

Anchor the edit on the unique surrounding lines, e.g. old_string:

```css
  --ui-overlay-active: rgba(255, 255, 255, 0.25);
  --ui-border-subtle: rgba(255, 255, 255, 0.1);
```

new_string:

```css
  --ui-overlay-active: rgba(255, 255, 255, 0.25);
  /* Floating-control scrim — opposite tone to the foreground so controls
     stay legible over same-tone pieces (issue #388). Dark scheme = dark scrim. */
  --ui-control-scrim: rgba(0, 0, 0, 0.45);
  --ui-control-scrim-hover: rgba(0, 0, 0, 0.55);
  --ui-control-scrim-active: rgba(0, 0, 0, 0.65);
  --ui-border-subtle: rgba(255, 255, 255, 0.1);
```

- [ ] **Step 2: Add the light-scheme scrim variables to `[data-ui-scheme="light"]`**

In the `[data-ui-scheme="light"]` block, after
`  --ui-overlay-active: rgba(0, 0, 0, 0.18);`, insert the light scrim. old_string:

```css
  --ui-overlay-active: rgba(0, 0, 0, 0.18);
  --ui-border-subtle: rgba(0, 0, 0, 0.1);
```

new_string:

```css
  --ui-overlay-active: rgba(0, 0, 0, 0.18);
  /* Light scheme = light scrim under the dark-foreground controls. */
  --ui-control-scrim: rgba(255, 255, 255, 0.55);
  --ui-control-scrim-hover: rgba(255, 255, 255, 0.65);
  --ui-control-scrim-active: rgba(255, 255, 255, 0.75);
  --ui-border-subtle: rgba(0, 0, 0, 0.1);
```

- [ ] **Step 3: Verify the variables exist exactly twice**

Run: `grep -c "\-\-ui-control-scrim:" src/style.css`
Expected: `2` (once per scheme block).

---

## Task 2: Repoint the eight variable-based floating controls

**Files:**
- Modify: `src/style.css` (the eight rules listed below)

These eight controls each have three `background` declarations — resting,
`:hover`, `:active` — currently pointing at `--ui-overlay`, `--ui-overlay-hover`,
`--ui-overlay-active`. Repoint **all three** in each, using this mapping:

| current value | new value |
|---|---|
| `var(--ui-overlay)` | `var(--ui-control-scrim)` |
| `var(--ui-overlay-hover)` | `var(--ui-control-scrim-hover)` |
| `var(--ui-overlay-active)` | `var(--ui-control-scrim-active)` |

The eight rules and their three pre-edit background line numbers:

| selector | resting | `:hover` | `:active` |
|---|---|---|---|
| `.new-game-button` | 76 | 89 | 94 |
| `.centre-view-button` | 108 | 121 | 126 |
| `.gather-pieces-button` | 140 | 153 | 158 |
| `.select-tool-button` | 174 | 187 | 192 |
| `.rotate-button` | 220 | 233 | 238 |
| `.rotate-handle` | 281 | 294 | 299 |
| `.bg-colour-button` | 843 | 856 | 861 |
| `.info-button` | 924 | 937 | 942 |

> Leave `.select-tool-button--active` (the blue *selected* state, ~line 195)
> untouched — it intentionally uses a blue tint, not the overlay.

- [ ] **Step 1: Repoint the `:hover` and `:active` backgrounds (16 edits)**

For each control, the `:hover`/`:active` selector sits directly above its
`background` line, so a 2-line `old_string` is unique. Example for
`.new-game-button:hover`:

old_string:
```css
.new-game-button:hover {
  background: var(--ui-overlay-hover);
```
new_string:
```css
.new-game-button:hover {
  background: var(--ui-control-scrim-hover);
```

Repeat for every `:hover` (→ `--ui-control-scrim-hover`) and every `:active`
(→ `--ui-control-scrim-active`) row in the table above, anchoring each on its
own selector line.

- [ ] **Step 2: Repoint the resting backgrounds (8 edits)**

The resting `background: var(--ui-overlay);` line is several lines below its
selector. To make the match unique, Read the rule, then build an `old_string`
that runs from the selector's opening line through the `background:` line
verbatim, and change only the value to `var(--ui-control-scrim)`. Example for
`.new-game-button`:

old_string (selector through background, copied verbatim from the file):
```css
.new-game-button {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 9999;
  padding: 8px 16px;
  font-size: 0.875rem;
  font-family: inherit;
  font-weight: 500;
  color: var(--ui-fg);
  background: var(--ui-overlay);
```
new_string: identical, with the final line changed to
`  background: var(--ui-control-scrim);`.

Do the same for the other seven resting rows in the table.

- [ ] **Step 3: Verify no floating-control rule still references `--ui-overlay`**

Run:
```bash
grep -n "var(--ui-overlay" src/style.css
```
Expected: only the **modal** users remain — lines around 591, 602, 608, 672,
683, 689, 718, 804, 817, 827, 1001, 1005, 1163, 1174, 1180 (size-picker,
segmented control, solve button, close button, preset options). None of the
eight control selectors above should appear.

Run:
```bash
grep -c "var(--ui-control-scrim" src/style.css
```
Expected: `24` (8 controls × 3 states) — Task 3 adds the deselect button on top.

---

## Task 3: Convert the deselect button to the scrim variables

**Files:**
- Modify: `src/style.css` (`.deselect-button` rule ~lines 319–354)

`.deselect-button` hardcodes a fixed dark scrim that never flips with the UI
scheme — so in the light scheme it shows a dark icon on a dark backing (the very
bug being fixed). Replace its three hardcoded backgrounds with the scrim vars.

- [ ] **Step 1: Repoint the resting background**

old_string (anchor through the selector; copy the intervening lines verbatim
from the file, the key change is the last line):
```css
.deselect-button {
```
…within this rule, change:
```css
  background: rgba(0, 0, 0, 0.35);
```
to:
```css
  background: var(--ui-control-scrim);
```
(Use a selector-anchored `old_string` spanning `.deselect-button {` down to the
`background: rgba(0, 0, 0, 0.35);` line so the match is unique — that rgba value
also appears elsewhere.)

- [ ] **Step 2: Repoint the `:hover` background**

old_string:
```css
.deselect-button:hover {
  background: rgba(0, 0, 0, 0.5);
```
new_string:
```css
.deselect-button:hover {
  background: var(--ui-control-scrim-hover);
```

- [ ] **Step 3: Repoint the `:active` background**

old_string:
```css
.deselect-button:active {
  background: rgba(0, 0, 0, 0.6);
```
new_string:
```css
.deselect-button:active {
  background: var(--ui-control-scrim-active);
```

- [ ] **Step 4: Verify the deselect button no longer hardcodes a scrim**

Run: `sed -n '319,360p' src/style.css | grep -n "rgba(0, 0, 0"`
Expected: no matches inside the `.deselect-button` rule.

Run: `grep -c "var(--ui-control-scrim" src/style.css`
Expected: `27` (24 from Task 2 + 3 here).

---

## Task 4: Build, verify visually, and commit

**Files:** none (verification + commit)

- [ ] **Step 1: Type-check and build**

Run: `npm run build`
Expected: `tsc` passes and `vite build` completes with no errors. (CSS custom
properties are not type-checked, but this confirms nothing else broke.)

- [ ] **Step 2: Run the existing test suite (sanity, should be unaffected)**

Run: `npm test`
Expected: PASS — no tests touch these styles; this just confirms no regression.

- [ ] **Step 3: Visual check in the dark scheme**

Run: `npm run dev`, open the app, keep a dark background preset (e.g. Midnight).
Confirm every control — New Game, Centre View, Gather Pieces, the multi-select
tool (top-left), the background-colour button, the info button, the rotate
CW/CCW buttons and the free-rotation handle (focus a piece to show them), and
the deselect button (select pieces to show it) — keeps a clearly legible
light icon/text when light-toned pieces sit directly behind it, and looks
tasteful (not heavy/boxy) over the bare table.

- [ ] **Step 4: Visual check in the light scheme**

Switch to a light background preset (e.g. Light). Confirm the same controls keep
a clearly legible dark icon/text over dark-toned pieces, and that the deselect
button now flips to a light scrim (previously it stayed dark and was
unreadable here).

- [ ] **Step 5: (Optional) Capture before/after screenshots for the PR**

If desired, use Playwright to screenshot the toolbar + a focused piece's rotate
controls over busy imagery in both schemes, for the PR description.

- [ ] **Step 6: Commit**

```bash
git add src/style.css
git commit -m "$(cat <<'EOF'
feat(controls): back floating controls with an opposite-tone scrim

Controls picked their light/dark foreground from the background only, so
same-tone pieces behind a control made its text/icon nearly invisible. Add
a dedicated --ui-control-scrim trio (dark scrim under light controls, light
scrim under dark controls) and repoint the nine floating-over-pieces
controls to it. The shared --ui-overlay family (used by modal internals) is
left untouched. Also fixes the deselect button, which hardcoded a dark scrim
that never flipped and was unreadable in the light scheme.

Closes #388

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Notes carried from the spec

- **No help-text update.** Cosmetic legibility polish to existing controls; no
  new button/interaction/setting/cut-style, and the info modal documents none
  of this styling. (Per `CLAUDE.md`'s help-sync rule.)
- **No contract impact.** Pure CSS — touches no seeded-PRNG call sequence and no
  save format; share links and saves are unaffected.
