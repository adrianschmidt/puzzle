# Large-save quota fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop large puzzle saves (e.g. 192-piece Composable + Traced) from silently failing the `localStorage` quota — compress on overflow, never clobber a prior good save, and toast the user if a save truly can't be written.

**Architecture:** Keep the existing save format and full geometry. `saveState` tries a plain `setItem`; on any failure it retries once with an `lz-string`-compressed, marker-prefixed payload; if that also fails it leaves the previous save intact and returns `'failed'`. `loadSavedGame` detects the marker and decompresses. Compression is a fallback only, so normal-sized saves are unchanged on disk. The debounced saver surfaces a `'failed'` result to `main.ts`, which shows a deduped toast.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom), `lz-string`. `tsconfig` uses `verbatimModuleSyntax: true` + `moduleResolution: bundler`, so `lz-string` (named-export `.d.ts`) is imported with **named imports**.

**Reference spec:** `docs/superpowers/specs/2026-06-01-large-save-quota-fix-design.md`

---

## File structure

- **Create** `src/persistence/compression.ts` — isolates `lz-string` + the storage marker. Exports `COMPRESSED_MARKER`, `compressForStorage(json)`, `decompressFromStorage(raw)`.
- **Create** `src/persistence/compression.test.ts` — unit tests for the helper.
- **Modify** `src/persistence/storage.ts` — `saveState` returns `SaveResult` and does compress-on-overflow; `loadSavedGame` decompresses via the helper; `createDebouncedSave` accepts `onSaveFailed`.
- **Modify** `src/persistence/storage.test.ts` — add overflow / failure / debounced-callback tests.
- **Modify** `src/persistence/index.ts` — export `SaveResult`.
- **Modify** `src/main.ts` — wire `onSaveFailed` to a deduped `showToast`.
- **Modify** `package.json` — add `lz-string` runtime dependency.

---

## Task 1: Add the `lz-string` dependency

**Files:**
- Modify: `package.json` (and `package-lock.json`)

- [ ] **Step 1: Install lz-string as a runtime dependency**

Run:
```bash
npm install --save lz-string@^1.5.0 --legacy-peer-deps
```
(`--legacy-peer-deps` is required because the existing tree has a pre-existing peer-dep conflict unrelated to this change.)

- [ ] **Step 2: Verify it landed under `dependencies`**

Run: `node -e "console.log(require('./package.json').dependencies['lz-string'])"`
Expected: prints a version like `^1.5.0` (NOT under devDependencies).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(deps): add lz-string for save compression (#397)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Compression helper module

**Files:**
- Create: `src/persistence/compression.ts`
- Test: `src/persistence/compression.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/persistence/compression.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    COMPRESSED_MARKER,
    compressForStorage,
    decompressFromStorage,
} from './compression.js';

describe('compression helper', () => {
    it('round-trips a JSON string', () => {
        const json = JSON.stringify({ a: 1, b: 'hello', c: [1, 2, 3] });
        const stored = compressForStorage(json);
        expect(decompressFromStorage(stored)).toBe(json);
    });

    it('tags compressed output with the marker', () => {
        const stored = compressForStorage('{"x":1}');
        expect(stored.startsWith(COMPRESSED_MARKER)).toBe(true);
    });

    it('shrinks large repetitive JSON', () => {
        const json = JSON.stringify(
            Array.from({ length: 2000 }, (_, i) => ({ path: 'C 1.234 5.678 9.0 1.2', id: i })),
        );
        const stored = compressForStorage(json);
        expect(stored.length).toBeLessThan(json.length / 2);
    });

    it('returns a marker-less (uncompressed) value unchanged', () => {
        const plain = '{"version":10,"pieces":[]}';
        expect(decompressFromStorage(plain)).toBe(plain);
    });

    it('the marker cannot collide with JSON.stringify output', () => {
        // JSON.stringify of an object always starts with "{".
        expect(COMPRESSED_MARKER.startsWith('{')).toBe(false);
        expect(JSON.stringify({}).startsWith(COMPRESSED_MARKER)).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/persistence/compression.test.ts`
Expected: FAIL — cannot resolve `./compression.js`.

- [ ] **Step 3: Write the implementation**

Create `src/persistence/compression.ts`:

```ts
/**
 * localStorage compression helper.
 *
 * Wraps lz-string's UTF-16 codec and a marker prefix so the storage layer
 * can store a compressed payload and still recognise it on load. Compression
 * is used only as a fallback when an uncompressed write exceeds the quota
 * (see saveState), so most saves never pass through here.
 */

import { compressToUTF16, decompressFromUTF16 } from 'lz-string';

/**
 * Prefix marking a stored value as lz-string-compressed.
 *
 * Begins with the U+0001 control character, which a `JSON.stringify` object
 * payload (always starting with `{`) can never begin with — so a stored blob
 * is classified unambiguously without a format/version flag.
 */
export const COMPRESSED_MARKER = 'LZ';

/** Compress a JSON string for localStorage, tagged with {@link COMPRESSED_MARKER}. */
export function compressForStorage(json: string): string {
    return COMPRESSED_MARKER + compressToUTF16(json);
}

/**
 * Reverse {@link compressForStorage}.
 *
 * A value without the marker is returned unchanged, so saves written before
 * compression existed (and normal-sized saves today) still load. A corrupt
 * compressed payload yields a string that fails downstream `JSON.parse`,
 * which the caller already treats as "no valid save".
 */
export function decompressFromStorage(raw: string): string {
    if (!raw.startsWith(COMPRESSED_MARKER)) {
        return raw;
    }
    return decompressFromUTF16(raw.slice(COMPRESSED_MARKER.length));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/persistence/compression.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/persistence/compression.ts src/persistence/compression.test.ts
git commit -m "feat(persistence): add marker-aware lz-string compression helper (#397)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `saveState` returns a result and compresses on overflow

**Files:**
- Modify: `src/persistence/storage.ts:30-33` (the `saveState` function)
- Test: `src/persistence/storage.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these imports at the top of `src/persistence/storage.test.ts` alongside the existing storage imports:

```ts
import { COMPRESSED_MARKER } from './compression.js';
```

Add a new `describe` block to `src/persistence/storage.test.ts` (after the existing `saveState / loadState` block):

```ts
describe('saveState quota handling', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns "ok" and stores an uncompressed value for a normal save', () => {
        const result = saveState(makeGameState());
        expect(result).toBe('ok');
        expect(localStorage.getItem(STORAGE_KEY)!.startsWith(COMPRESSED_MARKER)).toBe(false);
    });

    it('falls back to a compressed write when the plain write exceeds quota', () => {
        const state = makeGameState();
        const realSetItem = Storage.prototype.setItem;

        // Reject the large uncompressed write; accept the compressed retry.
        // Discriminate by the marker, not by size, so the test is robust.
        const spy = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(function (this: Storage, key: string, value: string) {
                if (!value.startsWith(COMPRESSED_MARKER)) {
                    throw new DOMException('quota', 'QuotaExceededError');
                }
                realSetItem.call(this, key, value);
            });

        const result = saveState(state);
        spy.mockRestore();

        expect(result).toBe('ok-compressed');
        const stored = localStorage.getItem(STORAGE_KEY)!;
        expect(stored.startsWith(COMPRESSED_MARKER)).toBe(true);

        const restored = loadState();
        expect(restored!.pieces).toEqual(state.pieces);
    });

    it('preserves a prior good save and returns "failed" when both writes throw', () => {
        saveState(makeGameState({ imageUrl: 'good.jpg' }));

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const spy = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('quota', 'QuotaExceededError');
            });

        const result = saveState(makeGameState({ imageUrl: 'too-big.jpg' }));
        spy.mockRestore();
        warnSpy.mockRestore();

        expect(result).toBe('failed');
        // The earlier good save is untouched (we never removeItem first).
        expect(loadState()!.imageUrl).toBe('good.jpg');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/persistence/storage.test.ts`
Expected: FAIL — `saveState` returns `undefined` (not `'ok'`), and the overflow test errors because the plain throw is uncaught.

- [ ] **Step 3: Implement the guarded `saveState`**

In `src/persistence/storage.ts`, add the import near the top (with the other `./` imports):

```ts
import { compressForStorage, decompressFromStorage } from './compression.js';
```

Replace the existing `saveState` function (currently lines 30-33) with:

```ts
/** Outcome of a {@link saveState} call. */
export type SaveResult = 'ok' | 'ok-compressed' | 'failed';

/**
 * Save a GameState to localStorage.
 *
 * Tries a plain JSON write first. If that throws (quota exceeded — large
 * traced-tab puzzles can exceed the ~4.75 MB ceiling), retries once with an
 * lz-string-compressed payload. If the compressed write also throws, the
 * previous save is left intact (we never clear it first) and `'failed'` is
 * returned so the caller can warn the user.
 */
export function saveState(state: GameState, selection?: Iterable<number>): SaveResult {
    const json = JSON.stringify(serializeState(state, selection));

    try {
        localStorage.setItem(STORAGE_KEY, json);
        return 'ok';
    } catch {
        // Any setItem failure (quota on most browsers) — retry compressed.
        try {
            localStorage.setItem(STORAGE_KEY, compressForStorage(json));
            return 'ok-compressed';
        } catch (error) {
            diagnostics.warn(
                'Failed to save game state (quota exceeded even after compression):',
                error,
            );
            return 'failed';
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/persistence/storage.test.ts`
Expected: PASS (existing tests + 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/persistence/storage.ts src/persistence/storage.test.ts
git commit -m "feat(persistence): compress-on-overflow guard in saveState (#397)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `loadSavedGame` decompresses marker-tagged saves

**Files:**
- Modify: `src/persistence/storage.ts` (`loadSavedGame`, currently lines 51-67)
- Test: `src/persistence/storage.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `saveState quota handling` describe block in `src/persistence/storage.test.ts`:

```ts
    it('round-trips a compressed save (including selection) through loadSavedGame', () => {
        const state = makeGameState();
        // Write a compressed payload directly via the helper-backed path:
        // force the compressed branch as in the overflow test.
        const realSetItem = Storage.prototype.setItem;
        const spy = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(function (this: Storage, key: string, value: string) {
                if (!value.startsWith(COMPRESSED_MARKER)) {
                    throw new DOMException('quota', 'QuotaExceededError');
                }
                realSetItem.call(this, key, value);
            });
        saveState(state, [1, 0]);
        spy.mockRestore();

        const loaded = loadSavedGame();
        expect(loaded).toBeDefined();
        expect(loaded!.state.pieces).toEqual(state.pieces);
        expect(loaded!.selection).toEqual([1, 0]);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/persistence/storage.test.ts`
Expected: FAIL — `loadSavedGame` does `JSON.parse` on the marker-prefixed string, throws, and returns `undefined`.

- [ ] **Step 3: Implement the decompress on load**

In `src/persistence/storage.ts` `loadSavedGame`, change the parse to decompress first. Replace:

```ts
        const parsed: SerializedGameState = JSON.parse(raw);
```

with:

```ts
        const parsed: SerializedGameState = JSON.parse(decompressFromStorage(raw));
```

(The surrounding `try/catch` already turns any decode/parse failure into `undefined`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/persistence/storage.test.ts`
Expected: PASS. Existing marker-less round-trip and version tests still pass (a value without the marker is returned unchanged by `decompressFromStorage`).

- [ ] **Step 5: Commit**

```bash
git add src/persistence/storage.ts src/persistence/storage.test.ts
git commit -m "feat(persistence): decompress marker-tagged saves on load (#397)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `createDebouncedSave` surfaces save failures

**Files:**
- Modify: `src/persistence/storage.ts` (`createDebouncedSave`, currently lines 97-150)
- Test: `src/persistence/storage.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the `createDebouncedSave` describe block in `src/persistence/storage.test.ts`:

```ts
    it('invokes onSaveFailed when a flushed save fails', () => {
        const onSaveFailed = vi.fn();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const setItemSpy = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('quota', 'QuotaExceededError');
            });

        const { save } = createDebouncedSave(onSaveFailed);
        save(makeGameState());
        vi.advanceTimersByTime(500);

        expect(onSaveFailed).toHaveBeenCalledOnce();
        setItemSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('does not invoke onSaveFailed on a successful save', () => {
        const onSaveFailed = vi.fn();
        const { save } = createDebouncedSave(onSaveFailed);

        save(makeGameState());
        vi.advanceTimersByTime(500);

        expect(onSaveFailed).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/persistence/storage.test.ts`
Expected: FAIL — `createDebouncedSave` takes no argument, so `onSaveFailed` is never called.

- [ ] **Step 3: Implement the callback**

In `src/persistence/storage.ts`, change the `createDebouncedSave` signature and its `flushPending` body.

Change the signature line from:

```ts
export function createDebouncedSave(): {
```

to:

```ts
export function createDebouncedSave(onSaveFailed?: () => void): {
```

And update the function's doc comment to mention: `onSaveFailed` is invoked when a flushed save cannot be persisted (quota exceeded even after compression).

Replace the `flushPending` function body:

```ts
    function flushPending(): void {
        if (pendingState !== null) {
            saveState(pendingState, pendingSelection ?? []);
            pendingState = null;
            pendingSelection = null;
        }
    }
```

with:

```ts
    function flushPending(): void {
        if (pendingState !== null) {
            const result = saveState(pendingState, pendingSelection ?? []);
            pendingState = null;
            pendingSelection = null;
            if (result === 'failed') {
                onSaveFailed?.();
            }
        }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/persistence/storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/storage.ts src/persistence/storage.test.ts
git commit -m "feat(persistence): report save failures from debounced saver (#397)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Export `SaveResult`

**Files:**
- Modify: `src/persistence/index.ts`

- [ ] **Step 1: Add the type export**

In `src/persistence/index.ts`, add `SaveResult` to the type re-exports from `./storage.js`. Change:

```ts
export {
    saveState,
    loadState,
    loadSavedGame,
    clearSavedState,
    createDebouncedSave,
    STORAGE_KEY,
    SAVE_DEBOUNCE_MS,
} from './storage.js';
```

to additionally export the type (a separate `export type` line keeps it valid under `verbatimModuleSyntax`):

```ts
export {
    saveState,
    loadState,
    loadSavedGame,
    clearSavedState,
    createDebouncedSave,
    STORAGE_KEY,
    SAVE_DEBOUNCE_MS,
} from './storage.js';
export type { SaveResult } from './storage.js';
```

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/persistence/index.ts
git commit -m "feat(persistence): export SaveResult type (#397)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Wire the failure toast in `main.ts`

**Files:**
- Modify: `src/main.ts:602` (the `createDebouncedSave()` call) and add a notifier near it.

No unit test: `main.ts` is the untested composition root (consistent with the rest of the file). Verified via `tsc`, the full suite, and the manual check in Task 8.

- [ ] **Step 1: Add a deduped notifier and pass it to `createDebouncedSave`**

In `src/main.ts`, replace:

```ts
const debouncedSave = createDebouncedSave();
```

with:

```ts
// Surface a save failure (quota exceeded even after compression) once, then
// suppress repeats for a while so the debounced save loop can't spam toasts.
let lastSaveFailedToastAt = 0;
function notifySaveFailed(): void {
    const now = Date.now();
    if (now - lastSaveFailedToastAt < 10_000) {
        return;
    }
    lastSaveFailedToastAt = now;
    showToast("This puzzle is too large to save — your progress won't be kept across reloads.");
}

const debouncedSave = createDebouncedSave(notifySaveFailed);
```

(`showToast` is already imported in `main.ts`.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(app): toast when a puzzle is too large to save (#397)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Type-check and build**

Run: `npm run build`
Expected: `tsc` clean, Vite build succeeds.

- [ ] **Step 3: Manual smoke test (the real bug)**

Run: `npm run dev`, open the app, then:
1. New Game → Composable, Tab style: Traced, 192 pieces (16×12), Blank image.
2. Wait for generation. Open DevTools console — there should be **no** uncaught `QuotaExceededError`, and **no** save-failed toast.
3. In the console: `localStorage.getItem('puzzle-game-state').charCodeAt(0)` — expect `1` (the U+0001 marker), confirming the compressed fallback was used.
4. Reload the page — the same 192-piece traced puzzle restores (it does **not** regenerate as a fresh/Classic puzzle).
5. Sanity: a small 48-piece Classic puzzle still saves as plain JSON — `localStorage.getItem('puzzle-game-state')[0]` is `{`.

- [ ] **Step 4: Confirm no help-text change is needed**

Per `CLAUDE.md`, this is a bug fix plus an error-path toast — no new feature, gesture, cut style, or setting — so the info modal (`src/ui/info-modal.ts`) does not need updating. Confirm by skimming the modal's How to Play / Settings sections; make no change.

---

## Self-review notes

- **Spec coverage:** write guard (Task 3), compress-on-overflow (Tasks 2–3), marker decompress on load + backward-compat (Task 4), toast wiring + dedupe (Task 7), `lz-string` runtime dep (Task 1), no `STATE_VERSION` bump (Task 4 — marker-based), tests incl. round-trip/overflow/failure/backward-compat (Tasks 2–5), help-text decision (Task 8). All covered.
- **Type consistency:** `SaveResult` (`'ok' | 'ok-compressed' | 'failed'`), `compressForStorage`/`decompressFromStorage`/`COMPRESSED_MARKER`, and `createDebouncedSave(onSaveFailed?)` are used identically across tasks.
- **Reproducibility contract:** untouched — full geometry is still stored (compressed), so share links and the PRNG call-count contract are unaffected.
