# Boot New-Game Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the boot path's new-game start fails, recover with a playable last-resort puzzle instead of leaving a dead app ([#488](https://github.com/adrianschmidt/puzzle/issues/488)).

**Architecture:** The traced-tab decision moves out of `src/main.ts` into a pure, testable module (`src/app/traced-tab-plan.ts`), which grows a `bootFallback` mode that forces the legacy Classic cut and never fetches the lazy chunk. A second new module (`src/app/start-with-boot-fallback.ts`) orchestrates try-preferred → report → start-fallback → toast, so the only thing left in `main.ts` is wiring. `startNewGame`'s eleven positional parameters become an options object so the new flag reads clearly at the call site.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`), Vite, Vitest (node env by default; `@vitest-environment jsdom` per file where DOM is needed). No new dependencies.

## Global Constraints

- **American English in all code artifacts** — identifiers, comments, docs. (`color`, `behavior`, `initialize`.)
- **Test files live next to the source they test** — `foo.ts` → `foo.test.ts` in the same directory.
- **No new `random()` calls** anywhere in the generation path: the `generateProceduralPuzzle` PRNG call order is a reproducibility contract for every share link and save (`CLAUDE.md`). Nothing in this plan adds seeded randomness — the fallback uses the legacy Classic generator that already exists.
- **No info-modal help-text change.** This is an error path, not a feature a player needs explained; the modal's existing text stays correct.
- **Conventional commit messages** (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`).
- **The repo merges with rebase-and-merge only** — keep commits individually coherent.
- Run `npm test` (vitest) and `npx tsc --noEmit` before each commit. `noUnusedLocals` is on: an import left behind after a refactor is a **build error**, not a warning.
- Spec: `docs/superpowers/specs/2026-07-27-boot-new-game-fallback-design.md`.

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/app/traced-tab-plan.ts` | Pure traced-tab decision: what to do before the chunk fetch (`planTracedTabs`) and what its outcome means (`resolveTracedTabOutcome`). |
| `src/app/traced-tab-plan.test.ts` | Unit tests for both functions, including #486's Classic degradation (currently untested). |
| `src/app/start-with-boot-fallback.ts` | Boot-path orchestration: run the preferred start, report a failure, start the last-resort puzzle, toast the substitution. |
| `src/app/start-with-boot-fallback.test.ts` | Unit tests for all four orchestration outcomes. |

**Modified:**

| File | Change |
| --- | --- |
| `src/analytics/umami.ts` | `NewGameFailedData.phase`, `NewGameData.bootFallback`, and the documented pre-upgrade-tail query. |
| `src/app/run-with-error-report.ts` | `toastMessage` becomes optional; the `new-game-failed` variant carries `phase`. |
| `src/app/run-with-error-report.test.ts` | Two cases for the above. |
| `src/main.ts` | `startNewGame` takes an options object; consumes the plan module; the boot IIFE goes through `startWithBootFallback`. |

Task order matters: Task 4 (mechanical signature refactor) lands before Task 5 (new behavior) so a reviewer can judge each on its own.

---

### Task 1: The traced-tab decision as a pure module

**Files:**
- Create: `src/app/traced-tab-plan.ts`
- Test: `src/app/traced-tab-plan.test.ts`

**Interfaces:**
- Consumes: `cutStyleNeedsTracedTabs`, `CutStyle` from `src/game/cut-styles.ts` (existing).
- Produces: `planTracedTabs(opts: { cutStyle: CutStyle; tabGenerator?: string; bootFallback?: boolean }): TracedTabPlan` where `TracedTabPlan = { cutStyle: CutStyle; preloadChunk: boolean }`; `resolveTracedTabOutcome(opts: { cutStyle: CutStyle; bootFallback?: boolean; chunkError: unknown | null }): TracedTabOutcome`. Task 5 consumes both.

- [ ] **Step 1: Branch off `main`**

```bash
git checkout main && git pull --rebase
git checkout -b fix/boot-new-game-fallback
```

- [ ] **Step 2: Write the failing test**

Create `src/app/traced-tab-plan.test.ts`. No `@vitest-environment` pragma — these are pure functions and the vitest default (node) is correct; `cut-styles.ts` only touches `localStorage` inside functions, so importing it under node is safe.

```ts
import { describe, it, expect } from 'vitest';

import { planTracedTabs, resolveTracedTabOutcome } from './traced-tab-plan.js';

describe('planTracedTabs', () => {
    it('fetches the chunk for the styles that always use traced tabs', () => {
        expect(planTracedTabs({ cutStyle: 'classic' })).toEqual({ cutStyle: 'classic', preloadChunk: true });
        expect(planTracedTabs({ cutStyle: 'wavy' })).toEqual({ cutStyle: 'wavy', preloadChunk: true });
        expect(planTracedTabs({ cutStyle: 'triangles' })).toEqual({ cutStyle: 'triangles', preloadChunk: true });
    });

    it('skips the chunk for a style that never uses traced tabs', () => {
        expect(planTracedTabs({ cutStyle: 'fractal' })).toEqual({ cutStyle: 'fractal', preloadChunk: false });
    });

    it('follows the per-game tab generator for composable', () => {
        expect(planTracedTabs({ cutStyle: 'composable', tabGenerator: 'traced' }).preloadChunk).toBe(true);
        expect(planTracedTabs({ cutStyle: 'composable', tabGenerator: 'classic' }).preloadChunk).toBe(false);
        expect(planTracedTabs({ cutStyle: 'composable' }).preloadChunk).toBe(false);
    });

    it('forces legacy Classic and no chunk fetch for the boot fallback', () => {
        const styles = ['classic', 'wavy', 'triangles', 'fractal', 'composable'] as const;
        for (const cutStyle of styles) {
            expect(planTracedTabs({ cutStyle, tabGenerator: 'traced', bootFallback: true }))
                .toEqual({ cutStyle: 'classic', preloadChunk: false });
        }
    });
});

describe('resolveTracedTabOutcome', () => {
    const error = new Error('chunk boom');

    it('generates as requested when nothing failed', () => {
        expect(resolveTracedTabOutcome({ cutStyle: 'wavy', chunkError: null })).toEqual({ kind: 'ok' });
        expect(resolveTracedTabOutcome({ cutStyle: 'fractal', chunkError: null })).toEqual({ kind: 'ok' });
    });

    it('degrades Classic to the legacy cut when the fetch failed', () => {
        expect(resolveTracedTabOutcome({ cutStyle: 'classic', chunkError: error }))
            .toEqual({ kind: 'legacy-classic', degraded: true, error });
    });

    it('fails every other style when the fetch failed', () => {
        expect(resolveTracedTabOutcome({ cutStyle: 'wavy', chunkError: error })).toEqual({ kind: 'fail', error });
        expect(resolveTracedTabOutcome({ cutStyle: 'triangles', chunkError: error })).toEqual({ kind: 'fail', error });
        expect(resolveTracedTabOutcome({ cutStyle: 'composable', chunkError: error })).toEqual({ kind: 'fail', error });
    });

    it('reports the boot fallback as an undegraded legacy Classic', () => {
        expect(resolveTracedTabOutcome({ cutStyle: 'classic', bootFallback: true, chunkError: null }))
            .toEqual({ kind: 'legacy-classic', degraded: false });
    });
});
```

- [ ] **Step 3: Run the test and verify it fails**

Run: `npx vitest run src/app/traced-tab-plan.test.ts`
Expected: FAIL — cannot resolve `./traced-tab-plan.js`.

- [ ] **Step 4: Write the implementation**

Create `src/app/traced-tab-plan.ts`:

```ts
/**
 * The traced-tab decision for a *new* game, in the two halves it
 * naturally has: what to do before the lazy chunk fetch starts, and what
 * the fetch's outcome means once it settles.
 *
 * Extracted from `main.ts` because that file is not importable under
 * test, so every rule here — including the Classic degradation — was
 * previously unverifiable.
 *
 * Reproducing an existing save or share link is a different question and
 * does not go through here: those carry their own per-style config, and
 * a pre-upgrade Classic link or a legacy-tab Wavy link needs no chunk
 * even though the style declares `'always'`.
 */

import { cutStyleNeedsTracedTabs, type CutStyle } from '../game/cut-styles.js';

export interface TracedTabPlan {
    /** Cut style the game is actually generated with. */
    cutStyle: CutStyle;
    /** Whether to start the lazy traced-tab chunk fetch. */
    preloadChunk: boolean;
}

/**
 * Decide, before any fetch, which cut style to generate and whether the
 * traced-tab chunk is needed for it.
 *
 * `bootFallback` is the last-resort boot puzzle (#488): the boot path's
 * preferred start already failed, so this one forces the legacy Classic
 * cut and never touches the chunk. Forcing the style here rather than
 * trusting the caller is deliberate — a safety net that can be handed
 * `'wavy'` is not a safety net.
 */
export function planTracedTabs(opts: {
    cutStyle: CutStyle;
    tabGenerator?: string;
    bootFallback?: boolean;
}): TracedTabPlan {
    if (opts.bootFallback) {
        return { cutStyle: 'classic', preloadChunk: false };
    }
    return {
        cutStyle: opts.cutStyle,
        preloadChunk: cutStyleNeedsTracedTabs(opts.cutStyle, opts.tabGenerator),
    };
}

/**
 * What the settled chunk fetch means for generation.
 *
 * - `ok` — generate as requested.
 * - `legacy-classic` — Classic without its sine config, i.e. the legacy
 *   straight-grid cut. `degraded` separates "a fetch failed" (warn, and
 *   flag the analytics event) from "we never tried" (the boot fallback).
 * - `fail` — the style needs traced tabs and cannot be generated without
 *   them; the caller rethrows `error`.
 */
export type TracedTabOutcome =
    | { kind: 'ok' }
    | { kind: 'legacy-classic'; degraded: false }
    | { kind: 'legacy-classic'; degraded: true; error: unknown }
    | { kind: 'fail'; error: unknown };

export function resolveTracedTabOutcome(opts: {
    cutStyle: CutStyle;
    bootFallback?: boolean;
    chunkError: unknown | null;
}): TracedTabOutcome {
    if (opts.bootFallback) return { kind: 'legacy-classic', degraded: false };
    if (opts.chunkError === null) return { kind: 'ok' };
    // Classic is the only style whose generator works without the chunk,
    // so it degrades instead of failing the whole start. That is what
    // keeps the default style booting when the fetch fails.
    if (opts.cutStyle !== 'classic') return { kind: 'fail', error: opts.chunkError };
    return { kind: 'legacy-classic', degraded: true, error: opts.chunkError };
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npx vitest run src/app/traced-tab-plan.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/app/traced-tab-plan.ts src/app/traced-tab-plan.test.ts
git commit -m "refactor: extract the traced-tab decision into a testable module

The rule for when a new game needs the lazy traced-tab chunk, and what
a failed fetch means per cut style, lived inline in main.ts and was
therefore untested. Move it to src/app/traced-tab-plan.ts with the boot
fallback mode the recovery path needs.

Refs #488"
```

---

### Task 2: Optional toast and a `phase` field on `new-game-failed`

**Files:**
- Modify: `src/analytics/umami.ts:315-317` (`NewGameFailedData`)
- Modify: `src/app/run-with-error-report.ts:21-23`, `:32-49`, `:51-77`
- Test: `src/app/run-with-error-report.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ErrorReportEvent` gains `{ event: 'new-game-failed'; phase?: 'boot' | 'boot-fallback' }`; `runWithErrorReport`'s `toastMessage` becomes optional. Task 3 consumes both.

- [ ] **Step 1: Write the failing tests**

Append these two cases inside the existing `describe('runWithErrorReport', ...)` block in `src/app/run-with-error-report.test.ts`:

```ts
    it('skips the toast when no toastMessage is given', async () => {
        await runWithErrorReport({
            run: async () => {
                throw new Error('boom');
            },
            warnMessage: 'Failed to start new game:',
            event: 'new-game-failed',
            fallback: undefined,
        });

        expect(umamiTrack).toHaveBeenCalledWith('new-game-failed', { reason: 'boom' });
        expect(showToast).not.toHaveBeenCalled();
    });

    it('passes the phase through to new-game-failed', async () => {
        await runWithErrorReport({
            run: async () => {
                throw new Error('boom');
            },
            warnMessage: 'Boot fallback puzzle also failed to start:',
            event: 'new-game-failed',
            phase: 'boot-fallback',
            toastMessage: "Couldn't start a puzzle",
            fallback: undefined,
        });

        expect(umamiTrack).toHaveBeenCalledWith('new-game-failed', {
            reason: 'boom',
            phase: 'boot-fallback',
        });
    });
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/app/run-with-error-report.test.ts`
Expected: FAIL, both new cases. Vitest strips types, so these fail on behavior, not typing: the first because `toastMessage` is currently mandatory and `showToast(undefined)` is called anyway, the second because `phase` is ignored and `track` receives only `{ reason: 'boom' }`. `npx tsc --noEmit` additionally reports both as type errors.

- [ ] **Step 3: Add `phase` to the analytics type**

In `src/analytics/umami.ts`, replace `NewGameFailedData` (`:315-317`):

```ts
export interface NewGameFailedData {
    reason: string;
    /**
     * Which start attempt failed. Absent on the new-game dialog path,
     * where a rejection leaves the previous puzzle on screen and the
     * player can simply retry — so absence is also every event recorded
     * before this field existed.
     *
     * `'boot'` is the boot path's preferred start, the failure that used
     * to leave a dead app (#488); `'boot-fallback'` is the last-resort
     * Classic puzzle that recovers from it failing too. A single boot can
     * emit both, in that order — they are one incident, not two.
     */
    phase?: 'boot' | 'boot-fallback';
}
```

- [ ] **Step 4: Make the toast optional and carry the phase**

In `src/app/run-with-error-report.ts`, extend the import on `:12` to include the type:

```ts
import {
    track,
    sanitizeErrorReason,
    type SharedLoadFailedData,
    type NewGameFailedData,
} from '../analytics/index.js';
```

Replace the `ErrorReportEvent` union (`:21-23`):

```ts
export type ErrorReportEvent =
    | { event: 'shared-load-failed'; source: SharedLoadFailedData['source'] }
    | { event: 'new-game-failed'; phase?: NewGameFailedData['phase'] };
```

Replace the `new-game-failed` case in `trackReasonEvent` (`:34-36`):

```ts
        case 'new-game-failed': {
            // Build the payload rather than passing `phase` straight
            // through: an explicit `phase: undefined` would ship a hollow
            // property to Umami instead of no property, and the dialog
            // path's events must stay byte-identical to today's.
            const data: NewGameFailedData = { reason };
            if (report.phase) data.phase = report.phase;
            track(report.event, data);
            return;
        }
```

Replace the `toastMessage` declaration in the `runWithErrorReport` options (`:55`):

```ts
    /**
     * Message for the user-facing toast. Omit to stay silent — only for a
     * caller that shows its own message once a recovery attempt has
     * settled. `showToast` renders one toast at a time, so an eager
     * failure toast would be replaced by the recovery's message anyway,
     * and the intermediate flash reads as a contradiction.
     */
    toastMessage?: string;
```

And guard the call (`:74`):

```ts
        if (opts.toastMessage !== undefined) showToast(opts.toastMessage);
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run src/app/run-with-error-report.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. The pre-existing cases must still pass unchanged — in particular the one asserting `track` was called with exactly `{ reason, source }`.

- [ ] **Step 6: Commit**

```bash
git add src/analytics/umami.ts src/app/run-with-error-report.ts src/app/run-with-error-report.test.ts
git commit -m "feat: let runWithErrorReport skip its toast and carry a failure phase

A caller that recovers from the failure needs to report it without
toasting — its own message comes after the recovery settles, and only
one toast renders at a time. new-game-failed gains an optional phase so
a boot failure is separable from a dialog one.

Refs #488"
```

---

### Task 3: The boot-path orchestrator

**Files:**
- Create: `src/app/start-with-boot-fallback.ts`
- Test: `src/app/start-with-boot-fallback.test.ts`

**Interfaces:**
- Consumes: `runWithErrorReport` with `phase` and optional `toastMessage` (Task 2); `showToast` from `src/ui/toast.ts`.
- Produces: `startWithBootFallback(opts: { start: () => Promise<void>; startFallback: () => Promise<void>; hasGame: () => boolean }): Promise<void>`, plus the exported constants `FALLBACK_STARTED_TOAST` and `BOOT_FAILED_TOAST`. Task 6 consumes them.

- [ ] **Step 1: Write the failing test**

Create `src/app/start-with-boot-fallback.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../ui/toast.js', () => ({ showToast: vi.fn() }));

import { showToast } from '../ui/toast.js';
import {
    startWithBootFallback,
    FALLBACK_STARTED_TOAST,
    BOOT_FAILED_TOAST,
} from './start-with-boot-fallback.js';

describe('startWithBootFallback', () => {
    let umamiTrack: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
        vi.restoreAllMocks();
        vi.mocked(showToast).mockClear();
    });

    it('reports nothing and starts no fallback when the preferred start succeeds', async () => {
        const startFallback = vi.fn(async () => {});

        await startWithBootFallback({
            start: async () => {},
            startFallback,
            hasGame: () => true,
        });

        expect(startFallback).not.toHaveBeenCalled();
        expect(umamiTrack).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
    });

    it('starts the fallback puzzle and explains the substitution', async () => {
        const startFallback = vi.fn(async () => {});

        await startWithBootFallback({
            start: async () => {
                throw new Error('chunk boom at https://cdn.example/x.js');
            },
            startFallback,
            hasGame: () => false,
        });

        expect(startFallback).toHaveBeenCalledTimes(1);
        expect(umamiTrack).toHaveBeenCalledTimes(1);
        expect(umamiTrack).toHaveBeenCalledWith('new-game-failed', {
            reason: 'chunk boom at <url>',
            phase: 'boot',
        });
        expect(showToast).toHaveBeenCalledTimes(1);
        expect(showToast).toHaveBeenCalledWith(FALLBACK_STARTED_TOAST);
    });

    it('leaves a puzzle that did reach the screen alone', async () => {
        const startFallback = vi.fn(async () => {});

        await startWithBootFallback({
            start: async () => {
                throw new Error('late boom');
            },
            startFallback,
            hasGame: () => true,
        });

        expect(startFallback).not.toHaveBeenCalled();
        expect(umamiTrack).toHaveBeenCalledWith('new-game-failed', {
            reason: 'late boom',
            phase: 'boot',
        });
        expect(showToast).not.toHaveBeenCalled();
    });

    it('reports both failures and still resolves when the fallback fails too', async () => {
        await startWithBootFallback({
            start: async () => {
                throw new Error('first');
            },
            startFallback: async () => {
                throw new Error('second');
            },
            hasGame: () => false,
        });

        expect(umamiTrack).toHaveBeenCalledTimes(2);
        expect(umamiTrack).toHaveBeenNthCalledWith(1, 'new-game-failed', {
            reason: 'first',
            phase: 'boot',
        });
        expect(umamiTrack).toHaveBeenNthCalledWith(2, 'new-game-failed', {
            reason: 'second',
            phase: 'boot-fallback',
        });
        expect(showToast).toHaveBeenCalledTimes(1);
        expect(showToast).toHaveBeenCalledWith(BOOT_FAILED_TOAST);
    });
});
```

The last case's "still resolves" matters: the boot IIFE awaits this call inside a `try`/`finally` that hides the loading overlay. A rejection here would skip nothing (the `finally` still runs) but would surface as an unhandled rejection, which is the reporting hole this whole change closes.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/app/start-with-boot-fallback.test.ts`
Expected: FAIL — cannot resolve `./start-with-boot-fallback.js`.

- [ ] **Step 3: Write the implementation**

Create `src/app/start-with-boot-fallback.ts`:

```ts
/**
 * Boot-path safety net for starting a new game.
 *
 * The boot flow has no user standing in front of it: if its
 * `startNewGame` rejects there is no previous puzzle to fall back to and
 * no dialog to retry from, so the app is left with an unassigned
 * `gameState`, an empty canvas, and a New Game button that throws on
 * click (#488). This runs the preferred start, reports a failure, and
 * then starts a last-resort puzzle that cannot depend on the lazy chunk.
 *
 * Extracted from `main.ts` so the outcomes are unit-testable.
 */

import { runWithErrorReport } from './run-with-error-report.js';
import { showToast } from '../ui/toast.js';

/** Shown once the last-resort puzzle is actually on screen. */
export const FALLBACK_STARTED_TOAST = "Couldn't start your usual puzzle — started a Classic one";

/** Shown when even the last-resort puzzle failed and the app is stuck. */
export const BOOT_FAILED_TOAST = "Couldn't start a puzzle — try reloading";

export async function startWithBootFallback(opts: {
    /** Start the puzzle the player's preferences ask for. */
    start: () => Promise<void>;
    /** Start the last-resort puzzle: legacy Classic, no lazy chunk. */
    startFallback: () => Promise<void>;
    /** Whether a puzzle made it onto the screen. */
    hasGame: () => boolean;
}): Promise<void> {
    const started = await runWithErrorReport({
        run: async () => {
            await opts.start();
            return true;
        },
        warnMessage: 'Failed to start the boot puzzle:',
        event: 'new-game-failed',
        phase: 'boot',
        // No toast: the message the player gets depends on whether the
        // recovery below works, and only one toast renders at a time.
        fallback: false,
    });
    if (started) return;

    // A rejection *after* `initGame` — say a throw while fitting the
    // view — leaves the player with the puzzle they asked for. Replacing
    // it with a Classic one would be the regression, not the fix. The
    // failure is still reported above.
    if (opts.hasGame()) return;

    const recovered = await runWithErrorReport({
        run: async () => {
            await opts.startFallback();
            return true;
        },
        warnMessage: 'Boot fallback puzzle also failed to start:',
        event: 'new-game-failed',
        phase: 'boot-fallback',
        toastMessage: BOOT_FAILED_TOAST,
        fallback: false,
    });
    // Deliberately after the fallback settles: the player reads
    // "started a Classic one" only once that is true.
    if (recovered) showToast(FALLBACK_STARTED_TOAST);
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/app/start-with-boot-fallback.test.ts && npx tsc --noEmit`
Expected: PASS (4 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/start-with-boot-fallback.ts src/app/start-with-boot-fallback.test.ts
git commit -m "feat: add the boot-path new-game fallback orchestrator

Runs the preferred start, reports a rejection as new-game-failed with
phase 'boot', and starts a last-resort puzzle when nothing reached the
screen. Not yet wired into main.ts.

Refs #488"
```

---

### Task 4: `startNewGame` takes an options object

**Files:**
- Modify: `src/main.ts:1003-1015` (signature), `:513-523`, `:574-585`, `:1303-1317`, `:1826-1838` (call sites)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `startNewGame(gridSize: GridSize, options?: StartNewGameOptions): Promise<void>` with `StartNewGameOptions = { cutStyle?, composableConfig?, imageSource?, imageCategory?, fractalConfig?, wavyConfig?, vibrant?, rotationEnabled?, seed?, pickedImage? }`. Task 5 adds `bootFallback` to it; Task 6 calls it twice.

This task is a **pure refactor — no behavior change**. Eleven positional parameters do not survive a twelfth flag legibly: the fallback call site would pad ten `undefined`s around the one argument that matters.

- [ ] **Step 1: Replace the signature**

In `src/main.ts`, replace the parameter list at `:1003-1015` (and the two `@param` lines in the JSDoc block above it) with:

```ts
interface StartNewGameOptions {
    /** Cut style for piece generation. Defaults to Classic. */
    cutStyle?: CutStyle;
    composableConfig?: import('./puzzle/composable-generator.js').ComposableConfig;
    imageSource?: string;
    imageCategory?: string;
    fractalConfig?: FractalDialogConfig;
    wavyConfig?: WavyDialogConfig;
    vibrant?: boolean;
    rotationEnabled?: boolean;
    seed?: number;
    pickedImage?: CandidateImage;
}

/**
 * Start a new game. Uses the player-picked photo when one is given;
 * otherwise fetches a random Unsplash image if available. Falls back to
 * the default image if the API key is missing or fetch fails.
 *
 * @param gridSize - Grid dimensions (cols × rows) for the puzzle
 * @param options - Per-game choices; see {@link StartNewGameOptions}
 */
async function startNewGame(
    gridSize: GridSize,
    options: StartNewGameOptions = {},
): Promise<void> {
    const {
        cutStyle = 'classic',
        composableConfig,
        imageSource,
        imageCategory,
        fractalConfig,
        wavyConfig,
        vibrant = false,
        rotationEnabled = false,
        seed,
        pickedImage,
    } = options;
```

The destructured names match the old parameter names exactly, so **the body needs no other edit in this task**.

- [ ] **Step 2: Update the `__startVennPuzzle` call site (`:513`)**

```ts
    void startNewGame({ cols: 1, rows: 1 }, {
        cutStyle: 'composable',
        composableConfig: {
            baseCutGenerator: 'venn',
            baseCutConfig,
            tabGenerator: overrides?.tabs ? 'classic' : 'none',
            tabConfig: {},
        },
        imageSource: 'blank',
    });
```

- [ ] **Step 3: Update the `__newComposableGame` call site (`:574`)**

```ts
    void startNewGame({ cols, rows }, {
        cutStyle: 'composable',
        composableConfig: config,
        imageSource: overrides?.imageSource ?? loadImageSourcePreference(),
        imageCategory: loadImageCategoryPreference(),
        vibrant: loadVibrantPreference(),
        rotationEnabled: rotation !== 'none',
        seed: overrides?.seed,
    });
```

- [ ] **Step 4: Update the new-game dialog call site (`:1303`)**

```ts
                const newGame = startNewGame(toGridSize(option), {
                    cutStyle,
                    composableConfig: composableConfig
                        ? composableSliderToGeneratorConfig(composableConfig)
                        : undefined,
                    imageSource: imageChoice.kind === 'blank' ? 'blank' : 'random',
                    imageCategory,
                    fractalConfig,
                    wavyConfig,
                    vibrant,
                    rotationEnabled,
                    // seed omitted — fresh random for every dialog game
                    pickedImage: imageChoice.kind === 'photo' ? imageChoice.photo : undefined,
                });
```

- [ ] **Step 5: Update the boot call site (`:1826`)**

```ts
        await startNewGame(toGridSize(option), {
            cutStyle: preferredCutStyle,
            composableConfig: preferredCutStyle === 'composable' && preferredComposable
                ? composableSliderToGeneratorConfig(preferredComposable)
                : undefined,
            imageSource: firstRun ? 'first-run' : loadImageSourcePreference(),
            imageCategory: loadImageCategoryPreference(),
            fractalConfig: preferredFractalConfig,
            wavyConfig: preferredWavyConfig,
            vibrant: loadVibrantPreference(),
            rotationEnabled: preferredRotationEnabled,
        });
```

- [ ] **Step 6: Verify nothing changed behaviorally**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; the full suite passes with the same test count as before this task. A missed positional argument shows up as a type error, since every field is named.

Then grep for stragglers — there must be exactly four call sites:

Run: `grep -n "startNewGame(" src/main.ts`
Expected: five hits — the declaration plus the four call sites above.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "refactor: give startNewGame an options object

Eleven positional parameters do not survive another flag legibly. No
behavior change; every call site passes the same values by name.

Refs #488"
```

---

### Task 5: Wire the plan module and `bootFallback` into `startNewGame`

**Files:**
- Modify: `src/main.ts` — the `StartNewGameOptions` interface and destructuring from Task 4, `:1038-1043` (preload), `:1104-1127` (outcome), `:1162-1164` (`generatorClassicConfig`), `:1212-1219` (analytics), and the `cut-styles.js` import block at `:80-85`
- Modify: `src/analytics/umami.ts` — `NewGameData`, and the pre-upgrade-tail query documented at `:69-70`

**Interfaces:**
- Consumes: `planTracedTabs`, `resolveTracedTabOutcome` from `src/app/traced-tab-plan.ts` (Task 1); `StartNewGameOptions` (Task 4).
- Produces: `StartNewGameOptions.bootFallback?: boolean`; `NewGameData.bootFallback?: boolean`. Task 6 passes the option.

- [ ] **Step 1: Add the option**

In `src/main.ts`, add to `StartNewGameOptions`:

```ts
    /**
     * Start the last-resort boot puzzle (#488): legacy Classic cut, lazy
     * traced-tab chunk never fetched, flagged in analytics. Overrides
     * `cutStyle` — see `planTracedTabs`.
     */
    bootFallback?: boolean;
```

and to the destructuring: `bootFallback = false,`.

Rename the destructured cut style so the planned one can take the name the body already uses:

```ts
        cutStyle: requestedCutStyle = 'classic',
```

- [ ] **Step 2: Import the plan module**

Add near the other `./app/` imports (`:127-133`):

```ts
import { planTracedTabs, resolveTracedTabOutcome } from './app/traced-tab-plan.js';
```

Then remove `cutStyleNeedsTracedTabs` from the `./game/cut-styles.js` import block at `:80-85` — `main.ts` no longer calls it, and `noUnusedLocals` makes a leftover import a build error. (`new-game-dialog.ts` still imports it; that file is untouched.)

- [ ] **Step 3: Replace the preload decision (`:1038-1043`)**

```ts
        // Traced tabs live in a lazy chunk. `planTracedTabs` decides
        // whether this start needs it and which cut style is actually
        // generated; the boot fallback forces legacy Classic and skips the
        // fetch entirely, so the recovery path cannot fail the same way the
        // start it is recovering from did.
        const { cutStyle, preloadChunk } = planTracedTabs({
            cutStyle: requestedCutStyle,
            tabGenerator: composableConfig?.tabGenerator,
            bootFallback,
        });

        // The dialog kicked off the preload when the user picked a traced
        // style, so this usually resolves instantly. Started here but
        // awaited further down, so on the paths that didn't go through the
        // dialog (the boot path, the __newComposableGame console hook) the
        // chunk fetch overlaps the image request — where there is one —
        // instead of running ahead of it. The first-run boot puzzle uses a
        // bundled image and so has nothing to overlap with; it just pays the
        // fetch under the overlay.
        //
        // The rejection is captured into a value rather than left floating:
        // an unawaited rejected promise would surface as an unhandled
        // rejection while the image loads. It is interpreted at the await
        // site below. `null` is the success sentinel there, so a rejection
        // reason that is itself falsy (`reject()`, `reject(null)`) has to be
        // defaulted to a real Error — otherwise it would read as success.
        const tracedTabsPreload = preloadChunk
            ? preloadTracedTabGenerator().then(
                () => null,
                (error: unknown) => error ?? new Error('Traced tab chunk failed to load'),
            )
            : null;
```

- [ ] **Step 4: Replace the outcome handling (`:1104-1127`)**

```ts
        // The traced-tab chunk fetch started before the image request;
        // collect its outcome now that the image has resolved. Before the
        // download report below, not after: a start that is about to throw
        // must not report an Unsplash "download" for a photo it discards.
        const tracedTabs = resolveTracedTabOutcome({
            cutStyle,
            bootFallback,
            chunkError: tracedTabsPreload ? await tracedTabsPreload : null,
        });
        if (tracedTabs.kind === 'fail') throw tracedTabs.error;
        if (tracedTabs.kind === 'legacy-classic' && tracedTabs.degraded) {
            // Degrading is quiet for the player by design, but not for us:
            // warn like every other failure channel in this file, and flag
            // the analytics event below so these games stay separable from
            // genuine pre-upgrade Classic traffic.
            diagnostics.warn(
                'Traced tab chunk failed to load; Classic fell back to the legacy cut:',
                tracedTabs.error,
            );
        }
```

- [ ] **Step 5: Stamp the Classic config from the outcome (`:1162-1164`)**

```ts
        // Every new Classic game uses the sine-based generator with traced
        // tabs at the current trace-set version — same stamping rationale as
        // generatorWavyConfig. A Classic game without this config falls back
        // to the legacy generator, so stamping it is what activates the
        // upgrade for fresh puzzles, and withholding it is what the
        // `legacy-classic` outcome means.
        const generatorClassicConfig = cutStyle === 'classic' && tracedTabs.kind === 'ok'
            ? { traceSetVersion: CURRENT_TRACE_SET_VERSION }
            : undefined;
```

- [ ] **Step 6: Flag the analytics payload (`:1212-1219`)**

Replace the `tracedChunkDegraded` block with:

```ts
        // Only Classic reaches here with a chunk error — every other style
        // threw above. Without this flag a degraded game is
        // indistinguishable from genuine pre-upgrade Classic traffic (both
        // are `classic` with no `traceSetVersion`), which is the metric that
        // decides when the legacy generator can be retired.
        if (tracedTabs.kind === 'legacy-classic' && tracedTabs.degraded) {
            data.tracedChunkDegraded = true;
        }
        // Same bucket, different cause: the boot fallback never fetched the
        // chunk, so it has no failure to record — but its game is legacy
        // geometry too and has to be excludable from that same query.
        if (bootFallback) {
            data.bootFallback = true;
        }
```

- [ ] **Step 7: Add `bootFallback` to `NewGameData`**

In `src/analytics/umami.ts`, add after `tracedChunkDegraded` (`:102`):

```ts
    /**
     * True when the boot path's preferred start failed and the app
     * recovered by starting a last-resort puzzle instead (#488): legacy
     * Classic cut, lazy chunk never fetched, every other preference kept.
     * The player's cut-style preference is untouched, so this is a
     * per-boot recovery and not a permanent switch — the next New Game
     * offers their style again.
     *
     * Never set on the dialog path: there a rejection leaves the previous
     * puzzle on screen and the player retries, so there is nothing to
     * substitute. The matching `new-game-failed { phase: 'boot' }` carries
     * why the preferred start failed; this flag counts the recoveries that
     * worked.
     *
     * Like `tracedChunkDegraded`, these games ran legacy geometry with no
     * `traceSetVersion`, so they must be excluded from the pre-upgrade-tail
     * query described above. Unlike it, the cause need not be the chunk at
     * all — a saved config the build cannot generate lands here too.
     */
    bootFallback?: boolean;
```

- [ ] **Step 8: Update the documented pre-upgrade-tail query (`:69-70`)**

Replace:

> So the query on `new-game-started` is: `cutStyle: 'classic'`, no `traceSetVersion`, not `tracedChunkDegraded` — then split on `source`.

with:

> So the query on `new-game-started` is: `cutStyle: 'classic'`, no `traceSetVersion`, neither `tracedChunkDegraded` nor `bootFallback` — then split on `source`.

Also extend the `tracedChunkDegraded` doc (`:85-91`) with a cross-reference sentence:

```
 * A boot fallback sets `bootFallback` instead — it never attempts the
 * fetch, so there is no failure to record.
```

- [ ] **Step 9: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, full suite green. If `tsc` reports `cutStyleNeedsTracedTabs` is declared but never read, Step 2's import removal was missed.

- [ ] **Step 10: Commit**

```bash
git add src/main.ts src/analytics/umami.ts
git commit -m "feat: add a bootFallback mode to startNewGame

Routes the traced-tab decision through traced-tab-plan and adds the
last-resort mode the boot recovery needs: legacy Classic cut, no chunk
fetch, flagged as bootFallback in new-game-started so those games stay
separable from genuine pre-upgrade Classic traffic. Not yet reachable.

Refs #488"
```

---

### Task 6: Wire the boot path and verify in a browser

**Files:**
- Modify: `src/main.ts:1811-1838` (the boot IIFE's fresh-start branch), imports

**Interfaces:**
- Consumes: `startWithBootFallback` (Task 3), `StartNewGameOptions.bootFallback` (Task 5).
- Produces: nothing — this is the last task.

- [ ] **Step 1: Import the orchestrator**

Add near the other `./app/` imports in `src/main.ts`:

```ts
import { startWithBootFallback } from './app/start-with-boot-fallback.js';
```

- [ ] **Step 2: Replace the boot start**

Replace the `await startNewGame(...)` call at the end of the boot IIFE's fresh-start branch (Task 4 left it as a single options-object call) with:

```ts
        const gridSize = toGridSize(option);
        const imageSource = firstRun ? 'first-run' : loadImageSourcePreference();
        const imageCategory = loadImageCategoryPreference();
        const vibrant = loadVibrantPreference();

        await startWithBootFallback({
            start: () => startNewGame(gridSize, {
                cutStyle: preferredCutStyle,
                composableConfig: preferredCutStyle === 'composable' && preferredComposable
                    ? composableSliderToGeneratorConfig(preferredComposable)
                    : undefined,
                imageSource,
                imageCategory,
                fractalConfig: preferredFractalConfig,
                wavyConfig: preferredWavyConfig,
                vibrant,
                rotationEnabled: preferredRotationEnabled,
            }),
            // Everything except the cut is kept: same size, image source,
            // category, vibrancy, rotation. The per-style configs are
            // deliberately dropped — with the style forced to Classic they
            // are dead weight, and a saved Composable config the build
            // cannot generate is one of the failures being recovered from.
            startFallback: () => startNewGame(gridSize, {
                bootFallback: true,
                imageSource,
                imageCategory,
                vibrant,
                rotationEnabled: preferredRotationEnabled,
            }),
            // `gameState` is genuinely undefined until `initGame` runs —
            // same assumption as the `gameState?.groups` guard above.
            hasGame: () => gameState !== undefined,
        });
```

- [ ] **Step 3: Verify the build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: no type errors, full suite green, build succeeds.

- [ ] **Step 4: Verify the recovery in a browser**

This is the only check that covers the `main.ts` wiring — the repo is vitest-only and `main.ts` is not importable under test.

1. `npm run dev`, open the app, and pick **Wavy** in the New Game dialog so the preference is saved.
2. DevTools → Network → **Block request URL** with the pattern `*traced-tab-generator*` (the module behind the lazy import at `traced-tab-loader.ts:172`).
3. In the console: `localStorage.clear()` then `localStorage.setItem('puzzle-cut-style', 'wavy')`. Reload.
4. Expect: **a playable Classic puzzle** (not a blank canvas), the toast *"Couldn't start your usual puzzle — started a Classic one"*, and a `Failed to start the boot puzzle:` warning in the console. Click New Game — the button must open the dialog rather than throw.
5. Reload again with the block still on: the fallback puzzle was persisted, so it loads from the save with no second failure.
6. Remove the block, click New Game: the dialog still has Wavy selected and starts a Wavy puzzle normally.

The Umami payloads are not checkable here — the analytics script does not load on `npm run dev`, and a `window.umami` stub cannot survive the reload that triggers the boot path. Those assertions live in `start-with-boot-fallback.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "fix: recover from a failed new-game start on boot

The boot IIFE had no catch: a rejected startNewGame left gameState
unassigned, an empty canvas, and a New Game button that threw on click.
Wavy, Triangles and a traced-tab Composable preference all hit that on a
chunk-load failure, as did any preference the build cannot generate.

Boot now reports the failure and starts a last-resort Classic puzzle,
keeping every other preference and the player's saved cut style.

Closes #488"
```

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin fix/boot-new-game-fallback
gh pr create --title "fix: recover from a failed new-game start on boot" --body "$(cat <<'EOF'
Closes #488

The boot IIFE (`src/main.ts`) is `try`/`finally` with no `catch`. When
`startNewGame` rejects there, `gameState` is never assigned: empty
canvas, and the New Game button's `isCompleted: () => gameState.completed`
throws on click. The player cannot recover without a reload, and it
reports only as a generic `unhandled-error`.

#486 covered Classic by degrading it to the legacy cut on a chunk-load
failure. Wavy, Triangles, and a `composable` preference with the Traced
tab generator still dead-ended — as did any non-chunk failure on that
path, such as a saved Composable config this build cannot generate.

## What this does

- Boot now runs through `startWithBootFallback`: report the failure, then
  start a last-resort puzzle — legacy Classic cut, lazy chunk never
  fetched — keeping size, image source/category, vibrancy and rotation.
  One toast, after that puzzle is on screen: *"Couldn't start your usual
  puzzle — started a Classic one"*.
- The cut-style preference is untouched, so the next New Game offers the
  player's style again and refetches the chunk.
- A failure *after* the puzzle reached the screen is reported but not
  substituted — no clobbering a working game.
- The traced-tab decision moved to `src/app/traced-tab-plan.ts`, giving
  #486's degradation rule its first unit coverage.
- `startNewGame` swapped eleven positional parameters for an options
  object (no behavior change).

## Analytics

`new-game-failed` gains `phase: 'boot' | 'boot-fallback'` (absent on the
dialog path); `new-game-started` gains `bootFallback: true` for recovered
games. Both are documented in `umami.ts`, including the extra exclusion
the pre-upgrade-tail query now needs.

## Testing

14 new unit tests across `traced-tab-plan.test.ts`,
`start-with-boot-fallback.test.ts`, and `run-with-error-report.test.ts`.
Verified in the browser with the chunk blocked in DevTools and a Wavy
preference saved: playable Classic puzzle, toast, working New Game
button, and the fallback puzzle surviving a reload.

Design: `docs/superpowers/specs/2026-07-27-boot-new-game-fallback-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01HNQ5xLMoDYnxtUDHNkvLJa
EOF
)"
```
