# Off-main-thread puzzle generation (#489) — design

**Date:** 2026-08-01
**Issue:** #489 — composable styles freeze input for 250 ms–2.4 s (est. 4–6×
on mid-range Android)
**Scope decision:** move generation to a Web Worker **and** add a Cancel
button to the loading overlay. Progress reporting is explicitly deferred —
it requires instrumenting the synchronous generator pipeline, which is
contract-adjacent.

## Why (honest version)

The loading overlay already masks the freeze for the common case: it is
modal, and its spinner animates on the compositor. The real benefits are in
the tail:

- Wavy at 16×12 is ~2.4 s on a fast desktop and plausibly 10 s+ on a
  mid-range Android — into "page unresponsive" territory, and a frozen page
  reads as broken even with a moving spinner. The share-link path exposes
  first-time visitors to this.
- A worker makes generation **cancellable** (terminate), giving an escape
  hatch from an accidental max-grid start.
- It puts a backstop under future, heavier styles: added cost becomes added
  wait, not added freeze.
- `generationMs` analytics finally measure what real players wait, closing
  the loop on how much this mattered.

## Architecture

`createNewGame` (`src/game/init.ts`) already has three implicit phases;
the split makes them explicit and moves only the middle one off-thread:

| Phase | What | Where it runs |
|---|---|---|
| Plan | seed resolution (`options.seed ?? generateSeed()`), nothing else | main |
| Generate | `scaleGrid` → `inscribePuzzleSize` → `strategy.generatePieces` → `quantizePieceGeometry` → `sealPieceGeometry` | **worker** (sync fallback: main) |
| Assemble | groups (`createInitialGroups`, unseeded `Math.random`, needs viewport), indexes, `GameState` | main |

### New modules

**`src/game/generation-core.ts`** — the pure generate phase.

- `GenerationRequest`: `cutStyle`, `gridSize`, `imageSize`, `seed`, the five
  per-style configs (`fractalConfig` / `composableConfig` / `wavyConfig` /
  `trianglesConfig` / `classicConfig`), `tabDebug: boolean`. All plain data.
- `GenerationResult`: `pieces` (quantized + sealed), `puzzleSize`,
  `autoGroups?`, `tabDebugReport?`, `pieceCountMismatch?`. All plain data —
  `sealPieceGeometry` returns new plain objects (no `Object.freeze`
  anywhere), so `structuredClone` reproduces the result losslessly.
- `runGeneration(request): GenerationResult` runs the whole phase. The
  `tabDebug` flag (read from the URL on the main thread — workers have no
  `window.location`) makes the core construct the `TabDebugSession` itself
  and return the plain-data report.

Both the worker and the sync fallback call `runGeneration`, so the two
paths execute byte-identical generation code — the PRNG call-order
contract lives in one place and cannot diverge between paths. Quantize +
seal run inside the worker deliberately: dropping the dense curve samples
(~61% of geometry pre-#493) before `postMessage` shrinks the clone payload.

**`src/game/generation-worker.ts`** — worker entry. On message: if the
request's style/config needs traced tabs, `await
preloadTracedTabGenerator()` (in worker context — the loader's `track()`
calls no-op there, by `track`'s existing `typeof window` guard, and that is
accepted; see Analytics), then `runGeneration`, then post the result.
Errors post back as an error message.

**`src/game/generate-async.ts`** — main-thread client.
`generatePieces(request, signal): Promise<GenerationResult>`:

- Spawns a fresh worker per call
  (`new Worker(new URL('./generation-worker.js', import.meta.url), { type: 'module' })`),
  posts the request, awaits the result, and terminates the worker in a
  `finally`. Per-call spawn keeps cancellation trivial and leaves no stale
  module state (worker-side traced registry included); spawn cost is
  milliseconds against a once-per-new-game operation.
- On **any** worker-path failure — `Worker` undefined (jsdom, locked-down
  browsers), spawn error, worker-side error, message error — logs via
  `diagnostics.warn` and falls back to calling `runGeneration`
  synchronously on the main thread: exact status-quo behavior.
- On abort (signal): terminate the worker, reject with a
  `GenerationCancelledError` sentinel.

### Changed modules

**`src/game/init.ts`** — `createNewGame` stays, as a thin sync composition
(resolve seed → `runGeneration` → assemble); its API and existing tests are
unchanged. New `createNewGameAsync(imageUrl, imageSize, viewport, gridSize,
options, signal)`: resolve seed up front, `await generatePieces(...)`, run
the same assembly. `onPieceCountMismatch` fires before the promise
resolves, so callers that capture into a local and read after the await
keep working unchanged. Assembly stays on main: it needs the viewport and
`Math.random`, and costs microseconds.

**Orchestrators** (`src/app/start-new-game.ts`,
`src/app/load-shared-puzzle.ts`): swap `createNewGame(...)` for `await
createNewGameAsync(...)`; wire the abort signal; catch
`GenerationCancelledError` and unwind silently (no install, no
`new-game-started`, overlay hidden by the existing `finally`). The
documented orchestration order in both file headers is unchanged.
`yieldForPaint()` stays — harmless on the worker path, still needed by the
sync fallback.

## Traced-tab chunk

The existing main-thread preload/degrade dance in `startNewGame`
(`planTracedTabs` → preload overlapping the image fetch →
`resolveTracedTabOutcome` → Classic degrades to legacy on chunk failure)
**stays exactly as-is**. It still owns the degrade decision, its
`traced-chunk-*` analytics keep their current meaning, and it keeps the
main-thread copy warm for the sync fallback.

The worker build is a separate Rollup graph, so it contains its own copy of
the generation pipeline, bezier-js, and the traced chunk (dynamic-imported
inside the worker). Accepted costs:

- The worker chunk duplicates code the main bundle ships. Precache grows;
  the real number gets measured and stated in the PR.
- A traced game's first generation fetches traced code twice (once per
  graph); both copies are SW/HTTP-cached afterwards.

Failure story: if the worker's own traced import fails, that is a worker
failure → sync fallback on the main thread, where the chunk either already
loaded or the existing degrade logic already handled its absence. Every
failure lands in an already-handled state.

## Cancel

- `showLoadingOverlay` gains an optional `onCancel`; when provided it
  renders a Cancel button. Escape triggers it too (keyboard affordance in
  the feature PR, not a follow-up).
- Each orchestrator call owns an `AbortController`; cancel → abort →
  worker terminated → `GenerationCancelledError` → silent unwind. The
  signal is also checked after the image-fetch awaits, so cancelling
  during a slow Unsplash fetch works.
- **Cancel is offered only when a puzzle is currently installed** — the
  semantics are "return to your current puzzle." Boot and first-visit
  share-link loads offer no Cancel (nothing to return to). Bootstrap wires
  a `hasCurrentGame` fact into the orchestrator deps; `bootstrap.test.ts`'s
  wiring assertions extend to cover it.
- No info-modal copy: a Cancel button on a loading overlay is behavior a
  player already expects (repo help-text rule).

## Errors, fallback, concurrency

- Worker failure of any kind → warn + sync fallback (status quo).
- Sync-path throw → propagates exactly as today (overlay hidden in
  `finally`).
- Worker always terminated in `finally` — completion, error, or cancel.
- Concurrent generations (e.g. a `hashchange` racing a new-game) each own
  their worker; no shared state, last install wins — same as today.

## Analytics (documented in `umami.ts` doc comments — the operator spec)

- `new-game-started` gains:
  - `generationMode: 'worker' | 'sync-fallback'`
  - `generationMs` (rounded) — answers "what do real players actually
    wait?"
  - `fallbackReason` (via `sanitizeErrorReason`), present only when mode is
    `'sync-fallback'`.
- New `generation-cancelled` event: `cutStyle`, grid, `elapsedMs` — shows
  whether Cancel serves as the "oops, too big" escape hatch.
- Worker-side `traced-chunk-*` events are consciously **not** emitted (no
  postMessage analytics bridge); a worker-side chunk failure surfaces as
  `generationMode: 'sync-fallback'` with its reason instead.

## Testing

- Generator and digest tests: untouched. The bezier-js tripwire
  (`dcel-broad-phase-equivalence.test.ts`) keeps guarding geometry — this
  change moves code between threads but never edits generator internals.
- `generation-core.test.ts`: `runGeneration` output equals the pre-split
  inline path for the same seed (per style), and a
  **`structuredClone(result)` round-trip equality test** — the regression
  guard against someone adding a function or class instance to the result.
- `generate-async.test.ts` (jsdom has no `Worker`): fallback taken when
  `Worker` is undefined; protocol round-trip against a stub Worker class;
  cancel → terminate called + sentinel rejection; worker error → fallback.
- Orchestrator tests: async call, plus cancel paths (no install, no
  analytics event, overlay hidden).
- No `@vitest/web-worker` dependency: worker-vs-sync identity is structural
  (same function), and the clone test covers the serialization gap.
- Manual verification: real browser, Wavy 16×12 — page stays interactive,
  Cancel returns to the prior puzzle.

## Out of scope

- Progress reporting (needs generator instrumentation; separate issue if
  wanted).
- Persistent/pooled worker (no benefit at once-per-new-game frequency).
- Deduplicating main/worker bundle graphs (revisit only if the measured
  size cost is ugly).
