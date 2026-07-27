# main.ts Composition Root Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `src/main.ts` from 1939 lines to five (two CSS imports, one value import, one `bootstrap()` call) by moving its composition root into `src/app/bootstrap.ts` and its logic into 22 unit-tested modules.

**Architecture:** `gameState` and `cleanupDrag` — the two module globals that ~25 closures read and that have blocked every previous extraction — move into a `GameSession` that models the no-game state explicitly (closing #501). Extraction runs leaf-first: each task creates a module plus its test, rewires `main.ts` to call it, and deletes the inline original in the same commit, so `main.ts` compiles and shrinks monotonically. `bootstrap.ts` exports a function rather than running on import, so a test can import it without booting the app.

**Tech Stack:** TypeScript 7 (strict, `verbatimModuleSyntax`, `noUnusedLocals`), Vite 8, Vitest 4 with jsdom, no linter.

**Spec:** `docs/superpowers/specs/2026-07-27-main-composition-root-design.md`

## Global Constraints

These apply to every task. Do not restate them per task; do not violate them.

- **No behavior change.** This is a pure refactor. If a task tempts you to fix a bug, stop and report it instead. #500 is explicitly out of scope.
  - *Ruling (2026-07-27, pre-flight):* read as **no user-observable behavior change**. The one sanctioned exception is Task 18's info-modal Solve wiring, which receives the solve function as a dependency instead of looking up `window.__solvePuzzle` at click time. `bootstrap` always installs the hooks, so the button behaves identically. No other task may rely on this reading.
- **Every task's commit leaves `main.ts` compiling and smaller.** Create module + test, rewire `main.ts` to import it, delete the inline original — all one commit. Never leave the old copy behind "for now".
- **Type-only imports must use `import type`** — `verbatimModuleSyntax: true`.
- **Relative imports end in `.js`** even though the source is `.ts` (repo-wide convention).
- **`noUnusedLocals` / `noUnusedParameters` are on.** A leftover import from a deleted block fails the typecheck.
- **Test file sits next to its source:** `foo.ts` → `foo.test.ts`.
- **DOM tests need the pragma** as the first lines of the file:
  ```ts
  /**
   * @vitest-environment jsdom
   */
  ```
- **Toast interception:** `vi.mock('../ui/toast.js', () => ({ showToast: vi.fn() }))` at module top, before imports. This is the established repo pattern (`src/app/start-with-boot-fallback.test.ts`).
- **Analytics interception:** do **not** mock `track` — it is an overloaded function and mocking it is painful. Stub the underlying tracker instead, as the existing tests do:
  ```ts
  umamiTrack = vi.fn();
  (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
  ```
  Clean up with `delete (window as unknown as { umami?: unknown }).umami` in `afterEach`.
- **Code style:** 4-space indent, single quotes, semicolons, JSDoc block comments on exported symbols explaining *why*, matching the density of the code being moved. Move the existing explanatory comments along with the code they explain — they encode contracts, and several are the only record of a fix.
- **American English** in all identifiers and comments (`color`, `behavior`, `center`).
- **Verification gates for every task:** `npx vitest run <the new test file>` then `npx tsc` (tsconfig already sets `noEmit`). Both must pass before the commit step.
- **PRNG contract:** nothing in this plan may add, remove, or reorder a call reaching `createNewGame`. Share links and saves replay through it.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/test-helpers/fake-renderer.ts` | Shared `Renderer` fake for controller tests |
| `src/app/snap-tolerances.ts` | The one definition of "would a drop merge?" |
| `src/app/blank-canvas.ts` | White data-URL canvas at a given size |
| `src/app/generator-configs.ts` | Per-style generator config + trace-set stamping |
| `src/app/share-payload-to-init.ts` | Share payload → `InitOptions`; traced-chunk predicate |
| `src/app/completed-payload.ts` | `puzzle-completed` analytics payload |
| `src/app/new-game-payload.ts` | `new-game-started` payload, fresh and shared |
| `src/app/completion-presenter.ts` | Owns the completion overlay's hide handle |
| `src/app/viewport-fit.ts` | Gather-and-fit; the completion zoom + upright spin |
| `src/app/save-coordinator.ts` | Debounced save, failure toast dedup, flush listeners |
| `src/app/merge-result.ts` | Post-drop selection prune, z-reorder, win detection |
| `src/app/game-session.ts` | Owns game state + interaction teardown (#501) |
| `src/app/rotation-ui.ts` | Rotate buttons, rotate handle, snap position, visibility |
| `src/app/install-background-color.ts` | Background color state, picker, theme re-apply, adopt |
| `src/app/start-new-game.ts` | The fresh-game flow |
| `src/app/load-shared-puzzle.ts` | The share-link load flow |
| `src/app/new-game-flow.ts` | Dialog open, preference fan-out, start |
| `src/app/share-link-loader.ts` | Hash parsing, undecodable-link rescue, guard ownership |
| `src/app/boot-sequence.ts` | share > saved > fresh, corrupt-save gate, first-run |
| `src/app/global-handlers.ts` | Context menu, analytics/error init, timing buffer, version |
| `src/app/install-toolbar.ts` | The six toolbar buttons |
| `src/app/dev-hooks.ts` | The four `window.__*` console hooks |
| `src/app/bootstrap.ts` | The composition root |
| `src/main.ts` | Two CSS imports, one value import, one call |
| `src/main.test.ts` | Guard: `main.ts` holds nothing else |

---

### Task 1: Shared `Renderer` test fake

Every controller task needs to assert renderer calls without a real `SvgDomRenderer` (451 lines, DOM-heavy). `src/renderer/types.ts` already defines the `Renderer` port and it covers every method `main.ts` calls, so the fake implements that interface and nothing more.

**Files:**
- Create: `src/test-helpers/fake-renderer.ts`
- Test: none — it is a test helper, exercised by every task that follows

**Interfaces:**
- Consumes: `Renderer` from `src/renderer/types.ts`
- Produces: `createFakeRenderer(): FakeRenderer` where `FakeRenderer` is `Renderer` with every method a `vi.fn()`, plus `pieceIdAtPointResult` / `pieceIdFromTargetResult` fields the tests can set.

- [ ] **Step 1: Write the helper**

```ts
/**
 * Fake {@link Renderer} for app-layer tests.
 *
 * The app layer talks to the renderer through the `Renderer` port only, so a
 * fake made of spies is enough to assert what the layer asked for — no real
 * DOM, no `SvgDomRenderer`. Hit-test results are fields rather than spies
 * because callers read their value, not their call count.
 */

import { vi } from 'vitest';
import type { Renderer } from '../renderer/types.js';
import type { Point } from '../model/types.js';

export interface FakeRenderer extends Renderer {
    init: ReturnType<typeof vi.fn>;
    renderState: ReturnType<typeof vi.fn>;
    bringGroupToFront: ReturnType<typeof vi.fn>;
    setViewportTransform: ReturnType<typeof vi.fn>;
    enableViewportTransition: ReturnType<typeof vi.fn>;
    disableViewportTransition: ReturnType<typeof vi.fn>;
    setGroupDragging: ReturnType<typeof vi.fn>;
    flashMergePulse: ReturnType<typeof vi.fn>;
    setGroupSelected: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    /** Value returned by `pieceIdAtPoint`. */
    pieceIdAtPointResult: number | null;
    /** Value returned by `pieceIdFromTarget`. */
    pieceIdFromTargetResult: number | null;
}

export function createFakeRenderer(): FakeRenderer {
    const fake: FakeRenderer = {
        init: vi.fn(),
        renderState: vi.fn(),
        bringGroupToFront: vi.fn(),
        setViewportTransform: vi.fn(),
        enableViewportTransition: vi.fn(),
        disableViewportTransition: vi.fn(),
        setGroupDragging: vi.fn(),
        flashMergePulse: vi.fn(),
        setGroupSelected: vi.fn(),
        destroy: vi.fn(),
        pieceIdAtPointResult: null,
        pieceIdFromTargetResult: null,
        pieceIdAtPoint: (_point: Point) => fake.pieceIdAtPointResult,
        pieceIdFromTarget: (_target: EventTarget | null) => fake.pieceIdFromTargetResult,
    };
    return fake;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc`
Expected: no output (clean). If `Renderer` has gained a method, the object literal fails to satisfy the interface — add it as a `vi.fn()`.

- [ ] **Step 3: Commit**

```bash
git add src/test-helpers/fake-renderer.ts
git commit -m "test: add a shared Renderer fake for app-layer tests"
```

---

### Task 2: `snap-tolerances.ts` and `blank-canvas.ts`

Two leaves. `activeSnapTolerances` (`src/main.ts:880`) is the single definition of the merge thresholds, read by three consumers. The blank-canvas block is **currently duplicated** — `src/main.ts:1103-1114` and `:1589-1596` are the same code — so this task also dedupes it.

**Files:**
- Create: `src/app/snap-tolerances.ts`, `src/app/blank-canvas.ts`
- Test: `src/app/snap-tolerances.test.ts`, `src/app/blank-canvas.test.ts`
- Modify: `src/main.ts` — delete `activeSnapTolerances` (`:880-889`) and both canvas blocks; import instead

**Interfaces:**
- Consumes: `getActiveTolerance`, `getActiveRotationTolerance` from `../ui/index.js`; `SnapTolerances` from `../game/snap-proximity-rotation.js`; `GameState`, `Size` from `../model/types.js`
- Produces:
  ```ts
  export function activeSnapTolerances(state: GameState): SnapTolerances;
  export function createBlankImageDataUrl(size: Size): string;
  ```

- [ ] **Step 1: Write the failing tests**

`src/app/snap-tolerances.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeGameState } from '../test-helpers/fixtures.js';
import { getActiveTolerance, getActiveRotationTolerance } from '../ui/index.js';
import { activeSnapTolerances } from './snap-tolerances.js';

describe('activeSnapTolerances', () => {
    it('derives the position tolerance from image width, column count and cut style', () => {
        const state = makeGameState({
            imageSize: { width: 1200, height: 800 },
            gridSize: { cols: 12, rows: 8 },
            cutStyle: 'wavy',
        });

        expect(activeSnapTolerances(state)).toEqual({
            tolerancePx: getActiveTolerance(1200, 12, 'wavy'),
            rotationToleranceDeg: getActiveRotationTolerance(),
        });
    });

    it('passes an absent cut style through rather than defaulting it', () => {
        // The tolerance helper owns the default; substituting 'classic' here
        // would put the fallback in two places.
        const state = makeGameState({ cutStyle: undefined });

        expect(activeSnapTolerances(state).tolerancePx).toBe(
            getActiveTolerance(state.imageSize.width, state.gridSize.cols, undefined),
        );
    });
});
```

`src/app/blank-canvas.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { createBlankImageDataUrl } from './blank-canvas.js';

describe('createBlankImageDataUrl', () => {
    it('returns a PNG data URL', () => {
        expect(createBlankImageDataUrl({ width: 8, height: 4 })).toMatch(/^data:image\/png[;,]/);
    });

    it('renders at the requested dimensions', () => {
        // Geometry depends on the image's dimensions, so a blank canvas that
        // ignored the requested size would silently change the cut.
        const url = createBlankImageDataUrl({ width: 13, height: 7 });
        const canvas = document.createElement('canvas');
        canvas.width = 13;
        canvas.height = 7;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 13, 7);
        expect(url).toBe(canvas.toDataURL('image/png'));
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/snap-tolerances.test.ts src/app/blank-canvas.test.ts`
Expected: FAIL — "Failed to resolve import ./snap-tolerances.js" and the same for `./blank-canvas.js`.

- [ ] **Step 3: Write the implementations**

`src/app/snap-tolerances.ts`:

```ts
/**
 * The active snap tolerances for a state — the single definition of "would a
 * drop merge?" thresholds, shared by drop/commit merge detection and snap
 * proximity rotation so they can never drift apart.
 */

import type { GameState } from '../model/types.js';
import type { SnapTolerances } from '../game/snap-proximity-rotation.js';
import { getActiveTolerance, getActiveRotationTolerance } from '../ui/index.js';

export function activeSnapTolerances(state: GameState): SnapTolerances {
    return {
        tolerancePx: getActiveTolerance(
            state.imageSize.width,
            state.gridSize.cols,
            state.cutStyle,
        ),
        rotationToleranceDeg: getActiveRotationTolerance(),
    };
}
```

`src/app/blank-canvas.ts`:

```ts
/**
 * White image at a given pixel size, as a data URL.
 *
 * The "blank" puzzle has no photo, but generation still needs an image of a
 * definite size: geometry depends on the image's dimensions, not its pixels.
 * Used by the fresh-game path (matching the puzzle's orientation) and by the
 * share-link path (regenerating the sentinel at the recorded dimensions).
 */

import type { Size } from '../model/types.js';

export function createBlankImageDataUrl(size: Size): string {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.width, size.height);
    return canvas.toDataURL('image/png');
}
```

- [ ] **Step 4: Rewire `main.ts`**

1. Add imports next to the other `./app/` imports:
   ```ts
   import { activeSnapTolerances } from './app/snap-tolerances.js';
   import { createBlankImageDataUrl } from './app/blank-canvas.js';
   ```
2. Delete the `activeSnapTolerances` function (`:880-889`) including its JSDoc — it moved verbatim.
3. In `startNewGame`, replace the `if (imageSource === 'blank') { ... }` body's canvas lines with:
   ```ts
   if (imageSource === 'blank') {
       const blankSize = blankSizeForOrientation(orientation);
       imageUrl = createBlankImageDataUrl(blankSize);
       imageSize = blankSize;
       attribution = undefined;
   }
   ```
4. In `loadSharedPuzzle`, replace the `if (imageUrl === 'blank') { ... }` body with:
   ```ts
   if (imageUrl === 'blank') {
       imageUrl = createBlankImageDataUrl(imageSize);
   }
   ```
5. Remove the now-unused `getActiveTolerance` / `getActiveRotationTolerance` entries from the `./ui/index.js` import list. `noUnusedLocals` will tell you if you miss one.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/app/snap-tolerances.test.ts src/app/blank-canvas.test.ts && npx tsc`
Expected: both suites PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/snap-tolerances.ts src/app/snap-tolerances.test.ts \
        src/app/blank-canvas.ts src/app/blank-canvas.test.ts src/main.ts
git commit -m "refactor(app): extract snap tolerances and the blank canvas

The blank-canvas block existed twice in main.ts — once on the fresh-game
path, once on the share-link path. Extracting it dedupes them."
```

---

### Task 3: `generator-configs.ts`

The four `generatorXConfig` derivations (`src/main.ts:1175-1203`) encode the trace-set-version stamping rules. Withholding `classicConfig` *is* the `legacy-classic` outcome — that is what activates or withholds the sine-based Classic upgrade — and it currently has no test.

**Files:**
- Create: `src/app/generator-configs.ts`
- Test: `src/app/generator-configs.test.ts`
- Modify: `src/main.ts:1175-1203` → one call

**Interfaces:**
- Consumes: `CutStyle` from `../game/cut-styles.js`; `FractalDialogConfig`, `WavyDialogConfig` from `../ui/index.js`; `CURRENT_TRACE_SET_VERSION` from `../puzzle/composable/traces/trace-set-version.js`
- Produces:
  ```ts
  export interface GeneratorConfigs {
      fractalConfig?: { borderless: boolean };
      wavyConfig?: { borderless: boolean; traceSetVersion: number };
      trianglesConfig?: { traceSetVersion: number };
      classicConfig?: { traceSetVersion: number };
  }

  export function generatorConfigsForNewGame(opts: {
      cutStyle: CutStyle;
      fractalConfig?: FractalDialogConfig;
      wavyConfig?: WavyDialogConfig;
      /** True when traced tabs are available — `TracedTabOutcome.kind === 'ok'`. */
      tracedTabsOk: boolean;
  }): GeneratorConfigs;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { CURRENT_TRACE_SET_VERSION } from '../puzzle/composable/traces/trace-set-version.js';
import { generatorConfigsForNewGame } from './generator-configs.js';

describe('generatorConfigsForNewGame', () => {
    it('stamps the current trace-set version on a fresh Wavy game', () => {
        expect(generatorConfigsForNewGame({
            cutStyle: 'wavy',
            wavyConfig: { borderless: true },
            tracedTabsOk: true,
        })).toEqual({
            wavyConfig: { borderless: true, traceSetVersion: CURRENT_TRACE_SET_VERSION },
        });
    });

    it('defaults Wavy borderless to false when the dialog supplied no config', () => {
        const configs = generatorConfigsForNewGame({ cutStyle: 'wavy', tracedTabsOk: true });
        expect(configs.wavyConfig).toEqual({
            borderless: false,
            traceSetVersion: CURRENT_TRACE_SET_VERSION,
        });
    });

    it('stamps Triangles too', () => {
        expect(generatorConfigsForNewGame({ cutStyle: 'triangles', tracedTabsOk: true }))
            .toEqual({ trianglesConfig: { traceSetVersion: CURRENT_TRACE_SET_VERSION } });
    });

    it('stamps Classic when traced tabs loaded', () => {
        expect(generatorConfigsForNewGame({ cutStyle: 'classic', tracedTabsOk: true }))
            .toEqual({ classicConfig: { traceSetVersion: CURRENT_TRACE_SET_VERSION } });
    });

    it('withholds classicConfig when traced tabs failed, selecting the legacy cut', () => {
        // This omission IS the `legacy-classic` outcome: a Classic game without
        // classicConfig falls back to the legacy straight-grid generator.
        expect(generatorConfigsForNewGame({ cutStyle: 'classic', tracedTabsOk: false }))
            .toEqual({});
    });

    it('passes fractal borderless through regardless of cut style', () => {
        // Deliberately not gated on cutStyle — matches the behavior being moved.
        expect(generatorConfigsForNewGame({
            cutStyle: 'classic',
            fractalConfig: { borderless: true },
            tracedTabsOk: true,
        })).toEqual({
            fractalConfig: { borderless: true },
            classicConfig: { traceSetVersion: CURRENT_TRACE_SET_VERSION },
        });
    });

    it('stamps nothing for a Composable game', () => {
        expect(generatorConfigsForNewGame({ cutStyle: 'composable', tracedTabsOk: true }))
            .toEqual({});
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/generator-configs.test.ts`
Expected: FAIL — cannot resolve `./generator-configs.js`.

- [ ] **Step 3: Write the implementation**

Move the four derivations verbatim, each keeping its existing comment. Build the result by assigning only the defined keys, so `toEqual({})` holds rather than `{ wavyConfig: undefined }`:

```ts
export function generatorConfigsForNewGame(opts: {
    cutStyle: CutStyle;
    fractalConfig?: FractalDialogConfig;
    wavyConfig?: WavyDialogConfig;
    tracedTabsOk: boolean;
}): GeneratorConfigs {
    const configs: GeneratorConfigs = {};

    if (opts.fractalConfig) {
        configs.fractalConfig = { borderless: opts.fractalConfig.borderless };
    }

    // Every new Wavy game uses traced tabs at the current trace-set version.
    // Older saves/links carry their own (or no) version and are reproduced
    // verbatim elsewhere; this path only ever creates fresh puzzles, so
    // stamping the current version is always correct.
    if (opts.cutStyle === 'wavy') {
        configs.wavyConfig = {
            borderless: opts.wavyConfig?.borderless ?? false,
            traceSetVersion: CURRENT_TRACE_SET_VERSION,
        };
    }

    // Every new Triangles game uses traced tabs at the current trace-set
    // version — same stamping rationale as wavyConfig above.
    if (opts.cutStyle === 'triangles') {
        configs.trianglesConfig = { traceSetVersion: CURRENT_TRACE_SET_VERSION };
    }

    // Every new Classic game uses the sine-based generator with traced tabs at
    // the current trace-set version. A Classic game without this config falls
    // back to the legacy generator, so stamping it is what activates the
    // upgrade for fresh puzzles, and withholding it is what the
    // `legacy-classic` outcome means.
    if (opts.cutStyle === 'classic' && opts.tracedTabsOk) {
        configs.classicConfig = { traceSetVersion: CURRENT_TRACE_SET_VERSION };
    }

    return configs;
}
```

- [ ] **Step 4: Rewire `main.ts`**

Replace `:1175-1203` with:

```ts
const generatorConfigs = generatorConfigsForNewGame({
    cutStyle,
    fractalConfig,
    wavyConfig,
    tracedTabsOk: tracedTabs.kind === 'ok',
});
```

and spread it into the `createNewGame` options:

```ts
const state = createNewGame(imageUrl, imageSize, viewport, oriented, {
    cutStyle,
    composableConfig,
    ...generatorConfigs,
    rotationMode,
    seed,
});
```

Drop the now-unused `CURRENT_TRACE_SET_VERSION` import if nothing else in `main.ts` uses it (`loadSharedPuzzle` does not — it reads versions off the payload).

- [ ] **Step 5: Verify**

Run: `npx vitest run src/app/generator-configs.test.ts && npx tsc`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/generator-configs.ts src/app/generator-configs.test.ts src/main.ts
git commit -m "refactor(app): extract per-style generator config derivation

First test coverage for the trace-set stamping rules, including that
withholding classicConfig is what selects the legacy Classic cut."
```

---

### Task 4: `share-payload-to-init.ts`

Two pure functions from the share path: the traced-chunk predicate (`src/main.ts:1571-1580`) and the payload → `InitOptions` mapping (`:1606-1623`). The predicate is deliberately narrower than the config reconstruction — it checks `clf?.tv !== undefined` rather than `clf` truthiness, so a crafted link with a falsy `clf` is denied a chunk fetch it will never use.

**Files:**
- Create: `src/app/share-payload-to-init.ts`
- Test: `src/app/share-payload-to-init.test.ts`
- Modify: `src/main.ts` — `:1571-1580` and `:1606-1623`

**Interfaces:**
- Consumes: `SharePayload`, `shareCfToComposableConfig` from `../sharing/index.js`; `InitOptions` from `../game/init.js`
- Produces:
  ```ts
  export function needsTracedTabChunk(payload: SharePayload): boolean;
  export function shareInitOptions(payload: SharePayload): InitOptions;
  ```

- [ ] **Step 1: Write the failing test**

Build payloads as object literals typed `SharePayload`. Minimum shape: `{ v, s, c, i, is: [w, h], g: [cols, rows], r }` — read the type in `src/sharing/share-link.ts` for the exact required fields and copy a literal from `src/sharing/share-link.test.ts` as the base.

```ts
import { describe, it, expect } from 'vitest';
import type { SharePayload } from '../sharing/index.js';
import { needsTracedTabChunk, shareInitOptions } from './share-payload-to-init.js';

// Fill in the required fields by copying a decoded-payload literal from
// src/sharing/share-link.test.ts, then override per case.
function payload(overrides: Partial<SharePayload> = {}): SharePayload {
    return { /* base literal from share-link.test.ts */ ...overrides } as SharePayload;
}

describe('needsTracedTabChunk', () => {
    it('is true for a composable link asking for traced tabs', () => {
        expect(needsTracedTabChunk(payload({ cf: { tg: 'traced' } as never }))).toBe(true);
    });

    it('is true for a versioned Wavy link but false for a legacy one', () => {
        expect(needsTracedTabChunk(payload({ c: 'wavy', wf: { bl: false, tv: 1 } as never }))).toBe(true);
        expect(needsTracedTabChunk(payload({ c: 'wavy', wf: { bl: false } as never }))).toBe(false);
    });

    it('is true for every Triangles link', () => {
        expect(needsTracedTabChunk(payload({ c: 'triangles' }))).toBe(true);
    });

    it('is true for a Classic link carrying a trace-set version', () => {
        expect(needsTracedTabChunk(payload({ c: 'classic', clf: { tv: 1 } as never }))).toBe(true);
    });

    it('denies a chunk fetch to a crafted link whose clf is falsy', () => {
        // Narrower than the truthiness check the config reconstruction uses:
        // this link would never consume the chunk, so it must not fetch it.
        expect(needsTracedTabChunk(payload({ c: 'classic', clf: 0 as never }))).toBe(false);
    });

    it('is false for a plain Classic link', () => {
        expect(needsTracedTabChunk(payload({ c: 'classic' }))).toBe(false);
    });
});

describe('shareInitOptions', () => {
    it('carries seed, cut style and rotation mode through', () => {
        const options = shareInitOptions(payload({ c: 'wavy', s: 1234, r: 'free' }));
        expect(options.cutStyle).toBe('wavy');
        expect(options.seed).toBe(1234);
        expect(options.rotationMode).toBe('free');
    });

    it('reconstructs the per-style configs the payload carries', () => {
        const options = shareInitOptions(payload({
            c: 'wavy',
            wf: { bl: true, tv: 2 } as never,
        }));
        expect(options.wavyConfig).toEqual({ borderless: true, traceSetVersion: 2 });
    });

    it('omits configs the payload does not carry', () => {
        const options = shareInitOptions(payload({ c: 'classic' }));
        expect(options.classicConfig).toBeUndefined();
        expect(options.wavyConfig).toBeUndefined();
        expect(options.trianglesConfig).toBeUndefined();
        expect(options.composableConfig).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/share-payload-to-init.test.ts`
Expected: FAIL — cannot resolve `./share-payload-to-init.js`.

- [ ] **Step 3: Write the implementation**

Move both blocks verbatim, keeping the predicate's comment about the deliberate narrowness. `shareInitOptions` returns the same object literal `main.ts` passes today (`cutStyle`, `seed`, `rotationMode`, `fractalConfig`, `wavyConfig`, `trianglesConfig`, `classicConfig`, `composableConfig`), preserving the `payload.xx ? { ... } : undefined` shape of each.

- [ ] **Step 4: Rewire `main.ts`**

In `loadSharedPuzzle`:

```ts
if (needsTracedTabChunk(payload)) {
    await preloadTracedTabGenerator();
}
```

and

```ts
const state = createNewGame(
    imageUrl,
    imageSize,
    viewport,
    { cols: payload.g[0], rows: payload.g[1] },
    shareInitOptions(payload),
);
```

Remove the now-unused `shareCfToComposableConfig` import from `main.ts`.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/app/share-payload-to-init.test.ts && npx tsc`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/share-payload-to-init.ts src/app/share-payload-to-init.test.ts src/main.ts
git commit -m "refactor(app): extract share-payload decoding into init options"
```

---

### Task 5: `completed-payload.ts` and `new-game-payload.ts`

The three analytics payload builders (`src/main.ts:233-255`, `:1228-1271`, `:1651-1690`). These carry the flags that keep degraded games separable from genuine pre-upgrade traffic — the metric that decides when the legacy generator can be retired — and `umami.ts`'s doc comments are the operator-facing query spec, so a wrong flag here is a real defect.

**Files:**
- Create: `src/app/completed-payload.ts`, `src/app/new-game-payload.ts`
- Test: `src/app/completed-payload.test.ts`, `src/app/new-game-payload.test.ts`
- Modify: `src/main.ts` — all three blocks

**Interfaces:**
- Consumes: `NewGameData`, `PuzzleCompletedData` from `../analytics/index.js`; `classifyImageSource`, `resolveNewGameImageSource` from `./classify-image-source.js`; `traceSetVersionOf` from `./trace-set-version.js`; `Orientation` from `./orientation.js`; `CandidateImage` from `./unsplash-display-image.js`
- Produces:
  ```ts
  export function buildPuzzleCompletedData(
      state: GameState,
      cached: NewGameData | null,
  ): PuzzleCompletedData;

  export function buildFreshGameData(opts: {
      state: GameState;
      cutStyle: string;
      rotationMode: 'none' | 'quarter-turn' | 'free';
      orientation: Orientation;
      oriented: GridSize;
      imageSource?: string;
      imageCategory?: string;
      vibrant: boolean;
      pickedImage?: CandidateImage;
      chunkDegraded: boolean;
      bootFallback: boolean;
  }): NewGameData;

  export function buildSharedGameData(opts: {
      state: GameState;
      includesProgress: boolean;
      recipientHadSavedState: boolean;
      sharedColor: NonNullable<NewGameData['sharedColor']>;
  }): NewGameData;
  ```

- [ ] **Step 1: Write the failing tests**

`src/app/completed-payload.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeGameState } from '../test-helpers/fixtures.js';
import type { NewGameData } from '../analytics/index.js';
import { buildPuzzleCompletedData } from './completed-payload.js';

describe('buildPuzzleCompletedData', () => {
    it('derives geometry and style from state when nothing was cached', () => {
        // A resumed session has no cached NewGameData, so the event still has
        // to be useful from gameState alone.
        const state = makeGameState({
            cutStyle: 'triangles',
            rotationMode: 'free',
            gridSize: { cols: 5, rows: 3 },
        });

        const data = buildPuzzleCompletedData(state, null);

        expect(data.cutStyle).toBe('triangles');
        expect(data.rotationMode).toBe('free');
        expect(data.cols).toBe(5);
        expect(data.rows).toBe(3);
        expect(data.pieceCount).toBe(state.pieces.length);
    });

    it('defaults an absent cut style and rotation mode', () => {
        const data = buildPuzzleCompletedData(
            makeGameState({ cutStyle: undefined, rotationMode: undefined }),
            null,
        );
        expect(data.cutStyle).toBe('classic');
        expect(data.rotationMode).toBe('none');
    });

    it('lets cached fields win over the derived ones', () => {
        // The cached payload knows things state cannot recover — image source,
        // category, vibrancy.
        const cached = {
            source: 'fresh', cutStyle: 'wavy', rotationMode: 'none',
            orientation: 'landscape', cols: 9, rows: 9, pieceCount: 81,
            imageSource: 'unsplash', imageCategory: 'nature', vibrant: true,
        } as NewGameData;

        const data = buildPuzzleCompletedData(makeGameState({ cutStyle: 'classic' }), cached);

        expect(data.cutStyle).toBe('wavy');
        expect(data.imageCategory).toBe('nature');
        expect(data.vibrant).toBe(true);
    });
});
```

`src/app/new-game-payload.test.ts` — cover the flags that matter:

```ts
import { describe, it, expect } from 'vitest';
import { makeGameState } from '../test-helpers/fixtures.js';
import { buildFreshGameData, buildSharedGameData } from './new-game-payload.js';

function freshOpts(overrides = {}) {
    return {
        state: makeGameState({ cutStyle: 'classic' }),
        cutStyle: 'classic',
        rotationMode: 'none' as const,
        orientation: 'landscape' as const,
        oriented: { cols: 8, rows: 6 },
        imageSource: 'random',
        imageCategory: 'any',
        vibrant: false,
        chunkDegraded: false,
        bootFallback: false,
        ...overrides,
    };
}

describe('buildFreshGameData', () => {
    it('marks the source fresh and reports the oriented grid', () => {
        const data = buildFreshGameData(freshOpts({ oriented: { cols: 6, rows: 8 } }));
        expect(data.source).toBe('fresh');
        expect(data.cols).toBe(6);
        expect(data.rows).toBe(8);
    });

    it('flags a degraded traced-tab chunk', () => {
        // Without this flag a degraded game is indistinguishable from genuine
        // pre-upgrade Classic traffic — both are classic with no traceSetVersion.
        expect(buildFreshGameData(freshOpts({ chunkDegraded: true })).tracedChunkDegraded).toBe(true);
    });

    it('omits tracedChunkDegraded rather than setting it false', () => {
        // Absence cannot be filtered in Umami; the query subtracts on presence.
        expect('tracedChunkDegraded' in buildFreshGameData(freshOpts())).toBe(false);
    });

    it('flags a boot-fallback game', () => {
        expect(buildFreshGameData(freshOpts({ bootFallback: true })).bootFallback).toBe(true);
    });

    it('adds image fields only for an Unsplash photo', () => {
        const unsplash = makeGameState({ imageUrl: 'https://images.unsplash.com/photo-1' });
        const data = buildFreshGameData(freshOpts({
            state: unsplash, imageCategory: 'nature', vibrant: true,
        }));
        expect(data.imageSource).toBe('unsplash');
        expect(data.imageCategory).toBe('nature');
        expect(data.vibrant).toBe(true);
        expect(data.imagePicked).toBe(false);
    });

    it('reports imagePicked when the player chose a candidate', () => {
        const unsplash = makeGameState({ imageUrl: 'https://images.unsplash.com/photo-1' });
        const data = buildFreshGameData(freshOpts({
            state: unsplash,
            pickedImage: { imageUrl: 'x', imageSize: { width: 1, height: 1 } } as never,
        }));
        expect(data.imagePicked).toBe(true);
    });
});

describe('buildSharedGameData', () => {
    it('marks the source shared and reads geometry off the generated state', () => {
        const data = buildSharedGameData({
            state: makeGameState({ gridSize: { cols: 4, rows: 7 } }),
            includesProgress: true,
            recipientHadSavedState: false,
            sharedColor: 'adopted',
        });
        expect(data.source).toBe('shared');
        expect(data.cols).toBe(4);
        expect(data.rows).toBe(7);
        expect(data.includesProgress).toBe(true);
        expect(data.sharedColor).toBe('adopted');
    });

    it('derives orientation from the post-transpose grid, squares reading landscape', () => {
        // The link stores the post-transpose grid, matching orientGridSize's
        // normalization.
        expect(buildSharedGameData({
            state: makeGameState({ gridSize: { cols: 4, rows: 9 } }),
            includesProgress: false, recipientHadSavedState: false, sharedColor: 'none',
        }).orientation).toBe('portrait');

        expect(buildSharedGameData({
            state: makeGameState({ gridSize: { cols: 5, rows: 5 } }),
            includesProgress: false, recipientHadSavedState: false, sharedColor: 'none',
        }).orientation).toBe('landscape');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/completed-payload.test.ts src/app/new-game-payload.test.ts`
Expected: FAIL — unresolved imports.

- [ ] **Step 3: Write the implementations**

Move each block verbatim, including the long comments explaining why `traceSetVersion` is read off the generated state rather than the payload and why the flags are set rather than omitted. Keep the conditional-assignment shape (`if (x !== undefined) data.x = x`) — omitting a field is semantically different from setting it false, and `umami.ts` documents queries that depend on it.

- [ ] **Step 4: Rewire `main.ts`**

- `buildPuzzleCompletedData(state)` → `buildPuzzleCompletedData(state, currentGameAnalytics)`; delete the local function (`:233-255`).
- In `startNewGame`, replace `:1228-1271` with a `buildFreshGameData({ ... })` call, then `currentGameAnalytics = data; track('new-game-started', data);`.
- In `loadSharedPuzzle`, replace `:1661-1690` with `buildSharedGameData({ ... })`.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/app/completed-payload.test.ts src/app/new-game-payload.test.ts && npx tsc`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/completed-payload.ts src/app/completed-payload.test.ts \
        src/app/new-game-payload.ts src/app/new-game-payload.test.ts src/main.ts
git commit -m "refactor(app): extract the three analytics payload builders

Covers the flags that keep degraded and boot-fallback games separable from
genuine pre-upgrade Classic traffic, including that they are omitted rather
than set false — absence is what the documented queries subtract on."
```

---

### Task 6: `completion-presenter.ts`

Owns `currentCompletionHide` (`src/main.ts:193-213`). Small, but it is a mutable global with a re-entrancy guard, and it is a dependency of both `merge-result` and `game-session`.

**Files:**
- Create: `src/app/completion-presenter.ts`
- Test: `src/app/completion-presenter.test.ts`
- Modify: `src/main.ts:193-213`

**Interfaces:**
- Consumes: `showCompletionOverlay` from `../ui/index.js`; `RotationFocus` from `../interaction/index.js`
- Produces:
  ```ts
  export interface CompletionPresenter {
      /** Show the overlay for `state`. No-op while one is already up. */
      show(state: GameState): void;
      /** Hide any visible overlay. */
      remove(): void;
  }

  export function createCompletionPresenter(deps: {
      container: HTMLElement;
      rotationFocus: RotationFocus;
  }): CompletionPresenter;
  ```

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const hide = vi.fn();
vi.mock('../ui/index.js', () => ({ showCompletionOverlay: vi.fn(() => hide) }));

import { showCompletionOverlay } from '../ui/index.js';
import { RotationFocus } from '../interaction/index.js';
import { makeGameState } from '../test-helpers/fixtures.js';
import { createCompletionPresenter } from './completion-presenter.js';

describe('createCompletionPresenter', () => {
    let container: HTMLElement;
    let rotationFocus: RotationFocus;

    beforeEach(() => {
        vi.mocked(showCompletionOverlay).mockClear();
        hide.mockClear();
        container = document.createElement('div');
        rotationFocus = new RotationFocus();
    });

    it('clears rotation focus before showing, so rotate buttons fade out first', () => {
        // Without this the buttons linger in front of the celebratory zoom.
        rotationFocus.setFocus(3);
        const presenter = createCompletionPresenter({ container, rotationFocus });

        presenter.show(makeGameState());

        expect(rotationFocus.focusedGroupId).toBeNull();
        expect(showCompletionOverlay).toHaveBeenCalledTimes(1);
    });

    it('ignores a second show while one overlay is up', () => {
        const presenter = createCompletionPresenter({ container, rotationFocus });
        presenter.show(makeGameState());
        presenter.show(makeGameState());
        expect(showCompletionOverlay).toHaveBeenCalledTimes(1);
    });

    it('hides on remove and allows showing again afterwards', () => {
        const presenter = createCompletionPresenter({ container, rotationFocus });
        presenter.show(makeGameState());
        presenter.remove();
        expect(hide).toHaveBeenCalledTimes(1);

        presenter.show(makeGameState());
        expect(showCompletionOverlay).toHaveBeenCalledTimes(2);
    });

    it('remove is a no-op when no overlay is up', () => {
        createCompletionPresenter({ container, rotationFocus }).remove();
        expect(hide).not.toHaveBeenCalled();
    });

    it('clears its handle when the user dismisses the overlay', () => {
        const presenter = createCompletionPresenter({ container, rotationFocus });
        presenter.show(makeGameState());

        const onDismiss = vi.mocked(showCompletionOverlay).mock.calls[0][0].onDismiss!;
        onDismiss();

        presenter.show(makeGameState());
        expect(showCompletionOverlay).toHaveBeenCalledTimes(2);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/completion-presenter.test.ts`
Expected: FAIL — cannot resolve `./completion-presenter.js`.

- [ ] **Step 3: Write the implementation**

A factory closing over `hideCurrent: (() => void) | null`, keeping the existing comment about clearing focus so the rotate buttons quick-fade before the zoom.

- [ ] **Step 4: Rewire `main.ts`**

Create the presenter near the other singletons and replace `showCompletionOverlay()` / `removeCompletionOverlay()` calls with `completionPresenter.show(gameState)` / `completionPresenter.remove()`. Delete `:193-213` and the `showCompletionOverlay as renderCompletionOverlay` alias import.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/app/completion-presenter.test.ts && npx tsc`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/completion-presenter.ts src/app/completion-presenter.test.ts src/main.ts
git commit -m "refactor(app): extract the completion overlay presenter"
```

---

### Task 7: `viewport-fit.ts`

`gatherAndZoomToFit` (`src/main.ts:285-314`) and `zoomToFitCompletedPuzzle` (`:324-453`). ~170 lines containing real untested math: the shortest-path upright spin and the `transform-origin` compensation that stops the pivot orbiting.

Note: `zoomToFitCompletedPuzzle` queries `[data-group-id]` and calls `applyGroupTransform` directly, bypassing the `Renderer` port. That coupling becomes an explicit `container` dependency. Do not fix it — out of scope per the spec.

**Files:**
- Create: `src/app/viewport-fit.ts`
- Test: `src/app/viewport-fit.test.ts`
- Modify: `src/main.ts:285-453`

**Interfaces:**
- Consumes: `computeGatheredPositions`, `applyGatheredPositions`, `getGroupVisualBounds`, `getGroupImageCenter` from `../game/index.js`; `applyGroupTransform` from `../renderer/index.js`; `rotatePoint`, `signedAngularDelta` from `../model/helpers.js`; `Renderer`; `ViewportTransform`
- Produces:
  ```ts
  export interface ViewportFitDeps {
      container: HTMLElement;
      renderer: Renderer;
      viewportTransform: ViewportTransform;
      /** Push the transform to the renderer after a setState. */
      applyTransform: () => void;
  }

  /** Gather all groups into a compact layout and zoom the viewport to fit. */
  export function gatherAndZoomToFit(state: GameState, deps: ViewportFitDeps): void;

  /**
   * Animate the viewport to frame a single completed group, spinning it
   * upright in parallel when it completed at a non-zero rotation.
   */
  export function zoomToFitCompletedPuzzle(
      state: GameState,
      completedGroup: PieceGroup,
      deps: ViewportFitDeps,
      onComplete: () => void,
  ): void;
  ```

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ViewportTransform } from '../interaction/index.js';
import { createFakeRenderer, type FakeRenderer } from '../test-helpers/fake-renderer.js';
import { makeGameState, makeCenteredGroup } from '../test-helpers/fixtures.js';
import { gatherAndZoomToFit, zoomToFitCompletedPuzzle } from './viewport-fit.js';

describe('gatherAndZoomToFit', () => {
    let container: HTMLElement;
    let renderer: FakeRenderer;
    let viewportTransform: ViewportTransform;
    let applyTransform: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        container = document.createElement('div');
        // jsdom reports 0 for clientWidth/Height; the code falls back to
        // window.innerWidth/Height, which jsdom defaults to 1024x768.
        renderer = createFakeRenderer();
        viewportTransform = new ViewportTransform();
        applyTransform = vi.fn();
    });

    it('scales to fit with 10% padding and centers the layout', () => {
        const state = makeGameState();
        gatherAndZoomToFit(state, { container, renderer, viewportTransform, applyTransform });

        const { scale, offset } = viewportTransform.getState();
        expect(scale).toBeGreaterThan(0);
        // Centering: the layout center maps to the screen center.
        expect(offset.x).toBeTypeOf('number');
        expect(applyTransform).toHaveBeenCalled();
    });

    it('moves the groups, not just the viewport', () => {
        const state = makeGameState();
        const before = state.groups.map((g) => ({ ...g.position }));

        gatherAndZoomToFit(state, { container, renderer, viewportTransform, applyTransform });

        const after = state.groups.map((g) => g.position);
        expect(after).not.toEqual(before);
    });
});

describe('zoomToFitCompletedPuzzle', () => {
    let container: HTMLElement;
    let renderer: FakeRenderer;
    let viewportTransform: ViewportTransform;
    let applyTransform: ReturnType<typeof vi.fn>;
    let deps: Parameters<typeof zoomToFitCompletedPuzzle>[2];

    beforeEach(() => {
        vi.useFakeTimers();
        container = document.createElement('div');
        renderer = createFakeRenderer();
        viewportTransform = new ViewportTransform();
        applyTransform = vi.fn();
        deps = { container, renderer, viewportTransform, applyTransform };
        // requestAnimationFrame runs the transform application one frame later.
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            cb(0);
            return 0;
        });
    });

    it('normalizes a completed rotation to upright', () => {
        const state = makeGameState();
        const group = state.groups[0];
        group.rotation = 350;

        zoomToFitCompletedPuzzle(state, group, deps, () => {});

        // 350° takes the +10° short way to an upright resting angle.
        expect(group.rotation).toBe(0);
    });

    it('compensates position so the puzzle does not move when the pivot changes', () => {
        // Re-anchoring transform-origin to the image center must keep the same
        // world point under the puzzle, or it jumps before the spin starts.
        const state = makeGameState();
        const group = state.groups[0];
        const before = { ...group.position };
        group.rotation = 90;

        zoomToFitCompletedPuzzle(state, group, deps, () => {});

        expect(group.position).not.toEqual(before);
    });

    it('leaves position alone for a puzzle completed upright', () => {
        const state = makeGameState();
        const group = state.groups[0];
        group.rotation = 0;
        const before = { ...group.position };

        zoomToFitCompletedPuzzle(state, group, deps, () => {});

        expect(group.position).toEqual(before);
    });

    it('enables the viewport transition and disables it when the transition ends', () => {
        const state = makeGameState();
        const table = document.createElement('div');
        table.dataset.puzzleTable = 'true';
        container.appendChild(table);

        const onComplete = vi.fn();
        zoomToFitCompletedPuzzle(state, state.groups[0], deps, onComplete);

        expect(renderer.enableViewportTransition).toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();

        table.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'transform' }));

        expect(renderer.disableViewportTransition).toHaveBeenCalled();
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('falls back to a timer when the table element is missing', () => {
        const state = makeGameState();
        const onComplete = vi.fn();

        zoomToFitCompletedPuzzle(state, state.groups[0], deps, onComplete);
        expect(onComplete).not.toHaveBeenCalled();

        vi.advanceTimersByTime(800);
        expect(onComplete).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/viewport-fit.test.ts`
Expected: FAIL — cannot resolve `./viewport-fit.js`.

- [ ] **Step 3: Write the implementation**

Move both functions, replacing `app` with `deps.container`, `renderer` with `deps.renderer`, `gameState` with the `state` parameter, and `applyViewportTransform()` with `deps.applyTransform()`. Keep the whole numbered comment block explaining the two things that matter about the spin — it is the only record of why the origin is pinned.

If `makeCenteredGroup` is unused after writing the test, remove the import (`noUnusedLocals`).

- [ ] **Step 4: Rewire `main.ts`**

Add a single `viewportFitDeps` object built once from the module singletons, and call `gatherAndZoomToFit(gameState, viewportFitDeps)` / `zoomToFitCompletedPuzzle(gameState, group, viewportFitDeps, onDone)`. Delete `:285-453`.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/app/viewport-fit.test.ts && npx tsc`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/viewport-fit.ts src/app/viewport-fit.test.ts src/main.ts
git commit -m "refactor(app): extract viewport gather and completion zoom

First coverage for the shortest-path upright spin and the transform-origin
compensation that keeps the pivot from orbiting."
```

---

### Task 8: `save-coordinator.ts`

Owns `debouncedSave` (`src/main.ts:745-756`), `lastSaveFailedToastAt` (`:695`), `notifySaveFailed` (`:698-712`), `persistNewPuzzle` (`:723-739`), `autoSave` (`:799-801`), and the two flush listeners (`:764-767`). Two behaviors here are worth locking down: the 10-second toast dedup window, and that a failure is attributed to the **flushed** state rather than the current one — a debounced save can land after a new game has started.

**Files:**
- Create: `src/app/save-coordinator.ts`
- Test: `src/app/save-coordinator.test.ts`
- Modify: `src/main.ts` — all of the above

**Interfaces:**
- Consumes: `createDebouncedSave`, `saveNewPuzzle` from `../persistence/index.js`; `showToast` from `../ui/toast.js`; `track` from `../analytics/index.js`; `traceSetVersionOf` from `./trace-set-version.js`; `SelectionManager`, `ViewportTransform`
- Produces:
  ```ts
  export const SAVE_FAILED_TOAST =
      "This puzzle is too large to save — your progress won't be kept across reloads.";
  /** Minimum gap between two save-failure toasts. */
  export const SAVE_FAILED_TOAST_DEDUP_MS = 10_000;

  export interface SaveCoordinator {
      /** Debounced progress save of `state`, including selection and viewport. */
      autoSave(state: GameState): void;
      /** Geometry + initial progress for a freshly created or loaded puzzle. */
      persistNewPuzzle(state: GameState): void;
      /** Flush any pending debounced save immediately. */
      flush(): void;
  }

  export function createSaveCoordinator(deps: {
      selectionManager: SelectionManager;
      viewportTransform: ViewportTransform;
      /** Injected for testing; defaults to Date.now. */
      now?: () => number;
  }): SaveCoordinator;
  ```

  `createSaveCoordinator` also installs the `pagehide` and `visibilitychange` flush listeners as a side effect of construction, matching today's module-scope registration.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../ui/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../persistence/index.js', () => ({
    createDebouncedSave: vi.fn(),
    saveNewPuzzle: vi.fn(),
}));

import { showToast } from '../ui/toast.js';
import { createDebouncedSave, saveNewPuzzle } from '../persistence/index.js';
import { SelectionManager } from '../interaction/selection-manager.js';
import { ViewportTransform } from '../interaction/index.js';
import { makeGameState } from '../test-helpers/fixtures.js';
import {
    createSaveCoordinator,
    SAVE_FAILED_TOAST,
    SAVE_FAILED_TOAST_DEDUP_MS,
} from './save-coordinator.js';

describe('createSaveCoordinator', () => {
    let umamiTrack: ReturnType<typeof vi.fn>;
    let save: ReturnType<typeof vi.fn>;
    let flush: ReturnType<typeof vi.fn>;
    let onSaveFailed: (state: ReturnType<typeof makeGameState>) => void;
    let onSaveSkipped: (state: ReturnType<typeof makeGameState>) => void;

    beforeEach(() => {
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
        save = vi.fn();
        flush = vi.fn();
        vi.mocked(createDebouncedSave).mockImplementation((opts) => {
            onSaveFailed = opts!.onSaveFailed!;
            onSaveSkipped = opts!.onSaveSkipped!;
            return { save, flush, cancel: vi.fn() };
        });
        vi.mocked(saveNewPuzzle).mockReturnValue('ok');
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
        vi.mocked(showToast).mockClear();
        vi.restoreAllMocks();
    });

    function make(now = () => 0) {
        return createSaveCoordinator({
            selectionManager: new SelectionManager(),
            viewportTransform: new ViewportTransform(),
            now,
        });
    }

    it('flushes pending saves on pagehide', () => {
        make();
        window.dispatchEvent(new Event('pagehide'));
        expect(flush).toHaveBeenCalled();
    });

    it('flushes when the document becomes hidden', () => {
        // pagehide is not guaranteed on mobile app-switch / background-kill.
        make();
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        expect(flush).toHaveBeenCalled();
    });

    it('does not flush when the document becomes visible', () => {
        make();
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        expect(flush).not.toHaveBeenCalled();
    });

    it('toasts and reports when a new-puzzle save fails', () => {
        vi.mocked(saveNewPuzzle).mockReturnValue('failed');
        make().persistNewPuzzle(makeGameState({ cutStyle: 'wavy' }));

        expect(showToast).toHaveBeenCalledWith(SAVE_FAILED_TOAST);
        expect(umamiTrack).toHaveBeenCalledWith(
            'save-failed',
            expect.objectContaining({ op: 'new-puzzle', cutStyle: 'wavy' }),
        );
    });

    it('reports a compressed save without toasting', () => {
        // Near-quota: one growth step from total failure, but nothing is lost.
        vi.mocked(saveNewPuzzle).mockReturnValue('ok-compressed');
        make().persistNewPuzzle(makeGameState({ cutStyle: 'triangles' }));

        expect(showToast).not.toHaveBeenCalled();
        expect(umamiTrack).toHaveBeenCalledWith(
            'save-compressed',
            expect.objectContaining({ cutStyle: 'triangles' }),
        );
    });

    it('suppresses a repeat failure toast inside the dedup window but still reports it', () => {
        // A fast debounced save loop must not spam the user, and a suppressed
        // repeat must still leave a trail rather than vanishing.
        let clock = 0;
        vi.mocked(saveNewPuzzle).mockReturnValue('failed');
        const coordinator = make(() => clock);

        coordinator.persistNewPuzzle(makeGameState());
        clock = SAVE_FAILED_TOAST_DEDUP_MS - 1;
        coordinator.persistNewPuzzle(makeGameState());

        expect(showToast).toHaveBeenCalledTimes(1);
        expect(umamiTrack).toHaveBeenCalledTimes(2);
        expect(console.warn).toHaveBeenCalled();
    });

    it('toasts again once the dedup window has passed', () => {
        let clock = 0;
        vi.mocked(saveNewPuzzle).mockReturnValue('failed');
        const coordinator = make(() => clock);

        coordinator.persistNewPuzzle(makeGameState());
        clock = SAVE_FAILED_TOAST_DEDUP_MS;
        coordinator.persistNewPuzzle(makeGameState());

        expect(showToast).toHaveBeenCalledTimes(2);
    });

    it('attributes a progress failure to the flushed state, not the current one', () => {
        // A save queued for the previous puzzle can flush after a new game
        // starts; reporting the new puzzle's fields would be a lie.
        make();
        onSaveFailed(makeGameState({ cutStyle: 'fractal' }));

        expect(umamiTrack).toHaveBeenCalledWith(
            'save-failed',
            expect.objectContaining({ op: 'progress', cutStyle: 'fractal' }),
        );
    });

    it('reports a cross-tab skip without alarming the user', () => {
        make();
        onSaveSkipped(makeGameState({ cutStyle: 'wavy' }));

        expect(showToast).not.toHaveBeenCalled();
        expect(umamiTrack).toHaveBeenCalledWith(
            'progress-save-skipped',
            expect.objectContaining({ cutStyle: 'wavy' }),
        );
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/save-coordinator.test.ts`
Expected: FAIL — cannot resolve `./save-coordinator.js`.

- [ ] **Step 3: Write the implementation**

Move all six pieces into the factory. Keep the two long comments — the one on `notifySaveFailed` about why every failure emits telemetry while the toast is rate-limited, and the one above `createDebouncedSave` about attributing to the flushed state. Default `now` to `Date.now`.

- [ ] **Step 4: Rewire `main.ts`**

Replace the deleted functions with `saveCoordinator.autoSave(gameState)` / `saveCoordinator.persistNewPuzzle(gameState)`, and pass `() => saveCoordinator.flush()` to `initPwaUpdates`. Delete `:695-767` and `:799-801`.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/app/save-coordinator.test.ts && npx tsc`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/save-coordinator.ts src/app/save-coordinator.test.ts src/main.ts
git commit -m "refactor(app): extract the save coordinator

Locks down the failure-toast dedup window and that a failure is attributed
to the flushed state rather than whatever game is current when it lands."
```

---

### Task 9: `merge-result.ts`

`applyMergeResult` (`src/main.ts:813-861`): selection prune with inheritance, rotate-handle focus retarget onto the survivor, z-reorder with absorbed ids remapped, win detection. Shared by drag drops and rotate-handle commits.

**Files:**
- Create: `src/app/merge-result.ts`
- Test: `src/app/merge-result.test.ts`
- Modify: `src/main.ts:813-861`

**Interfaces:**
- Consumes: `MergeResult` from `../game/group-merging.js`; `checkAndMarkWin` from `../game/index.js`; `reorderGroupsAfterDrop` from `../game/z-order.js`; `track`; `buildPuzzleCompletedData`; `Renderer`; `SelectionManager`; `RotationFocus`
- Produces:
  ```ts
  export function applyMergeResult(
      state: GameState,
      result: MergeResult,
      droppedGroupIds: readonly number[],
      deps: {
          renderer: Renderer;
          selectionManager: SelectionManager;
          rotationFocus: RotationFocus;
          /** Cached new-game analytics, for the completion payload. */
          currentGameAnalytics: () => NewGameData | null;
          /** Frame and celebrate a completed puzzle. */
          onCompleted: (state: GameState) => void;
      },
  ): void;
  ```

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SelectionManager } from '../interaction/selection-manager.js';
import { RotationFocus } from '../interaction/index.js';
import { createFakeRenderer, type FakeRenderer } from '../test-helpers/fake-renderer.js';
import { makeGameState } from '../test-helpers/fixtures.js';
import { applyMergeResult } from './merge-result.js';

describe('applyMergeResult', () => {
    let renderer: FakeRenderer;
    let selectionManager: SelectionManager;
    let rotationFocus: RotationFocus;
    let onCompleted: ReturnType<typeof vi.fn>;
    let umamiTrack: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
        renderer = createFakeRenderer();
        selectionManager = new SelectionManager();
        rotationFocus = new RotationFocus();
        onCompleted = vi.fn();
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
    });

    function deps() {
        return {
            renderer,
            selectionManager,
            rotationFocus,
            currentGameAnalytics: () => null,
            onCompleted,
        };
    }

    it('prunes absorbed groups from the selection', () => {
        const state = makeGameState();
        const survivor = state.groups[0];
        const absorbedId = 999;
        selectionManager.toolActive = true;
        selectionManager.select(absorbedId);

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [absorbedId], deps());

        expect(selectionManager.isSelected(absorbedId)).toBe(false);
    });

    it('lets the surviving group inherit selection from an absorbed one', () => {
        const state = makeGameState();
        const survivor = state.groups[0];
        selectionManager.toolActive = true;
        selectionManager.select(999);

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [999], deps());

        expect(selectionManager.isSelected(survivor.id)).toBe(true);
    });

    it('leaves the selection alone when nothing selected was absorbed', () => {
        const state = makeGameState();
        const survivor = state.groups[0];

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [survivor.id], deps());

        expect(selectionManager.hasSelection).toBe(false);
    });

    it('retargets rotate-handle focus onto the survivor when its anchor was absorbed', () => {
        // Otherwise the handle stays anchored to a deleted group and the next
        // pointerdown silently no-ops until the idle timer expires.
        const state = makeGameState();
        const survivor = state.groups[0];
        rotationFocus.setFocus(999);

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [999], deps());

        expect(rotationFocus.focusedGroupId).toBe(survivor.id);
    });

    it('leaves focus alone when the focused group survived', () => {
        const state = makeGameState();
        const survivor = state.groups[0];
        rotationFocus.setFocus(survivor.id);

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [survivor.id], deps());

        expect(rotationFocus.focusedGroupId).toBe(survivor.id);
    });

    it('re-renders and pulses the merged group', () => {
        const state = makeGameState();
        const survivor = state.groups[0];

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [survivor.id], deps());

        expect(renderer.renderState).toHaveBeenCalledWith(state);
        expect(renderer.flashMergePulse).toHaveBeenCalledWith(survivor.id);
    });

    it('remaps absorbed ids to the survivor before reordering z-order', () => {
        // Every entry handed to the reorder must name a group that still exists.
        const state = makeGameState();
        const survivor = state.groups[0];

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [999, survivor.id], deps());

        const front = renderer.bringGroupToFront.mock.calls.map((c) => c[0]);
        expect(front).not.toContain(999);
    });

    it('reports and celebrates a completed puzzle', () => {
        const state = makeGameState();
        // Collapse to one group holding every piece so checkAndMarkWin passes.
        const survivor = state.groups[0];
        for (const piece of state.pieces) {
            survivor.pieces.set(piece.id, { x: -piece.imageOffset.x, y: -piece.imageOffset.y });
        }
        state.groups = [survivor];

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [survivor.id], deps());

        expect(umamiTrack).toHaveBeenCalledWith('puzzle-completed', expect.any(Object));
        expect(onCompleted).toHaveBeenCalledWith(state);
    });

    it('does not report completion for an unfinished puzzle', () => {
        const state = makeGameState();
        applyMergeResult(state, { group: state.groups[0], mergeCount: 1 }, [state.groups[0].id], deps());
        expect(onCompleted).not.toHaveBeenCalled();
    });
});
```

If `makeGameState`'s default fixture does not produce a state where `checkAndMarkWin` can pass by collapsing groups, read `src/game/win-detection.test.ts` and reuse whatever construction it uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/merge-result.test.ts`
Expected: FAIL — cannot resolve `./merge-result.js`.

- [ ] **Step 3: Write the implementation**

Move the function verbatim, replacing `gameState` with `state` and the two module globals with `deps`. The completion branch calls `deps.onCompleted(state)` instead of choosing between `zoomToFitCompletedPuzzle` and `showCompletionOverlay` — that choice (including the "shouldn't happen" fallback when `groups.length !== 1`) moves to the caller, which is the thing that owns the viewport. Keep the comments on the prune, the focus retarget, and the id remap.

- [ ] **Step 4: Rewire `main.ts`**

Call `applyMergeResult(gameState, result, droppedGroupIds, { ... })` from both call sites (the drop handler and the rotate-handle commit), supplying `onCompleted` as the existing zoom-then-overlay sequence. Delete `:813-861`.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/app/merge-result.test.ts && npx tsc`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/merge-result.ts src/app/merge-result.test.ts src/main.ts
git commit -m "refactor(app): extract post-merge selection, z-order and win handling"
```

---

### Task 10: `game-session.ts` — the core move

This is the task the other 21 exist to make possible, and the riskiest one. It removes `let gameState` and `let cleanupDrag` from `main.ts`, absorbing `initGame` (`:894-960`) and `restorePersistedSelection` (`:973-997`).

Two invariants become enforced rather than commented:

- The interaction teardown handle is assigned by `install`'s **last** statement, so `hasGame()` stays false through render and wiring. A throw in that window must still report "no game" so the boot fallback runs — this is #488, and the test below is what stops a future refactor from silently undoing it.
- `current()` returns `GameState | undefined`, so the compiler forces call sites to handle the no-game state instead of each one rediscovering it (#501).

**Files:**
- Create: `src/app/game-session.ts`
- Test: `src/app/game-session.test.ts`
- Modify: `src/main.ts` — delete `:257-258`, `:894-997`; every `gameState` reference becomes `session.current()`

**Interfaces:**
- Consumes: `setupInteraction` from `../interaction/index.js`; `processDrop` from `../game/index.js`; `reorderGroupsAfterDrop` from `../game/z-order.js`; `activeSnapTolerances`; `Renderer`; `SelectionManager`; `RotationFocus`; `ViewportTransform`; `diagnostics`
- Produces:
  ```ts
  export interface GameSession {
      current(): GameState | undefined;
      hasGame(): boolean;
      install(state: GameState): void;
      restoreSelection(saved: readonly number[]): void;
  }

  export function createGameSession(deps: {
      container: HTMLElement;
      renderer: Renderer;
      viewportTransform: ViewportTransform;
      selectionManager: SelectionManager;
      rotationFocus: RotationFocus;
      /** Run after the state is installed and rendered, before interaction is wired. */
      onInstalled: (state: GameState) => void;
      /** Debounced progress save. */
      save: (state: GameState) => void;
      /** Apply a merge produced by a drop. */
      applyMerge: (
          state: GameState,
          result: MergeResult,
          droppedGroupIds: readonly number[],
      ) => void;
      /** Push the viewport transform to the renderer and persist it. */
      onViewportChanged: () => void;
  }): GameSession;
  ```

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SelectionManager } from '../interaction/selection-manager.js';
import { RotationFocus, ViewportTransform } from '../interaction/index.js';
import { createFakeRenderer, type FakeRenderer } from '../test-helpers/fake-renderer.js';
import { makeGameState } from '../test-helpers/fixtures.js';
import { createGameSession, type GameSession } from './game-session.js';

describe('createGameSession', () => {
    let container: HTMLElement;
    let renderer: FakeRenderer;
    let selectionManager: SelectionManager;
    let rotationFocus: RotationFocus;
    let onInstalled: ReturnType<typeof vi.fn>;
    let save: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        renderer = createFakeRenderer();
        selectionManager = new SelectionManager();
        rotationFocus = new RotationFocus();
        onInstalled = vi.fn();
        save = vi.fn();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    function make(overrides: Partial<Parameters<typeof createGameSession>[0]> = {}): GameSession {
        return createGameSession({
            container,
            renderer,
            viewportTransform: new ViewportTransform(),
            selectionManager,
            rotationFocus,
            onInstalled,
            save,
            applyMerge: vi.fn(),
            onViewportChanged: vi.fn(),
            ...overrides,
        });
    }

    it('reports no game before anything is installed', () => {
        const session = make();
        expect(session.current()).toBeUndefined();
        expect(session.hasGame()).toBe(false);
    });

    it('exposes the installed state', () => {
        const session = make();
        const state = makeGameState();
        session.install(state);
        expect(session.current()).toBe(state);
        expect(session.hasGame()).toBe(true);
    });

    it('keeps hasGame false until interaction is wired', () => {
        // #488: the boot fallback reads hasGame as "a puzzle is rendered AND
        // interactive". A throw between the state assignment and interaction
        // setup must still report no game, or the fallback is skipped and the
        // player is left with a dead canvas and no message.
        let hasGameDuringInstall: boolean | undefined;
        let session: GameSession;

        session = make({
            onInstalled: () => {
                hasGameDuringInstall = session.hasGame();
            },
        });
        session.install(makeGameState());

        expect(hasGameDuringInstall).toBe(false);
        expect(session.hasGame()).toBe(true);
    });

    it('still reports no game when wiring interaction throws', () => {
        const session = make();
        renderer.renderState.mockImplementationOnce(() => {
            throw new Error('render boom');
        });

        expect(() => session.install(makeGameState())).toThrow('render boom');
        expect(session.hasGame()).toBe(false);
    });

    it('renders the state and runs onInstalled', () => {
        const session = make();
        const state = makeGameState();
        session.install(state);
        expect(renderer.renderState).toHaveBeenCalledWith(state);
        expect(onInstalled).toHaveBeenCalledWith(state);
    });

    it('clears selection and rotation focus when a new game replaces an old one', () => {
        const session = make();
        session.install(makeGameState());
        selectionManager.toolActive = true;
        selectionManager.select(0);
        rotationFocus.setFocus(0);

        session.install(makeGameState());

        expect(selectionManager.hasSelection).toBe(false);
        expect(rotationFocus.focusedGroupId).toBeNull();
    });

    it('restores a saved selection and switches the multi-select tool on', () => {
        const session = make();
        const state = makeGameState();
        session.install(state);

        session.restoreSelection([state.groups[0].id]);

        expect(selectionManager.toolActive).toBe(true);
        expect(selectionManager.isSelected(state.groups[0].id)).toBe(true);
    });

    it('does nothing for an empty saved selection', () => {
        const session = make();
        session.install(makeGameState());
        session.restoreSelection([]);
        expect(selectionManager.toolActive).toBe(false);
    });

    it('drops saved ids with no matching group and warns', () => {
        // Group ids are stable across a reload, so a mismatch points at real
        // inconsistency rather than something to swallow.
        const session = make();
        const state = makeGameState();
        session.install(state);

        session.restoreSelection([state.groups[0].id, 4242]);

        expect(selectionManager.isSelected(4242)).toBe(false);
        expect(selectionManager.isSelected(state.groups[0].id)).toBe(true);
        expect(console.warn).toHaveBeenCalled();
    });

    it('leaves the tool off when no saved id survives', () => {
        const session = make();
        session.install(makeGameState());
        session.restoreSelection([4242]);
        expect(selectionManager.toolActive).toBe(false);
    });
});
```

Note: `diagnostics.warn` is DEV-gated. Confirm it reaches `console.warn` under Vitest by checking `src/diagnostics.ts`; if it is gated on `import.meta.env.DEV` and that is false in test, assert on the dropped-id behavior only and drop the `console.warn` assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/game-session.test.ts`
Expected: FAIL — cannot resolve `./game-session.js`.

- [ ] **Step 3: Write the implementation**

A factory closing over `state: GameState | undefined` and `cleanup: (() => void) | null`. `install` runs today's `initGame` sequence in the same order: remove completion overlay and clear selection/focus via `onInstalled`'s caller and the managers, tear down previous interaction, assign state, render, `onInstalled(state)`, then — last — assign `cleanup = setupInteraction({...})`.

Keep the comment explaining why the assignment is last, rewritten to point at `hasGame()` rather than at a variable name, and note that `game-session.test.ts` now enforces it.

The `setupInteraction` callbacks read `state` through the closure, which is correct: they must see whatever is current at fire time.

- [ ] **Step 4: Rewire `main.ts`**

This is the large edit. Mechanically:

1. Delete `let gameState;` and `let cleanupDrag`.
2. Create the session after the singletons and the collaborators it needs.
3. Replace every read. Where the old code read `gameState` unguarded, use a local `const state = session.current(); if (!state) return;` — **except** where the original deliberately threw or deliberately guarded. Specifically preserve:
   - `isCompleted: () => session.current()?.completed ?? false`
   - `getGroupCount: () => session.current()?.groups.length ?? 0`
   - `getPieceCount: () => session.current()?.pieces.length ?? 0`
   - the Gather handler's early return when there is no game
   - the `if (!gameState) return;` guards in the rotate-button and rotate-handle callbacks
4. `hasGame: () => cleanupDrag !== null` in the boot call becomes `hasGame: () => session.hasGame()`.
5. `initGame(state)` → `session.install(state)`; `restorePersistedSelection(...)` → `session.restoreSelection(...)`.

- [ ] **Step 5: Verify**

Run: `npx vitest run && npx tsc`
Expected: the whole suite PASSes and typecheck is clean. Run the **full** suite here, not just the new file — this task touches every call site in `main.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/app/game-session.ts src/app/game-session.test.ts src/main.ts
git commit -m "refactor(app): move game state and teardown into a GameSession

gameState was a module-level let that ~25 closures read, which is what
blocked every previous extraction. current() now returns GameState |
undefined so the compiler forces call sites to handle the no-game state,
and hasGame() is a named predicate instead of a drag-teardown handle
doubling as the boot-readiness signal.

A test now enforces that hasGame() stays false until interaction is wired
— previously a comment asking a maintainer not to move a line, in the one
file no test could reach.

Closes #501"
```

---

### Task 11: `rotation-ui.ts`

Rotate buttons (`src/main.ts:1423-1442`), snap position controller (`:1444-1447`), rotate handle (`:1449-1501`), `updateRotationUiVisibility` (`:1503-1514`), `getFocusedGroupScreenBounds` (`:780-793`), and the interactive pivot derivation (`:1485-1499`).

Return an object literal of closures — **not** a class — so `bootstrap` can pass `rotationUi.syncVisibility` as an unbound method reference. That reference is what makes the ordering a data dependency: the session's `onInstalled` needs the value, so `rotationUi` must be constructed first or it will not compile.

**Files:**
- Create: `src/app/rotation-ui.ts`
- Test: `src/app/rotation-ui.test.ts`
- Modify: `src/main.ts` — the ranges above

**Interfaces:**
- Consumes: `createRotateButtons`, `createRotateHandle` from `../ui/index.js`; `SnapProximityPositionController` from `../interaction/snap-proximity-position-controller.js`; `rotateGroup` from `../game/rotate-group.js`; `getGroupLocalBounds`, `getGroupVisualBounds` from `../game/index.js`; `localToWorld` from `../model/helpers.js`; `processDrop`; `activeSnapTolerances`
- Produces:
  ```ts
  export interface RotationUi {
      /** Show the controls matching `state.rotationMode`, hiding the others. */
      syncVisibility: (state: GameState | undefined) => void;
      /** Project the focused group's visual bounds into screen space. */
      getFocusedGroupScreenBounds: (
          groupId: number,
      ) => { left: number; right: number; top: number; bottom: number } | null;
  }

  export function createRotationUi(deps: {
      container: HTMLElement;
      renderer: Renderer;
      viewportTransform: ViewportTransform;
      selectionManager: SelectionManager;
      rotationFocus: RotationFocus;
      getState: () => GameState | undefined;
      save: (state: GameState) => void;
      applyMerge: (
          state: GameState,
          result: MergeResult,
          droppedGroupIds: readonly number[],
      ) => void;
  }): RotationUi;
  ```

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SelectionManager } from '../interaction/selection-manager.js';
import { RotationFocus, ViewportTransform } from '../interaction/index.js';
import { createFakeRenderer, type FakeRenderer } from '../test-helpers/fake-renderer.js';
import { makeGameState } from '../test-helpers/fixtures.js';
import { createRotationUi } from './rotation-ui.js';

describe('createRotationUi', () => {
    let container: HTMLElement;
    let renderer: FakeRenderer;
    let state: ReturnType<typeof makeGameState> | undefined;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        renderer = createFakeRenderer();
        state = makeGameState();
    });

    function make() {
        return createRotationUi({
            container,
            renderer,
            viewportTransform: new ViewportTransform(),
            selectionManager: new SelectionManager(),
            rotationFocus: new RotationFocus(),
            getState: () => state,
            save: vi.fn(),
            applyMerge: vi.fn(),
        });
    }

    it('shows the quarter-turn buttons and hides the free handle', () => {
        const ui = make();
        state = makeGameState({ rotationMode: 'quarter-turn' });
        ui.syncVisibility(state);
        expect(container.querySelector('.rotate-button, [class*="rotate"]')).not.toBeNull();
    });

    it('tolerates being asked to sync with no game', () => {
        // Boot can leave no game behind; syncing must not throw.
        const ui = make();
        expect(() => ui.syncVisibility(undefined)).not.toThrow();
    });

    it('returns null screen bounds for a group that is gone', () => {
        const ui = make();
        expect(ui.getFocusedGroupScreenBounds(4242)).toBeNull();
    });

    it('projects a live group into screen space', () => {
        const ui = make();
        const bounds = ui.getFocusedGroupScreenBounds(state!.groups[0].id);
        expect(bounds).not.toBeNull();
        expect(bounds!.right).toBeGreaterThanOrEqual(bounds!.left);
        expect(bounds!.bottom).toBeGreaterThanOrEqual(bounds!.top);
    });

    it('returns null bounds when there is no game at all', () => {
        const ui = make();
        state = undefined;
        expect(ui.getFocusedGroupScreenBounds(0)).toBeNull();
    });
});
```

The visibility assertions depend on what `createRotateButtons` / `createRotateHandle` render. Read `src/ui/rotate-buttons.test.ts` and `src/ui/rotate-handle.test.ts` and assert with the same selectors those tests use; if the handles only show on focus, assert by spying on the returned handles' `show`/`hide` via `vi.mock` of `../ui/index.js` instead of on the DOM.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/rotation-ui.test.ts`
Expected: FAIL — cannot resolve `./rotation-ui.js`.

- [ ] **Step 3: Write the implementation**

Move all six pieces. `syncVisibility` takes the state as a parameter rather than reading the thunk, so `onInstalled` can hand it the state it just installed. Keep the comment explaining why interactive rotation pivots about the tab-inclusive bounds center while the completion spin uses the corner-only image center — they are deliberately different points.

- [ ] **Step 4: Rewire `main.ts`**

Construct `rotationUi` before the session, pass `rotationUi.syncVisibility` into the session's `onInstalled`, and delete the moved ranges plus `getFocusedGroupScreenBounds`.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/app/rotation-ui.test.ts && npx tsc`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/rotation-ui.ts src/app/rotation-ui.test.ts src/main.ts
git commit -m "refactor(app): extract the rotation UI

syncVisibility is passed as an unbound reference, so the session cannot be
constructed before the rotation UI exists — an ordering that used to hold
only because of where the consts sat in the file."
```

---

### Task 12: `install-background-color.ts`

Owns `currentColorId` (`src/main.ts:1525`), the picker (`:1532-1544`), the OS-theme re-apply (`:1530`), and the piece-outline setup (`:1520-1522`). The share path currently reaches in and mutates both the global and the picker (`:1653-1658`); that becomes an explicit `adopt` method. If it does not, a theme flip after adopting a shared color re-applies the stale one.

**Files:**
- Create: `src/app/install-background-color.ts`
- Test: `src/app/install-background-color.test.ts`
- Modify: `src/main.ts:1520-1544`, `:1651-1659`

**Interfaces:**
- Consumes: `loadColorPreference`, `saveColorPreference`, `applyBackgroundColor`, `adoptSharedBackgroundColor`, `onColorSchemeChange`, `createBackgroundColorPicker`, `installPieceOutlineFilter`, `applyPieceOutline`, `loadPieceOutlinePreference`, `applyPieceOutlineColor`, `loadPieceOutlineColorPreference` from `../ui/index.js`; `track`
- Produces:
  ```ts
  export interface BackgroundColorControl {
      /**
       * Offer a sharer's color to a recipient who never picked one. Returns
       * the adoption outcome for analytics; 'none' is the caller's business.
       */
      adopt(id: string): 'adopted' | 'kept-own' | 'invalid';
  }

  export function installBackgroundColor(deps: {
      container: HTMLElement;
  }): BackgroundColorControl;
  ```

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installBackgroundColor } from './install-background-color.js';

describe('installBackgroundColor', () => {
    let container: HTMLElement;
    let umamiTrack: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
        document.body.innerHTML = '';
    });

    it('renders the picker into the container', () => {
        installBackgroundColor({ container });
        expect(container.querySelector('.bg-color-button')).not.toBeNull();
    });

    it('reports an adopted shared color', () => {
        const control = installBackgroundColor({ container });
        // Use a real preset id — read one from BACKGROUND_COLOR_PRESETS in
        // src/ui/background-color.ts.
        expect(control.adopt('<a-real-preset-id>')).toBe('adopted');
    });

    it('reports an unrecognized shared color as invalid', () => {
        // Palette drift that silently drops a live link's color must stay
        // visible in analytics.
        const control = installBackgroundColor({ container });
        expect(control.adopt('not-a-real-preset')).toBe('invalid');
    });

    it('keeps the recipient’s own color when they already picked one', () => {
        const control = installBackgroundColor({ container });
        // Simulate an existing preference by selecting first, then adopting.
        // Read saveColorPreference's key from src/ui/background-color.ts and
        // seed localStorage before install to make the "already picked" case.
        expect(['kept-own', 'adopted']).toContain(control.adopt('<a-real-preset-id>'));
    });

    it('reports a color switch with from and to ids', () => {
        installBackgroundColor({ container });
        (container.querySelector('.bg-color-button') as HTMLElement).click();
        const swatch = document.querySelector('.bg-color-panel button:not([aria-current="true"])');
        (swatch as HTMLElement | null)?.click();

        expect(umamiTrack).toHaveBeenCalledWith(
            'background-color-changed',
            expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
        );
    });

    it('does not report re-selecting the current swatch', () => {
        installBackgroundColor({ container });
        (container.querySelector('.bg-color-button') as HTMLElement).click();
        const current = document.querySelector('.bg-color-panel [aria-current="true"]');
        (current as HTMLElement | null)?.click();

        expect(umamiTrack).not.toHaveBeenCalledWith('background-color-changed', expect.anything());
    });
});
```

Read `src/ui/background-color-picker.test.ts` for the real DOM selectors and `src/ui/background-color.ts` for a real preset id and the storage key; replace the `<a-real-preset-id>` placeholders before running. Do not leave them in.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/install-background-color.test.ts`
Expected: FAIL — cannot resolve `./install-background-color.js`.

- [ ] **Step 3: Write the implementation**

Close over `currentColorId`. `adopt` calls `adoptSharedBackgroundColor`, and on `'adopted'` updates both the closed-over id and the picker's `setSelected` — the pair that keeps the theme re-apply correct. Keep the comments about the theme flip only needing a re-apply to recompute the luminance-derived chrome scheme, and about the piece-outline color flipping via CSS.

- [ ] **Step 4: Rewire `main.ts`**

Replace `:1520-1544` with one `installBackgroundColor({ container: app })` call, and the share path's block with:

```ts
let sharedColor: NonNullable<NewGameData['sharedColor']> = 'none';
if (payload.bgc !== undefined) {
    sharedColor = backgroundColor.adopt(payload.bgc);
}
```

- [ ] **Step 5: Verify**

Run: `npx vitest run src/app/install-background-color.test.ts && npx tsc`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/install-background-color.ts src/app/install-background-color.test.ts src/main.ts
git commit -m "refactor(app): extract background color state and adoption

The share path reached into a module global and the picker separately; both
now go through adopt(), which is what keeps the OS-theme re-apply from
using a stale color after a shared one is adopted."
```

---

### Task 13: `start-new-game.ts`

`startNewGame` and `StartNewGameOptions` (`src/main.ts:999-1275`). By now most of its body is calls into extracted modules, so this task is mostly about the dependency object and the orchestration order — which is where its real contracts live: the chunk preload starts before the image request and is collected after it, but before the Unsplash download report, so a start that is about to throw does not report a download for a photo it discards.

**Files:**
- Create: `src/app/start-new-game.ts`
- Test: `src/app/start-new-game.test.ts`
- Modify: `src/main.ts:999-1275`

**Interfaces:**
- Consumes: `planTracedTabs`, `resolveTracedTabOutcome`, `resolveUnsplashImage`, `pickBundledImage`, `orientationForViewport`, `orientGridSize`, `blankSizeForOrientation`, `createBlankImageDataUrl`, `generatorConfigsForNewGame`, `buildFreshGameData`, `createNewGame`, `rotationModeForNewGame`, `preloadTracedTabGenerator`, `getUnsplashAccessKey`, `triggerPhotoDownload`, `showLoadingOverlay`, `hideLoadingOverlay`, `yieldForPaint`, `GameSession`, `track`
- Produces:
  ```ts
  export interface StartNewGameOptions {
      cutStyle?: CutStyle;
      composableConfig?: ComposableConfig;
      imageSource?: string;
      imageCategory?: string;
      fractalConfig?: FractalDialogConfig;
      wavyConfig?: WavyDialogConfig;
      vibrant?: boolean;
      rotationEnabled?: boolean;
      seed?: number;
      pickedImage?: CandidateImage;
      /** Last-resort boot puzzle (#488): legacy Classic, chunk never fetched. */
      bootFallback?: boolean;
  }

  export interface StartNewGameDeps {
      container: HTMLElement;
      session: GameSession;
      /** Gather and zoom-to-fit the freshly installed puzzle. */
      fitView: (state: GameState) => void;
      persistNewPuzzle: (state: GameState) => void;
      /** Record the payload as the current game's analytics. */
      onGameAnalytics: (data: NewGameData) => void;
  }

  export function startNewGame(
      gridSize: GridSize,
      options: StartNewGameOptions,
      deps: StartNewGameDeps,
  ): Promise<void>;
  ```

- [ ] **Step 1: Write the failing test**

Mock the module boundaries this flow calls out to so the test asserts orchestration, not generation:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../ui/index.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../ui/index.js')>()),
    showLoadingOverlay: vi.fn(),
    hideLoadingOverlay: vi.fn(),
    yieldForPaint: vi.fn(async () => {}),
}));
vi.mock('../images/index.js', () => ({
    getUnsplashAccessKey: vi.fn(() => null),
    triggerPhotoDownload: vi.fn(async () => {}),
}));
vi.mock('../puzzle/topology/traced-tab-loader.js', () => ({
    preloadTracedTabGenerator: vi.fn(async () => {}),
}));

import { showLoadingOverlay, hideLoadingOverlay } from '../ui/index.js';
import { getUnsplashAccessKey, triggerPhotoDownload } from '../images/index.js';
import { preloadTracedTabGenerator } from '../puzzle/topology/traced-tab-loader.js';
import { makeGameState } from '../test-helpers/fixtures.js';
import { startNewGame } from './start-new-game.js';

describe('startNewGame', () => {
    let umamiTrack: ReturnType<typeof vi.fn>;
    let install: ReturnType<typeof vi.fn>;
    let deps: Parameters<typeof startNewGame>[2];

    beforeEach(() => {
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
        install = vi.fn();
        deps = {
            container: document.createElement('div'),
            session: { install, current: () => makeGameState(), hasGame: () => true, restoreSelection: vi.fn() },
            fitView: vi.fn(),
            persistNewPuzzle: vi.fn(),
            onGameAnalytics: vi.fn(),
        };
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
        vi.clearAllMocks();
    });

    it('installs a puzzle, fits the view and persists it', async () => {
        await startNewGame({ cols: 2, rows: 2 }, { imageSource: 'blank' }, deps);

        expect(install).toHaveBeenCalledTimes(1);
        expect(deps.fitView).toHaveBeenCalled();
        expect(deps.persistNewPuzzle).toHaveBeenCalled();
    });

    it('shows the loading overlay and always hides it', async () => {
        await startNewGame({ cols: 2, rows: 2 }, { imageSource: 'blank' }, deps);
        expect(showLoadingOverlay).toHaveBeenCalled();
        expect(hideLoadingOverlay).toHaveBeenCalled();
    });

    it('hides the loading overlay even when generation throws', async () => {
        install.mockImplementation(() => {
            throw new Error('install boom');
        });

        await expect(
            startNewGame({ cols: 2, rows: 2 }, { imageSource: 'blank' }, deps),
        ).rejects.toThrow('install boom');
        expect(hideLoadingOverlay).toHaveBeenCalled();
    });

    it('reports new-game-started with the fresh source', async () => {
        await startNewGame({ cols: 2, rows: 2 }, { imageSource: 'blank' }, deps);
        expect(umamiTrack).toHaveBeenCalledWith(
            'new-game-started',
            expect.objectContaining({ source: 'fresh' }),
        );
    });

    it('never fetches the traced chunk for a boot-fallback start', async () => {
        // The recovery path must not be able to fail the way the start it is
        // recovering from did.
        await startNewGame({ cols: 2, rows: 2 }, { bootFallback: true, imageSource: 'blank' }, deps);
        expect(preloadTracedTabGenerator).not.toHaveBeenCalled();
    });

    it('flags a boot-fallback game in analytics', async () => {
        await startNewGame({ cols: 2, rows: 2 }, { bootFallback: true, imageSource: 'blank' }, deps);
        expect(umamiTrack).toHaveBeenCalledWith(
            'new-game-started',
            expect.objectContaining({ bootFallback: true }),
        );
    });

    it('does not report an Unsplash download when the start throws first', async () => {
        // The chunk outcome is collected before the download report, so a start
        // about to throw must not credit a photo it discards.
        vi.mocked(getUnsplashAccessKey).mockReturnValue('key');
        vi.mocked(preloadTracedTabGenerator).mockRejectedValue(new Error('chunk boom'));

        await expect(
            startNewGame({ cols: 2, rows: 2 }, { cutStyle: 'wavy' }, deps),
        ).rejects.toThrow();
        expect(triggerPhotoDownload).not.toHaveBeenCalled();
    });

    it('skips the access-key lookup for a blank puzzle', async () => {
        await startNewGame({ cols: 2, rows: 2 }, { imageSource: 'blank' }, deps);
        expect(getUnsplashAccessKey).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/start-new-game.test.ts`
Expected: FAIL — cannot resolve `./start-new-game.js`.

- [ ] **Step 3: Write the implementation**

Move the function, substituting the extracted modules and `deps`. Preserve every comment in the traced-tab block — the one explaining why the rejection is captured into a value rather than left floating, and why a falsy rejection reason has to be defaulted to a real `Error` because `null` is the success sentinel. Preserve the ordering: plan → start preload → resolve image → collect chunk outcome → throw or warn → download report → configs → `yieldForPaint` → `createNewGame` → install → fit → persist → analytics.

- [ ] **Step 4: Rewire `main.ts`**

Every `startNewGame(...)` call site — the dialog, the two boot legs, and the two console hooks — gains the `deps` argument. Keep a single module-level `startNewGameDeps` object so the argument is spelled once.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/app/start-new-game.test.ts && npx tsc`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/start-new-game.ts src/app/start-new-game.test.ts src/main.ts
git commit -m "refactor(app): extract the fresh-game start flow"
```

---

### Task 14: `load-shared-puzzle.ts`

`loadSharedPuzzle` (`src/main.ts:1562-1694`). Mostly extracted pieces by now; what remains is the order and the progress-failure toast.

**Files:**
- Create: `src/app/load-shared-puzzle.ts`
- Test: `src/app/load-shared-puzzle.test.ts`
- Modify: `src/main.ts:1562-1694`

**Interfaces:**
- Consumes: `needsTracedTabChunk`, `shareInitOptions`, `createBlankImageDataUrl`, `buildSharedGameData`, `applyProgress` from `../game/reconstruct-groups.js`, `createNewGame`, `showToast`, loading-overlay helpers, `BackgroundColorControl`, `GameSession`
- Produces:
  ```ts
  export function loadSharedPuzzle(
      payload: SharePayload,
      recipientHadSavedState: boolean,
      deps: {
          container: HTMLElement;
          session: GameSession;
          fitView: (state: GameState) => void;
          persistNewPuzzle: (state: GameState) => void;
          backgroundColor: BackgroundColorControl;
          onGameAnalytics: (data: NewGameData) => void;
      },
  ): Promise<void>;
  ```

- [ ] **Step 1: Write the failing test**

Same mocking approach as Task 13. Cover:

```ts
it('installs the shared puzzle, fits the view and persists it', async () => { /* … */ });

it('preloads the traced chunk only when the payload needs it', async () => {
    // A plain Classic link must not pay a chunk fetch.
});

it('regenerates the blank canvas at the recorded dimensions', async () => {
    // imageUrl 'blank' is a sentinel; geometry depends on the recorded size.
});

it('applies the attribution the link carried', async () => { /* … */ });

it('toasts when progress in the link could not be applied', async () => {
    // "Couldn't load progress — starting from scratch" — the puzzle still loads.
});

it('reports new-game-started with source shared and recipientHadSavedState', async () => { /* … */ });

it('reports sharedColor none when the link carried no color', async () => { /* … */ });

it('adopts a shared background color and reports the outcome', async () => {
    // Adoption goes through backgroundColor.adopt so the picker and the
    // theme re-apply stay consistent.
});

it('hides the loading overlay even when generation throws', async () => { /* … */ });
```

Write each body out following Task 13's pattern: build `deps` with spies, call `loadSharedPuzzle`, assert on the spies and on `umamiTrack`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/load-shared-puzzle.test.ts`
Expected: FAIL — cannot resolve `./load-shared-puzzle.js`.

- [ ] **Step 3: Write the implementation**

Move the function, substituting extracted modules and `deps`. Keep the comment explaining why `traceSetVersion` is read off the generated state rather than the payload — the crafted-link guard is structural, not restated per style.

- [ ] **Step 4: Rewire `main.ts`**

`loadSharedPuzzle(payload, hadSavedState)` → `loadSharedPuzzle(payload, hadSavedState, sharedDeps)` at both call sites (`tryLoadSharedPuzzle` and `__reproPuzzle`).

- [ ] **Step 5: Verify**

Run: `npx vitest run src/app/load-shared-puzzle.test.ts && npx tsc`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/load-shared-puzzle.ts src/app/load-shared-puzzle.test.ts src/main.ts
git commit -m "refactor(app): extract the share-link load flow"
```

---

### Task 15: `new-game-flow.ts`

The dialog open, the preference save fan-out, and the start call (`src/main.ts:1292-1385`). Nine preferences are written on select; a dropped one is a silent bug the user only notices next session.

**Files:**
- Create: `src/app/new-game-flow.ts`
- Test: `src/app/new-game-flow.test.ts`
- Modify: `src/main.ts:1292-1385`

**Interfaces:**
- Consumes: `createNewGameDialog`, the nine load/save preference pairs, `getSizeOption`, `toGridSize`, `composableSliderToGeneratorConfig`, `getBaseCutGenerator`, `fetchCandidateImages`, `orientationForViewport`, `preloadTracedTabGenerator`, `clearSavedState`, `runWithErrorReport`, `startNewGame`
- Produces:
  ```ts
  export function openNewGameDialog(deps: {
      container: HTMLElement;
      start: (gridSize: GridSize, options: StartNewGameOptions) => Promise<void>;
  }): void;
  ```

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../ui/new-game-dialog.js', () => ({ createNewGameDialog: vi.fn() }));

import { createNewGameDialog } from '../ui/new-game-dialog.js';
import { loadSizePreference } from '../game/puzzle-sizes.js';
import { loadCutStylePreference } from '../game/cut-styles.js';
import { openNewGameDialog } from './new-game-flow.js';

describe('openNewGameDialog', () => {
    let container: HTMLElement;
    let start: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        localStorage.clear();
        container = document.createElement('div');
        start = vi.fn(async () => {});
        vi.mocked(createNewGameDialog).mockClear();
    });

    function selectWith(overrides: Record<string, unknown> = {}) {
        openNewGameDialog({ container, start });
        const opts = vi.mocked(createNewGameDialog).mock.calls[0][0];
        opts.onSelect({
            sizeId: opts.selectedSizeId,
            cutStyleId: 'wavy',
            rotationEnabled: true,
            imageChoice: { kind: 'random' },
            imageCategory: 'nature',
            vibrant: true,
            ...overrides,
        } as never);
        return opts;
    }

    it('seeds the dialog from the saved preferences', () => {
        openNewGameDialog({ container, start });
        const opts = vi.mocked(createNewGameDialog).mock.calls[0][0];
        expect(opts.selectedSizeId).toBe(loadSizePreference());
        expect(opts.selectedCutStyleId).toBe(loadCutStylePreference());
    });

    it('persists the chosen size, cut style and rotation', () => {
        selectWith();
        expect(loadCutStylePreference()).toBe('wavy');
    });

    it('persists the image source as blank when a blank puzzle is chosen', () => {
        // No UI reads this preference anymore, but first-run detection depends
        // on the key existing and analytics still classifies by it.
        selectWith({ imageChoice: { kind: 'blank' } });
        expect(localStorage.length).toBeGreaterThan(0);
    });

    it('clears the saved game before starting a new one', () => {
        localStorage.setItem('puzzle-game-state', '{}');
        selectWith();
        expect(localStorage.getItem('puzzle-game-state')).toBeNull();
    });

    it('starts the game with the chosen options', () => {
        selectWith();
        expect(start).toHaveBeenCalledWith(
            expect.objectContaining({ cols: expect.any(Number) }),
            expect.objectContaining({ cutStyle: 'wavy', rotationEnabled: true, vibrant: true }),
        );
    });

    it('omits the seed so every dialog game is a fresh random puzzle', () => {
        selectWith();
        expect(start.mock.calls[0][1].seed).toBeUndefined();
    });

    it('passes a picked photo through', () => {
        const photo = { imageUrl: 'x', imageSize: { width: 1, height: 1 } };
        selectWith({ imageChoice: { kind: 'photo', photo } });
        expect(start.mock.calls[0][1].pickedImage).toBe(photo);
    });

    it('toasts and reports when the start rejects', async () => {
        start.mockRejectedValue(new Error('chunk boom'));
        selectWith();
        await vi.waitFor(() => {
            // runWithErrorReport shows "Couldn't start new game" and reports
            // new-game-failed attributed to the failing cut style.
        });
    });
});
```

Read `src/ui/new-game-dialog.ts` for the exact `onSelect` payload shape and fill the literal in `selectWith` accordingly. Complete the last test's assertions using the toast mock and `umamiTrack` as in Task 8.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/new-game-flow.test.ts`
Expected: FAIL — cannot resolve `./new-game-flow.js`.

- [ ] **Step 3: Write the implementation**

Move both handlers. Keep the comments on the `onPreloadTracedTabs` fire-and-forget (why the rejection is swallowed here but resurfaces at the real `await`), on the image-source preference still being written despite no UI reading it, and on the `runWithErrorReport` call explaining that a chunk-load failure is the likely rejection.

- [ ] **Step 4: Rewire `main.ts`**

The New Game button's `onNewGame` becomes `() => openNewGameDialog({ container: app, start: (grid, options) => startNewGame(grid, options, startNewGameDeps) })`.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/app/new-game-flow.test.ts && npx tsc`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/new-game-flow.ts src/app/new-game-flow.test.ts src/main.ts
git commit -m "refactor(app): extract the new-game dialog flow

Covers the nine-preference save fan-out, where a dropped write is a silent
bug the player only notices next session."
```

---

### Task 16: `share-link-loader.ts`

`tryLoadSharedPuzzle` (`src/main.ts:1757-1821`), `rescueUndecodableLink` (`:1722-1755`), `rescueStillOwnsGuard` (`:1710-1712`), and `rescueReloadPending` (`:1699`). The trickiest logic in the file: one rescue per link, guard ownership across an await, and a predicate whose meaning flips either side of that await.

**Files:**
- Create: `src/app/share-link-loader.ts`
- Test: `src/app/share-link-loader.test.ts`
- Modify: `src/main.ts:1699-1821`

**Interfaces:**
- Consumes: `parseLocationHash` from `../sharing/index.js`; `wasRescueAttempted`, `recordRescueAttempt`, `clearRescueAttempt` from `../pwa/share-link-rescue.js`; `loadState`, `clearSavedState`; `showToast`; loading-overlay helpers; `runWithErrorReport`; `track`
- Produces:
  ```ts
  export interface ShareLinkLoader {
      /**
       * Handle a `#p=` link if one is present. Resolves true when the boot
       * flow must not start a puzzle underneath it — either the shared puzzle
       * loaded, or a rescue reload is imminent.
       */
      tryLoad(): Promise<boolean>;
      /** True when a rescue update was applied and a reload is pending. */
      isRescueReloadPending(): boolean;
  }

  export function createShareLinkLoader(deps: {
      loadShared: (payload: SharePayload, recipientHadSavedState: boolean) => Promise<void>;
      /** `pwaUpdates.attemptShareLinkRescue`. */
      attemptRescue: () => Promise<'updated' | 'no-update' | 'failed'>;
      /** Injected for testing; defaults to window.confirm. */
      confirm?: (message: string) => boolean;
  }): ShareLinkLoader;
  ```

Read `src/pwa/register.ts` for `attemptShareLinkRescue`'s exact return union and use that type rather than the sketch above.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../ui/toast.js', () => ({ showToast: vi.fn() }));

import { showToast } from '../ui/toast.js';
import { createShareLinkLoader } from './share-link-loader.js';

describe('createShareLinkLoader', () => {
    let umamiTrack: ReturnType<typeof vi.fn>;
    let loadShared: ReturnType<typeof vi.fn>;
    let attemptRescue: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        localStorage.clear();
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
        loadShared = vi.fn(async () => {});
        attemptRescue = vi.fn(async () => 'no-update' as const);
        history.replaceState(null, '', '/');
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
        vi.mocked(showToast).mockClear();
        vi.restoreAllMocks();
    });

    function make(confirmResult = true) {
        return createShareLinkLoader({
            loadShared,
            attemptRescue,
            confirm: () => confirmResult,
        });
    }

    it('reports not handled when there is no hash', async () => {
        expect(await make().tryLoad()).toBe(false);
        expect(loadShared).not.toHaveBeenCalled();
    });

    it('ignores a hash that is not a share link', async () => {
        history.replaceState(null, '', '/#something-else');
        expect(await make().tryLoad()).toBe(false);
        expect(attemptRescue).not.toHaveBeenCalled();
    });

    it('attempts one rescue for an undecodable share link', async () => {
        history.replaceState(null, '', '/#p=not-a-real-payload');
        await make().tryLoad();
        expect(attemptRescue).toHaveBeenCalledTimes(1);
        expect(umamiTrack).toHaveBeenCalledWith(
            'share-link-rescue-attempted',
            expect.objectContaining({ outcome: 'no-update' }),
        );
    });

    it('halts the boot flow when a rescue update is pending', async () => {
        // The update controller reloads the page; starting a puzzle underneath
        // it would flash and then be thrown away.
        history.replaceState(null, '', '/#p=not-a-real-payload');
        attemptRescue.mockResolvedValue('updated');
        const loader = make();

        expect(await loader.tryLoad()).toBe(true);
        expect(loader.isRescueReloadPending()).toBe(true);
    });

    it('toasts and strips the hash when no update fixes the link', async () => {
        history.replaceState(null, '', '/#p=not-a-real-payload');
        await make().tryLoad();
        expect(showToast).toHaveBeenCalledWith('Invalid share link');
        expect(window.location.hash).toBe('');
    });

    it('does not retry the rescue for the same link after a reload', async () => {
        // The guard survives the reload; a second attempt would loop forever.
        history.replaceState(null, '', '/#p=not-a-real-payload');
        await make().tryLoad();
        vi.mocked(showToast).mockClear();
        attemptRescue.mockClear();

        history.replaceState(null, '', '/#p=not-a-real-payload');
        await make().tryLoad();

        expect(attemptRescue).not.toHaveBeenCalled();
        expect(umamiTrack).toHaveBeenCalledWith(
            'share-link-rescue-result',
            expect.objectContaining({ decoded: false }),
        );
    });

    it('closes the rescue funnel when the updated build decodes the link', async () => {
        // Construct: record a rescue attempt for a hash that DOES decode, then
        // load it. Use a real encoded payload from src/sharing/share-link.test.ts.
    });

    it('asks before discarding existing progress and honors a decline', async () => {
        // Declining leaves the hash in place so the user can reload to retry.
    });

    it('reports a generation failure and toasts', async () => {
        // A link can satisfy the schema and still trip the topology pipeline.
        loadShared.mockRejectedValue(new Error('topology boom'));
        // …assert 'shared-load-failed' with source 'shared' and the toast.
    });
});
```

For the three sketched bodies, take a real encoded `#p=` string from `src/sharing/share-link.test.ts` so `parseLocationHash` succeeds, then complete the assertions. Do not leave a test with only a comment body.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/share-link-loader.test.ts`
Expected: FAIL — cannot resolve `./share-link-loader.js`.

- [ ] **Step 3: Write the implementation**

Move all four pieces into the factory, closing over `rescueReloadPending`. Keep every comment: the one on `hashBody` being captured once before any await, the one on `rescueStillOwnsGuard` explaining why the same predicate has two names for its two readings, the one on why a non-persistable guard skips the rescue rather than risking a loop, and the one on why an unreadable save reads as no progress on this path.

- [ ] **Step 4: Rewire `main.ts`**

Construct the loader once; the boot flow calls `shareLinks.tryLoad()`, the `finally` reads `shareLinks.isRescueReloadPending()`, and the `hashchange` listener calls `void shareLinks.tryLoad()`.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/app/share-link-loader.test.ts && npx tsc`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/share-link-loader.ts src/app/share-link-loader.test.ts src/main.ts
git commit -m "refactor(app): extract the share-link loader and rescue

First coverage for one-rescue-per-link, guard ownership across the await,
and the invalid-link toast/strip decision."
```

---

### Task 17: `boot-sequence.ts`

The boot IIFE (`src/main.ts:1827-1931`): share > saved > fresh, the corrupt-save gate, first-run detection, viewport restore, and the `startWithBootFallback` wiring.

**Files:**
- Create: `src/app/boot-sequence.ts`
- Test: `src/app/boot-sequence.test.ts`
- Modify: `src/main.ts:1827-1931`

**Interfaces:**
- Consumes: `loadSavedGame`; `createCorruptSaveDialog`; `hideLoadingOverlay`; `startWithBootFallback`; the preference loaders; `imageSourcePreferenceExists`, `imageCategoryPreferenceExists`; `toGridSize`, `getSizeOption`; `composableSliderToGeneratorConfig`; `GameSession`; `ViewportTransform`; `track`
- Produces:
  ```ts
  export function runBootSequence(deps: {
      container: HTMLElement;
      session: GameSession;
      viewportTransform: ViewportTransform;
      applyTransform: () => void;
      /** Handle a `#p=` link; true means the boot flow must not start a puzzle. */
      tryLoadShared: () => Promise<boolean>;
      /** True when a rescue reload is imminent — leave the overlay up. */
      isRescueReloadPending: () => boolean;
      start: (gridSize: GridSize, options: StartNewGameOptions) => Promise<void>;
  }): Promise<void>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../ui/loading-overlay.js', () => ({
    showLoadingOverlay: vi.fn(),
    hideLoadingOverlay: vi.fn(),
}));

import { hideLoadingOverlay } from '../ui/loading-overlay.js';
import { ViewportTransform } from '../interaction/index.js';
import { makeGameState } from '../test-helpers/fixtures.js';
import { runBootSequence } from './boot-sequence.js';

describe('runBootSequence', () => {
    let umamiTrack: ReturnType<typeof vi.fn>;
    let install: ReturnType<typeof vi.fn>;
    let restoreSelection: ReturnType<typeof vi.fn>;
    let start: ReturnType<typeof vi.fn>;
    let hasGame: boolean;

    beforeEach(() => {
        localStorage.clear();
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
        install = vi.fn();
        restoreSelection = vi.fn();
        start = vi.fn(async () => { hasGame = true; });
        hasGame = false;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    function deps(overrides = {}) {
        return {
            container: document.createElement('div'),
            session: {
                install, restoreSelection,
                current: () => undefined,
                hasGame: () => hasGame,
            },
            viewportTransform: new ViewportTransform(),
            applyTransform: vi.fn(),
            tryLoadShared: vi.fn(async () => false),
            isRescueReloadPending: () => false,
            start,
            ...overrides,
        };
    }

    it('stops after a share link handled the boot', async () => {
        const d = deps({ tryLoadShared: vi.fn(async () => true) });
        await runBootSequence(d);
        expect(start).not.toHaveBeenCalled();
        expect(install).not.toHaveBeenCalled();
    });

    it('starts a fresh puzzle when there is no save', async () => {
        await runBootSequence(deps());
        expect(start).toHaveBeenCalledTimes(1);
    });

    it('marks a brand-new visitor as first-run', async () => {
        // A visitor with no save and no touched image preference gets the
        // hand-picked bundled image, not a random one.
        await runBootSequence(deps());
        expect(start.mock.calls[0][1].imageSource).toBe('first-run');
    });

    it('hides the loading overlay when boot finishes', async () => {
        await runBootSequence(deps());
        expect(hideLoadingOverlay).toHaveBeenCalled();
    });

    it('leaves the overlay up when a rescue reload is pending', async () => {
        // Otherwise the page flashes blank for the gap before the reload lands.
        await runBootSequence(deps({
            tryLoadShared: vi.fn(async () => true),
            isRescueReloadPending: () => true,
        }));
        expect(hideLoadingOverlay).not.toHaveBeenCalled();
    });

    it('substitutes a Classic puzzle when the preferred start fails', async () => {
        const failing = vi.fn()
            .mockRejectedValueOnce(new Error('chunk boom'))
            .mockImplementationOnce(async () => { hasGame = true; });
        await runBootSequence(deps({ start: failing }));
        expect(failing).toHaveBeenCalledTimes(2);
        expect(failing.mock.calls[1][1].bootFallback).toBe(true);
    });
});
```

Add the saved-game cases — restore, viewport restore, and the corrupt-save dialog — by seeding `localStorage` the way `src/persistence/storage.test.ts` does. Cover: `status: 'ok'` installs and restores selection; a saved viewport is applied; `status: 'unreadable'` reports `save-unreadable`, hides the overlay, opens the dialog, and continues to a fresh start once dismissed.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/boot-sequence.test.ts`
Expected: FAIL — cannot resolve `./boot-sequence.js`.

- [ ] **Step 3: Write the implementation**

Move the IIFE body into the function. Keep the comments on why the fallback drops the per-style configs while keeping size and image preferences, and on first-run detection meaning "empty save AND untouched image preferences". The `hasGame` predicate passed to `startWithBootFallback` becomes `deps.session.hasGame` — the comment explaining why it is not `gameState !== undefined` moves too, now pointing at `GameSession`.

- [ ] **Step 4: Rewire `main.ts`**

Replace the IIFE with `void runBootSequence({ ... });` followed by the existing `hashchange` registration, **in that order**.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/app/boot-sequence.test.ts && npx tsc`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/boot-sequence.ts src/app/boot-sequence.test.ts src/main.ts
git commit -m "refactor(app): extract the boot sequence

First coverage for share > saved > fresh precedence, first-run detection,
the corrupt-save gate, and leaving the overlay up for a rescue reload."
```

---

### Task 18: `global-handlers.ts`, `install-toolbar.ts`, `dev-hooks.ts`

The last three groups of wiring. Grouped because each is thin and they are approved or rejected together as "the rest of the wiring".

**Files:**
- Create: `src/app/global-handlers.ts`, `src/app/install-toolbar.ts`, `src/app/dev-hooks.ts`
- Test: `src/app/global-handlers.test.ts`, `src/app/install-toolbar.test.ts`, `src/app/dev-hooks.test.ts`
- Modify: `src/main.ts:148-191`, `:1278-1419`, `:1547-1560`, `:457-668`

**Interfaces:**
- Produces:
  ```ts
  /** Context menu suppression, analytics + error tracking, timing buffer, version badge. */
  export function installGlobalHandlers(container: HTMLElement): void;

  export function installToolbar(deps: {
      container: HTMLElement;
      session: GameSession;
      selectionManager: SelectionManager;
      fitView: (state: GameState) => void;
      save: (state: GameState) => void;
      renderer: Renderer;
      onNewGame: () => void;
      solve: () => void;
  }): void;

  export function installDevHooks(deps: {
      session: GameSession;
      renderer: Renderer;
      start: (gridSize: GridSize, options: StartNewGameOptions) => Promise<void>;
      loadShared: (payload: SharePayload, recipientHadSavedState: boolean) => Promise<void>;
      /** Frame and celebrate a solved puzzle — the completion zoom. */
      onSolved: (state: GameState, group: PieceGroup) => void;
  }): void;
  ```

`installToolbar` takes `solve` so the info modal's Solve button calls the same implementation `dev-hooks` exposes on `window.__solvePuzzle`, rather than looking the global up. Behavior is identical; `bootstrap` wires one function into both.

- [ ] **Step 1: Write the failing tests**

`src/app/global-handlers.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../analytics/index.js', () => ({
    initAnalytics: vi.fn(),
    initErrorTracking: vi.fn(),
    track: vi.fn(),
}));
vi.mock('../pwa/sw-error-bridge.js', () => ({ initSwErrorReporting: vi.fn() }));

import { initAnalytics, initErrorTracking } from '../analytics/index.js';
import { initSwErrorReporting } from '../pwa/sw-error-bridge.js';
import { installGlobalHandlers } from './global-handlers.js';

describe('installGlobalHandlers', () => {
    let container: HTMLElement;

    beforeEach(() => {
        vi.clearAllMocks();
        container = document.createElement('div');
        document.body.replaceChildren(container);
    });

    it('initializes analytics before error tracking and the worker bridge', () => {
        // Error reporting must not run before the tracker it reports through.
        installGlobalHandlers(container);
        const order = [
            vi.mocked(initAnalytics).mock.invocationCallOrder[0],
            vi.mocked(initErrorTracking).mock.invocationCallOrder[0],
            vi.mocked(initSwErrorReporting).mock.invocationCallOrder[0],
        ];
        expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('enlarges the resource-timing buffer', () => {
        // Backs the traced-chunk cacheState dimension on long PWA sessions.
        const spy = vi.fn();
        performance.setResourceTimingBufferSize = spy;
        installGlobalHandlers(container);
        expect(spy).toHaveBeenCalledWith(500);
    });

    it('suppresses the context menu on the puzzle table', () => {
        installGlobalHandlers(container);
        const table = document.createElement('div');
        table.dataset.puzzleTable = 'true';
        container.appendChild(table);

        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        table.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it('leaves the context menu alone outside the table', () => {
        // Long-press copy of share links and repro params inside the info
        // modal has to keep working.
        installGlobalHandlers(container);
        const modal = document.createElement('div');
        container.appendChild(modal);

        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        modal.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
    });
});
```

`src/app/install-toolbar.test.ts` — assert each button is created in the container, that Gather does nothing when there is no game, and that the three New Game readiness reads return zeros/false rather than throwing when `session.current()` is undefined (the #488 guards):

```ts
it('reads zero counts and not-completed when there is no game', () => {
    // Unguarded reads here threw and swallowed the click in exactly the
    // terminal state boot can leave behind (#488), making the one dialog
    // that can escape the failure the one thing unreachable.
    // …assert via the createNewGameButton mock's captured callbacks.
});

it('does nothing when Gather is tapped with no game', () => { /* … */ });
```

`src/app/dev-hooks.test.ts` — assert each hook is installed under its exact name, and cover `__reproPuzzle`'s validation contract:

```ts
it('installs all four hooks', () => {
    installDevHooks(deps());
    for (const name of ['__solvePuzzle', '__startVennPuzzle', '__newComposableGame', '__reproPuzzle']) {
        expect(typeof (window as never)[name]).toBe('function');
    }
});

it('__reproPuzzle resolves false for params the share codec rejects', async () => {
    installDevHooks(deps());
    await expect((window as never).__reproPuzzle({ seed: 'nope' })).resolves.toBe(false);
});

it('__reproPuzzle resolves true once the puzzle is on screen', async () => {
    // Use a valid ReproParams literal — see the docs on the hook.
});

it('__reproPuzzle clears the saved state but leaves the address bar alone', async () => {
    // A #p= link must stay reloadable after a replay.
});

it('__solvePuzzle is a no-op with no game', () => { /* … */ });
```

Complete every sketched body before running; a test whose body is only a comment fails the no-placeholder rule.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/global-handlers.test.ts src/app/install-toolbar.test.ts src/app/dev-hooks.test.ts`
Expected: FAIL — unresolved imports.

- [ ] **Step 3: Write the implementations**

Move each block. In `dev-hooks.ts` keep all four doc comments verbatim — they are the documented interface for these helpers, including `__reproPuzzle`'s notes on `imageSize` being part of the geometry contract, on attribution not being part of the params, and on the address bar deliberately being left alone.

- [ ] **Step 4: Rewire `main.ts`**

Replace the moved ranges with three calls. `main.ts` should now be roughly the composition root and nothing else.

- [ ] **Step 5: Verify**

Run: `npx vitest run && npx tsc`
Expected: full suite PASSes, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/global-handlers.ts src/app/global-handlers.test.ts \
        src/app/install-toolbar.ts src/app/install-toolbar.test.ts \
        src/app/dev-hooks.ts src/app/dev-hooks.test.ts src/main.ts
git commit -m "refactor(app): extract global handlers, toolbar and dev hooks

The info modal's Solve button now receives the same function dev-hooks
exposes on window, instead of looking the global up at click time."
```

---

### Task 19: `bootstrap.ts`, the `main.ts` reduction, and the guard

The composition root moves out, `main.ts` shrinks to five lines, and a test stops it regrowing.

**Files:**
- Create: `src/app/bootstrap.ts`, `src/app/bootstrap.test.ts`, `src/main.test.ts`
- Modify: `src/main.ts` (down to five lines), `CLAUDE.md`

**Interfaces:**
- Produces:
  ```ts
  export function bootstrap(
      root?: HTMLElement,
  ): void;
  ```
  Defaulting `root` to `document.querySelector<HTMLDivElement>('#app')!` inside the parameter list keeps the DOM lookup out of `main.ts` while letting a test pass its own container. The default is evaluated at call time, so importing the module boots nothing.

- [ ] **Step 1: Write the failing tests**

`src/app/bootstrap.test.ts` — assert the ordering invariants that were comments until now:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./global-handlers.js', () => ({ installGlobalHandlers: vi.fn() }));
vi.mock('./boot-sequence.js', () => ({ runBootSequence: vi.fn(async () => {}) }));

import { installGlobalHandlers } from './global-handlers.js';
import { runBootSequence } from './boot-sequence.js';
import { bootstrap } from './bootstrap.js';

describe('bootstrap', () => {
    let root: HTMLElement;

    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        root = document.createElement('div');
        document.body.replaceChildren(root);
    });

    it('installs global handlers before starting the boot sequence', () => {
        // Analytics and error tracking have to be up before anything that
        // can throw runs.
        bootstrap(root);
        expect(vi.mocked(installGlobalHandlers).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(runBootSequence).mock.invocationCallOrder[0]);
    });

    it('registers the hashchange listener after kicking off the boot sequence', () => {
        // Boot runs synchronously up to its first await, so this order is
        // observable. Preserved from main.ts, where the listener sat last.
        const addEventListener = vi.spyOn(window, 'addEventListener');
        bootstrap(root);

        const hashChangeCall = addEventListener.mock.invocationCallOrder[
            addEventListener.mock.calls.findIndex((c) => c[0] === 'hashchange')
        ];
        expect(hashChangeCall).toBeGreaterThan(
            vi.mocked(runBootSequence).mock.invocationCallOrder[0],
        );
    });

    it('renders the toolbar into the given root', () => {
        bootstrap(root);
        expect(root.children.length).toBeGreaterThan(0);
    });

    it('falls back to #app when no root is given', () => {
        const app = document.createElement('div');
        app.id = 'app';
        document.body.replaceChildren(app);

        expect(() => bootstrap()).not.toThrow();
        expect(app.children.length).toBeGreaterThan(0);
    });

    it('handles a hashchange by re-running the share-link loader', () => {
        bootstrap(root);
        vi.mocked(runBootSequence).mockClear();
        window.dispatchEvent(new Event('hashchange'));
        // The loader, not the boot sequence, handles a later hashchange.
        expect(runBootSequence).not.toHaveBeenCalled();
    });
});
```

`src/main.test.ts` — the guard:

```ts
/**
 * Guard: `main.ts` is an entry point, not a place to put logic.
 *
 * It cannot be imported under test — `index.html` loads it as a
 * side-effecting module — so anything living there is permanently
 * unreachable by the suite. That is how it reached 1939 lines. The
 * composition root is `src/app/bootstrap.ts`, which IS importable and has
 * tests; new wiring belongs there.
 *
 * Deliberately not a line-count cap: a threshold is a number the next
 * feature raises by ten. This assertion has nothing to relax — the next
 * statement added here fails it, whatever that statement is.
 */

import { describe, it, expect } from 'vitest';
import mainSrc from './main.ts?raw';

/** Source lines with comments and blank lines removed. */
function statements(src: string): string[] {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, '').trim())
        .filter((line) => line.length > 0);
}

describe('main.ts', () => {
    it('contains only imports and the bootstrap call', () => {
        const unexpected = statements(mainSrc).filter(
            (line) => !line.startsWith('import ') && line !== 'bootstrap();',
        );

        expect(
            unexpected,
            'main.ts must stay an entry point. Put new wiring in src/app/bootstrap.ts, '
                + 'which has tests, rather than adding it here where nothing can reach it.',
        ).toEqual([]);
    });

    it('imports the palette before the main stylesheet', () => {
        // Cascade order: palette.css defines the custom properties style.css reads.
        const imports = statements(mainSrc).filter((line) => line.startsWith('import '));
        expect(imports[0]).toContain('palette.css');
        expect(imports[1]).toContain('style.css');
    });

    it('calls bootstrap exactly once', () => {
        expect(statements(mainSrc).filter((line) => line === 'bootstrap();')).toHaveLength(1);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/bootstrap.test.ts src/main.test.ts`
Expected: `bootstrap.test.ts` FAILs on the unresolved import; `main.test.ts` FAILs listing every remaining statement in `main.ts`.

- [ ] **Step 3: Write `bootstrap.ts`**

Move what is left of `main.ts` into `bootstrap(root)`, in this order — the order is the tested contract:

```ts
export function bootstrap(
    root: HTMLElement = document.querySelector<HTMLDivElement>('#app')!,
): void {
    installGlobalHandlers(root);

    const renderer = new SvgDomRenderer();
    renderer.init(root);

    const selectionManager = new SelectionManager();
    const rotationFocus = new RotationFocus();
    const viewportTransform = new ViewportTransform();

    // …save coordinator, completion presenter, background color, rotation UI —
    // rotation UI before the session, because the session's onInstalled takes
    // its syncVisibility as a value.

    const session = createGameSession({ /* …, onInstalled: … */ });

    installToolbar({ /* … */ });
    installDevHooks({ /* … */ });

    void runBootSequence({ /* … */ });

    // After the boot sequence is kicked off, matching main.ts's original
    // ordering: boot runs synchronously to its first await.
    window.addEventListener('hashchange', () => {
        void shareLinks.tryLoad();
    });
}
```

- [ ] **Step 4: Reduce `main.ts` and document the convention**

`src/main.ts` in full:

```ts
import './palette.css';
import './style.css';
import { bootstrap } from './app/bootstrap.js';

bootstrap();
```

Add to `CLAUDE.md`:

```markdown
## Keep `main.ts` an entry point

`src/main.ts` is loaded by `index.html` as a side-effecting module, so
nothing in it can be imported or called by a test. It reached 1939 lines
because it was also the composition root, and every feature appended to it.

The composition root is now `src/app/bootstrap.ts`, which exports a function
and has tests (`bootstrap.test.ts` asserts the wiring order). **Put new
wiring there, with a test.** `src/main.test.ts` enforces that `main.ts`
holds nothing but its two CSS imports and the `bootstrap()` call — if you
find yourself wanting to raise that bar rather than clear it, the thing you
are adding belongs in `bootstrap.ts` or in a module it wires.
```

- [ ] **Step 5: Verify**

Run: `npx vitest run && npx tsc && npm run build`
Expected: full suite PASSes, typecheck clean, and the production build succeeds — the build is the only check that the entry point still resolves for Vite.

- [ ] **Step 6: Smoke-test the real app**

`npm run dev`, then work through the matrix the spec calls for. Unit tests cannot establish behavior preservation for a move this size:

- [ ] Fresh boot with no save → puzzle appears, is draggable
- [ ] Reload with a save → same puzzle, same zoom/pan, same selection
- [ ] Complete a puzzle → upright spin, zoom-to-fit, overlay
- [ ] Each rotation mode → quarter-turn buttons for Fractal, free handle for Wavy, neither for Classic
- [ ] Share link → loads, confirms before discarding progress
- [ ] Undecodable `#p=` link → "Invalid share link", hash stripped
- [ ] Corrupt save (hand-edit `puzzle-game-state` in localStorage) → recovery dialog, then boot continues
- [ ] New Game dialog → every preference survives a reload
- [ ] `__reproPuzzle` and `__newComposableGame` in the console still work

- [ ] **Step 7: Commit**

```bash
git add src/app/bootstrap.ts src/app/bootstrap.test.ts src/main.ts src/main.test.ts CLAUDE.md
git commit -m "refactor(app): move the composition root into bootstrap.ts

main.ts is now two CSS imports and a bootstrap() call. bootstrap.ts exports
a function rather than running on import, so the wiring order is finally
unit-testable: analytics before error tracking, rotation UI before the
session, hashchange registered after boot is kicked off.

main.test.ts keeps main.ts that way. It asserts the file holds nothing but
imports and the one call, rather than capping its line count — a threshold
is a number the next feature raises by ten, which is how this file reached
1939 lines."
```

- [ ] **Step 8: Open the PR**

```bash
git push -u origin refactor/main-composition-root
gh pr create --title "refactor: make main.ts's composition root testable" --body "$(cat <<'PRBODY'
Closes #501

`src/main.ts` was 1939 lines across 158 commits, and the one file no test
could reach — `index.html` imports it as a side-effecting module.

Extraction had stalled at pure helpers every time, because `gameState` was a
module-level `let` that ~25 closures read. This moves it into a
`GameSession` whose `current()` returns `GameState | undefined` and whose
`hasGame()` is a named predicate rather than a drag-teardown handle doing
double duty — both of #501's asks — and then moves the rest out behind it.

`main.ts` is now:

```ts
import './palette.css';
import './style.css';
import { bootstrap } from './app/bootstrap.js';

bootstrap();
```

22 new modules, 22 new test files. Two invariants that were comments in an
untested file are now tests: `hasGame()` stays false until interaction is
wired (#488), and the wiring order in `bootstrap.ts`.

Reviewable commit by commit — each one extracts a module, adds its test,
rewires `main.ts`, and deletes the inline original.

No behavior change. #500 stays separate on purpose, so a regression here is
attributable to the move rather than to a behavior fix tangled up in it.

Smoke-tested on dev: fresh boot, reload with save, completion spin, all
three rotation modes, share link, undecodable link, corrupt-save recovery,
preference round-trip, and the console hooks.
PRBODY
)"
```

---

## Self-Review

**Spec coverage.** Every module in the spec's inventory has a task: `game-session` (T10), the six pure modules (T2–T5), the seven controllers (T6–T9, T11–T12), the five flows (T13–T17), the four wiring modules (T18–T19). The 12 contracts in the spec's "Contracts that must survive" section map to tests as follows — 1 in T10, 2 in T11's unbound-reference design plus T19's ordering test, 3 in T18, 4 in T18, 5 in T19, 6 in T8, 7 in T19's `main.test.ts`, 8 in T8, 9 in T12, 10 in T18, 11 in T18, 12 as a review check rather than a test (no call reaching `createNewGame` is reordered). The guard is T19; the smoke matrix is T19 Step 6.

**Known gaps the implementer must close.** Three tasks contain test bodies given as comments rather than code, because they need a literal copied out of an existing test file that I did not want to guess at: T4's `SharePayload` base literal (copy from `src/sharing/share-link.test.ts`), T16's three rescue cases needing a real encoded `#p=` string (same file), and T14/T15/T18's sketched cases. Each is marked inline with what to read. **Do not commit a test whose body is only a comment** — that is a plan failure carried into the code.

**Placeholder scan.** T12's test contains `<a-real-preset-id>` twice, flagged inline with where to read the real value. No other placeholders.

**Type consistency.** `activeSnapTolerances` (T2) is consumed under that name by T9, T10, T11. `GameSession`'s four methods (T10) are used consistently by T13–T19. `StartNewGameOptions` and `StartNewGameDeps` (T13) are consumed by T15, T17, T18. `BackgroundColorControl.adopt` (T12) is consumed by T14. `RotationUi.syncVisibility` (T11) is consumed by T10's `onInstalled` and T19. `generatorConfigsForNewGame`'s `tracedTabsOk: boolean` (T3) is fed from `tracedTabs.kind === 'ok'` in T13.
