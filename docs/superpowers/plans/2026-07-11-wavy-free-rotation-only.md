# Free-Rotation-Only Wavy and Composable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the 90° rotation option for Wavy and Composable so enabling rotation means free rotation (matching Triangles); Classic and Fractal keep quarter-turn mode.

**Architecture:** Rotation mode for a *new* game becomes a pure function of cut style, implemented as a tested helper in `src/game/cut-styles.ts` and called from `startNewGame` in `src/main.ts`. The "Free rotation" sub-checkbox, its localStorage preference module, and all `freeRotation` parameter threading are deleted. Saves and share links are untouched — they carry `rotationMode` explicitly, and `'quarter-turn'` stays fully supported for Classic/Fractal and for older Wavy/Composable games.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom for UI tests). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-11-wavy-free-rotation-only-design.md`

## Global Constraints

- Do NOT touch serialization, share-link encode/decode, or reconstruction: `'quarter-turn'` must remain a valid `rotationMode` everywhere it is read.
- Do NOT add, remove, or reorder any PRNG (`random()`) calls in puzzle generation — share-link reproducibility contract.
- American English in all code and copy (`90°` copy strings are fine as-is).
- Composable stays unmentioned in the in-app help text (dev-only feature).
- Run commands from the repo root `/Users/bot/src/puzzle`.

---

### Task 1: `rotationModeForNewGame` helper

**Files:**
- Modify: `src/game/cut-styles.ts` (append at end of file)
- Test: `src/game/cut-styles.test.ts` (append at end of file)

**Interfaces:**
- Consumes: existing `CutStyle` type and `CUT_STYLE_OPTIONS` in the same file.
- Produces: `rotationModeForNewGame(cutStyle: CutStyle, rotationEnabled: boolean): 'none' | 'quarter-turn' | 'free'` — Task 2 imports this from `./game/cut-styles.js`.

- [ ] **Step 1: Write the failing tests**

Append to `src/game/cut-styles.test.ts` (the file already imports `describe`, `it`, `expect` from vitest and `CUT_STYLE_OPTIONS` from `./cut-styles.js`; add `rotationModeForNewGame` to the existing import list from `./cut-styles.js`):

```ts
describe('rotationModeForNewGame', () => {
    it('returns none when rotation is disabled, for every cut style', () => {
        for (const option of CUT_STYLE_OPTIONS) {
            expect(rotationModeForNewGame(option.id, false)).toBe('none');
        }
    });

    it('returns quarter-turn for classic and fractal', () => {
        expect(rotationModeForNewGame('classic', true)).toBe('quarter-turn');
        expect(rotationModeForNewGame('fractal', true)).toBe('quarter-turn');
    });

    it('returns free for wavy, triangles, and composable', () => {
        expect(rotationModeForNewGame('wavy', true)).toBe('free');
        expect(rotationModeForNewGame('triangles', true)).toBe('free');
        expect(rotationModeForNewGame('composable', true)).toBe('free');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/game/cut-styles.test.ts`
Expected: FAIL — `rotationModeForNewGame` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/game/cut-styles.ts`:

```ts
/**
 * Rotation mode for a newly created game, as a pure function of cut style.
 *
 * Classic and Fractal rotate in 90° steps. The traced-tab styles (Wavy,
 * Triangles, Composable) rotate freely: 90° steps don't match their
 * irregular piece shapes, so enabling rotation means free rotation.
 *
 * Only new-game creation goes through this mapping. Saves and share links
 * carry their own rotationMode, so older quarter-turn Wavy/Composable
 * puzzles keep loading unchanged.
 */
export function rotationModeForNewGame(
    cutStyle: CutStyle,
    rotationEnabled: boolean,
): 'none' | 'quarter-turn' | 'free' {
    if (!rotationEnabled) return 'none';
    return cutStyle === 'classic' || cutStyle === 'fractal'
        ? 'quarter-turn'
        : 'free';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/game/cut-styles.test.ts`
Expected: PASS (all tests in the file, including pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/game/cut-styles.ts src/game/cut-styles.test.ts
git commit -m "feat(game): add rotationModeForNewGame cut-style mapping"
```

---

### Task 2: Derive rotation mode in `main.ts`; drop `freeRotation` plumbing

`main.ts` has no unit tests; this task is verified by the compiler and the full suite. The dialog still *emits* `freeRotation` after this task — `main.ts` simply stops reading it. That keeps every intermediate commit compiling; Task 3 removes the emission.

**Files:**
- Modify: `src/main.ts` (imports around lines 56–59; `__newComposableGame` around lines 554–594; `startNewGame` signature and mode decision around lines 895–969; new-game-dialog wiring around lines 1050–1111; first-load path around lines 1482–1497)

**Interfaces:**
- Consumes: `rotationModeForNewGame` from `./game/cut-styles.js` (Task 1).
- Produces: `startNewGame` signature ends `..., vibrant: boolean = false, rotationEnabled: boolean = false, seed?: number` — the `freeRotation` parameter (previously between `rotationEnabled` and `seed`) is gone. All callers in this file are updated in this task.

- [ ] **Step 1: Remove the free-rotation preference imports**

In the `from './ui/index.js'` import block, delete these two lines:

```ts
    loadFreeRotationEnabledPreference,
    saveFreeRotationEnabledPreference,
```

Add `rotationModeForNewGame` to the existing value import from `./game/cut-styles.js`:

```ts
import {
    loadCutStylePreference,
    saveCutStylePreference,
    rotationModeForNewGame,
} from './game/cut-styles.js';
```

- [ ] **Step 2: Simplify `startNewGame`**

Remove the `freeRotation: boolean = false,` parameter (it sits between `rotationEnabled` and `seed`). Then replace the mode decision:

```ts
        let rotationMode: 'none' | 'quarter-turn' | 'free';
        if (!rotationEnabled) {
            rotationMode = 'none';
        } else if (cutStyle === 'triangles') {
            // Triangles offers no quarter-turn mode: 90° steps don't match a
            // triangle lattice, so enabling rotation means free rotation.
            rotationMode = 'free';
        } else if (freeRotation && (cutStyle === 'wavy' || cutStyle === 'composable')) {
            rotationMode = 'free';
        } else {
            rotationMode = 'quarter-turn';
        }
```

with:

```ts
        const rotationMode = rotationModeForNewGame(cutStyle, rotationEnabled);
```

- [ ] **Step 3: Simplify the `__newComposableGame` dev hook**

In the hook's overrides type, narrow the rotation override:

```ts
    rotation?: 'none' | 'free';
```

At the end of the hook, the `startNewGame` call currently passes two rotation arguments:

```ts
        rotation !== 'none',
        rotation === 'free',
        overrides?.seed,
```

Replace with:

```ts
        rotation !== 'none',
        overrides?.seed,
```

Also update the JSDoc example block above the hook: the `__newComposableGame({ rotation: 'free' })` example still works; no change needed there. In the "Defaults:" sentence, "no rotation" is still accurate.

- [ ] **Step 4: Update the new-game-dialog wiring**

In the `onNewGame` handler:
- Delete the line `const savedFreeRotationEnabled = loadFreeRotationEnabledPreference();`
- Delete the option line `savedFreeRotationEnabled: savedFreeRotationEnabled,`
- In the `onSelect` destructuring, remove `freeRotation` (keep `rotationEnabled`):

```ts
            onSelect: ({ sizeId, cutStyleId, composableConfig, fractalConfig, wavyConfig, rotationEnabled, imageSource, imageCategory, vibrant }) => {
```

- Delete the line `saveFreeRotationEnabledPreference(freeRotation);`
- In the `startNewGame(...)` call, remove the `freeRotation,` argument (it follows `rotationEnabled,`).

- [ ] **Step 5: Update the first-load path**

Near the bottom of the file (no-saved-game fallback):
- Delete the line `const preferredFreeRotationEnabled = loadFreeRotationEnabledPreference();`
- In the `await startNewGame(...)` call, remove the `preferredFreeRotationEnabled,` argument (it follows `preferredRotationEnabled,` as the last argument).

- [ ] **Step 6: Verify compile and full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests PASS (nothing outside `main.ts` changed behavior; the dialog still emits `freeRotation`, which is now ignored).

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat(app): derive new-game rotation mode from cut style

Wavy and Composable no longer offer a 90° mode: enabling rotation
means free rotation, matching Triangles. Classic and Fractal keep
quarter-turn. Existing saves and share links carry their rotationMode
explicitly and are unaffected."
```

---

### Task 3: Remove the "Free rotation" sub-checkbox from the dialog

TDD by expectation-flip: update the tests to describe the new dialog first, watch them fail, then remove the UI code.

**Files:**
- Modify: `src/ui/new-game-dialog.ts` (interface at lines ~41–105; checkbox construction at lines ~654–682; `onPick` payload at lines ~689–708; `onSelect` cut-style handler at line ~720; `dialog.appendChild(freeRotationRow)` at line ~742)
- Modify: `src/style.css` (delete the `.free-rotation-row` rule at lines ~752–754)
- Test: `src/ui/new-game-dialog.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `NewGameSelection` without `freeRotation`; `NewGameDialogOptions` without `savedFreeRotationEnabled`. (`main.ts` already stopped using both in Task 2.)

- [ ] **Step 1: Update the tests to the new expectations**

In `src/ui/new-game-dialog.test.ts`:

1. Delete the entire `describe('free rotation sub-checkbox', ...)` block (starts near line 381 — the one containing tests from `'is hidden when "Enable rotation" is unchecked'` through `'defaults the sub-checkbox to unchecked when savedFreeRotationEnabled is not provided'`).
2. Delete the entire `describe('createNewGameDialog — free rotation sub-checkbox', ...)` block (starts near line 659 — the one with the `getFreeRotationRow()` helper and the wavy/composable/classic/fractal/triangles visibility tests).
3. In the two exact-object `expect(onSelect).toHaveBeenCalledWith({...})` assertions that include `freeRotation: false` (near lines 83–93 and 266–276 and 299–309 — three call sites total), delete the `freeRotation: false,` line from each object literal.
4. Add this test inside the top-level `describe('createNewGameDialog', ...)` block (next to `'exposes the top-level "Enable rotation" checkbox by default'`):

```ts
    it('renders no free-rotation sub-checkbox for any cut style', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'wavy',
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });

        expect(container.querySelector('.free-rotation-row')).toBeNull();
        const labels = Array.from(
            container.querySelectorAll<HTMLLabelElement>('label'),
        ).map((l) => l.textContent ?? '');
        expect(labels.some((t) => t.includes('Free rotation'))).toBe(false);
    });
```

(`appendCheckboxRow` renders each label as a real `<label class="dialog-row-label">` element, so the label query is reliable.)

- [ ] **Step 2: Run the dialog tests to verify the new test fails**

Run: `npx vitest run src/ui/new-game-dialog.test.ts`
Expected: FAIL — the new `renders no free-rotation sub-checkbox` test fails (the row still exists); all remaining pre-existing tests pass.

- [ ] **Step 3: Remove the sub-checkbox from the dialog source**

In `src/ui/new-game-dialog.ts`:

1. In `NewGameSelection`, delete the `freeRotation: boolean;` field and its whole doc comment (the block explaining "True iff cut style is wavy or composable ...").
2. In `NewGameDialogOptions`, delete `savedFreeRotationEnabled?: boolean;` and its doc comment line.
3. Delete the sub-checkbox construction block (the comment starting `// Free rotation sub-checkbox — visible only when ...` and everything through `updateFreeRotationVisibility();` including the `rotationCheckbox.addEventListener('change', updateFreeRotationVisibility);` line and the `updateFreeRotationVisibility` function itself):

```ts
    // Free rotation sub-checkbox — visible only when rotation is enabled AND
    // the cut style supports free rotation (wavy or composable). State
    // persists across visibility toggles.
    const freeRotationRow = document.createElement('div');
    freeRotationRow.className = 'free-rotation-row';
    const freeRotationCheckbox = appendCheckboxRow(
        freeRotationRow,
        'Free rotation',
        options.savedFreeRotationEnabled ?? false,
    );

    function updateFreeRotationVisibility(): void {
        const visible =
            rotationCheckbox.checked &&
            (currentCutStyleId === 'wavy' || currentCutStyleId === 'composable');
        freeRotationRow.style.display = visible ? 'block' : 'none';
    }

    rotationCheckbox.addEventListener('change', updateFreeRotationVisibility);
    updateFreeRotationVisibility();
```

4. In the `onPick` payload, delete the `freeRotation:` entry:

```ts
                freeRotation:
                    rotationCheckbox.checked &&
                    (currentCutStyleId === 'wavy' || currentCutStyleId === 'composable') &&
                    freeRotationCheckbox.checked,
```

5. In the cut-style picker's `onSelect` handler, delete the `updateFreeRotationVisibility();` call.
6. Delete `dialog.appendChild(freeRotationRow);`.

In `src/style.css`, delete the rule:

```css
.free-rotation-row {
  padding-left: 1.5em;
}
```

- [ ] **Step 4: Run tests and compile to verify**

Run: `npx tsc --noEmit && npx vitest run src/ui/new-game-dialog.test.ts`
Expected: tsc clean; all dialog tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/new-game-dialog.ts src/ui/new-game-dialog.test.ts src/style.css
git commit -m "feat(ui): remove the free-rotation sub-checkbox from the new-game dialog"
```

---

### Task 4: Delete the free-rotation preference module

**Files:**
- Delete: `src/ui/free-rotation-preference.ts`
- Delete: `src/ui/free-rotation-preference.test.ts`
- Modify: `src/ui/index.ts` (remove the re-export block at lines ~184–188)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing — `main.ts` (Task 2) was the only consumer of the re-exports. The `puzzle-free-rotation-enabled` localStorage key simply stops being read; orphaned keys are harmless, no migration.

- [ ] **Step 1: Remove the re-export**

In `src/ui/index.ts`, delete:

```ts
export {
    FREE_ROTATION_ENABLED_PREFERENCE_KEY,
    loadFreeRotationEnabledPreference,
    saveFreeRotationEnabledPreference,
} from './free-rotation-preference.js';
```

- [ ] **Step 2: Delete the module and its test**

```bash
git rm src/ui/free-rotation-preference.ts src/ui/free-rotation-preference.test.ts
```

- [ ] **Step 3: Verify no dangling references, compile, full suite**

Run: `grep -rn "free-rotation-preference\|FreeRotationEnabled\|FREE_ROTATION" src/ && echo "DANGLING REFS" || echo "clean"`
Expected: `clean`

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/ui/index.ts
git commit -m "refactor(ui): delete the unused free-rotation preference module"
```

---

### Task 5: Update the in-app help text

Repo convention (CLAUDE.md): help text must stay correct in the same PR. Two spots describe free rotation as a Wavy *option*; both need to describe it as what rotation *means* for Wavy.

**Files:**
- Modify: `src/ui/info-modal.ts` (How to Play rotate entry at lines ~155–165; Wavy cut-style bullet at lines ~200–217)
- Test: `src/ui/info-modal.test.ts`

**Interfaces:** none.

- [ ] **Step 1: Update the tests to the new expectations**

In `src/ui/info-modal.test.ts`:

1. Replace the test `'mentions Free rotation in both the How to Play and Cut Styles sections'` (near line 179) with:

```ts
    it('describes rotation in both the How to Play and Cut Styles sections', () => {
        createInfoModal({ container });

        const sections = container.querySelectorAll<HTMLElement>('section.info-section');
        const howToPlay = Array.from(sections).find(
            (s) => s.querySelector('h3')?.textContent === 'How to Play',
        );
        const cutStyles = Array.from(sections).find(
            (s) => s.querySelector('h3')?.textContent === 'Cut Styles',
        );

        expect(howToPlay?.textContent).toContain('Free rotation');
        expect(cutStyles?.textContent).toContain('rotate freely');
    });
```

2. Replace the test `'mentions Free rotation in the Wavy bullet'` (near line 228) with:

```ts
    it('says Wavy rotates freely, with no option sub-bullet', () => {
        createInfoModal({ container });
        const lis = cutStylesSection().querySelectorAll<HTMLLIElement>('ul > li');
        const wavyLi = [...lis].find((li) => li.textContent?.includes('Wavy'));
        expect(wavyLi).toBeDefined();
        expect(wavyLi!.textContent).toContain('rotate freely');
        expect(wavyLi!.textContent).not.toContain('Free rotation');
    });
```

3. Keep `'mentions Wavy alongside Free rotation'` (near line 293) unchanged — the How to Play entry still pairs "Free rotation" with "(Wavy and Triangles puzzles)".
4. Add one test next to it asserting the 90° mode is attributed to its cut styles:

```ts
    it('attributes 90° rotation to Classic and Fractal', () => {
        createInfoModal({ container });
        const text = howToPlaySection().textContent ?? '';
        const ninetyIdx = text.indexOf('90° rotation');
        expect(ninetyIdx).toBeGreaterThan(-1);
        const context = text.slice(ninetyIdx, ninetyIdx + 60);
        expect(context).toContain('Classic');
        expect(context).toContain('Fractal');
    });
```

- [ ] **Step 2: Run the info-modal tests to verify the new/changed ones fail**

Run: `npx vitest run src/ui/info-modal.test.ts`
Expected: FAIL — `'says Wavy rotates freely...'`, `'attributes 90° rotation...'`, and the reworked Cut Styles assertion fail against the old copy.

- [ ] **Step 3: Update the help copy**

In `src/ui/info-modal.ts`:

1. How to Play rotate entry — attribute 90° rotation to its cut styles. Change:

```ts
        ' (when rotation is enabled) — Tap any piece to bring up rotation controls next to it. With ',
        ['strong', '90° rotation'],
        ', the ↺ / ↻ buttons rotate the focused piece (and anything merged with it) by a quarter-turn. With ',
```

to:

```ts
        ' (when rotation is enabled) — Tap any piece to bring up rotation controls next to it. With ',
        ['strong', '90° rotation'],
        ' (Classic and Fractal puzzles), the ↺ / ↻ buttons rotate the focused piece (and anything merged with it) by a quarter-turn. With ',
```

(The following "Free rotation" sentence already says "(Wavy and Triangles puzzles)" — leave it.)

2. Wavy cut-style bullet — free rotation is no longer an option. Change the main line:

```ts
        ['strong', 'Wavy'],
        ' — Smooth sinewave edges with hand-traced tab shapes — a more organic, dramatic take on Classic. Options:',
```

to:

```ts
        ['strong', 'Wavy'],
        ' — Smooth sinewave edges with hand-traced tab shapes — a more organic, dramatic take on Classic. Enabling rotation lets pieces rotate freely to any angle. Options:',
```

and delete the "Free rotation" sub-bullet:

```ts
    appendInlineLi(wavySub, [
        ['strong', 'Free rotation'],
        ' (when rotation is also enabled) — Pieces rotate continuously to any angle instead of snapping to the four 90° orientations. See ',
        ['em', 'How to Play'],
        ' for the rotation controls.',
    ]);
```

(The Borderless sub-bullet stays, so the "Options:" lead-in and the sub-list remain.)

- [ ] **Step 4: Run tests, compile, and the full suite**

Run: `npx tsc --noEmit && npx vitest run src/ui/info-modal.test.ts && npm test`
Expected: everything PASSES. This is the final task, so the full suite doubles as the whole-branch verification.

- [ ] **Step 5: Commit**

```bash
git add src/ui/info-modal.ts src/ui/info-modal.test.ts
git commit -m "docs(ui): attribute 90° vs free rotation to their cut styles in help"
```
