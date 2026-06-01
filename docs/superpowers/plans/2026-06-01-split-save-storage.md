# Split save storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the per-move UI freeze on large puzzles by persisting the static geometry once and writing only the small mutable progress (`groups`/`selection`/`completed`) on each debounced save.

**Architecture:** Two localStorage keys — `puzzle-game-state` (STATIC: geometry + immutable metadata, compressed, written once per puzzle) and `puzzle-progress` (PROGRESS: small, written per move, synchronous). The debounced saver writes only PROGRESS. `loadSavedGame` recombines the two, falls back to the legacy single-key format, and discards torn pairs.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom), `lz-string` (already a dep). `tsconfig` uses `verbatimModuleSyntax: true` + `moduleResolution: bundler`.

**Reference spec:** `docs/superpowers/specs/2026-06-01-split-save-storage-design.md`

**Branch:** `fix/397-large-save-quota` (extends PR #399; do NOT branch/switch).

---

## File structure

- **Modify** `src/persistence/serialization.ts` — bump `STATE_VERSION` to 11; add `SerializedStaticState`, `SerializedProgress`, `serializeStatic`, `serializeProgress`, `recombine`; extract a shared `validateGroups`; broaden the `resolve*` helper signatures. Keep `serializeState`/`deserializeState` (legacy v≤10 path).
- **Modify** `src/persistence/serialization.test.ts` — tests for the new functions.
- **Modify** `src/persistence/storage.ts` — `PROGRESS_KEY`; `saveGeometry`, `saveProgress`, `saveNewPuzzle`; rewrite `loadSavedGame`; `clearSavedState` clears both keys; debounced flush calls `saveProgress`; remove `saveState`.
- **Modify** `src/persistence/storage.test.ts` — update for the new API; add split/migration/torn tests.
- **Modify** `src/persistence/index.ts` — export the new functions/types/`PROGRESS_KEY`; drop `saveState`.
- **Modify** `src/main.ts` — new-game & share-link load call `saveNewPuzzle`; update the `persistence` import.

---

## Task 1: Serialization — static/progress split

**Files:**
- Modify: `src/persistence/serialization.ts`
- Test: `src/persistence/serialization.test.ts`

Context: the existing `serializeState`/`deserializeState` handle the full single-key blob and stay for the legacy path. The helpers `resolveComposableConfig`, `resolveFractalConfig`, `resolveRotationMode`, `deriveImageSize`, `serializeGroup`, `deserializeGroup`, `validateSerializedState`, `buildGroupIndexes`, `buildPiecesById`, `DEFAULT_COLS/ROWS` already exist. Reuse them.

- [ ] **Step 1: Write the failing tests**

Add to `src/persistence/serialization.test.ts` (import the new symbols `serializeStatic, serializeProgress, recombine` from `./serialization.js` alongside existing imports; reuse the file's existing `makeGameState`/piece fixtures — mirror how the current tests build a `GameState`):

```ts
describe('static/progress split (v11)', () => {
    it('serializeStatic omits groups/selection/completed and tags v11', () => {
        const state = makeGameState();
        const s = serializeStatic(state);
        expect(s.version).toBe(11);
        expect('groups' in s).toBe(false);
        expect('completed' in s).toBe(false);
        expect(s.pieces).toEqual(state.pieces);
        expect(s.imageUrl).toBe(state.imageUrl);
    });

    it('serializeProgress carries groups, completed, selection and seed', () => {
        const state = makeGameState({ completed: true, seed: 42 });
        const p = serializeProgress(state, [1, 0]);
        expect(p.version).toBe(11);
        expect(p.completed).toBe(true);
        expect(p.seed).toBe(42);
        expect(p.selection).toEqual([1, 0]);
        expect(p.groups.length).toBe(state.groups.length);
    });

    it('serializeProgress omits an empty selection', () => {
        const p = serializeProgress(makeGameState(), []);
        expect('selection' in p).toBe(false);
    });

    it('recombine rebuilds an equal GameState from static + progress', () => {
        const state = makeGameState({ seed: 7, cutStyle: 'composable', completed: true });
        const restored = recombine(serializeStatic(state), serializeProgress(state, []));
        expect(restored.pieces).toEqual(state.pieces);
        expect(restored.groups.length).toBe(state.groups.length);
        expect(restored.groups[0].pieces).toBeInstanceOf(Map);
        expect(restored.completed).toBe(true);
        expect(restored.seed).toBe(7);
        expect(restored.cutStyle).toBe('composable');
        expect(restored.piecesById.size).toBe(state.pieces.length);
    });

    it('recombine throws on empty pieces', () => {
        const state = makeGameState();
        const bad = { ...serializeStatic(state), pieces: [] };
        expect(() => recombine(bad as never, serializeProgress(state, []))).toThrow();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/persistence/serialization.test.ts`
Expected: FAIL — `serializeStatic`/`serializeProgress`/`recombine` not exported.

- [ ] **Step 3: Implement**

In `src/persistence/serialization.ts`:

(a) Change the version constant and supported list:
```ts
export const STATE_VERSION = 11;
```
and add `11` to `SUPPORTED_VERSIONS`:
```ts
const SUPPORTED_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
```
Add a short doc line: `// - v11: split storage — STATIC blob omits groups/selection/completed (those live in the separate progress blob); v≤10 full blobs still load via deserializeState.`

(b) Add the new interfaces after `SerializedGameState`:
```ts
/** Static portion: geometry + immutable metadata. No groups/selection/completed. */
export interface SerializedStaticState {
    version: number;
    pieces: GameState['pieces'];
    imageUrl: string;
    imageSize?: Size;
    gridSize?: GridSize;
    attribution?: ImageAttribution;
    seed?: number;
    cutStyle?: string;
    rotationMode?: 'none' | 'quarter-turn' | 'free';
    composableConfig?: GameState['composableConfig'];
    fractalConfig?: GameState['fractalConfig'];
    /** Present only on legacy v7 blobs read through the static path. */
    generatorConfig?: Record<string, unknown>;
}

/** Mutable portion: changes as the player plays. */
export interface SerializedProgress {
    version: number;
    /** Seed of the puzzle this progress belongs to, for pairing with the static blob. */
    seed?: number;
    groups: SerializedPieceGroup[];
    selection?: number[];
    completed: boolean;
}
```

(c) Broaden the three resolver signatures so they accept the static shape (a legacy `SerializedGameState` is structurally assignable). Change each parameter type from `SerializedGameState` to `SerializedStaticState`:
- `resolveComposableConfig(data: SerializedStaticState)`
- `resolveFractalConfig(data: SerializedStaticState)`
- `resolveRotationMode(data: SerializedStaticState, groups: PieceGroup[])`

(`resolveFractalConfig` reads `data.generatorConfig.borderless` — that field exists on `SerializedStaticState`.)

(d) Extract group validation from `validateSerializedState` into a reusable helper, and call it from both places. Add:
```ts
/** Validate the serialized groups array (shape + per-group invariants). */
function validateGroups(groups: SerializedPieceGroup[] | undefined): void {
    if (!Array.isArray(groups) || groups.length === 0) {
        throw new Error('Invalid state: groups must be a non-empty array');
    }
    for (const group of groups) {
        if (typeof group.id !== 'number') {
            throw new Error('Invalid state: group id must be a number');
        }
        if (!Array.isArray(group.pieces) || group.pieces.length === 0) {
            throw new Error(`Invalid state: group ${group.id} must have at least one piece`);
        }
        if (!Number.isFinite(group.position?.x) || !Number.isFinite(group.position?.y)) {
            throw new Error(`Invalid state: group ${group.id} must have a valid position`);
        }
    }
}
```
Then in `validateSerializedState`, replace the inline groups checks (the `if (!Array.isArray(data.groups) ...)` block and the `for (const group of data.groups)` loop) with `validateGroups(data.groups);`. Leave the pieces/imageUrl/completed checks as they are.

(e) Add the new serialize functions (place near `serializeState`):
```ts
/** Serialize only the static geometry + metadata (no groups/selection/completed). */
export function serializeStatic(state: GameState): SerializedStaticState {
    const s: SerializedStaticState = {
        version: STATE_VERSION,
        pieces: state.pieces,
        imageUrl: state.imageUrl,
        imageSize: state.imageSize,
        gridSize: state.gridSize,
    };
    if (state.attribution) s.attribution = state.attribution;
    if (state.seed !== undefined) s.seed = state.seed;
    if (state.cutStyle) s.cutStyle = state.cutStyle;
    if (state.rotationMode) s.rotationMode = state.rotationMode;
    if (state.composableConfig) s.composableConfig = state.composableConfig;
    if (state.fractalConfig) s.fractalConfig = state.fractalConfig;
    return s;
}

/** Serialize only the mutable progress (groups, selection, completed). */
export function serializeProgress(
    state: GameState,
    selection?: Iterable<number>,
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
    return p;
}
```

(f) Add `recombine` (place near `deserializeState`):
```ts
/**
 * Rebuild a full GameState from a static blob + a progress blob.
 *
 * The static blob may be a v11 static-only blob or a legacy v≤10 full blob
 * (its inline groups are ignored — groups come from `progress`).
 */
export function recombine(
    staticData: SerializedStaticState,
    progress: SerializedProgress,
): GameState {
    if (!SUPPORTED_VERSIONS.includes(staticData.version)) {
        throw new Error(
            `Unsupported state version: ${staticData.version} (expected one of ${SUPPORTED_VERSIONS.join(', ')})`,
        );
    }
    if (!Array.isArray(staticData.pieces) || staticData.pieces.length === 0) {
        throw new Error('Invalid state: pieces must be a non-empty array');
    }
    if (typeof staticData.imageUrl !== 'string' || staticData.imageUrl.length === 0) {
        throw new Error('Invalid state: imageUrl must be a non-empty string');
    }
    validateGroups(progress.groups);

    const groups = progress.groups.map(deserializeGroup);
    const { groupsById, pieceToGroup } = buildGroupIndexes(groups);
    const imageSize =
        staticData.imageSize ??
        getImageDimensions({
            pieces: staticData.pieces,
            groups: [],
            piecesById: buildPiecesById(staticData.pieces),
            groupsById: new Map(),
            pieceToGroup: new Map(),
            imageUrl: '',
            imageSize: { width: 0, height: 0 },
            gridSize: { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
            completed: false,
        });
    const gridSize = staticData.gridSize ?? { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };

    const state: GameState = {
        pieces: staticData.pieces,
        groups,
        piecesById: buildPiecesById(staticData.pieces),
        groupsById,
        pieceToGroup,
        imageUrl: staticData.imageUrl,
        imageSize,
        gridSize,
        completed: progress.completed,
    };
    if (staticData.attribution) state.attribution = staticData.attribution;
    if (staticData.seed !== undefined) state.seed = staticData.seed;
    if (staticData.cutStyle) state.cutStyle = staticData.cutStyle;
    state.rotationMode = resolveRotationMode(staticData, groups);
    const composableConfig = resolveComposableConfig(staticData);
    if (composableConfig) state.composableConfig = composableConfig;
    const fractalConfig = resolveFractalConfig(staticData);
    if (fractalConfig) state.fractalConfig = fractalConfig;
    return state;
}
```
Note: `recombine` does not apply the v≤8 quarter-turn→degrees rotation migration, because the progress blob is always written by the current (v11) build, so its rotations are already degrees. Legacy v≤10 saves still load through `deserializeState`, which keeps that migration.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/persistence/serialization.test.ts` and `npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/serialization.ts src/persistence/serialization.test.ts
git commit -m "feat(persistence): split serialization into static + progress (#397)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Storage — two-key save/load

**Files:**
- Modify: `src/persistence/storage.ts`
- Test: `src/persistence/storage.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/persistence/storage.test.ts`, update imports to the new API (replace `saveState` with `saveGeometry, saveProgress, saveNewPuzzle, PROGRESS_KEY`; keep `loadState, loadSavedGame, clearSavedState, createDebouncedSave, STORAGE_KEY`). Replace any existing test that calls `saveState(...)` directly with `saveNewPuzzle(...)`. Then add:

```ts
describe('split storage', () => {
    beforeEach(() => localStorage.clear());

    it('saveNewPuzzle writes both keys and round-trips through loadSavedGame', () => {
        const state = makeGameState({ seed: 5 });
        const result = saveNewPuzzle(state, [1, 0]);
        expect(result).not.toBe('failed');
        expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
        expect(localStorage.getItem(PROGRESS_KEY)).not.toBeNull();

        const loaded = loadSavedGame();
        expect(loaded!.state.pieces).toEqual(state.pieces);
        expect(loaded!.state.groups.length).toBe(state.groups.length);
        expect(loaded!.selection).toEqual([1, 0]);
    });

    it('saveProgress writes only the progress key, leaving the geometry untouched', () => {
        const state = makeGameState({ seed: 5 });
        saveNewPuzzle(state, []);
        const geometryBefore = localStorage.getItem(STORAGE_KEY);

        saveProgress(state, [2]);
        expect(localStorage.getItem(STORAGE_KEY)).toBe(geometryBefore); // unchanged
        expect(loadSavedGame()!.selection).toEqual([2]);
    });

    it('discards a torn pair: geometry present, progress missing (v11 static)', () => {
        saveGeometry(makeGameState({ seed: 5 })); // writes only the v11 static key
        expect(localStorage.getItem(PROGRESS_KEY)).toBeNull();
        expect(loadSavedGame()).toBeUndefined();
    });

    it('discards a seed-mismatched pair', () => {
        const a = makeGameState({ seed: 1 });
        const b = makeGameState({ seed: 2 });
        saveGeometry(a);
        saveProgress(b, []); // different seed
        expect(loadSavedGame()).toBeUndefined();
    });

    it('still loads a legacy single-key v10 save (groups inline, no progress key)', () => {
        // Hand-write a legacy full blob the way the old build stored it.
        const state = makeGameState({ seed: 9 });
        const legacy = {
            version: 10,
            pieces: state.pieces,
            groups: state.groups.map((g) => ({
                id: g.id,
                pieces: Array.from(g.pieces.entries()),
                position: g.position,
                rotation: g.rotation,
            })),
            imageUrl: state.imageUrl,
            imageSize: state.imageSize,
            gridSize: state.gridSize,
            completed: false,
            seed: 9,
            selection: [1],
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
        expect(localStorage.getItem(PROGRESS_KEY)).toBeNull();

        const loaded = loadSavedGame();
        expect(loaded!.state.pieces).toEqual(state.pieces);
        expect(loaded!.state.groups.length).toBe(state.groups.length);
        expect(loaded!.selection).toEqual([1]);
    });

    it('prefers the progress key over a legacy inline-groups blob (migration)', () => {
        const state = makeGameState({ seed: 9 });
        const legacy = {
            version: 10,
            pieces: state.pieces,
            groups: state.groups.map((g) => ({
                id: g.id, pieces: Array.from(g.pieces.entries()), position: g.position, rotation: g.rotation,
            })),
            imageUrl: state.imageUrl, imageSize: state.imageSize, gridSize: state.gridSize,
            completed: false, seed: 9,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
        // A newer progress write lands in the progress key.
        saveProgress(state, [0]);
        const loaded = loadSavedGame();
        expect(loaded!.selection).toEqual([0]); // from progress, not the legacy blob
    });

    it('clearSavedState removes both keys', () => {
        saveNewPuzzle(makeGameState({ seed: 5 }), [1]);
        clearSavedState();
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(localStorage.getItem(PROGRESS_KEY)).toBeNull();
    });
});
```

Also update the `createDebouncedSave` describe block: a debounced flush now writes the PROGRESS key. Change the assertions in those tests that check `localStorage.getItem(STORAGE_KEY)` for a routine save to check `PROGRESS_KEY` instead (e.g. "saves after the debounce interval", "carries the selection", "resets the timer", "flush saves immediately", "cancel discards"). For the round-trip/selection ones, keep using `loadState()`/`loadedSelection()` — but those now need geometry present, so in each such test call `saveGeometry(state)` (or `saveNewPuzzle`) once up front so `loadSavedGame` can recombine. The `onSaveFailed` tests keep working (mock throws on all `setItem`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/persistence/storage.test.ts`
Expected: FAIL — new exports missing; debounce writes the wrong key.

- [ ] **Step 3: Implement the new storage module**

Rewrite `src/persistence/storage.ts`. Replace the imports from `./serialization.js` and the `saveState`/`loadSavedGame`/`clearSavedState`/`flushPending` functions as follows (keep `STORAGE_KEY`, `SAVE_DEBOUNCE_MS`, `SaveResult`, `loadState`, and the rest of `createDebouncedSave` unchanged except `flushPending`).

Imports:
```ts
import {
    serializeStatic,
    serializeProgress,
    deserializeState,
    recombine,
    readSelection,
    type SerializedStaticState,
    type SerializedProgress,
    type SerializedGameState,
} from './serialization.js';
import { compressForStorage, decompressFromStorage } from './compression.js';
```

Keys:
```ts
/** localStorage key for the static geometry + metadata blob. */
export const STORAGE_KEY = 'puzzle-game-state';

/** localStorage key for the small mutable progress blob (groups/selection/completed). */
export const PROGRESS_KEY = 'puzzle-progress';
```

Replace `saveState` with a private `writeWithOverflow` + the three public save functions:
```ts
/**
 * Write a value to a localStorage key with compress-on-overflow.
 *
 * Tries a plain write; on any throw (quota on most browsers) retries once with
 * an lz-string-compressed payload. If both throw, the previous value at `key`
 * is left intact (we never clear it first) and `'failed'` is returned.
 */
function writeWithOverflow(key: string, json: string): SaveResult {
    try {
        localStorage.setItem(key, json);
        return 'ok';
    } catch {
        try {
            localStorage.setItem(key, compressForStorage(json));
            return 'ok-compressed';
        } catch (error) {
            diagnostics.warn(
                `Failed to save "${key}" (quota or other storage error, even after compression):`,
                error,
            );
            return 'failed';
        }
    }
}

/** Persist the static geometry + metadata blob. Written once per puzzle. */
export function saveGeometry(state: GameState): SaveResult {
    return writeWithOverflow(STORAGE_KEY, JSON.stringify(serializeStatic(state)));
}

/** Persist the small mutable progress blob. Written on every debounced save. */
export function saveProgress(state: GameState, selection?: Iterable<number>): SaveResult {
    return writeWithOverflow(PROGRESS_KEY, JSON.stringify(serializeProgress(state, selection)));
}

/**
 * Persist a freshly created puzzle: geometry (once) + initial progress.
 * Used on new game and share-link load. Worst sub-result wins.
 */
export function saveNewPuzzle(state: GameState, selection?: Iterable<number>): SaveResult {
    const g = saveGeometry(state);
    const p = saveProgress(state, selection);
    if (g === 'failed' || p === 'failed') return 'failed';
    if (g === 'ok-compressed' || p === 'ok-compressed') return 'ok-compressed';
    return 'ok';
}
```

Rewrite `loadSavedGame`:
```ts
/**
 * Load the saved game and its multi-select selection.
 *
 * New split format: a STATIC blob (geometry + metadata) plus a PROGRESS blob
 * (groups/selection/completed) recombined into a GameState. Falls back to the
 * legacy single-key full blob (groups inline) when no progress key exists.
 * A geometry/progress pair with mismatched seeds, or a v11 static blob with no
 * progress, is treated as "no valid save".
 *
 * Never throws — all errors are caught and logged.
 */
export function loadSavedGame(): { state: GameState; selection: number[] } | undefined {
    try {
        const staticRaw = localStorage.getItem(STORAGE_KEY);
        if (staticRaw === null) {
            return undefined;
        }
        const staticData: SerializedStaticState & SerializedGameState = JSON.parse(
            decompressFromStorage(staticRaw),
        );

        const progressRaw = localStorage.getItem(PROGRESS_KEY);
        if (progressRaw !== null) {
            const progress: SerializedProgress = JSON.parse(decompressFromStorage(progressRaw));
            if (
                staticData.seed !== undefined &&
                progress.seed !== undefined &&
                staticData.seed !== progress.seed
            ) {
                // Torn / cross-puzzle pair — don't load a mismatched puzzle.
                return undefined;
            }
            return { state: recombine(staticData, progress), selection: readSelection(progress) };
        }

        // No progress key: a legacy single-key blob has groups inline.
        if (Array.isArray(staticData.groups) && staticData.groups.length > 0) {
            return { state: deserializeState(staticData), selection: readSelection(staticData) };
        }

        // v11 static blob with no progress = torn write — nothing to restore.
        return undefined;
    } catch (error) {
        diagnostics.warn('Failed to restore saved game state:', error);
        return undefined;
    }
}
```
(`readSelection` reads the `selection` field of whatever blob it's given, so it works for both the progress blob and a legacy full blob.)

Update `clearSavedState`:
```ts
export function clearSavedState(): void {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PROGRESS_KEY);
}
```

Update `flushPending` inside `createDebouncedSave` to save progress only:
```ts
    function flushPending(): void {
        if (pendingState !== null) {
            const result = saveProgress(pendingState, pendingSelection ?? []);
            pendingState = null;
            pendingSelection = null;
            if (result === 'failed') {
                onSaveFailed?.();
            }
        }
    }
```

Remove the old `saveState` export entirely.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/persistence/storage.test.ts` and `npx tsc --noEmit`
Expected: PASS, clean. (If a leftover test still references `saveState`, switch it to `saveNewPuzzle`.)

- [ ] **Step 5: Commit**

```bash
git add src/persistence/storage.ts src/persistence/storage.test.ts
git commit -m "feat(persistence): two-key storage — geometry once, progress per save (#397)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Update persistence barrel exports

**Files:**
- Modify: `src/persistence/index.ts`

- [ ] **Step 1: Update exports**

In `src/persistence/index.ts`:
- From `./serialization.js`, add `serializeStatic`, `serializeProgress`, `recombine` to the value exports and `SerializedStaticState`, `SerializedProgress` to the `export type` block.
- From `./storage.js`, remove `saveState`; add `saveGeometry`, `saveProgress`, `saveNewPuzzle`, and `PROGRESS_KEY`. Keep `loadState`, `loadSavedGame`, `clearSavedState`, `createDebouncedSave`, `STORAGE_KEY`, `SAVE_DEBOUNCE_MS`, and `export type { SaveResult }`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/persistence/index.ts
git commit -m "feat(persistence): export split-storage API (#397)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wire new-game / share-link to saveNewPuzzle

**Files:**
- Modify: `src/main.ts`

No unit test (composition root). Verified by `tsc`, the suite, and Task 5.

- [ ] **Step 1: Update the persistence import**

In `src/main.ts`, in the import from `./persistence/index.js`, add `saveNewPuzzle` (next to `createDebouncedSave`). Leave `loadState`, `loadSavedGame`, `clearSavedState`, `createDebouncedSave` as they are.

- [ ] **Step 2: Persist geometry once on new game**

In `src/main.ts`, the fresh-start flow currently ends with (around line 951):
```ts
        initGame(state);
        gatherAndZoomToFit();
        renderer.renderState(gameState);
        autoSave();
```
Replace that `autoSave();` with:
```ts
        saveNewPuzzle(gameState, selectionManager.selectedGroupIds);
```

- [ ] **Step 3: Persist geometry once on share-link load**

In `src/main.ts`, the share-link flow has the same four lines (around line 1267). Replace its `autoSave();` with:
```ts
        saveNewPuzzle(gameState, selectionManager.selectedGroupIds);
```
(There are exactly two `initGame(state); gatherAndZoomToFit(); renderer.renderState(gameState); autoSave();` blocks — the fresh-start one and the shared one. Update both. Leave every other `autoSave()` call site unchanged — those debounce a progress save.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(app): persist geometry once on new game / share load (#397)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Full verification

**Files:** none.

- [ ] **Step 1: Full suite + build**

Run: `npm test` then `npm run build`
Expected: all tests pass; `tsc` + Vite build clean.

- [ ] **Step 2: Manual perf smoke test (the freeze)**

`npm run dev`, open the app:
1. New Game → Composable, Traced, 192 pieces, Blank. Wait for generation.
2. Confirm both keys exist: in console, `localStorage.getItem('puzzle-game-state').length` (~1.1M, the geometry) and `localStorage.getItem('puzzle-progress').length` (small, a few KB).
3. Capture the geometry blob: `g = localStorage.getItem('puzzle-game-state')`.
4. Drag a piece. After ~500 ms, confirm:
   - `localStorage.getItem('puzzle-game-state') === g` (geometry **unchanged** — not rewritten).
   - the progress key changed and is still small.
5. Time a save: in console, `const t=performance.now(); window.dispatchEvent(new Event('pagehide')); performance.now()-t` should be low-single-digit ms (no recompression).
6. Reload → the 192-piece traced Composable puzzle restores (instant), pieces in the positions you left them.

- [ ] **Step 3: Confirm no help-text change needed**

Internal persistence/perf refactor; no visible feature/gesture/setting change. Skim `src/ui/info-modal.ts`, make no change.

---

## Self-review notes

- **Spec coverage:** two keys + sizes (Task 2), v11 static omits groups (Task 1), progress per-save via debounce (Task 2), `saveGeometry`/`saveProgress`/`saveNewPuzzle` (Task 2), recombine/legacy/torn/seed-guard load (Tasks 1–2), `clearSavedState` both keys (Task 2), new-game & share-link wiring (Task 4), help-text decision (Task 5), perf verification (Task 5). All covered.
- **Type consistency:** `serializeStatic`/`serializeProgress`/`recombine`, `SerializedStaticState`/`SerializedProgress`, `saveGeometry`/`saveProgress`/`saveNewPuzzle`, `STORAGE_KEY`/`PROGRESS_KEY`, `SaveResult` used identically across tasks.
- **Reproducibility contract:** untouched — full geometry still stored (compressed), generation not invoked on load.
