# Persist zoom & pan state across page reloads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the player's last zoom level and pan offset when they reopen an in-progress puzzle from localStorage.

**Architecture:** The viewport (`scale` + pan `offset`) is stored inside the existing `puzzle-progress` blob, riding on its seed-pairing, torn-write, cross-tab, and clear-on-new-game machinery. The persistence layer gains a `viewport?` field and a `readViewport` reader (mirroring the existing `selection` / `readSelection` pattern). `main.ts` captures the current viewport on every save and applies the saved viewport on the saved-game restore path.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom env). ESM imports use `.js` extensions on relative paths.

## Global Constraints

- **No `STATE_VERSION` bump.** The `viewport` field is additive and optional, exactly like the existing `selection` field. Bumping the version would make older builds reject the whole save during a deploy. Leave `STATE_VERSION = 11`.
- **Isolate-randomness / PRNG contract:** not relevant — this feature consumes no `random()` calls and does not touch puzzle generation.
- **American English** for all identifiers and comments (`color`, `behavior`, `center`).
- **Relative imports keep the `.js` extension** (e.g. `from './serialization.js'`).
- **Help text:** no info-modal change required (no new button/gesture/setting). Verify the modal makes no claim about load-time view that this contradicts (Task 4).
- **Spec:** `docs/superpowers/specs/2026-06-19-persist-viewport-design.md`.

---

### Task 1: Serialization — `SerializedViewport`, `viewport` field, `readViewport`

**Files:**
- Modify: `src/persistence/serialization.ts`
- Test: `src/persistence/serialization.test.ts`

**Interfaces:**
- Consumes: nothing new (uses existing `Point` from `../model/types.js`, already imported).
- Produces:
  - `interface SerializedViewport { scale: number; offset: Point }`
  - `SerializedProgress.viewport?: SerializedViewport`
  - `serializeProgress(state: GameState, selection?: Iterable<number>, viewport?: SerializedViewport): SerializedProgress`
  - `readViewport(data: SerializedProgress): SerializedViewport | undefined`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the end of `src/persistence/serialization.test.ts`. Also add `serializeProgress` and `readViewport` to the existing import from `./serialization.js` (the `serializeProgress` import already exists; add `readViewport`):

```ts
describe('viewport persistence', () => {
    const VP = { scale: 1.5, offset: { x: 30, y: -40 } };

    it('serializeProgress includes the viewport when passed', () => {
        const p = serializeProgress(makeGameState(), [], VP);
        expect(p.viewport).toEqual(VP);
    });

    it('serializeProgress omits the viewport when not passed', () => {
        const p = serializeProgress(makeGameState(), []);
        expect('viewport' in p).toBe(false);
    });

    it('round-trips the viewport through serializeProgress + JSON + readViewport', () => {
        const onDisk = JSON.stringify(serializeProgress(makeGameState(), [], VP));
        const parsed = JSON.parse(onDisk) as ReturnType<typeof serializeProgress>;
        expect(readViewport(parsed)).toEqual(VP);
    });

    it('readViewport returns undefined when the field is absent', () => {
        expect(readViewport(serializeProgress(makeGameState(), []))).toBeUndefined();
    });

    it('readViewport returns undefined for a non-finite scale (NaN survived as null)', () => {
        const onDisk = JSON.stringify(
            serializeProgress(makeGameState(), [], { scale: NaN, offset: { x: 0, y: 0 } }),
        );
        const parsed = JSON.parse(onDisk) as ReturnType<typeof serializeProgress>;
        // Sanity: NaN serialized to null inside the offset-less scale field.
        expect(readViewport(parsed)).toBeUndefined();
    });

    it('readViewport returns undefined for a malformed offset', () => {
        const data = {
            ...serializeProgress(makeGameState(), []),
            viewport: { scale: 1, offset: { x: 'nope', y: 0 } },
        } as unknown as ReturnType<typeof serializeProgress>;
        expect(readViewport(data)).toBeUndefined();
    });

    it('readViewport returns undefined for a non-object viewport from hand-edited storage', () => {
        const data = {
            ...serializeProgress(makeGameState(), []),
            viewport: 'garbage',
        } as unknown as ReturnType<typeof serializeProgress>;
        expect(readViewport(data)).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/persistence/serialization.test.ts -t "viewport persistence"`
Expected: FAIL — `readViewport` is not exported / not a function, and `serializeProgress` ignores the third argument.

- [ ] **Step 3: Implement in `src/persistence/serialization.ts`**

3a. Add the type next to the other serialized interfaces (after `SerializedProgress`, around line 138):

```ts
/** JSON-safe viewport (zoom + pan) snapshot. */
export interface SerializedViewport {
    scale: number;
    offset: Point;
}
```

3b. Add the optional field to `SerializedProgress` (inside the interface, after `completed: boolean;`):

```ts
    /**
     * The player's last viewport (zoom + pan). Like {@link SerializedGameState.selection},
     * this is deliberately additive and optional — it is NOT gated behind a
     * STATE_VERSION bump. The state it represents lives outside GameState (in
     * ViewportTransform). Older builds ignore the unknown key; newer builds
     * restore it when present. Omitted when the caller passes no viewport.
     */
    viewport?: SerializedViewport;
```

3c. Extend `serializeProgress` to accept and write the viewport. Replace the existing function (lines ~229-244) with:

```ts
/** Serialize only the mutable progress (groups, selection, completed, viewport). */
export function serializeProgress(
    state: GameState,
    selection?: Iterable<number>,
    viewport?: SerializedViewport,
): SerializedProgress {
    const p: SerializedProgress = {
        version: STATE_VERSION,
        groups: state.groups.map(serializeGroup),
        completed: state.completed,
    };
    if (state.seed !== undefined) p.seed = state.seed;
    if (selection !== undefined) {
        const ids = [...selection];
        if (ids.length > 0) p.selection = ids;
    }
    if (viewport !== undefined) p.viewport = viewport;
    return p;
}
```

3d. Add the reader next to `readSelection` (after that function, around line 554):

```ts
/**
 * Extract a sanitized viewport from a serialized progress blob.
 *
 * Tolerates missing/garbage data (older saves, hand-edited storage): a missing
 * field, a non-object viewport, a non-finite `scale`, or an `offset` without
 * finite `x`/`y` all yield `undefined`. Never throws.
 */
export function readViewport(data: SerializedProgress): SerializedViewport | undefined {
    const vp = data.viewport as unknown;
    if (typeof vp !== 'object' || vp === null) {
        return undefined;
    }
    const { scale, offset } = vp as { scale?: unknown; offset?: unknown };
    if (typeof scale !== 'number' || !Number.isFinite(scale)) {
        return undefined;
    }
    if (typeof offset !== 'object' || offset === null) {
        return undefined;
    }
    const { x, y } = offset as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
        return undefined;
    }
    return { scale, offset: { x, y } };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/persistence/serialization.test.ts`
Expected: PASS (the new block plus all existing serialization tests).

- [ ] **Step 5: Commit**

```bash
git add src/persistence/serialization.ts src/persistence/serialization.test.ts
git commit -m "feat: serialize viewport in the progress blob"
```

---

### Task 2: Storage — thread viewport through save/load

**Files:**
- Modify: `src/persistence/storage.ts`
- Test: `src/persistence/storage.test.ts`

**Interfaces:**
- Consumes (from Task 1): `SerializedViewport`, `serializeProgress(state, selection?, viewport?)`, `readViewport(progress)`.
- Produces:
  - `saveProgress(state, selection?, viewport?: SerializedViewport): SaveResult`
  - `saveNewPuzzle(state, selection?, viewport?: SerializedViewport): SaveResult`
  - `createDebouncedSave().save(state, selection?, viewport?: SerializedViewport): void`
  - `LoadOutcome` `'ok'` variant gains `viewport?: SerializedViewport`.

- [ ] **Step 1: Write the failing tests**

In `src/persistence/storage.test.ts`, add `SerializedViewport` to the type import from `./serialization.js` is **not** needed (use inline literals). Add a `loadedViewport()` helper near `loadedSelection()` (after line 48):

```ts
/** The persisted viewport, or undefined when none is saved. */
function loadedViewport() {
    const outcome = loadSavedGame();
    return outcome.status === 'ok' ? outcome.viewport : undefined;
}
```

Then add a new `describe` block at the end of the file:

```ts
describe('viewport persistence through storage', () => {
    beforeEach(() => localStorage.clear());

    const VP = { scale: 2, offset: { x: 10, y: 20 } };

    it('saveNewPuzzle round-trips a viewport through loadSavedGame', () => {
        saveNewPuzzle(makeGameState({ seed: 5 }), [], VP);
        expect(loadedViewport()).toEqual(VP);
    });

    it('returns undefined when no viewport was saved', () => {
        saveNewPuzzle(makeGameState({ seed: 5 }), []);
        expect(loadedViewport()).toBeUndefined();
    });

    it('saveProgress persists the viewport on top of existing geometry', () => {
        const state = makeGameState({ seed: 5 });
        saveNewPuzzle(state, []);
        saveProgress(state, [], VP);
        expect(loadedViewport()).toEqual(VP);
    });

    it('createDebouncedSave forwards the viewport captured at save time', () => {
        vi.useFakeTimers();
        try {
            const state = makeGameState({ seed: 5 });
            saveGeometry(state);
            const { save } = createDebouncedSave();
            save(state, [], VP);
            vi.advanceTimersByTime(500);
            expect(loadedViewport()).toEqual(VP);
        } finally {
            vi.useRealTimers();
        }
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/persistence/storage.test.ts -t "viewport persistence through storage"`
Expected: FAIL — `outcome.viewport` is not a property; `saveProgress` / `saveNewPuzzle` / `save` ignore the third argument.

- [ ] **Step 3: Implement in `src/persistence/storage.ts`**

3a. Import the type. Extend the existing serialization import (lines 14-23) to add `readViewport` and the `SerializedViewport` type:

```ts
import {
    serializeStatic,
    serializeProgress,
    deserializeState,
    recombine,
    readSelection,
    readViewport,
    type SerializedStaticState,
    type SerializedProgress,
    type SerializedGameState,
    type SerializedViewport,
} from './serialization.js';
```

3b. Add `viewport` to the `LoadOutcome` `'ok'` variant (lines ~78-81):

```ts
export type LoadOutcome =
    | { status: 'ok'; state: GameState; selection: number[]; viewport?: SerializedViewport }
    | { status: 'empty' }
    | { status: 'unreadable'; reason: UnreadableReason; raw: CorruptSaveData };
```

3c. Extend `saveProgress` (lines ~159-173) to accept and forward the viewport. Change the signature and the final `writeWithOverflow` call:

```ts
export function saveProgress(
    state: GameState,
    selection?: Iterable<number>,
    viewport?: SerializedViewport,
): SaveResult {
    const geometrySeed = currentGeometrySeed();
    if (
        geometrySeed !== undefined &&
        state.seed !== undefined &&
        geometrySeed !== state.seed
    ) {
        diagnostics.warn(
            'Skipping progress save: stored geometry belongs to a different puzzle ' +
                '(cross-tab takeover); not overwriting it.',
        );
        return 'skipped';
    }
    return writeWithOverflow(
        PROGRESS_KEY,
        JSON.stringify(serializeProgress(state, selection, viewport)),
    );
}
```

3d. Extend `saveNewPuzzle` (lines ~179-195) to forward the viewport to `saveProgress`:

```ts
export function saveNewPuzzle(
    state: GameState,
    selection?: Iterable<number>,
    viewport?: SerializedViewport,
): SaveResult {
    const g = saveGeometry(state);
    if (g === 'failed') {
        return 'failed';
    }
    const p = saveProgress(state, selection, viewport);
    if (p === 'failed') return 'failed';
    if (g === 'ok-compressed' || p === 'ok-compressed') return 'ok-compressed';
    return 'ok';
}
```

(Keep the existing explanatory comment block inside `saveNewPuzzle` after the `if (g === 'failed')` line — only the signature and the `saveProgress` call change.)

3e. In `loadSavedGame`, populate `viewport` on the recombined `ok` return (the branch around lines 254-258):

```ts
            return {
                status: 'ok',
                state: recombine(staticData, progress),
                selection: readSelection(progress),
                viewport: readViewport(progress),
            };
```

(Leave the legacy single-key `deserializeState` branch as-is — it returns no `viewport`, which is correct: old saves carry none.)

3f. In `createDebouncedSave`, thread the viewport through the closure. Replace the `pendingSelection` declaration, `flushPending`, and `save` (lines ~330-357) with:

```ts
    // Snapshot of the selection captured with the pending state. `null` means
    // "no pending save"; an empty array means "save with an empty selection".
    let pendingSelection: number[] | null = null;
    // Snapshot of the viewport captured with the pending state. `undefined`
    // means "no viewport supplied with this save".
    let pendingViewport: SerializedViewport | undefined;

    function flushPending(): void {
        if (pendingState !== null) {
            const result = saveProgress(pendingState, pendingSelection ?? [], pendingViewport);
            pendingState = null;
            pendingSelection = null;
            pendingViewport = undefined;
            if (result === 'failed') {
                onSaveFailed?.();
            } else if (result === 'skipped') {
                onSaveSkipped?.();
            }
        }
    }

    function save(
        state: GameState,
        selection?: Iterable<number>,
        viewport?: SerializedViewport,
    ): void {
        pendingState = state;
        pendingSelection = selection === undefined ? [] : [...selection];
        pendingViewport = viewport;

        if (timer !== null) {
            clearTimeout(timer);
        }

        timer = setTimeout(() => {
            flushPending();
            timer = null;
        }, SAVE_DEBOUNCE_MS);
    }
```

3g. Update the `save` type in the returned object's signature (lines ~321-325) and `cancel` to clear the new snapshot. In the return-type annotation change:

```ts
    save: (state: GameState, selection?: Iterable<number>, viewport?: SerializedViewport) => void;
```

and in `cancel` add `pendingViewport = undefined;` next to `pendingSelection = null;`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/persistence/storage.test.ts`
Expected: PASS (the new block plus all existing storage tests).

- [ ] **Step 5: Commit**

```bash
git add src/persistence/storage.ts src/persistence/storage.test.ts
git commit -m "feat: thread viewport through save/load in the storage layer"
```

---

### Task 3: Wire viewport capture & restore into `main.ts`

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes (from Task 2): `saveNewPuzzle(state, selection?, viewport?)`, `loadSavedGame()` returning `viewport?` on `ok`, and `createDebouncedSave().save(state, selection?, viewport?)`.
- Consumes (existing): `viewportTransform.getState(): Readonly<ViewportState>`, `viewportTransform.setState(state)`, `applyViewportTransform()`, `restorePersistedSelection(ids)`.
- Produces: no exported interface; this is the app entry wiring. Verified by build + manual reload.

> `ViewportState` (`{ scale, offset }`) is structurally identical to `SerializedViewport`, so `viewportTransform.getState()` is assignable where a `SerializedViewport` is expected, and a loaded `SerializedViewport` is assignable to `setState`. No conversion needed.

- [ ] **Step 1: Capture the viewport in `autoSave()`**

In `src/main.ts`, replace the `autoSave` body (lines ~705-707):

```ts
function autoSave(): void {
    debouncedSave.save(gameState, selectionManager.selectedGroupIds, viewportTransform.getState());
}
```

- [ ] **Step 2: Capture the viewport in `persistNewPuzzle()`**

Replace the `saveNewPuzzle` call inside `persistNewPuzzle` (line ~641):

```ts
    const result = saveNewPuzzle(
        gameState,
        selectionManager.selectedGroupIds,
        viewportTransform.getState(),
    );
```

- [ ] **Step 3: Persist on pure pan/zoom via `onViewportChanged`**

`onViewportChanged` is currently `applyViewportTransform` (line ~838). It must now also trigger a debounced save so panning/zooming with no piece movement still persists. Add a small named function near `applyViewportTransform` (after its definition, ~line 617):

```ts
/**
 * React to a viewport (zoom/pan) change: re-apply the transform to the
 * renderer and persist the new view via the debounced auto-save, so the
 * player's zoom level and pan offset survive a reload (#420).
 */
function onViewportChanged(): void {
    applyViewportTransform();
    autoSave();
}
```

Then change the interaction wiring (line ~838) from `onViewportChanged: applyViewportTransform,` to:

```ts
        onViewportChanged,
```

> Note: `onViewportChanged` references `autoSave` and `debouncedSave`, which are declared earlier in the module (lines ~652, ~705) than line 617. These are function/`const` declarations at module scope; `onViewportChanged` is only *called* later (during interaction), by which point all are initialized. This matches how `applyViewportTransform` already forward-references `renderer`.

- [ ] **Step 4: Apply the saved viewport on the saved-game restore path**

In the startup IIFE, the `saved.status === 'ok'` branch (lines ~1418-1422). Replace it with:

```ts
        if (saved.status === 'ok') {
            initGame(saved.state);
            restorePersistedSelection(saved.selection);
            if (saved.viewport) {
                // Restore the zoom/pan the player last had (#420). Absent on
                // pre-feature saves — those keep the default view, as before.
                viewportTransform.setState(saved.viewport);
                applyViewportTransform();
            }
            return;
        }
```

- [ ] **Step 5: Type-check and build**

Run: `npm run build`
Expected: PASS — no TypeScript errors. (If the project exposes a faster check such as `npx tsc --noEmit`, that is sufficient for this step; the build is the authoritative gate.)

- [ ] **Step 6: Run the full unit-test suite**

Run: `npx vitest run`
Expected: PASS — no regressions from the `main.ts` wiring.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat: persist and restore zoom/pan across reloads

Closes #420"
```

---

### Task 4: Verify behavior in the running app & confirm help text

**Files:**
- Read-only check: `src/ui/info-modal.ts`

**Interfaces:** none — this is a verification task, no code unless a defect is found.

- [ ] **Step 1: Confirm the info modal needs no change**

Run: `grep -niE "zoom|pan|fit|view" src/ui/info-modal.ts`
Expected: review the hits. The feature adds no button/gesture/setting, so no copy *must* change. Confirm no existing sentence claims the app "always opens fitted/centered" in a way this now contradicts. If such a sentence exists, update it in this task and note it in the PR; otherwise no change.

- [ ] **Step 2: Manual reload check in the running app**

Start the dev server (`npm run dev`) and open the app. Then:
1. Pan and zoom to a distinctive view (e.g. zoom in on one corner).
2. Reload the page.
3. Confirm the app reopens at the *same* zoom and pan, not the default/fitted view.
4. Start a New Game → confirm it still gathers & zooms to fit (unchanged).
5. Click Center View → reload → confirm the centered view is restored.

Optionally automate steps 1-3 with the Playwright MCP (navigate, drag/wheel to change the view, read `localStorage['puzzle-progress']` to confirm a `viewport` field is written, reload, assert the rendered transform matches).

Expected: saved-game reloads restore the last view; new games are unaffected.

- [ ] **Step 3: No commit unless Step 1 found a defect**

If Step 1 required an info-modal edit, commit it:

```bash
git add src/ui/info-modal.ts
git commit -m "docs: clarify load-time view in info modal"
```

Otherwise this task produces no commit.

---

## Self-Review

**Spec coverage:**
- Storage location (progress blob) → Tasks 1-2. ✓
- `SerializedViewport` + optional `viewport` field, no version bump → Task 1, Global Constraints. ✓
- `serializeProgress(…, viewport?)` + `readViewport` → Task 1. ✓
- Thread through `saveProgress` / `saveNewPuzzle` / `createDebouncedSave`, `LoadOutcome.viewport` → Task 2. ✓
- `autoSave` / `persistNewPuzzle` capture viewport → Task 3 Steps 1-2. ✓
- `onViewportChanged` also saves → Task 3 Step 3. ✓
- Restore path applies `setState` + `applyViewportTransform`, absent → no-op → Task 3 Step 4. ✓
- Share link / new game / Gather / Center View untouched → not modified (verified by Task 4 Step 2 items 4-5). ✓
- Snapshot correctness (immutable `getState()`, debounce, pagehide flush) → covered by Task 2 debounce test + existing flush handlers (unchanged). ✓
- Testing matrix (serializeProgress round-trip, readViewport garbage tolerance, loadSavedGame viewport, debounced forward) → Tasks 1-2. ✓
- Help text confirmation → Task 4 Step 1. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `SerializedViewport { scale, offset }` defined in Task 1, imported and used by the same name in Task 2; `serializeProgress`/`saveProgress`/`saveNewPuzzle`/`save` all use the `(…, viewport?: SerializedViewport)` shape consistently; `LoadOutcome.viewport` matches `readViewport`'s return type; `main.ts` relies on `ViewportState`≈`SerializedViewport` structural compatibility (noted in Task 3). ✓
