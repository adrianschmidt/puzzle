# Off-Main-Thread Puzzle Generation (#489) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the expensive piece-generation phase in a per-call Web Worker with a synchronous fallback, add a Cancel button to the loading overlay, and instrument generation timing in analytics.

**Architecture:** `createNewGame`'s middle phase (strategy dispatch → generate → quantize → seal) moves into a pure `runGeneration(request)` function that both a worker entry and a main-thread fallback call, so the PRNG-call-order contract has exactly one implementation. Orchestrators switch to `createNewGameAsync`, which resolves the seed on the main thread, generates off-thread (or falls back), and assembles `GameState` on the main thread. Cancel = AbortController → worker terminate → sentinel error → silent unwind.

**Tech Stack:** Vite module workers (`new Worker(new URL(...), { type: 'module' })`), Vitest + jsdom (no `Worker` — tests exercise the fallback and a stub Worker class), vite-plugin-pwa `injectManifest` precache.

**Spec:** `docs/superpowers/specs/2026-08-01-worker-generation-design.md`

## Global Constraints

- **PRNG contract:** never add, remove, or reorder `random()` calls inside any generator, and never change the call sequence reaching `strategy.generatePieces`. This plan only *relocates* the call site; generator internals are untouched.
- **Geometry tripwire:** `src/puzzle/topology/dcel-broad-phase-equivalence.test.ts` digests must stay green. If it goes red, a task broke generation equivalence — fix the task, NEVER `vitest -u` those snapshots.
- **Test code in this plan is a sketch, not a spec** (see `feedback_plan_test_code_is_untrusted`): before writing each test, read the real APIs it touches; after it passes, sanity-check it fails when the behavior is broken (comment out the code under test or invert a condition once).
- Test files live next to the source they test.
- American English in all code/identifiers.
- No info-modal changes: decided in the spec — Cancel on a loading overlay is self-explanatory.
- `umami.ts` doc comments are the operator-facing query spec — new fields/events need real documentation there, not stubs.
- Commit style: conventional commits, match `git log`. Branch: `feat/worker-generation` (already exists, has the spec commit).
- Run `npm test` (vitest run) for the suite; `npm run build` for typecheck+build.
- Vitest quirk: no `restoreMocks` in config; mock state leaks across tests — follow each test file's existing `beforeEach` reset pattern.

---

### Task 1: `generation-core.ts` — the pure generate phase

**Files:**
- Create: `src/game/generation-core.ts`
- Test: `src/game/generation-core.test.ts`

**Interfaces:**
- Consumes: `getCutStyleStrategy`/`StrategyContext` (`./cut-style-strategies.js`), `quantizePieceGeometry` (`../model/quantize-geometry.js`), `sealPieceGeometry` (`../model/seal-geometry.js`), `TabDebugSession` (`../puzzle/topology/tab-debug.js`).
- Produces (later tasks rely on these exact names):
  - `interface GenerationRequest { cutStyle: CutStyle; gridSize: GridSize; imageSize: Size; seed: number; fractalConfig?: FractalConfig; composableConfig?: ComposableConfig; wavyConfig?: { borderless?: boolean; traceSetVersion?: number }; trianglesConfig?: { traceSetVersion?: number }; classicConfig?: { traceSetVersion?: number }; tabDebug: boolean }`
  - `interface GenerationResult { pieces: Piece[]; puzzleSize: Size; autoGroups?: AutoGroup[]; tabDebugReport?: TabDebugReport; pieceCountMismatch?: PieceCountMismatch }`
  - `runGeneration(request: GenerationRequest): GenerationResult`
  - `requestNeedsTracedTabs(request: GenerationRequest): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// src/game/generation-core.test.ts
import { describe, it, expect } from 'vitest';
import { runGeneration, requestNeedsTracedTabs } from './generation-core.js';
import type { GenerationRequest } from './generation-core.js';

const IMAGE = { width: 1080, height: 720 };

function legacyClassicRequest(seed = 12345): GenerationRequest {
    return {
        cutStyle: 'classic',
        gridSize: { cols: 4, rows: 3 },
        imageSize: IMAGE,
        seed,
        tabDebug: false,
    };
}

describe('runGeneration', () => {
    it('is deterministic: same request twice yields identical results', () => {
        const a = runGeneration(legacyClassicRequest());
        const b = runGeneration(legacyClassicRequest());
        expect(b).toEqual(a);
    });

    it('produces quantized, sealed pieces (bounds present, no curve samples)', () => {
        const { pieces } = runGeneration(legacyClassicRequest());
        expect(pieces).toHaveLength(12);
        for (const piece of pieces) {
            expect(piece.bounds).toBeDefined();
            for (const edge of piece.edges) {
                expect('curvePoints' in edge).toBe(false);
            }
        }
    });

    it('returns the inscribed puzzle size (full image for classic)', () => {
        const { puzzleSize } = runGeneration(legacyClassicRequest());
        expect(puzzleSize).toEqual(IMAGE);
    });

    it('survives structuredClone losslessly (worker-protocol guard)', () => {
        const result = runGeneration(legacyClassicRequest());
        expect(structuredClone(result)).toEqual(result);
    });

    it('different seeds produce different geometry', () => {
        const a = runGeneration(legacyClassicRequest(1));
        const b = runGeneration(legacyClassicRequest(2));
        expect(a.pieces[0].shape).not.toEqual(b.pieces[0].shape);
    });
});

describe('requestNeedsTracedTabs', () => {
    const base = legacyClassicRequest();
    it.each<[string, Partial<GenerationRequest>, boolean]>([
        ['legacy classic', {}, false],
        ['sine classic', { classicConfig: { traceSetVersion: 1 } }, true],
        ['wavy legacy tabs', { cutStyle: 'wavy', wavyConfig: { borderless: false } }, false],
        ['wavy traced', { cutStyle: 'wavy', wavyConfig: { traceSetVersion: 1 } }, true],
        ['triangles', { cutStyle: 'triangles' }, true],
        ['fractal', { cutStyle: 'fractal' }, false],
        ['composable classic tabs', { cutStyle: 'composable', composableConfig: { tabGenerator: 'classic' } as never }, false],
        ['composable traced tabs', { cutStyle: 'composable', composableConfig: { tabGenerator: 'traced' } as never }, true],
    ])('%s', (_name, overrides, expected) => {
        expect(requestNeedsTracedTabs({ ...base, ...overrides })).toBe(expected);
    });
});
```

Before writing: read `src/puzzle/composable-generator.ts` for the real `ComposableConfig` shape (fix the `as never` casts to real minimal configs) and `src/model/types.ts` for `Piece`/`GeneratedEdge` (confirm the sealed-edge `curvePoints` check matches reality — see `src/model/seal-geometry.ts`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/generation-core.test.ts`
Expected: FAIL — module `./generation-core.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/game/generation-core.ts
/**
 * The pure generate phase of creating a new game: strategy dispatch,
 * piece generation, quantization, sealing. Extracted from `init.ts` so
 * the generation worker and the synchronous main-thread fallback run
 * byte-identical code — the seeded-PRNG call-order contract (share
 * links/saves replay puzzles from the seed alone) has exactly one
 * implementation regardless of which thread executes it.
 *
 * Request and result are plain structured-cloneable data; the result
 * crosses a `postMessage` boundary on the worker path. Quantize + seal
 * run here — inside the worker — deliberately: sealing drops the dense
 * curve samples before the clone, which is most of the payload.
 */

import type { GridSize, Piece, Size } from '../model/types.js';
import type { FractalConfig } from '../puzzle/fractal/index.js';
import type { ComposableConfig } from '../puzzle/composable-generator.js';
import type { AutoGroup } from '../puzzle/topology/auto-group.js';
import type { PieceCountMismatch } from '../puzzle/topology/generator.js';
import type { TabDebugReport } from '../puzzle/topology/tab-debug.js';
import { TabDebugSession } from '../puzzle/topology/tab-debug.js';
import { quantizePieceGeometry } from '../model/quantize-geometry.js';
import { sealPieceGeometry } from '../model/seal-geometry.js';
import type { CutStyle } from './cut-styles.js';
import { getCutStyleStrategy } from './cut-style-strategies.js';

/** Everything the generate phase needs. Plain data — worker-safe. */
export interface GenerationRequest {
    cutStyle: CutStyle;
    gridSize: GridSize;
    imageSize: Size;
    seed: number;
    fractalConfig?: FractalConfig;
    composableConfig?: ComposableConfig;
    wavyConfig?: { borderless?: boolean; traceSetVersion?: number };
    trianglesConfig?: { traceSetVersion?: number };
    classicConfig?: { traceSetVersion?: number };
    /**
     * Whether to run a tab-debug session. A boolean, not a session:
     * the flag is read from the URL on the main thread (workers have no
     * `window.location`) and the live session object cannot cross the
     * worker boundary — so the session is constructed here and only its
     * plain-data report travels back.
     */
    tabDebug: boolean;
}

/** What the generate phase yields. Plain data — worker-safe. */
export interface GenerationResult {
    pieces: Piece[];
    puzzleSize: Size;
    autoGroups?: AutoGroup[];
    tabDebugReport?: TabDebugReport;
    pieceCountMismatch?: PieceCountMismatch;
}

export function runGeneration(request: GenerationRequest): GenerationResult {
    const strategy = getCutStyleStrategy(request.cutStyle);
    const tabDebug = request.tabDebug ? new TabDebugSession() : undefined;
    const ctx = {
        fractalConfig: request.fractalConfig,
        composableConfig: request.composableConfig,
        wavyConfig: request.wavyConfig,
        trianglesConfig: request.trianglesConfig,
        classicConfig: request.classicConfig,
        tabDebug,
    };

    const generationGrid = strategy.scaleGrid(request.gridSize, request.imageSize, ctx);
    const puzzleSize = strategy.inscribePuzzleSize(request.imageSize, generationGrid, ctx);
    const { pieces: rawPieces, autoGroups, tabDebugReport, pieceCountMismatch } =
        strategy.generatePieces(generationGrid, puzzleSize, request.seed, ctx);

    const pieces = sealPieceGeometry(quantizePieceGeometry(rawPieces));

    return { pieces, puzzleSize, autoGroups, tabDebugReport, pieceCountMismatch };
}

/**
 * Whether generating this request will hit the traced-tab generator, and
 * so needs the lazy traced chunk loaded first. The worker entry awaits
 * the chunk based on this; keep it in step with which strategies pass
 * `tabGenerator: 'traced'` in `cut-style-strategies.ts` (its test
 * enumerates them). Mirrors `needsTracedTabChunk`
 * (`app/share-payload-to-init.ts`), which answers the same question for
 * a share payload rather than a request.
 */
export function requestNeedsTracedTabs(request: GenerationRequest): boolean {
    switch (request.cutStyle) {
        case 'triangles':
            return true;
        case 'classic':
            return request.classicConfig?.traceSetVersion !== undefined;
        case 'wavy':
            return request.wavyConfig?.traceSetVersion !== undefined;
        case 'composable':
            return request.composableConfig?.tabGenerator === 'traced';
        case 'fractal':
            return false;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/generation-core.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/generation-core.ts src/game/generation-core.test.ts
git commit -m "feat(generation): extract the pure generate phase into runGeneration"
```

---

### Task 2: `init.ts` delegates to `runGeneration` (behavior-preserving refactor)

**Files:**
- Modify: `src/game/init.ts` (the `createNewGame` body, lines ~94–167)
- Test: existing suites are the guard — `src/game/init.test.ts`, `src/game/init-configs.test.ts`, `src/game/init-geometry-precision.test.ts`, `src/puzzle/topology/dcel-broad-phase-equivalence.test.ts`

**Interfaces:**
- Consumes: `runGeneration`, `GenerationRequest`, `GenerationResult` from Task 1.
- Produces (Task 5 relies on these): internal helpers in `init.ts` —
  - `buildGenerationRequest(gridSize: GridSize, imageSize: Size, seed: number, options: InitOptions): GenerationRequest` (module-private)
  - `assembleGameState(imageUrl: string, viewport: Size, gridSize: GridSize, options: InitOptions, seed: number, result: GenerationResult): GameState` (module-private)
  - `createNewGame` keeps its exact current signature and behavior.

- [ ] **Step 1: Refactor `createNewGame`**

Replace the generation portion of `createNewGame` so the function reads:

```ts
export function createNewGame(
    imageUrl: string,
    imageSize: Size,
    viewport: Size,
    gridSize: GridSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    options: InitOptions = {},
): GameState {
    const seed = options.seed ?? generateSeed();
    const result = runGeneration(buildGenerationRequest(gridSize, imageSize, seed, options));
    return assembleGameState(imageUrl, viewport, gridSize, options, seed, result);
}

function buildGenerationRequest(
    gridSize: GridSize,
    imageSize: Size,
    seed: number,
    options: InitOptions,
): GenerationRequest {
    return {
        cutStyle: options.cutStyle ?? 'classic',
        gridSize,
        imageSize,
        seed,
        fractalConfig: options.fractalConfig,
        composableConfig: options.composableConfig,
        wavyConfig: options.wavyConfig,
        trianglesConfig: options.trianglesConfig,
        classicConfig: options.classicConfig,
        tabDebug: tabDebugEnabled(),
    };
}

function assembleGameState(
    imageUrl: string,
    viewport: Size,
    gridSize: GridSize,
    options: InitOptions,
    seed: number,
    result: GenerationResult,
): GameState {
    const cutStyle = options.cutStyle ?? 'classic';
    const rotationMode = options.rotationMode ?? 'none';
    const { pieces, puzzleSize, autoGroups, tabDebugReport, pieceCountMismatch } = result;

    if (pieceCountMismatch) {
        options.onPieceCountMismatch?.(pieceCountMismatch);
    }

    if (tabDebugReport) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__tabDebug = tabDebugReport;
        // eslint-disable-next-line no-console
        console.info('[tabDebug] report attached to window.__tabDebug',
            { pieceCount: Object.keys(tabDebugReport).length });
    }

    const groups = createInitialGroups(
        pieces, puzzleSize, viewport, gridSize, options, autoGroups,
    );
    const { groupsById, pieceToGroup } = buildGroupIndexes(groups);

    const strategy = getCutStyleStrategy(cutStyle);
    return {
        pieces,
        groups,
        piecesById: buildPiecesById(pieces),
        groupsById,
        pieceToGroup,
        imageUrl,
        imageSize: puzzleSize,
        gridSize,
        completed: false,
        seed,
        cutStyle,
        rotationMode,
        composableConfig: strategy.configKey === 'composableConfig' ? options.composableConfig : undefined,
        fractalConfig: strategy.configKey === 'fractalConfig' ? options.fractalConfig : undefined,
        wavyConfig: strategy.configKey === 'wavyConfig' ? options.wavyConfig : undefined,
        trianglesConfig: strategy.configKey === 'trianglesConfig' ? options.trianglesConfig : undefined,
        classicConfig: strategy.configKey === 'classicConfig' ? options.classicConfig : undefined,
    };
}
```

Preserve the existing doc comments (move the quantize/seal comment onto `generation-core.ts` if Task 1 didn't already carry it; leave a pointer in `init.ts`). `TabDebugSession` import moves out of `init.ts` (now unused there); `tabDebugEnabled()` stays. Delete nothing else.

- [ ] **Step 2: Run the guard suites**

Run: `npx vitest run src/game/ src/puzzle/topology/dcel-broad-phase-equivalence.test.ts`
Expected: ALL PASS — this is a pure relocation. A digest failure means the refactor changed generation behavior: stop and fix, do not re-record.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/game/init.ts src/game/generation-core.ts
git commit -m "refactor(game): route createNewGame through runGeneration"
```

---

### Task 3: worker entry — `generation-worker-core.ts` + `generation-worker.ts`

**Files:**
- Create: `src/game/generation-worker-core.ts` (testable handler)
- Create: `src/game/generation-worker.ts` (3-line worker entry — deliberately untested; assigning `self.onmessage` in the shared jsdom would leak globally)
- Test: `src/game/generation-worker-core.test.ts`

**Interfaces:**
- Consumes: `runGeneration`, `requestNeedsTracedTabs`, `GenerationRequest`, `GenerationResult` (Task 1); `preloadTracedTabGenerator` (`../puzzle/topology/traced-tab-loader.js`).
- Produces (Task 4 relies on the message shape):
  - `type GenerationResponse = { ok: true; result: GenerationResult } | { ok: false; error: string }`
  - `handleGenerationRequest(request: GenerationRequest): Promise<GenerationResponse>`

- [ ] **Step 1: Write the failing test**

```ts
// src/game/generation-worker-core.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../puzzle/topology/traced-tab-loader.js', () => ({
    preloadTracedTabGenerator: vi.fn(),
}));

import { preloadTracedTabGenerator } from '../puzzle/topology/traced-tab-loader.js';
import { handleGenerationRequest } from './generation-worker-core.js';
import type { GenerationRequest } from './generation-core.js';

const LEGACY_CLASSIC: GenerationRequest = {
    cutStyle: 'classic',
    gridSize: { cols: 4, rows: 3 },
    imageSize: { width: 1080, height: 720 },
    seed: 42,
    tabDebug: false,
};

beforeEach(() => {
    vi.mocked(preloadTracedTabGenerator).mockReset().mockResolvedValue(undefined);
});

describe('handleGenerationRequest', () => {
    it('generates without touching the traced chunk for legacy classic', async () => {
        const response = await handleGenerationRequest(LEGACY_CLASSIC);
        expect(response.ok).toBe(true);
        if (response.ok) expect(response.result.pieces).toHaveLength(12);
        expect(preloadTracedTabGenerator).not.toHaveBeenCalled();
    });

    it('awaits the traced chunk before generating a traced request', async () => {
        // Traced request; the mocked preload resolves but registers nothing,
        // so generation itself may fail — the assertion is about the await.
        const request: GenerationRequest = {
            ...LEGACY_CLASSIC,
            cutStyle: 'triangles',
        };
        await handleGenerationRequest(request);
        expect(preloadTracedTabGenerator).toHaveBeenCalledOnce();
    });

    it('returns ok:false with a message when the preload rejects', async () => {
        vi.mocked(preloadTracedTabGenerator)
            .mockRejectedValue(new Error('chunk fetch failed'));
        const response = await handleGenerationRequest(
            { ...LEGACY_CLASSIC, cutStyle: 'triangles' },
        );
        expect(response).toEqual({ ok: false, error: 'chunk fetch failed' });
    });

    it('returns ok:false when generation throws', async () => {
        // Traced generation with a resolved-but-empty registry throws the
        // stub's "not loaded" error — a real failure mode (loader contract).
        const response = await handleGenerationRequest(
            { ...LEGACY_CLASSIC, cutStyle: 'triangles' },
        );
        expect(response.ok).toBe(false);
    });
});
```

Check the real behavior of the traced stub before relying on the last test: with `preloadTracedTabGenerator` mocked to resolve without registering, `tracedTabGeneratorStub.generate` throws "Traced tab library not loaded" — confirm by reading `src/puzzle/topology/traced-tab-loader.ts:114-122`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/generation-worker-core.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/game/generation-worker-core.ts
/**
 * The generation worker's message handler, separated from the worker
 * entry (`generation-worker.ts`) so it can be unit-tested: importing
 * the entry in jsdom would assign `self.onmessage` on the shared
 * window and leak across tests.
 *
 * Runs in worker context in production. `track()` calls made by the
 * traced-tab loader no-op there (its `typeof window` guard) — accepted
 * by design; a worker-side chunk failure surfaces to analytics as
 * `generationMode: 'sync-fallback'` on `new-game-started` instead.
 */

import { preloadTracedTabGenerator } from '../puzzle/topology/traced-tab-loader.js';
import {
    runGeneration,
    requestNeedsTracedTabs,
    type GenerationRequest,
    type GenerationResult,
} from './generation-core.js';

export type GenerationResponse =
    | { ok: true; result: GenerationResult }
    | { ok: false; error: string };

export async function handleGenerationRequest(
    request: GenerationRequest,
): Promise<GenerationResponse> {
    try {
        if (requestNeedsTracedTabs(request)) {
            // The worker bundle has its own copy of the lazy traced
            // chunk (separate Rollup graph); the main thread's preload
            // does not warm it. Loaded on demand here.
            await preloadTracedTabGenerator();
        }
        return { ok: true, result: runGeneration(request) };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
```

```ts
// src/game/generation-worker.ts
/**
 * Worker entry for off-thread puzzle generation. Kept to a bare
 * message-loop shell — all logic lives in `generation-worker-core.ts`,
 * which the tests import instead (importing this file in jsdom would
 * assign `self.onmessage` on the shared window).
 */

import { handleGenerationRequest } from './generation-worker-core.js';
import type { GenerationRequest } from './generation-core.js';
import type { GenerationResponse } from './generation-worker-core.js';

const workerScope = self as unknown as {
    onmessage: ((event: MessageEvent<GenerationRequest>) => void) | null;
    postMessage(message: GenerationResponse): void;
};

workerScope.onmessage = (event) => {
    void handleGenerationRequest(event.data).then((response) => {
        workerScope.postMessage(response);
    });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/generation-worker-core.test.ts`
Expected: PASS. Also run `npx tsc --noEmit` to confirm the `workerScope` typing compiles.

- [ ] **Step 5: Commit**

```bash
git add src/game/generation-worker-core.ts src/game/generation-worker-core.test.ts src/game/generation-worker.ts
git commit -m "feat(generation): add the generation worker entry and handler"
```

---

### Task 4: `generate-async.ts` — worker client with sync fallback and cancel

**Files:**
- Create: `src/game/generate-async.ts`
- Test: `src/game/generate-async.test.ts`

**Interfaces:**
- Consumes: Task 1's `runGeneration`/`GenerationRequest`/`GenerationResult`; Task 3's `GenerationResponse` message shape; `diagnostics` (`../diagnostics.js`); `sanitizeErrorReason` (`../analytics/sanitize-error-reason.js`).
- Produces (Task 5/8/9 rely on these):
  - `class GenerationCancelledError extends Error`
  - `interface OffThreadGeneration { result: GenerationResult; mode: 'worker' | 'sync-fallback'; fallbackReason?: string }`
  - `generatePiecesOffThread(request: GenerationRequest, signal?: AbortSignal): Promise<OffThreadGeneration>`

- [ ] **Step 1: Write the failing test**

jsdom has no `Worker`; the worker path is tested by installing a stub class on `globalThis` and restoring it after each test (mock state leaks across tests in this repo — clean up explicitly).

```ts
// src/game/generate-async.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    generatePiecesOffThread,
    GenerationCancelledError,
} from './generate-async.js';
import { runGeneration, type GenerationRequest } from './generation-core.js';

const REQUEST: GenerationRequest = {
    cutStyle: 'classic',
    gridSize: { cols: 4, rows: 3 },
    imageSize: { width: 1080, height: 720 },
    seed: 7,
    tabDebug: false,
};

/** Minimal Worker stand-in driven by each test. */
class StubWorker {
    static instances: StubWorker[] = [];
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: { message?: string }) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    posted: unknown[] = [];
    terminated = false;
    constructor() { StubWorker.instances.push(this); }
    postMessage(msg: unknown) { this.posted.push(msg); }
    terminate() { this.terminated = true; }
}

const originalWorker = (globalThis as { Worker?: unknown }).Worker;

beforeEach(() => { StubWorker.instances = []; });
afterEach(() => {
    (globalThis as { Worker?: unknown }).Worker = originalWorker;
});

describe('generatePiecesOffThread', () => {
    it('falls back synchronously when Worker is undefined (jsdom default)', async () => {
        delete (globalThis as { Worker?: unknown }).Worker;
        const outcome = await generatePiecesOffThread(REQUEST);
        expect(outcome.mode).toBe('sync-fallback');
        expect(outcome.fallbackReason).toBe('no-worker');
        expect(outcome.result).toEqual(runGeneration(REQUEST));
    });

    it('uses the worker path: posts the request, resolves with the result, terminates', async () => {
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const promise = generatePiecesOffThread(REQUEST);
        const worker = StubWorker.instances[0];
        expect(worker.posted).toEqual([REQUEST]);
        const result = runGeneration(REQUEST);
        worker.onmessage!({ data: { ok: true, result } });
        const outcome = await promise;
        expect(outcome).toEqual({ result, mode: 'worker' });
        expect(worker.terminated).toBe(true);
    });

    it('falls back to sync generation when the worker reports an error', async () => {
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const promise = generatePiecesOffThread(REQUEST);
        StubWorker.instances[0].onmessage!({ data: { ok: false, error: 'boom' } });
        const outcome = await promise;
        expect(outcome.mode).toBe('sync-fallback');
        expect(outcome.fallbackReason).toContain('boom');
        expect(outcome.result).toEqual(runGeneration(REQUEST));
        expect(StubWorker.instances[0].terminated).toBe(true);
    });

    it('falls back when the worker itself errors (onerror)', async () => {
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const promise = generatePiecesOffThread(REQUEST);
        StubWorker.instances[0].onerror!({ message: 'script failed to load' });
        const outcome = await promise;
        expect(outcome.mode).toBe('sync-fallback');
        expect(StubWorker.instances[0].terminated).toBe(true);
    });

    it('abort during worker generation terminates and throws the sentinel', async () => {
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const controller = new AbortController();
        const promise = generatePiecesOffThread(REQUEST, controller.signal);
        controller.abort();
        await expect(promise).rejects.toBeInstanceOf(GenerationCancelledError);
        expect(StubWorker.instances[0].terminated).toBe(true);
    });

    it('an already-aborted signal throws before spawning anything', async () => {
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const controller = new AbortController();
        controller.abort();
        await expect(generatePiecesOffThread(REQUEST, controller.signal))
            .rejects.toBeInstanceOf(GenerationCancelledError);
        expect(StubWorker.instances).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/generate-async.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/game/generate-async.ts
/**
 * Main-thread client for off-thread puzzle generation.
 *
 * Spawns a fresh worker per call and terminates it when done: per-call
 * lifetime keeps cancellation trivial (terminate) and leaves no stale
 * worker-side state, and spawn cost is milliseconds against a
 * once-per-new-game operation. On ANY worker-path failure — no Worker
 * in this environment, spawn failure, worker-side error — generation
 * falls back to running synchronously on the main thread, which is
 * exactly the pre-worker status quo.
 *
 * Cancellation: an aborted signal terminates the worker and rejects
 * with {@link GenerationCancelledError}. Cancel never falls back —
 * the user asked for no puzzle, not a slower one.
 */

import { diagnostics } from '../diagnostics.js';
import { sanitizeErrorReason } from '../analytics/sanitize-error-reason.js';
import {
    runGeneration,
    type GenerationRequest,
    type GenerationResult,
} from './generation-core.js';
import type { GenerationResponse } from './generation-worker-core.js';

/** Rejection sentinel for a cancelled generation. */
export class GenerationCancelledError extends Error {
    constructor() {
        super('Puzzle generation cancelled');
        this.name = 'GenerationCancelledError';
    }
}

export interface OffThreadGeneration {
    result: GenerationResult;
    mode: 'worker' | 'sync-fallback';
    /** Present only when `mode` is `'sync-fallback'`. */
    fallbackReason?: string;
}

export async function generatePiecesOffThread(
    request: GenerationRequest,
    signal?: AbortSignal,
): Promise<OffThreadGeneration> {
    if (signal?.aborted) throw new GenerationCancelledError();

    if (typeof Worker === 'undefined') {
        return {
            result: runGeneration(request),
            mode: 'sync-fallback',
            fallbackReason: 'no-worker',
        };
    }

    try {
        const result = await runInWorker(request, signal);
        return { result, mode: 'worker' };
    } catch (err) {
        if (err instanceof GenerationCancelledError) throw err;
        diagnostics.warn('Generation worker failed; falling back to main thread:', err);
        if (signal?.aborted) throw new GenerationCancelledError();
        return {
            result: runGeneration(request),
            mode: 'sync-fallback',
            fallbackReason: sanitizeErrorReason(err),
        };
    }
}

function runInWorker(
    request: GenerationRequest,
    signal?: AbortSignal,
): Promise<GenerationResult> {
    return new Promise<GenerationResult>((resolve, reject) => {
        const worker = new Worker(
            new URL('./generation-worker.js', import.meta.url),
            { type: 'module' },
        );
        const settle = (fn: () => void) => {
            worker.terminate();
            signal?.removeEventListener('abort', onAbort);
            fn();
        };
        const onAbort = () => settle(() => reject(new GenerationCancelledError()));
        signal?.addEventListener('abort', onAbort);
        worker.onmessage = (event: MessageEvent<GenerationResponse>) => settle(() => {
            if (event.data.ok) resolve(event.data.result);
            else reject(new Error(event.data.error));
        });
        worker.onerror = (event) => settle(() =>
            reject(new Error(event.message || 'Generation worker error')));
        worker.onmessageerror = () => settle(() =>
            reject(new Error('Generation worker response failed to deserialize')));
        worker.postMessage(request);
    });
}
```

Note on the URL specifier: this repo uses `.js` specifiers with bundler resolution, and Vite resolves worker URLs through the same pipeline. Task 10 verifies the emitted worker chunk in a real build; if `vite build` cannot resolve `./generation-worker.js`, the fix is using the `.ts` extension in this one specifier (Vite's documented pattern) — change it there, not silently here.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/generate-async.test.ts`
Expected: PASS.

- [ ] **Step 5: Sanity-check the tests catch breakage**

Temporarily swap `worker.terminate()` out of `settle` — the terminate assertions must fail. Revert.

- [ ] **Step 6: Commit**

```bash
git add src/game/generate-async.ts src/game/generate-async.test.ts
git commit -m "feat(generation): worker client with sync fallback and cancellation"
```

---

### Task 5: `createNewGameAsync` in `init.ts`, exported via `game/index.ts`

**Files:**
- Modify: `src/game/init.ts`, `src/game/index.ts`
- Test: `src/game/init.test.ts` (add a describe block)

**Interfaces:**
- Consumes: Task 4's `generatePiecesOffThread` / `GenerationCancelledError`; Task 2's `buildGenerationRequest` / `assembleGameState`.
- Produces (Tasks 8/9 rely on these):
  - `interface CreateNewGameAsyncResult { state: GameState; generation: { mode: 'worker' | 'sync-fallback'; durationMs: number; fallbackReason?: string } }`
  - `createNewGameAsync(imageUrl: string, imageSize: Size, viewport: Size, gridSize?: GridSize, options?: InitOptions, signal?: AbortSignal): Promise<CreateNewGameAsyncResult>`
  - `game/index.ts` re-exports: `createNewGameAsync`, `CreateNewGameAsyncResult` (type), `GenerationCancelledError`.

- [ ] **Step 1: Write the failing test** (append to `src/game/init.test.ts`, following its existing fixture style — read the file first)

```ts
describe('createNewGameAsync', () => {
    // jsdom has no Worker, so this exercises the sync-fallback path with
    // real generation — worker-path mechanics are generate-async.test.ts's job.
    const viewport = { width: 800, height: 600 };
    const imageSize = { width: 1080, height: 720 };

    it('resolves to the same state createNewGame builds for the same seed', async () => {
        const options = { seed: 123, cutStyle: 'classic' as const };
        const { state, generation } = await createNewGameAsync(
            'img.jpg', imageSize, viewport, { cols: 4, rows: 3 }, options,
        );
        const sync = createNewGame('img.jpg', imageSize, viewport, { cols: 4, rows: 3 }, options);
        expect(state.pieces).toEqual(sync.pieces);
        expect(state.seed).toBe(123);
        expect(generation.mode).toBe('sync-fallback');
        expect(generation.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('fires onPieceCountMismatch before resolving', async () => {
        // Use whichever config init.test.ts already uses to trigger a
        // mismatch, if one exists; otherwise assert the callback is simply
        // not called for a healthy classic generation:
        const onPieceCountMismatch = vi.fn();
        await createNewGameAsync('img.jpg', imageSize, viewport, { cols: 4, rows: 3 },
            { seed: 1, onPieceCountMismatch });
        expect(onPieceCountMismatch).not.toHaveBeenCalled();
    });

    it('rejects with GenerationCancelledError on an aborted signal', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(createNewGameAsync(
            'img.jpg', imageSize, viewport, { cols: 4, rows: 3 }, { seed: 1 },
            controller.signal,
        )).rejects.toBeInstanceOf(GenerationCancelledError);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/init.test.ts`
Expected: FAIL — `createNewGameAsync` not exported.

- [ ] **Step 3: Implement**

In `src/game/init.ts`:

```ts
import { generatePiecesOffThread } from './generate-async.js';

/** What {@link createNewGameAsync} resolves to: the state plus how its
 * generation ran, for the `new-game-started` analytics fields. */
export interface CreateNewGameAsyncResult {
    state: GameState;
    generation: {
        mode: 'worker' | 'sync-fallback';
        durationMs: number;
        fallbackReason?: string;
    };
}

/**
 * Async counterpart of {@link createNewGame}: identical inputs and
 * resulting state, but the expensive generate phase runs in a Web
 * Worker when the environment provides one (`generate-async.ts`),
 * falling back to the synchronous path otherwise. The orchestrators
 * (`app/start-new-game.ts`, `app/load-shared-puzzle.ts`) call this;
 * everything else — tests included — can keep using the sync function.
 *
 * `options.onPieceCountMismatch` fires before the promise resolves, so
 * callers that capture into a local and read it after the await behave
 * exactly as they did around the sync call.
 *
 * Rejects with {@link GenerationCancelledError} when `signal` aborts.
 */
export async function createNewGameAsync(
    imageUrl: string,
    imageSize: Size,
    viewport: Size,
    gridSize: GridSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    options: InitOptions = {},
    signal?: AbortSignal,
): Promise<CreateNewGameAsyncResult> {
    const seed = options.seed ?? generateSeed();
    const startedAt = performance.now();
    const { result, mode, fallbackReason } = await generatePiecesOffThread(
        buildGenerationRequest(gridSize, imageSize, seed, options),
        signal,
    );
    const durationMs = Math.round(performance.now() - startedAt);
    const state = assembleGameState(imageUrl, viewport, gridSize, options, seed, result);
    return { state, generation: { mode, durationMs, fallbackReason } };
}
```

In `src/game/index.ts`, extend the existing export blocks:

```ts
export { createNewGameAsync } from './init.js';
export type { CreateNewGameAsyncResult } from './init.js';
export { GenerationCancelledError } from './generate-async.js';
```

(Read the file and match its grouping style; `createNewGame` is already exported there.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/init.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/init.ts src/game/init.test.ts src/game/index.ts
git commit -m "feat(game): add createNewGameAsync with off-thread generation"
```

---

### Task 6: analytics — `NewGameData` fields, `generation-cancelled` event, payload builders

**Files:**
- Modify: `src/analytics/umami.ts` (NewGameData interface + new `GenerationCancelledData` + `track` overload), `src/app/new-game-payload.ts` (both builders)
- Test: `src/app/new-game-payload.test.ts` (extend), `src/analytics/umami.test.ts` (extend if it asserts event names — read it first)

**Interfaces:**
- Consumes: nothing new.
- Produces (Tasks 8/9 rely on these):
  - `NewGameData` gains `generationMode: 'worker' | 'sync-fallback'`, `generationMs: number`, `generationFallbackReason?: string`.
  - `interface GenerationCancelledData { source: 'fresh' | 'shared'; cutStyle: string; cols: number; rows: number; elapsedMs: number }` + `track('generation-cancelled', data)` overload.
  - `buildFreshGameData` and `buildSharedGameData` each gain a required `generation: { mode: 'worker' | 'sync-fallback'; durationMs: number; fallbackReason?: string }` option (the `CreateNewGameAsyncResult['generation']` shape) and stamp the three fields.

- [ ] **Step 1: Write the failing tests** (extend `src/app/new-game-payload.test.ts`; read its existing fixture helpers first and reuse them)

```ts
it('stamps generation mode and duration', () => {
    const data = buildFreshGameData({
        ...baseOpts, // whatever fixture the file already builds
        generation: { mode: 'worker', durationMs: 250 },
    });
    expect(data.generationMode).toBe('worker');
    expect(data.generationMs).toBe(250);
    expect(data.generationFallbackReason).toBeUndefined();
});

it('stamps the fallback reason only when falling back', () => {
    const data = buildFreshGameData({
        ...baseOpts,
        generation: { mode: 'sync-fallback', durationMs: 900, fallbackReason: 'no-worker' },
    });
    expect(data.generationMode).toBe('sync-fallback');
    expect(data.generationFallbackReason).toBe('no-worker');
});
// Mirror both for buildSharedGameData.
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/new-game-payload.test.ts`
Expected: FAIL — unknown option / missing fields.

- [ ] **Step 3: Implement**

`src/analytics/umami.ts` — add to `NewGameData` (with operator-spec doc comments; follow the interface's existing comment style):

```ts
    /**
     * How the generate phase ran: `'worker'` = off the main thread in the
     * generation Web Worker (the normal path since #489), `'sync-fallback'`
     * = synchronously on the main thread because the worker path was
     * unavailable or failed (see `generationFallbackReason`). Fallback games
     * froze the main thread for ~`generationMs`, worker games did not.
     * Present on every `new-game-started` from the off-thread release on;
     * absent on events from older clients (PWA caches).
     */
    generationMode: 'worker' | 'sync-fallback';
    /**
     * Wall-clock milliseconds the generate phase took (rounded), measured
     * on the main thread around the whole off-thread round trip — worker
     * spawn, traced-chunk load inside the worker where needed, generation,
     * and result transfer — or around the synchronous call on the fallback
     * path. This is the wait a player actually experienced under the
     * loading overlay for the generation step (image fetch excluded).
     */
    generationMs: number;
    /**
     * Why generation fell back to the main thread. Only present when
     * `generationMode` is `'sync-fallback'`. `'no-worker'` means the
     * environment has no `Worker` constructor; anything else is a
     * sanitized worker-path error (spawn failure, worker-side generation
     * error, a failed traced-chunk fetch inside the worker — the
     * worker-side copy of the chunk emits no `traced-chunk-*` events, so
     * this field is where those failures surface).
     */
    generationFallbackReason?: string;
```

New event interface + overload (near the other event interfaces):

```ts
/**
 * A player cancelled a game start from the loading overlay (#489). The
 * Cancel affordance only exists while a puzzle is already installed, so
 * every event here means "returned to their previous puzzle". `cutStyle`
 * is the style the cancelled start *requested* (for `source: 'shared'`,
 * the link's style). `elapsedMs` is overlay-shown → cancel, so it
 * includes image fetch time, not just generation — it measures player
 * patience, not generator speed. No completion-side pair: a cancelled
 * start emits no `new-game-started`.
 */
export interface GenerationCancelledData {
    source: 'fresh' | 'shared';
    cutStyle: string;
    cols: number;
    rows: number;
    elapsedMs: number;
}
```

```ts
export function track(name: 'generation-cancelled', data: GenerationCancelledData): void;
```

`src/app/new-game-payload.ts` — both builders take the new option and stamp:

```ts
    generation: { mode: 'worker' | 'sync-fallback'; durationMs: number; fallbackReason?: string };
```

```ts
    const data: NewGameData = {
        // ...existing fields...
        generationMode: generation.mode,
        generationMs: generation.durationMs,
    };
    if (generation.fallbackReason !== undefined) {
        data.generationFallbackReason = generation.fallbackReason;
    }
```

- [ ] **Step 4: Run to verify pass, then fix the fallout**

Run: `npm test`
Expected: `new-game-payload.test.ts` passes; `start-new-game.test.ts` / `load-shared-puzzle.test.ts` now FAIL to compile (builders' new required option) — that fallout is fixed in Tasks 8/9, so for THIS commit make the option required and let those tests be updated in their tasks *only if the suite still compiles*. If the type error blocks the suite now, update the two orchestrator call sites minimally in this task (pass `generation: { mode: 'sync-fallback', durationMs: 0 }` as a placeholder with a `// replaced in the async swap` comment) so every task ends green — Tasks 8/9 replace it with the real value.

- [ ] **Step 5: Commit**

```bash
git add src/analytics/umami.ts src/app/new-game-payload.ts src/app/new-game-payload.test.ts src/app/start-new-game.ts src/app/load-shared-puzzle.ts
git commit -m "feat(analytics): record generation mode, duration and cancellations"
```

---

### Task 7: loading overlay — Cancel button + Escape

**Files:**
- Modify: `src/ui/loading-overlay.ts`, `src/style.css` (or wherever `.loading-overlay` styles live — grep first)
- Test: `src/ui/loading-overlay.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces (Tasks 8/9 rely on this): `showLoadingOverlay(text?: string, options?: { onCancel?: () => void }): void` — backward compatible; existing single-argument callers unchanged.

- [ ] **Step 1: Write the failing tests** (extend `src/ui/loading-overlay.test.ts`, following its existing DOM assertions)

```ts
it('renders a Cancel button when onCancel is provided and invokes it on click', () => {
    const onCancel = vi.fn();
    showLoadingOverlay(undefined, { onCancel });
    const button = document.querySelector<HTMLButtonElement>('.loading-overlay__cancel');
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe('Cancel');
    button!.click();
    expect(onCancel).toHaveBeenCalledOnce();
});

it('renders no Cancel button without onCancel', () => {
    showLoadingOverlay();
    expect(document.querySelector('.loading-overlay__cancel')).toBeNull();
});

it('Escape triggers onCancel while the overlay is up', () => {
    const onCancel = vi.fn();
    showLoadingOverlay(undefined, { onCancel });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCancel).toHaveBeenCalledOnce();
});

it('Escape does nothing after hideLoadingOverlay', () => {
    const onCancel = vi.fn();
    showLoadingOverlay(undefined, { onCancel });
    hideLoadingOverlay();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCancel).not.toHaveBeenCalled();
});

it('re-showing without onCancel removes a previous Cancel button', () => {
    showLoadingOverlay(undefined, { onCancel: vi.fn() });
    showLoadingOverlay();
    expect(document.querySelector('.loading-overlay__cancel')).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/loading-overlay.test.ts`
Expected: new tests FAIL.

- [ ] **Step 3: Implement**

```ts
// loading-overlay.ts additions
const CANCEL_CLASS = 'loading-overlay__cancel';

let cancelHandler: (() => void) | null = null;

function onOverlayKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && cancelHandler) cancelHandler();
}

export function showLoadingOverlay(
    text: string = 'Building puzzle…',
    options: { onCancel?: () => void } = {},
): void {
    // ...existing create-or-update logic...
    syncCancelButton(overlay, options.onCancel);
}

function syncCancelButton(overlay: HTMLElement, onCancel?: () => void): void {
    cancelHandler = onCancel ?? null;
    let button = overlay.querySelector<HTMLButtonElement>(`.${CANCEL_CLASS}`);
    if (!onCancel) {
        button?.remove();
        document.removeEventListener('keydown', onOverlayKeydown);
        return;
    }
    if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = CANCEL_CLASS;
        button.textContent = 'Cancel';
        overlay.appendChild(button);
    }
    button.onclick = () => cancelHandler?.();
    document.addEventListener('keydown', onOverlayKeydown);
}
```

And in `hideLoadingOverlay`:

```ts
export function hideLoadingOverlay(): void {
    cancelHandler = null;
    document.removeEventListener('keydown', onOverlayKeydown);
    document.querySelector<HTMLElement>(`.${OVERLAY_CLASS}`)?.remove();
}
```

Restructure the existing `showLoadingOverlay` early-return so both branches reach `syncCancelButton` (the current code returns after creating the overlay). Update the module doc comment: generation is no longer always synchronous; the overlay hosts the cancel affordance.

CSS: add `.loading-overlay__cancel` styles next to the existing `.loading-overlay` block, using existing `--color-*` variables only (see `feedback_palette_css_variables` — no hex literals; check how other buttons in style.css are styled and match).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/ui/loading-overlay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/loading-overlay.ts src/ui/loading-overlay.test.ts src/style.css
git commit -m "feat(ui): add a cancel affordance to the loading overlay"
```

---

### Task 8: `startNewGame` — async generation, cancel flow, analytics

**Files:**
- Modify: `src/app/start-new-game.ts`
- Test: `src/app/start-new-game.test.ts`

**Interfaces:**
- Consumes: `createNewGameAsync`/`GenerationCancelledError` (via `../game/index.js`), overlay `onCancel` (Task 7), builder `generation` option (Task 6).
- Produces (Task 10 relies on this): `StartNewGameDeps` gains `hasCurrentGame: () => boolean`.

- [ ] **Step 1: Update the test file's mocks and add failing tests**

The file mocks `../game/index.js` with an `importOriginal` passthrough wrapping `createNewGame`; extend the factory to also wrap `createNewGameAsync` (same pattern, `vi.fn(actual.createNewGameAsync)`), and re-export `GenerationCancelledError` untouched. Every existing `deps` fixture gains `hasCurrentGame: () => false` (no Cancel in existing tests — behavior unchanged). New tests:

```ts
it('passes onCancel to the overlay only when a game is installed', async () => {
    await startNewGame(GRID, {}, { ...deps, hasCurrentGame: () => true });
    expect(vi.mocked(showLoadingOverlay).mock.calls[0][1]?.onCancel).toBeTypeOf('function');

    vi.mocked(showLoadingOverlay).mockClear();
    await startNewGame(GRID, {}, { ...deps, hasCurrentGame: () => false });
    expect(vi.mocked(showLoadingOverlay).mock.calls[0][1]?.onCancel).toBeUndefined();
});

it('cancel unwinds silently: no install, no new-game-started, overlay hidden', async () => {
    // Make the generation await hang until we cancel mid-flight.
    vi.mocked(createNewGameAsync).mockImplementation(async (...args) => {
        const signal = args[5] as AbortSignal;
        await new Promise((r) => setTimeout(r, 0));
        if (signal.aborted) throw new GenerationCancelledError();
        return realCreateNewGameAsync(...args);
    });
    const promise = startNewGame(GRID, {}, { ...deps, hasCurrentGame: () => true });
    const onCancel = vi.mocked(showLoadingOverlay).mock.calls[0][1]!.onCancel!;
    onCancel();
    await promise; // resolves, does not reject
    expect(deps.session.install).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalledWith('new-game-started', expect.anything());
    expect(track).toHaveBeenCalledWith('generation-cancelled', expect.objectContaining({
        source: 'fresh',
        cutStyle: 'classic',
    }));
    expect(hideLoadingOverlay).toHaveBeenCalled();
});

it('stamps generationMode and generationMs on new-game-started', async () => {
    await startNewGame(GRID, {}, deps);
    expect(track).toHaveBeenCalledWith('new-game-started', expect.objectContaining({
        generationMode: 'sync-fallback', // jsdom has no Worker
        generationMs: expect.any(Number),
    }));
});
```

`track` is not currently mocked in this file — check how `new-game-started` assertions are done today (the file may assert via `onGameAnalytics`); mirror the existing pattern instead of inventing a `track` mock if one isn't there. If `track` assertions are new, mock `../analytics/index.js` with an `importOriginal` passthrough like the file's other mocks.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/app/start-new-game.test.ts`

- [ ] **Step 3: Implement in `start-new-game.ts`**

1. `StartNewGameDeps` gains:
```ts
    /**
     * Whether a puzzle is currently installed. Gates the overlay's Cancel
     * affordance: cancelling means "return to your current puzzle", so
     * with nothing installed (boot, first-visit share link) there is
     * nothing to offer.
     */
    hasCurrentGame: () => boolean;
```
2. Top of the function:
```ts
    const startedAt = performance.now();
    const controller = new AbortController();
    showLoadingOverlay(
        undefined,
        deps.hasCurrentGame() ? { onCancel: () => controller.abort() } : {},
    );
```
3. After the `resolveTracedTabOutcome` block and **before** `triggerPhotoDownload` (a cancelled start must not report an Unsplash download for a photo it discards, same principle as the existing throw ordering):
```ts
    if (controller.signal.aborted) throw new GenerationCancelledError();
```
4. Swap the generation call:
```ts
    const { state, generation } = await createNewGameAsync(
        imageUrl, imageSize, viewport, oriented,
        {
            cutStyle,
            composableConfig,
            ...generatorConfigs,
            rotationMode,
            seed,
            onPieceCountMismatch: (m) => { pieceCountMismatch = m; },
        },
        controller.signal,
    );
```
5. Pass `generation` through to `buildFreshGameData` (replacing any Task 6 placeholder).
6. Wrap the whole `try` body's contents in cancel handling — add a `catch` between the existing `try` and `finally`:
```ts
    } catch (err) {
        if (err instanceof GenerationCancelledError) {
            track('generation-cancelled', {
                source: 'fresh',
                cutStyle: requestedCutStyle,
                cols: gridSize.cols,
                rows: gridSize.rows,
                elapsedMs: Math.round(performance.now() - startedAt),
            });
            return;
        }
        throw err;
    } finally {
```
7. Update the file-header orchestration contract comment: point 4's "synchronous piece-generation burst" wording becomes "generation (off-thread when possible; the yield still covers the sync fallback)", and add the cancel rule: the abort check sits before the download report so a cancelled start never reports a download.

- [ ] **Step 4: Run the suite**

Run: `npx vitest run src/app/start-new-game.test.ts && npm test`
Expected: PASS (bootstrap's deps literal fails to compile until Task 10 — if so, do Task 10's one-line dep addition here and note it in the commit).

- [ ] **Step 5: Commit**

```bash
git add src/app/start-new-game.ts src/app/start-new-game.test.ts
git commit -m "feat(app): generate new games off-thread with a cancellable overlay"
```

---

### Task 9: `loadSharedPuzzle` — same treatment

**Files:**
- Modify: `src/app/load-shared-puzzle.ts`
- Test: `src/app/load-shared-puzzle.test.ts`

**Interfaces:**
- Consumes: same as Task 8.
- Produces: `LoadSharedPuzzleDeps` gains `hasCurrentGame: () => boolean`.

- [ ] **Step 1: Write failing tests** — mirror Task 8's three new tests with this file's own mock/fixture conventions (read them first): overlay gets `onCancel` only when `hasCurrentGame()`, cancel unwinds silently (no `session.install`, no `new-game-started`, a `generation-cancelled` with `source: 'shared'` and `cutStyle: payload.c`, overlay hidden), and `new-game-started` carries `generationMode`/`generationMs`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/load-shared-puzzle.test.ts`

- [ ] **Step 3: Implement** — mirror Task 8 exactly, with these differences:
- `startedAt`/controller at the top; overlay call identical.
- The generation swap wraps the existing `createNewGame` call site (options come from `shareInitOptions(payload)` plus the mismatch callback), passing `controller.signal`.
- No download-trigger ordering concern here; no extra abort check needed beyond `createNewGameAsync`'s own (the only await before generation is the traced preload).
- `generation-cancelled` fields: `source: 'shared'`, `cutStyle: payload.c`, `cols: payload.g[0]`, `rows: payload.g[1]`.
- Pass `generation` to `buildSharedGameData`.
- Update the file-header comment the same way.

- [ ] **Step 4: Run the suite**

Run: `npx vitest run src/app/load-shared-puzzle.test.ts && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/app/load-shared-puzzle.ts src/app/load-shared-puzzle.test.ts
git commit -m "feat(app): off-thread generation and cancel for shared-link loads"
```

---

### Task 10: bootstrap wiring — `hasCurrentGame`

**Files:**
- Modify: `src/app/bootstrap.ts` (both deps literals: `startNewGameDeps` ~line 333, `sharedDeps` ~line 446)
- Test: `src/app/bootstrap.test.ts`

**Interfaces:**
- Consumes: `GameSession.current()` (already on the session), Tasks 8/9's dep fields.
- Produces: nothing further.

- [ ] **Step 1: Write the failing test** — read `bootstrap.test.ts`'s existing wiring assertions and follow their style. The behavior to pin: both deps' `hasCurrentGame` reflects `session.current()`:

```ts
it('wires hasCurrentGame to the session', async () => {
    // Following the file's existing pattern for reaching into deps —
    // read how it asserts on startNewGameDeps today and mirror it.
    // Assert: hasCurrentGame() is false before any install and true
    // once session.current() returns a state.
});
```

If the file's harness can't observe the deps object directly, pin it where it CAN see it: boot with no saved state (nothing installed) and assert `showLoadingOverlay` received no `onCancel` — the observable consequence.

- [ ] **Step 2: Run to verify failure, implement, verify pass**

In both deps literals:
```ts
        hasCurrentGame: () => session.current() !== undefined,
```
Run: `npx vitest run src/app/bootstrap.test.ts && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/bootstrap.ts src/app/bootstrap.test.ts
git commit -m "feat(app): gate the generation cancel affordance on an installed game"
```

---

### Task 11: build verification — worker chunk, PWA precache, bundle size

**Files:**
- Possibly modify: `src/game/generate-async.ts` (URL specifier, see Task 4's note), `vite.config.ts` (only if the worker chunk is missing from the precache manifest)

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: success; `dist/assets/` contains a `generation-worker-*.js` chunk. If the build fails resolving `./generation-worker.js`, switch that one specifier to `./generation-worker.ts` (Vite's documented worker-URL pattern) and re-run tests + build.

- [ ] **Step 2: Verify the precache manifest**

Run: `grep -o 'generation-worker[^"]*' dist/sw.js | head` (adjust to however the injected manifest lands — check `dist/` layout).
Expected: the worker chunk (and its imported sub-chunks, including the worker-graph traced chunk) appear. If not, extend the `injectManifest` glob in `vite.config.ts`.

- [ ] **Step 3: Measure and record the duplication cost**

Compare `dist/assets` total against a `main`-branch build (`git stash` not needed — build main in a worktree or note sizes from CI). Record the delta (worker chunk size + duplicated traced chunk) in the PR description.

- [ ] **Step 4: Commit (if anything changed)**

```bash
git add -A
git commit -m "build: ensure the generation worker chunk is emitted and precached"
```

---

### Task 12: manual verification and PR

- [ ] **Step 1: Manual browser check** (use the `run` skill / `npm run dev`)

1. New game, Wavy, 16×12 — overlay appears, page stays responsive (spin the mouse over the canvas; devtools Performance tab shows no multi-second main-thread task), puzzle appears.
2. With a game installed: start another new game → Cancel button visible; click it → overlay closes, previous puzzle still there, still interactive.
3. Escape during generation → same as Cancel.
4. Boot with cleared site data → no Cancel button on the boot start.
5. Open a traced share link (generate one via Share) → loads correctly (worker-side traced chunk works).
6. `?tabDebug=1` new game → `window.__tabDebug` populated (report crossed the worker boundary).
7. Console shows no errors; Network tab shows the worker chunk + its traced chunk loading.

- [ ] **Step 2: Full suite + typecheck**

Run: `npm test && npm run build`
Expected: green.

- [ ] **Step 3: Push and open the PR** (no confirmation needed — standing preference)

```bash
git push -u origin feat/worker-generation
gh pr create --title "feat: move puzzle generation off the main thread" --body "..."
```

PR body must include, in this order: `Closes #489` as a standalone first line; a summary of the approach (worker at the strategy boundary, sync fallback, Cancel, analytics); the measured bundle-size delta from Task 11; the note that `traced-chunk-*` events keep their main-thread meaning and worker-side chunk failures surface via `generationFallbackReason`; and the manual-verification checklist results. End with the standard generation footer.

---

## Self-review notes (already applied)

- Spec coverage: every spec section maps to a task — core split (1–2), worker entry (3), client+fallback+cancel error (4), async API (5), analytics incl. operator docs (6), overlay+Escape a11y (7), orchestrators+abort ordering vs. download report (8–9), `hasCurrentGame` gating (10), precache/size (11), manual tail-case verification (12). Info-modal: no change, by spec.
- The spec's "signal is also checked after the image-fetch awaits" lands in Task 8 step 3.3 (before the download report); `createNewGameAsync` re-checks at generation entry.
- Type consistency: `GenerationRequest`/`GenerationResult`/`GenerationResponse`/`OffThreadGeneration`/`CreateNewGameAsyncResult` names and shapes are used identically across Tasks 1, 3, 4, 5, 6, 8, 9.
