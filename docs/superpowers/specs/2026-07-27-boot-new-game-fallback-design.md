# Boot path: recover from a failed new-game start instead of dying

**Date:** 2026-07-27
**Status:** Approved (design)
**Issue:** [#488](https://github.com/adrianschmidt/puzzle/issues/488)

> Point-in-time design record, not a description of the merged code. Review
> moved a few details on the way in (signatures gained fields, `hasGame`
> gained a stricter predicate, `new-game-failed` gained `cutStyle`). Where
> this document and the module doc comments disagree, the module doc
> comments are authoritative.

## Summary

The boot IIFE (`src/main.ts:1768`) is `try`/`finally` with no `catch`.
When there is no saved game it awaits `startNewGame(...)` with the
player's saved preferences; if that rejects, `gameState` is never
assigned, the canvas stays empty, and the New Game button's
`isCompleted: () => gameState.completed` throws on click. The player
cannot recover without a reload, and the failure reports only as a
generic `unhandled-error`.

#486 added a Classic-only mitigation: a failed traced-tab chunk fetch
withholds `classicConfig` and generates the legacy straight-grid cut, so
the default style still boots. Wavy, Triangles, and a `composable`
preference with the Traced tab generator still hit the dead app — and so
does any non-chunk failure on that path (a saved Composable config the
current build can't build, any throw inside `createNewGame`). The
Unsplash fetch is not a source: `resolveUnsplashImage` swallows and
returns `null`.

The fix is a boot-path safety net: catch **any** rejection from the boot
start, report it, and — if no game made it onto the screen — start a
last-resort puzzle that cannot depend on the lazy chunk. The player
lands on a playable puzzle, the substitution is explained in a toast,
and the failure becomes measurable.

Scope is the boot path only. The dialog path already survives a
rejection (the previous game stays on screen) and keeps its current
toast; the shared-link and saved-game branches are untouched.

## Design

### `src/app/traced-tab-plan.ts` (new)

The traced-tab decision moves out of `main.ts` into two pure functions —
the two halves of one decision, before the chunk fetch and after it
settles. Both the new fallback flag and #486's degradation rule flow
through them, which is also that rule's first unit coverage (it is
currently inline in `main.ts`, referenced nowhere else but `umami.ts`).

```ts
export interface TracedTabPlan {
    /** Cut style the game is actually generated with. */
    cutStyle: CutStyle;
    /** Whether to start the lazy traced-tab chunk fetch. */
    preloadChunk: boolean;
}

export function planTracedTabs(opts: {
    cutStyle: CutStyle;
    tabGenerator?: string;
    bootFallback?: boolean;
}): TracedTabPlan;

export type TracedTabOutcome =
    // Generate as requested.
    | { kind: 'ok' }
    // Classic without classicConfig. `error` is present exactly when
    // `degraded` is true, and is what the caller warns with.
    | { kind: 'legacy-classic'; degraded: false }
    | { kind: 'legacy-classic'; degraded: true; error: unknown }
    // Style needs the chunk and the chunk failed — rethrow.
    | { kind: 'fail'; error: unknown };

export function resolveTracedTabOutcome(opts: {
    cutStyle: CutStyle;
    bootFallback?: boolean;
    chunkError: unknown | null;
}): TracedTabOutcome;
```

Rules:

- `bootFallback` → `cutStyle: 'classic'`, `preloadChunk: false`, and
  `{ kind: 'legacy-classic', degraded: false }` regardless of the
  requested style. The last-resort puzzle therefore cannot fetch the
  chunk and cannot stamp a config that needs it, by construction rather
  than by two scattered `&&`s at opposite ends of `startNewGame`. It is
  also why the caller does not pass a cut style: a future caller cannot
  combine `bootFallback` with Wavy and silently re-break the net.
- Otherwise `preloadChunk` is `cutStyleNeedsTracedTabs(cutStyle,
  tabGenerator)` — unchanged behavior, one indirection deeper.
- `chunkError !== null` → `legacy-classic` with `degraded: true` for
  Classic (warn + `tracedChunkDegraded`, per #486), `fail` for every
  other style.
- `degraded` distinguishes "a fetch actually failed" from "we never
  tried", so only the former warns and flags analytics.

### `src/main.ts` — `startNewGame` signature

Eleven positional parameters become an options object. The new flag
would otherwise arrive as a twelfth, with the fallback call site padding
ten `undefined`s around the one argument that matters.

```ts
interface StartNewGameOptions {
    cutStyle?: CutStyle;              // default 'classic'
    composableConfig?: ComposableConfig;
    imageSource?: string;
    imageCategory?: string;
    fractalConfig?: FractalDialogConfig;
    wavyConfig?: WavyDialogConfig;
    vibrant?: boolean;                // default false
    rotationEnabled?: boolean;        // default false
    seed?: number;
    pickedImage?: CandidateImage;
    /**
     * Start the last-resort boot puzzle: legacy Classic cut, lazy chunk
     * never touched, flagged in analytics. Overrides `cutStyle`.
     */
    bootFallback?: boolean;
}

async function startNewGame(
    gridSize: GridSize,
    options: StartNewGameOptions = {},
): Promise<void>;
```

Four call sites update: the boot path (`:1826`), the dialog's `onSelect`
(`:1303`), `__startVennPuzzle` (`:513`), and `__newComposableGame`
(`:574`). Behavior at all four is unchanged.

The body becomes a thin consumer of the plan module:

```ts
const { cutStyle, preloadChunk } = planTracedTabs({
    cutStyle: options.cutStyle ?? 'classic',
    tabGenerator: options.composableConfig?.tabGenerator,
    bootFallback: options.bootFallback,
});

const tracedTabsPreload = preloadChunk ? preloadTracedTabGenerator().then(...) : null;
// ... image resolution, unchanged ...
const outcome = resolveTracedTabOutcome({
    cutStyle,
    bootFallback: options.bootFallback,
    chunkError: tracedTabsPreload ? await tracedTabsPreload : null,
});
if (outcome.kind === 'fail') throw outcome.error;
if (outcome.kind === 'legacy-classic' && outcome.degraded) {
    diagnostics.warn('Traced tab chunk failed to load; Classic fell back to the legacy cut:', outcome.error);
}
const tracedTabsAvailable = outcome.kind === 'ok';
```

`generatorClassicConfig` is stamped on `cutStyle === 'classic' &&
tracedTabsAvailable`; `data.tracedChunkDegraded` is set from
`outcome.degraded`; `data.bootFallback` from `options.bootFallback`.
The effective (possibly forced) `cutStyle` is what flows into
`rotationModeForNewGame`, `createNewGame`, and `NewGameData.cutStyle`,
so a fallback game is honestly recorded as Classic.

### `src/app/start-with-boot-fallback.ts` (new)

The orchestration and reporting, extracted so it is unit-testable —
`main.ts` keeps only the thunks.

```ts
export const FALLBACK_STARTED_TOAST = "Couldn't start your usual puzzle — started a Classic one";
export const BOOT_FAILED_TOAST = "Couldn't start a puzzle — try reloading";

export async function startWithBootFallback(opts: {
    start: () => Promise<void>;
    startFallback: () => Promise<void>;
    hasGame: () => boolean;
}): Promise<void>;
```

1. Run `start()` through `runWithErrorReport` with **no** toast
   (`event: 'new-game-failed'`, `phase: 'boot'`). On success, return.
2. If `hasGame()` is true, return without a fallback. This covers a
   rejection *after* `initGame` (say a throw in `gatherAndZoomToFit`):
   the player already has the puzzle they asked for, and replacing it
   with a Classic one would be a regression. The failure is still
   reported.
3. Run `startFallback()` through `runWithErrorReport` with
   `phase: 'boot-fallback'` and `BOOT_FAILED_TOAST`. On success, show
   `FALLBACK_STARTED_TOAST`.

The toast fires *after* the fallback puzzle renders, so the message is
true when the player reads it. `showToast` only ever shows one toast
(a new one removes the old, `src/ui/toast.ts:9`), which is why step 1
suppresses its toast rather than letting two messages fight.

### `src/main.ts` — the boot path

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
        imageSource, imageCategory, vibrant,
        fractalConfig: preferredFractalConfig,
        wavyConfig: preferredWavyConfig,
        rotationEnabled: preferredRotationEnabled,
    }),
    startFallback: () => startNewGame(gridSize, {
        bootFallback: true,
        imageSource, imageCategory, vibrant,
        rotationEnabled: preferredRotationEnabled,
    }),
    hasGame: () => gameState !== undefined,
});
```

The fallback keeps every preference except the cut: same size, image
source/category/vibrancy, rotation. It deliberately passes no
`composableConfig`/`wavyConfig`/`fractalConfig` — with the style forced
to Classic they are dead weight, and a bad saved Composable config is
one of the failures being recovered from.

`hasGame` mirrors the existing `gameState?.groups ?? []` guard at
`main.ts:274`: `gameState` is declared `let gameState: GameState` and is
genuinely `undefined` until `initGame` runs.

**Superseded — see the `startWithBootFallback` module docs and the `hasGame`
call site in `main.ts`.** `gameState !== undefined` shipped as
`cleanupDrag !== null`. `initGame` assigns the global *before* it renders
and wires interaction, so the looser predicate answers "a puzzle reached
the screen" with `true` over a blank or undraggable canvas — skipping the
fallback and every message, which is the #488 symptom again. Don't
reintroduce the form shown above.

The fallback puzzle is **persisted** by `startNewGame`'s normal
`persistNewPuzzle()`. A throwaway puzzle that vanished on the next
reload would be a worse surprise than a substituted cut style, and there
is no save to protect — the boot path only reaches here when there was
none (or an unreadable one, whose recovery blobs were already offered).
The cut-style *preference* is untouched, so the next New Game offers
Wavy again and its chunk fetch is a fresh attempt.

### Analytics

| Moment | Event |
| --- | --- |
| Preferred start rejects | `new-game-failed { reason, phase: 'boot' }` |
| Fallback puzzle starts | `new-game-started { cutStyle: 'classic', bootFallback: true, … }` (no `traceSetVersion`) |
| Fallback rejects too | `new-game-failed { reason, phase: 'boot-fallback' }` |

`src/analytics/umami.ts`:

- `NewGameFailedData` gains `phase?: 'boot' | 'boot-fallback'`. Absent on
  the dialog path, so existing data stays comparable. Documented as: two
  events can describe one boot (the primary failure and the net failing
  behind it), distinguishable by `phase`.
- `NewGameData` gains `bootFallback?: boolean`, mirroring the
  `tracedChunkDegraded` precedent. `source` stays `'fresh'`, so
  fresh-vs-shared denominators are unchanged.
- The documented "Classic without `traceSetVersion`" pre-upgrade-tail
  query (`umami.ts:69`) gains one more exclusion: `bootFallback`. Like
  `tracedChunkDegraded`, a fallback game genuinely ran legacy geometry,
  so leaving it in would inflate the tail in the safe direction — but it
  is a distinct population and should be separable.

`src/app/run-with-error-report.ts`:

- `toastMessage` becomes optional; omitted means no toast. Documented as
  for callers that show their own message after a recovery attempt.
- The `new-game-failed` variant of `ErrorReportEvent` gains
  `phase?: NewGameFailedData['phase']`, matching how `shared-load-failed`
  already carries `source`. `trackReasonEvent` omits the key entirely
  when `phase` is undefined rather than sending `phase: undefined`.

## Testing

`src/app/traced-tab-plan.test.ts` (new):

| Input | Expected |
| --- | --- |
| `bootFallback` + any requested style | `cutStyle: 'classic'`, `preloadChunk: false`, `legacy-classic` with `degraded: false` |
| classic, `chunkError` set | `legacy-classic`, `degraded: true` |
| classic, no error | `ok` |
| wavy / triangles, `chunkError` set | `fail`, carrying the original error |
| wavy / triangles, no error | `ok`, `preloadChunk: true` |
| composable + `tabGenerator: 'traced'` vs. anything else | `preloadChunk: true` / `false` |
| fractal | `preloadChunk: false`, `ok` |

`src/app/start-with-boot-fallback.test.ts` (new), jsdom, mocking
`../ui/toast.js` and stubbing `window.umami` as
`run-with-error-report.test.ts` does:

- `start` resolves → `startFallback` not called, no events, no toast.
- `start` rejects, `hasGame()` false → `startFallback` called,
  `new-game-failed { phase: 'boot' }` tracked with a sanitized reason,
  `FALLBACK_STARTED_TOAST` shown once.
- `start` rejects, `hasGame()` true → `startFallback` not called, event
  still tracked, no toast.
- Both reject → two events (`phase: 'boot'`, then
  `'boot-fallback'`), `BOOT_FAILED_TOAST` shown, promise resolves rather
  than rejecting (the boot IIFE must reach its `finally`).

`src/app/run-with-error-report.test.ts` (extend):

- Omitted `toastMessage` → failure still warns and tracks, no toast.
- `phase` passed through to the `new-game-failed` payload; omitted key
  when undefined.

Manual verification (the wiring in `main.ts` has no unit harness — the
repo is vitest-only, and `main.ts` is not importable under test):

1. `npm run dev`, pick Wavy in the New Game dialog so the preference is
   saved.
2. DevTools → Network → block request URL pattern
   `*traced-tab-generator*` (the chunk Vite emits for the lazy import,
   `traced-tab-loader.ts:172`).
3. Console: `localStorage.clear()` then
   `localStorage.setItem('puzzle-cut-style', 'wavy')`; reload.
4. Expect: a playable Classic puzzle, the "started a Classic one" toast,
   and the boot failure warned in the console. The event payloads are
   not checkable here — the Umami script does not load on `npm run dev`
   and `track` drops silently without it, and a `window.umami` stub
   cannot survive the reload that triggers the boot path. Those
   assertions live in `start-with-boot-fallback.test.ts`; this step
   verifies the `main.ts` wiring the unit tests cannot reach.
5. Unblock, click New Game: the dialog still offers Wavy and it starts
   normally.

## Non-changes

- **No info-modal copy.** This is an error path, not a feature a player
  needs explained; the modal's existing text stays correct.
- **No retry of the preferred style, and no chunk-fetch timeout.** A
  hanging fetch already hangs the first attempt; that is pre-existing
  and out of scope.
- **The dialog path keeps its current behavior** — toast, previous game
  intact, no substitution. The player is standing at the dialog and can
  simply try again.
- **#486's Classic degradation is preserved exactly**, just expressed
  through `resolveTracedTabOutcome`.
- **No new seeded randomness**, so the `generateProceduralPuzzle` PRNG
  call-order contract in `CLAUDE.md` is untouched. The fallback uses the
  legacy Classic generator that already exists.
