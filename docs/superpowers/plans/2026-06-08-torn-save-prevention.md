# Torn save prevention (#404) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the torn `puzzle-game-state` / `puzzle-progress` pair impossible to write, so the load-time seed-mismatch guard stops firing false "corrupt save" dialogs (#404).

**Architecture:** Two changes, both in `src/persistence/storage.ts`. (Route 1) `saveProgress` consults the seed of the geometry currently in localStorage and refuses to write when it belongs to a different puzzle — the geometry key is the anchor and the tab that last wrote it owns the single save slot. A tiny module-level cache keyed on the verbatim raw geometry string avoids re-decoding the (potentially multi-MB) geometry blob on every debounced save. (Route 2) `saveNewPuzzle` becomes atomic: if the geometry write fails (quota), it does not write the new progress, leaving the previous puzzle's consistent pair intact and loadable. The existing load-time detection is unchanged — it remains the backstop.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom), lz-string (via `compression.ts`).

**Spec:** `docs/superpowers/specs/2026-06-08-torn-save-prevention-design.md`

**Commands:**
- Focused tests: `npx vitest run src/persistence/storage.test.ts`
- Full suite: `npm test`
- Typecheck: `npx tsc --noEmit`

---

## File structure

- **Modify** `src/persistence/storage.ts`
  - Add `'skipped'` to the `SaveResult` union.
  - Add a module-level geometry-seed cache + `currentGeometrySeed()` helper.
  - `saveProgress`: skip on confirmed seed mismatch.
  - `saveNewPuzzle`: early-return on geometry-write failure (don't write new progress).
- **Modify** `src/persistence/storage.test.ts`
  - New tests for the cross-tab guard, the cache, and Route 2.
  - Update two existing load-guard tests that built a mismatched pair *via* `saveProgress` (now refused) to install the mismatched progress blob directly.

No new files, no new localStorage keys, no UI changes. (Per the spec, no `info-modal.ts` help-text update — this is a correctness fix with no visible feature.)

---

## Task 1: Route 1 — refuse a stale progress write (anchor wins)

**Files:**
- Modify: `src/persistence/storage.ts` (`SaveResult` ~line 36; insert cache helper before `saveGeometry` ~line 102; `saveProgress` ~lines 107-110)
- Test: `src/persistence/storage.test.ts`

- [ ] **Step 1: Add the new test import**

In `src/persistence/storage.test.ts`, the compression import is currently:

```ts
import { COMPRESSED_MARKER } from './compression.js';
import { STATE_VERSION } from './serialization.js';
```

Replace those two lines with (adds a namespace import for spying on `decompressFromStorage`, and `serializeProgress` for installing on-disk blobs directly):

```ts
import * as compression from './compression.js';
import { COMPRESSED_MARKER } from './compression.js';
import { STATE_VERSION, serializeProgress } from './serialization.js';
```

- [ ] **Step 2: Write the failing tests for the guard**

Append this new `describe` block to `src/persistence/storage.test.ts` (after the `split storage` block, before `unreadable save carries the raw blobs for download`):

```ts
describe('saveProgress cross-tab guard (#404)', () => {
    beforeEach(() => localStorage.clear());

    it('refuses to overwrite progress when the stored geometry is a different puzzle', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        saveNewPuzzle(makeGameState({ seed: 1 }), [0]); // geometry=1, progress=1
        const progressBefore = localStorage.getItem(PROGRESS_KEY);

        const result = saveProgress(makeGameState({ seed: 2 }), [1]); // stale tab
        warnSpy.mockRestore();

        expect(result).toBe('skipped');
        expect(localStorage.getItem(PROGRESS_KEY)).toBe(progressBefore); // untouched
    });

    it('logs why it skipped a mismatched progress write', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        saveNewPuzzle(makeGameState({ seed: 1 }), [0]);
        saveProgress(makeGameState({ seed: 2 }), [1]);
        warnSpy.mockRestore();

        expect(warnSpy).toHaveBeenCalled();
    });

    it('keeps the most-recent geometry owner so reload is not a seed-mismatch', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // Tab A started puzzle 1; a stale background Tab B autosaves puzzle 2.
        saveNewPuzzle(makeGameState({ seed: 1 }), [0]);
        saveProgress(makeGameState({ seed: 2 }), [1]);
        warnSpy.mockRestore();

        const loaded = expectLoaded();
        expect(loaded.state.seed).toBe(1); // still puzzle 1, pair intact
    });

    it('writes normally when the stored geometry is the same puzzle', () => {
        saveNewPuzzle(makeGameState({ seed: 5 }), []);
        const result = saveProgress(makeGameState({ seed: 5 }), [1]);

        expect(result).not.toBe('skipped');
        expect(expectLoaded().selection).toEqual([1]);
    });

    it('writes when no geometry is present (nothing to mismatch against)', () => {
        const result = saveProgress(makeGameState({ seed: 7 }), [1]);
        expect(result).not.toBe('skipped');
        expect(localStorage.getItem(PROGRESS_KEY)).not.toBeNull();
    });

    it('writes when the stored geometry is unreadable (does not block on it)', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        localStorage.setItem(STORAGE_KEY, '{not valid json!!!');
        const result = saveProgress(makeGameState({ seed: 7 }), [1]);
        warnSpy.mockRestore();

        expect(result).not.toBe('skipped');
        expect(localStorage.getItem(PROGRESS_KEY)).not.toBeNull();
    });

    it('writes when either side has no seed (only a confirmed mismatch skips)', () => {
        saveNewPuzzle(makeGameState({ seed: 5 }), []); // geometry has seed 5
        const result = saveProgress(makeGameState(), [1]); // progress has no seed
        expect(result).not.toBe('skipped');
    });

    it('does not re-decode the geometry on repeated same-puzzle saves (cache)', () => {
        // saveGeometry does not read/decode, so the cache still holds whatever a
        // previous test left. A unique seed guarantees the first read is a cache
        // miss (one decode); subsequent reads of the unchanged bytes must not
        // decode again.
        saveGeometry(makeGameState({ seed: 424242 }));
        const spy = vi.spyOn(compression, 'decompressFromStorage');

        saveProgress(makeGameState({ seed: 424242 }), [1]); // miss → 1 decode
        const afterFirst = spy.mock.calls.length;
        saveProgress(makeGameState({ seed: 424242 }), [2]); // hit → 0
        saveProgress(makeGameState({ seed: 424242 }), [3]); // hit → 0
        spy.mockRestore();

        expect(afterFirst).toBe(1); // also proves the spy intercepts storage.ts
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('re-decodes after a cross-tab geometry change (cache invalidation)', () => {
        // Geometry replaced by a different puzzle between two progress saves: the
        // raw bytes change, so the guard re-reads the new seed and now skips.
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        saveNewPuzzle(makeGameState({ seed: 1 }), []); // geometry=1
        expect(saveProgress(makeGameState({ seed: 1 }), [1])).not.toBe('skipped');

        saveGeometry(makeGameState({ seed: 2 })); // another tab takes over → geometry=2
        expect(saveProgress(makeGameState({ seed: 1 }), [2])).toBe('skipped');
        warnSpy.mockRestore();
    });
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `npx vitest run src/persistence/storage.test.ts -t "cross-tab guard"`
Expected: FAIL — `saveProgress` currently always writes, so the skip/`'skipped'` and cache assertions fail.

- [ ] **Step 4: Add `'skipped'` to `SaveResult`**

In `src/persistence/storage.ts`, change (line ~36):

```ts
/** Outcome of a save call. */
export type SaveResult = 'ok' | 'ok-compressed' | 'failed';
```

to:

```ts
/**
 * Outcome of a save call.
 *
 * - `'ok'` / `'ok-compressed'` — written (compressed on quota overflow).
 * - `'failed'`  — could not be written (quota even after compression).
 * - `'skipped'` — intentionally not written; see {@link saveProgress}.
 */
export type SaveResult = 'ok' | 'ok-compressed' | 'failed' | 'skipped';
```

- [ ] **Step 5: Add the geometry-seed cache helper**

In `src/persistence/storage.ts`, insert this block immediately before `saveGeometry` (i.e. between `writeWithOverflow` and the `saveGeometry` comment, ~line 101):

```ts
// Cache of the stored geometry's seed, keyed on the verbatim raw geometry
// string. A debounced progress save runs often; decoding the (potentially
// multi-MB) geometry blob on every call just to read its seed would be
// wasteful. Correctness comes from reading the real value on every call — we
// only re-run decompress+parse when the raw bytes differ from the last decode.
// A cross-tab geometry write (or a new puzzle in this tab) changes the bytes
// and invalidates the cache lazily on the next read.
let cachedGeometryRaw: string | null = null;
let cachedGeometrySeed: number | undefined;

/**
 * Seed of the geometry currently in localStorage, or `undefined` if there is no
 * geometry, it cannot be decoded, or it carries no seed. Never throws.
 */
function currentGeometrySeed(): number | undefined {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
        cachedGeometryRaw = null;
        cachedGeometrySeed = undefined;
        return undefined;
    }
    if (raw !== cachedGeometryRaw) {
        cachedGeometryRaw = raw;
        try {
            const parsed = JSON.parse(decompressFromStorage(raw)) as { seed?: unknown };
            cachedGeometrySeed = typeof parsed.seed === 'number' ? parsed.seed : undefined;
        } catch {
            // Unreadable geometry: don't block progress writes on it.
            cachedGeometrySeed = undefined;
        }
    }
    return cachedGeometrySeed;
}
```

- [ ] **Step 6: Add the guard to `saveProgress`**

In `src/persistence/storage.ts`, replace `saveProgress` (lines ~107-110):

```ts
/** Persist the small mutable progress blob. Written on every debounced save. */
export function saveProgress(state: GameState, selection?: Iterable<number>): SaveResult {
    return writeWithOverflow(PROGRESS_KEY, JSON.stringify(serializeProgress(state, selection)));
}
```

with:

```ts
/**
 * Persist the small mutable progress blob. Written on every debounced save.
 *
 * Refuses to write (returns `'skipped'`) when the geometry currently in
 * localStorage belongs to a *different* puzzle than `state` — e.g. another tab
 * on the same origin started a new puzzle while this tab still holds the old
 * one. Writing here would tear the geometry/progress pair into a seed-mismatch
 * that the next load rejects as a false "corrupt save" (#404). The geometry key
 * is the anchor; the tab that last wrote it owns the single save slot. Only a
 * confirmed seed mismatch skips — absent / unreadable / seedless geometry writes
 * as before.
 */
export function saveProgress(state: GameState, selection?: Iterable<number>): SaveResult {
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
    return writeWithOverflow(PROGRESS_KEY, JSON.stringify(serializeProgress(state, selection)));
}
```

- [ ] **Step 7: Run the new tests to verify they pass**

Run: `npx vitest run src/persistence/storage.test.ts -t "cross-tab guard"`
Expected: PASS (all nine cases).

- [ ] **Step 8: Fix the two existing load-guard tests broken by the guard**

These two tests built a mismatched pair by calling `saveProgress` with a different seed — which the guard now refuses, so they no longer create the mismatch. Install the mismatched progress blob directly instead (same on-disk bytes as before).

(a) In the `split storage` block, the test `reports "unreadable" for a seed-mismatched pair and logs why` currently reads:

```ts
    it('reports "unreadable" for a seed-mismatched pair and logs why', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const a = makeGameState({ seed: 1 });
        const b = makeGameState({ seed: 2 });
        saveGeometry(a);
        saveProgress(b, []); // different seed
        expect(loadSavedGame().status).toBe('unreadable');
        expect(warnSpy).toHaveBeenCalled(); // intentional discard leaves a trail
        warnSpy.mockRestore();
    });
```

Replace the `saveGeometry(a); saveProgress(b, []); // different seed` lines with:

```ts
        saveGeometry(a);
        // saveProgress now refuses to write a seed-mismatched pair, so install the
        // stale/cross-tab progress blob directly — the on-disk shape the load-time
        // guard must still detect.
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(serializeProgress(b, [])));
```

(b) In the `unreadable save carries the raw blobs for download` block, the test `attaches both raw blobs for a seed-mismatched pair (reason: seed-mismatch)` currently starts:

```ts
        saveGeometry(makeGameState({ seed: 1 }));
        saveProgress(makeGameState({ seed: 2 }), []);
        const staticRaw = localStorage.getItem(STORAGE_KEY);
```

Replace the first two lines with:

```ts
        saveGeometry(makeGameState({ seed: 1 }));
        // Install the mismatched progress blob directly (saveProgress now guards
        // against writing one); the load-time guard must still flag the pair.
        localStorage.setItem(
            PROGRESS_KEY,
            JSON.stringify(serializeProgress(makeGameState({ seed: 2 }), [])),
        );
```

- [ ] **Step 9: Run the full storage suite + typecheck**

Run: `npx vitest run src/persistence/storage.test.ts`
Expected: PASS (all tests, including the two fixed ones).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/persistence/storage.ts src/persistence/storage.test.ts
git commit -m "fix: drop stale cross-tab progress writes to prevent torn saves (#404)

A debounced progress autosave from a background tab could overwrite
puzzle-progress while puzzle-game-state held a freshly-started puzzle from
another tab on the same origin, tearing the pair into a seed-mismatch that
the next load rejects as a false 'corrupt save'.

saveProgress now reads the stored geometry's seed (cached by raw-string so the
large geometry blob is decoded at most once per puzzle, not per save) and skips
the write on a confirmed mismatch — the geometry key is the anchor and the tab
that last wrote it owns the single save slot.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Route 2 — keep the previous puzzle loadable on a failed geometry write

**Files:**
- Modify: `src/persistence/storage.ts` (`saveNewPuzzle` ~lines 116-122)
- Test: `src/persistence/storage.test.ts` (`saveNewPuzzle quota handling` block)

- [ ] **Step 1: Write the failing tests**

Append these two tests inside the existing `describe('saveNewPuzzle quota handling', ...)` block in `src/persistence/storage.test.ts`:

```ts
    it('leaves the previous puzzle loadable when the new geometry write fails', () => {
        saveNewPuzzle(makeGameState({ seed: 1, imageUrl: 'good.jpg' }), [0]);

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const realSetItem = Storage.prototype.setItem;
        // Geometry writes (STORAGE_KEY) fail; small progress writes still succeed.
        const spy = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(function (this: Storage, key: string, value: string) {
                if (key === STORAGE_KEY) {
                    throw new DOMException('quota', 'QuotaExceededError');
                }
                realSetItem.call(this, key, value);
            });

        const result = saveNewPuzzle(makeGameState({ seed: 2, imageUrl: 'too-big.jpg' }), [1]);
        spy.mockRestore();
        warnSpy.mockRestore();

        expect(result).toBe('failed');
        // The previous pair is intact: load returns the previous puzzle, not a
        // seed-mismatch.
        const loaded = expectLoaded();
        expect(loaded.state.imageUrl).toBe('good.jpg');
        expect(loaded.state.seed).toBe(1);
    });

    it('does not leave an orphan progress key when the first puzzle is too large to save', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const realSetItem = Storage.prototype.setItem;
        const spy = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(function (this: Storage, key: string, value: string) {
                if (key === STORAGE_KEY) {
                    throw new DOMException('quota', 'QuotaExceededError');
                }
                realSetItem.call(this, key, value);
            });

        const result = saveNewPuzzle(makeGameState({ seed: 1 }), [0]); // empty storage
        spy.mockRestore();
        warnSpy.mockRestore();

        expect(result).toBe('failed');
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(localStorage.getItem(PROGRESS_KEY)).toBeNull(); // no orphan progress
        expect(loadSavedGame().status).toBe('empty');
    });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/persistence/storage.test.ts -t "too large to save"`
Expected: the `does not leave an orphan progress key` case FAILS — with only Task 1's guard, the absent-geometry default lets the orphan progress write through (it expects `PROGRESS_KEY` to be `null`). Task 2 closes that.

(The companion `leaves the previous puzzle loadable` case already passes after Task 1, because the guard skips the mismatched progress write when the previous geometry is still on disk; it is included here as a regression guard for the headline behavior, alongside the orphan case that actually drives this change.)

- [ ] **Step 3: Make `saveNewPuzzle` atomic on geometry failure**

In `src/persistence/storage.ts`, replace `saveNewPuzzle` (lines ~116-122):

```ts
export function saveNewPuzzle(state: GameState, selection?: Iterable<number>): SaveResult {
    const g = saveGeometry(state);
    const p = saveProgress(state, selection);
    if (g === 'failed' || p === 'failed') return 'failed';
    if (g === 'ok-compressed' || p === 'ok-compressed') return 'ok-compressed';
    return 'ok';
}
```

with:

```ts
export function saveNewPuzzle(state: GameState, selection?: Iterable<number>): SaveResult {
    const g = saveGeometry(state);
    if (g === 'failed') {
        // The new geometry was too large to persist even compressed; the previous
        // puzzle's geometry is still at STORAGE_KEY. Don't write the new progress
        // on top of it — that would be a seed-mismatch (#404). Leaving the
        // previous pair untouched keeps it loadable; the new puzzle simply won't
        // persist (the caller surfaces a "too large to save" toast). Route 1's
        // saveProgress guard likewise drops later autosaves of the new puzzle.
        return 'failed';
    }
    const p = saveProgress(state, selection);
    if (p === 'failed') return 'failed';
    if (g === 'ok-compressed' || p === 'ok-compressed') return 'ok-compressed';
    return 'ok';
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npx vitest run src/persistence/storage.test.ts -t "too large to save"`
Expected: PASS (both cases).

- [ ] **Step 5: Run the full storage suite + typecheck**

Run: `npx vitest run src/persistence/storage.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/persistence/storage.ts src/persistence/storage.test.ts
git commit -m "fix: keep the previous save loadable when a new puzzle is too large (#404)

saveNewPuzzle wrote geometry then progress unconditionally. When the new
geometry was too large to persist even compressed, the stale geometry stayed
while the new (small) progress wrote, tearing the pair into a seed-mismatch.

Now a failed geometry write short-circuits before the progress write, leaving
the previous puzzle's consistent pair intact (and loadable) and avoiding an
orphan progress key on a first-puzzle failure.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`
Expected: all tests pass (no regressions outside `storage.test.ts`).

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build (catches build-only breakage)**

Run: `npm run build`
Expected: builds successfully.

---

## Self-review notes

- **Spec coverage:** Route 1 guard + raw-string cache (Task 1), `'skipped'` result that does not toast — `'skipped'` is inert in `createDebouncedSave.flushPending` (only `'failed'` calls `onSaveFailed`) and in `saveNewPuzzle`'s combine (returns `'ok'`), so no caller change is needed; defensive defaults for absent/unreadable/seedless geometry (Task 1 tests); Route 2 atomic new-game leaving the previous puzzle loadable (Task 2); cross-tab race simulation (Task 1 "keeps the most-recent geometry owner"); decode-once cache assertion (Task 1). No telemetry, no `storage`-event coordination, no help-text change — all explicitly out of scope.
- **Why no `main.ts` change:** `'skipped'` is never surfaced to the user. The debounced saver toasts only on `'failed'`; `persistNewPuzzle` toasts on `saveNewPuzzle` returning `'failed'`, which Route 2 still returns. Confirmed against `src/main.ts:611-637`.
- **Type consistency:** `currentGeometrySeed` (internal, not exported), `cachedGeometryRaw`/`cachedGeometrySeed`, `SaveResult` extended with `'skipped'` — used consistently across both tasks.
- **Module-cache across tests:** the cache is keyed on the actual raw bytes read every call, so it self-heals (a `localStorage.clear()` makes the next read return `null` → cache resets). The decode-count test uses a unique seed (`424242`) to guarantee a deterministic first-read miss regardless of test order.
