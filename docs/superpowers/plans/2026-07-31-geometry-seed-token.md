# Geometry Seed Token Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `saveProgress` from reading and memcmp-ing the whole (up to ~5.8 MB) geometry blob on every debounced flush, by recording the owning puzzle's seed in a small dedicated `localStorage` key when the geometry is written.

**Architecture:** A third key, `puzzle-geometry-seed`, holds the seed of the geometry currently at `puzzle-game-state`. It is a derived cache, never part of the save format: `saveGeometry` writes it after a successful geometry write, `clearSavedState` removes it, and a module-scope `storage` listener removes it when *another tab* touches the geometry key. `currentGeometrySeed()` reads the token when present and otherwise falls back to today's decode-the-blob path, backfilling the token afterward. One invariant governs it: **the token exists only while we believe it matches the geometry; anyone who sees evidence otherwise deletes it, and the next reader re-derives it.**

**Tech Stack:** TypeScript, Vite, Vitest (jsdom environment), `lz-string` via `src/persistence/compression.ts`.

## Global Constraints

- **Design doc:** `docs/superpowers/specs/2026-07-31-geometry-seed-token-design.md` — read it before starting.
- **All work lives in two files:** `src/persistence/storage.ts` and `src/persistence/storage.test.ts`. No other source file changes.
- **No save-format change.** No `STATE_VERSION` bump, no serialization change. A save with no token key must load and play exactly as before.
- **American English** in all identifiers, comments, and doc comments.
- **Test command:** `npx vitest run src/persistence/storage.test.ts` for the focused loop; `npm test` for the full suite before the final commit.
- **jsdom facts already verified — do not re-litigate:** `new StorageEvent('storage', { key, oldValue, newValue, storageArea: localStorage })` constructs and dispatches to a `window` listener, and a same-window `localStorage.setItem` does **not** fire a storage event. Both were probed against this repo's jsdom.
- **`decompressFromStorage` is spy-able** from inside `storage.ts` only because `storage.test.ts` starts with a hoisted `vi.mock('./compression.js', …)` pass-through. Use `vi.spyOn(compression, 'decompressFromStorage')` for decode counts, exactly as the existing test at `src/persistence/storage.test.ts:551` does.
- **Every new test uses a seed no other test uses.** `cachedGeometryRaw` is module-level state keyed on the raw geometry string, and it survives the `localStorage.clear()` in `beforeEach`. Two tests that write byte-identical geometry would share a memo entry, and a decode-count assertion would then pass or fail on test *order*. The seeds below are allocated in the `4900xx` range for exactly this reason — keep them unique, do not "tidy" them to small numbers.
- **Do not weaken the #404 guard.** `saveProgress` must still return `'skipped'` when the stored geometry belongs to a different puzzle, and only on a *confirmed* mismatch (absent / unreadable / seedless geometry still writes).
- **Commit style:** conventional commits; body ends with the repo's `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` and `Claude-Session:` trailers (copy them from `git log -1 --format=%B` on the branch's first commit).

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/persistence/storage.ts` | Owns all three localStorage keys and the cross-tab ownership invariant | Modify: add `GEOMETRY_SEED_KEY`, `recordGeometrySeed()`, the `storage` listener, rewrite `currentGeometrySeed()`, touch `saveGeometry` and `clearSavedState` |
| `src/persistence/storage.test.ts` | Behavioral tests for the above | Modify: correct one existing test, delete one superseded test, add the new suite |

`src/persistence/index.ts` is the module's public barrel. `GEOMETRY_SEED_KEY` is **not** exported from it — the token is an implementation detail of the storage layer, and no app code should read it. `storage.test.ts` imports it directly from `./storage.js`, which is how that file already imports everything.

---

### Task 1: Token key written on geometry save, read on the fast path

Delivers the whole mechanism except cross-tab invalidation, which Task 2 adds. After this task the guard is correct for everything the current code handles *except* another tab writing geometry — Task 1's tests cover the takeover only through the token-absent fallback.

**Files:**
- Modify: `src/persistence/storage.ts:3-10` (module doc), `29-35` (key constants), `110-142` (cache + `currentGeometrySeed`), `144-147` (`saveGeometry`), `319-325` (`clearSavedState`)
- Test: `src/persistence/storage.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, for Task 2:
  - `export const GEOMETRY_SEED_KEY = 'puzzle-geometry-seed'`
  - `function recordGeometrySeed(seed: number | undefined): void` — module-private; `undefined` removes the key.
  - `function currentGeometrySeed(): number | undefined` — module-private, signature unchanged.

- [ ] **Step 1: Write the failing tests**

Add `GEOMETRY_SEED_KEY` to the existing import from `./storage.js` at `src/persistence/storage.test.ts:28`. Then add this suite immediately after the existing `describe('saveProgress cross-tab guard (#404)', …)` block (which ends at line 580), so the two read together.

```ts
// Seeds here are unique per test on purpose: `cachedGeometryRaw` inside
// storage.ts memoizes on the raw geometry string and outlives localStorage.clear(),
// so byte-identical geometry in two tests would make a decode count depend on
// test order. See the plan's Global Constraints.
describe('geometry seed token (#490)', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks(); // reset the vi.mock'd decompressFromStorage call count
    });

    it('records the geometry seed on save so the guard need not decode', () => {
        saveNewPuzzle(makeGameState({ seed: 490001 }), []);
        expect(localStorage.getItem(GEOMETRY_SEED_KEY)).toBe('490001');
    });

    it('does not decode the geometry at all on repeated same-puzzle saves', () => {
        saveGeometry(makeGameState({ seed: 490002 }));
        const spy = vi.spyOn(compression, 'decompressFromStorage');

        saveProgress(makeGameState({ seed: 490002 }), [1]);
        saveProgress(makeGameState({ seed: 490002 }), [2]);
        saveProgress(makeGameState({ seed: 490002 }), [3]);

        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('skips a mismatched save using the token, without decoding', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        saveNewPuzzle(makeGameState({ seed: 490003 }), []);
        const progressBefore = localStorage.getItem(PROGRESS_KEY);
        const decodeSpy = vi.spyOn(compression, 'decompressFromStorage');

        const result = saveProgress(makeGameState({ seed: 490004 }), [1]);

        expect(result).toBe('skipped');
        expect(localStorage.getItem(PROGRESS_KEY)).toBe(progressBefore);
        expect(decodeSpy).not.toHaveBeenCalled();
        decodeSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('falls back to decoding once, then backfills, for a save with no token', () => {
        // A save written before this change: geometry present, token absent.
        saveNewPuzzle(makeGameState({ seed: 490005 }), []);
        localStorage.removeItem(GEOMETRY_SEED_KEY);
        const spy = vi.spyOn(compression, 'decompressFromStorage');

        saveProgress(makeGameState({ seed: 490005 }), [1]); // miss → decode + backfill
        expect(spy).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(GEOMETRY_SEED_KEY)).toBe('490005');

        saveProgress(makeGameState({ seed: 490005 }), [2]); // token path → no decode
        saveProgress(makeGameState({ seed: 490005 }), [3]);
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });

    it('still detects a takeover when the token is absent', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        saveNewPuzzle(makeGameState({ seed: 490006 }), []);
        localStorage.removeItem(GEOMETRY_SEED_KEY);

        expect(saveProgress(makeGameState({ seed: 490007 }), [1])).toBe('skipped');
        warnSpy.mockRestore();
    });

    it('ignores a non-numeric token and re-derives from the geometry', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        saveNewPuzzle(makeGameState({ seed: 490008 }), []);
        localStorage.setItem(GEOMETRY_SEED_KEY, 'not-a-number');

        expect(saveProgress(makeGameState({ seed: 490009 }), [1])).toBe('skipped');
        expect(localStorage.getItem(GEOMETRY_SEED_KEY)).toBe('490008'); // re-derived
        warnSpy.mockRestore();
    });

    it('does not record a token when the geometry write failed', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        saveNewPuzzle(makeGameState({ seed: 490010 }), []); // this puzzle owns the slot

        // Both the plain and the compressed geometry write throw → 'failed'.
        const setItem = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation((key: string) => {
                if (key === STORAGE_KEY) throw new Error('quota');
                // saveGeometry writes nothing else, so no pass-through is needed.
            });
        const result = saveGeometry(makeGameState({ seed: 490011 }));
        setItem.mockRestore();
        warnSpy.mockRestore();

        expect(result).toBe('failed');
        // The slot still belongs to 490010, and the token must still say so.
        expect(localStorage.getItem(GEOMETRY_SEED_KEY)).toBe('490010');
    });

    it('falls back to decoding when the token write itself throws', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const realSetItem = localStorage.setItem.bind(localStorage);
        const setItem = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation((key: string, value: string) => {
                if (key === GEOMETRY_SEED_KEY) throw new Error('quota');
                realSetItem(key, value);
            });
        saveNewPuzzle(makeGameState({ seed: 490012 }), []);
        setItem.mockRestore();

        // No stale token left behind — a lie here would make this tab skip every
        // save for a puzzle it legitimately owns.
        expect(localStorage.getItem(GEOMETRY_SEED_KEY)).toBeNull();
        // And the guard still works, the slow way.
        expect(saveProgress(makeGameState({ seed: 490013 }), [1])).toBe('skipped');
        warnSpy.mockRestore();
    });

    it('clearSavedState removes the token along with the other keys', () => {
        saveNewPuzzle(makeGameState({ seed: 490014 }), []);
        clearSavedState();

        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(localStorage.getItem(PROGRESS_KEY)).toBeNull();
        expect(localStorage.getItem(GEOMETRY_SEED_KEY)).toBeNull();
    });
});
```

jsdom's `localStorage` methods live on `Storage.prototype`, which is why the two stubs above spy there rather than on the `localStorage` instance. The second captures the original with `.bind(localStorage)` **before** installing the spy, because it needs a working pass-through.

- [ ] **Step 2: Run the tests and confirm they fail for the right reason**

Run: `npx vitest run src/persistence/storage.test.ts -t "geometry seed token"`
Expected: FAIL. The first failure is an import error — `GEOMETRY_SEED_KEY` is not exported from `./storage.js`. That is the correct starting failure.

- [ ] **Step 3: Add the key constant and the recorder**

In `src/persistence/storage.ts`, after the `PROGRESS_KEY` declaration (line 32):

```ts
/**
 * localStorage key holding the seed of the geometry currently at
 * {@link STORAGE_KEY}, as a decimal string.
 *
 * Purely derived data — everything it holds is already inside the geometry
 * blob — so it is not part of the save format and needs no migration: absent,
 * non-numeric, or invalidated all fall back to decoding the blob (see
 * {@link currentGeometrySeed}). It exists so the per-flush cross-tab check in
 * {@link saveProgress} can read ~10 bytes instead of a blob that reaches
 * ~5.8 MB on a 16×12 composable puzzle (#490).
 *
 * The invariant: **the token exists only while we believe it matches the
 * geometry.** Anyone with evidence otherwise deletes it, and the next reader
 * re-derives it.
 */
export const GEOMETRY_SEED_KEY = 'puzzle-geometry-seed';
```

Then replace the cache comment and declarations at lines 110-118 — the existing "correctness comes from reading the real value on every call" note describes the behavior this change retires:

```ts
// Memo for the fallback path in `currentGeometrySeed`, keyed on the verbatim
// raw geometry string. Only reached when the token is missing; the token path
// never decodes.
let cachedGeometryRaw: string | null = null;
let cachedGeometrySeed: number | undefined;

/**
 * Record (or, for `undefined`, clear) the seed of the geometry now at
 * {@link STORAGE_KEY}.
 *
 * A failed write must not leave a stale token behind — that would claim the
 * slot belongs to a puzzle it doesn't, and this tab would then skip every
 * progress save for a puzzle it legitimately owns. So a throw falls back to
 * removing the key, which puts the next read on the decode path: slower, but
 * correct. If the removal throws too there is no in-process remedy, so say so.
 */
function recordGeometrySeed(seed: number | undefined): void {
    try {
        if (seed === undefined) {
            localStorage.removeItem(GEOMETRY_SEED_KEY);
        } else {
            localStorage.setItem(GEOMETRY_SEED_KEY, String(seed));
        }
    } catch {
        try {
            localStorage.removeItem(GEOMETRY_SEED_KEY);
        } catch (error) {
            diagnostics.warn(
                `Could not clear "${GEOMETRY_SEED_KEY}"; the cross-tab guard may ` +
                    'read a stale geometry seed until storage recovers:',
                error,
            );
        }
    }
}
```

- [ ] **Step 4: Rewrite `currentGeometrySeed` with the token fast path**

Replace `currentGeometrySeed` (lines 120-142). The fallback below is today's implementation verbatim, plus the backfill:

```ts
/**
 * Seed of the geometry currently in localStorage, or `undefined` if there is no
 * geometry, it cannot be decoded, or it carries no seed. Never throws.
 *
 * Answers from {@link GEOMETRY_SEED_KEY} when it is present — a ~10-byte read,
 * which matters because {@link saveProgress} calls this on every debounced
 * flush (#490). Otherwise decodes the blob and backfills the token, so a save
 * written before the token existed pays that cost once rather than on every
 * flush for the rest of the session.
 */
function currentGeometrySeed(): number | undefined {
    const token = localStorage.getItem(GEOMETRY_SEED_KEY);
    if (token !== null) {
        const seed = Number(token);
        // A non-numeric token is corruption, not an answer: fall through and
        // re-derive rather than trusting it.
        if (Number.isFinite(seed)) return seed;
    }

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
    // Backfill so the next flush takes the fast path. A seedless or unreadable
    // blob records nothing — there is no seed to claim, and leaving the token
    // absent keeps re-derivation honest if that blob is later replaced.
    if (cachedGeometrySeed !== undefined) recordGeometrySeed(cachedGeometrySeed);
    return cachedGeometrySeed;
}
```

- [ ] **Step 5: Record on geometry save, clear on wipe**

Replace `saveGeometry` (lines 144-147):

```ts
/**
 * Persist the static geometry + metadata blob. Written once per puzzle.
 *
 * Records the new owner in {@link GEOMETRY_SEED_KEY} only on a successful
 * write: when the write fails the *previous* puzzle's geometry is still in the
 * slot, and the existing token still describes it correctly.
 */
export function saveGeometry(state: GameState): SaveResult {
    const result = writeWithOverflow(STORAGE_KEY, JSON.stringify(serializeStatic(state)));
    if (result !== 'failed') recordGeometrySeed(state.seed);
    return result;
}
```

And add the third removal to `clearSavedState` (line 322):

```ts
export function clearSavedState(): void {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PROGRESS_KEY);
    localStorage.removeItem(GEOMETRY_SEED_KEY);
}
```

- [ ] **Step 6: Update the module doc comment**

The header at `src/persistence/storage.ts:3-10` says "Two-key model". Make it three:

```ts
/**
 * Persistence layer for puzzle game state.
 *
 * Three-key model:
 * - STORAGE_KEY       ('puzzle-game-state')    — static geometry + metadata, written once per puzzle.
 * - PROGRESS_KEY      ('puzzle-progress')      — small mutable blob (groups/selection/completed),
 *                                                written on every debounced save.
 * - GEOMETRY_SEED_KEY ('puzzle-geometry-seed') — derived cache: the seed of the geometry above, so
 *                                                the cross-tab guard need not decode it (#490).
 *
 * The first two are the save; the third is rebuildable from the first and is
 * not part of the save format.
 *
 * All serialization/deserialization goes through the serialization module.
 */
```

- [ ] **Step 7: Run the new tests**

Run: `npx vitest run src/persistence/storage.test.ts -t "geometry seed token"`
Expected: PASS, all 9.

- [ ] **Step 8: Delete the superseded cache test and run the whole file**

Run: `npx vitest run src/persistence/storage.test.ts`
Expected: exactly one pre-existing failure —
`saveProgress cross-tab guard (#404) > does not re-decode the geometry on repeated same-puzzle saves (cache)` (line 551), which asserts `afterFirst === 1`. It now decodes zero times, because `saveGeometry` recorded the token. The new `'does not decode the geometry at all on repeated same-puzzle saves'` case supersedes it: **delete lines 551-567**, leaving every other test in that suite untouched.

If any *other* test fails, stop and report — nothing else was supposed to change.

Do not touch `'skips after a cross-tab geometry change (cache invalidation)'` (line 569) in this task. It passes here, because the in-process `saveGeometry` call it uses rewrites the token. Task 2 rewrites it to model a real other tab.

Re-run after the deletion. Expected: all PASS.

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/persistence/storage.ts src/persistence/storage.test.ts
git commit
```

Message: `perf(persistence): record the geometry owner seed instead of re-reading the blob`. Body: the per-flush multi-MB read it removes, the blob sizes from #487, and the token's derived-cache status (no migration). Include `Refs #490`.

---

### Task 2: Cross-tab invalidation via the `storage` event

**Files:**
- Modify: `src/persistence/storage.ts` (add the listener directly after `recordGeometrySeed`)
- Test: `src/persistence/storage.test.ts`

**Interfaces:**
- Consumes from Task 1: `GEOMETRY_SEED_KEY`, `recordGeometrySeed`, `currentGeometrySeed`.
- Produces: no new exports. The listener is a module-scope side effect.

**Why this is a separate task:** Task 1's token is only correct while every writer of `STORAGE_KEY` maintains it. Two tabs on one origin need not run the same build — `/puzzle/` and `/puzzle/dev/` share a `localStorage` (it is keyed by origin, not path), as does a tab left open across a deploy. A tab running older JS writes geometry and leaves the token pointing at the previous puzzle, and the #404 takeover goes undetected. The `storage` event is a browser primitive that fires regardless of what the other tab's JS knows, which is why it is the right backstop.

- [ ] **Step 1: Write the failing tests**

Add `serializeStatic` to the existing `./serialization.js` import at `src/persistence/storage.test.ts:27`. Then add the following inside the `describe('geometry seed token (#490)', …)` block from Task 1 — the helper first, then the tests.

```ts
    /** What another tab writing the geometry looks like from inside this one. */
    function otherTabWritesGeometry(seed: number): void {
        const raw = JSON.stringify(serializeStatic(makeGameState({ seed })));
        const oldValue = localStorage.getItem(STORAGE_KEY);
        localStorage.setItem(STORAGE_KEY, raw); // no token update: not our write
        window.dispatchEvent(
            new StorageEvent('storage', {
                key: STORAGE_KEY,
                oldValue,
                newValue: raw,
                storageArea: localStorage,
            }),
        );
    }

    it('drops the token when another tab writes the geometry', () => {
        saveNewPuzzle(makeGameState({ seed: 490020 }), []);
        expect(localStorage.getItem(GEOMETRY_SEED_KEY)).toBe('490020');

        otherTabWritesGeometry(490021);

        expect(localStorage.getItem(GEOMETRY_SEED_KEY)).toBeNull();
    });

    it('detects a takeover by a tab that does not maintain the token (#404)', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        saveNewPuzzle(makeGameState({ seed: 490022 }), []);
        expect(saveProgress(makeGameState({ seed: 490022 }), [1])).not.toBe('skipped');
        const progressBefore = localStorage.getItem(PROGRESS_KEY);

        otherTabWritesGeometry(490023);

        expect(saveProgress(makeGameState({ seed: 490022 }), [2])).toBe('skipped');
        expect(localStorage.getItem(PROGRESS_KEY)).toBe(progressBefore);
        warnSpy.mockRestore();
    });

    it('re-derives exactly once after a cross-tab write, then goes fast again', () => {
        saveNewPuzzle(makeGameState({ seed: 490024 }), []);
        otherTabWritesGeometry(490025);
        const spy = vi.spyOn(compression, 'decompressFromStorage');

        saveProgress(makeGameState({ seed: 490025 }), [1]); // decode + backfill
        saveProgress(makeGameState({ seed: 490025 }), [2]); // token path
        saveProgress(makeGameState({ seed: 490025 }), [3]);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(GEOMETRY_SEED_KEY)).toBe('490025');
        spy.mockRestore();
    });

    it('drops the token when another tab clears storage (null-key event)', () => {
        saveNewPuzzle(makeGameState({ seed: 490026 }), []);

        window.dispatchEvent(
            new StorageEvent('storage', { key: null, storageArea: localStorage }),
        );

        expect(localStorage.getItem(GEOMETRY_SEED_KEY)).toBeNull();
    });

    it('ignores storage events for unrelated keys', () => {
        saveNewPuzzle(makeGameState({ seed: 490027 }), []);

        window.dispatchEvent(
            new StorageEvent('storage', {
                key: 'some-other-app-key',
                newValue: 'x',
                storageArea: localStorage,
            }),
        );

        expect(localStorage.getItem(GEOMETRY_SEED_KEY)).toBe('490027');
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/persistence/storage.test.ts -t "geometry seed token"`
Expected: FAIL. `'drops the token when another tab writes the geometry'` gets `'490020'` instead of `null`, and `'detects a takeover by a tab that does not maintain the token'` gets a non-`'skipped'` result — that second one is the exact #404 regression this task exists to prevent.

- [ ] **Step 3: Register the listener**

In `src/persistence/storage.ts`, directly after `recordGeometrySeed`:

```ts
// A token is only correct while every writer of STORAGE_KEY maintains it, and
// two tabs on one origin need not be running the same build — `/puzzle/` and
// `/puzzle/dev/` share a localStorage (it is keyed by origin, not path), as
// does a tab left open across a deploy. A tab on older JS writes the geometry
// without touching the token, and the #404 takeover would go undetected. The
// `storage` event fires regardless of what that tab's JS knows, so it is the
// backstop: drop the token and let the next reader re-derive it from the blob.
//
// Storage events never fire in the window that made the change, so anything we
// receive is by definition another tab — no self-filtering needed, and our own
// removal cannot re-trigger us. That removal does fire an event in other tabs,
// but they ignore keys other than the geometry key, so there is no cascade.
//
// Registered here rather than wired from bootstrap.ts: this is a correctness
// mechanism, and one that degrades silently when a caller forgets to install it
// is worse than a module-scope side effect in the module owning the invariant.
if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event: StorageEvent) => {
        // `key === null` is how the spec reports another tab's localStorage.clear().
        if (event.key === STORAGE_KEY || event.key === null) {
            recordGeometrySeed(undefined);
        }
    });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/persistence/storage.test.ts -t "geometry seed token"`
Expected: PASS, all 14.

- [ ] **Step 5: Correct the remaining cross-tab test**

`'skips after a cross-tab geometry change (cache invalidation)'` (`src/persistence/storage.test.ts:569`, or wherever Task 1's deletion left it) fakes the other tab with an in-process `saveGeometry(…)` call — which under this model is a *same-tab* write that legitimately updates the token, so it would pass for the wrong reason. Replace the whole `it(…)` with:

```ts
    it('skips after another tab replaces the geometry', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        saveNewPuzzle(makeGameState({ seed: 490028 }), []);
        expect(saveProgress(makeGameState({ seed: 490028 }), [1])).not.toBe('skipped');

        // Another tab takes over: it writes the geometry key directly, and the
        // browser delivers us a storage event for it.
        const raw = JSON.stringify(serializeStatic(makeGameState({ seed: 490029 })));
        localStorage.setItem(STORAGE_KEY, raw);
        window.dispatchEvent(
            new StorageEvent('storage', {
                key: STORAGE_KEY,
                newValue: raw,
                storageArea: localStorage,
            }),
        );

        expect(saveProgress(makeGameState({ seed: 490028 }), [2])).toBe('skipped');
        warnSpy.mockRestore();
    });
```

That suite's imports now need `serializeStatic` too — already added in Step 1.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all PASS. If a test outside `src/persistence/` fails, stop and report it rather than adjusting it — nothing else was supposed to change.

- [ ] **Step 7: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add src/persistence/storage.ts src/persistence/storage.test.ts
git commit
```

Message: `fix(persistence): drop the geometry seed token when another tab writes geometry`. Body: the mixed-build tab case (dev/prod sharing an origin, a tab open across a deploy) and why the `storage` event is the backstop the token needs. Include `Refs #490`.

---

### Task 3: Pin the performance claim, and confirm no help-text change

The issue is a performance claim. Tasks 1–2 prove correctness; this pins the claim itself, so a future change cannot quietly reintroduce the read.

**Files:**
- Test: `src/persistence/storage.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–2. No new exports.

- [ ] **Step 1: Write the test**

Add to the `describe('geometry seed token (#490)', …)` block:

```ts
    it('never reads the geometry blob on a steady-state flush (#490)', () => {
        saveNewPuzzle(makeGameState({ seed: 490030 }), []);

        const getItem = vi.spyOn(Storage.prototype, 'getItem');
        saveProgress(makeGameState({ seed: 490030 }), [1]);
        saveProgress(makeGameState({ seed: 490030 }), [2]);

        // Two flushes, two ~10-byte reads, and the multi-MB blob untouched.
        expect(getItem.mock.calls.map(([key]) => key)).toEqual([
            GEOMETRY_SEED_KEY,
            GEOMETRY_SEED_KEY,
        ]);
        getItem.mockRestore();
    });
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/persistence/storage.test.ts -t "steady-state flush"`
Expected: PASS immediately — Tasks 1–2 already implement the behavior. This is a regression pin, not a driver. If it fails, the implementation reads more than it should: fix the implementation, not the assertion.

- [ ] **Step 3: Full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 4: Confirm no help-text change is needed**

`CLAUDE.md` requires the info modal to stay correct. This change alters no player-visible behavior — the same saves are written and skipped in the same situations, only more cheaply — so no copy should need touching.

Run: `grep -n "save\|Save\|storage\|Storage" src/ui/info-modal.ts`
Expected: nothing describing *when* a save is skipped or how storage is keyed. If something does, report it rather than editing on your own judgment.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/storage.test.ts
git commit
```

Message: `test(persistence): pin that a steady-state flush never reads the geometry blob`. Include `Refs #490`.

---

## Out of Scope

- Exporting `GEOMETRY_SEED_KEY` from `src/persistence/index.ts` — no app code should read the token.
- Populating the token from `loadSavedGame` — it stays read-only; the backfill in `currentGeometrySeed` already covers pre-existing saves.
- Any change to the save format, `STATE_VERSION`, serialization, `CorruptSaveData`, or analytics.
- Reducing the geometry blob's size (#487's territory).
