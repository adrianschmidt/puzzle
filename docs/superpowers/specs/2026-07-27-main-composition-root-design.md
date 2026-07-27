# Make `main.ts` a three-line entry point and its composition root testable

**Date:** 2026-07-27
**Status:** Approved (design)
**Issues:** [#501](https://github.com/adrianschmidt/puzzle/issues/501) (closed by this work), [#502](https://github.com/adrianschmidt/puzzle/issues/502) (ESLint, deliberately excluded)

> Point-in-time design record, not a description of the merged code. Where
> this document and the module doc comments disagree once the work lands,
> the module doc comments are authoritative.

## Summary

`src/main.ts` is 1939 lines across 158 commits. It is the app's composition
root, so every feature appends to it, and it is the one file no test can
reach — `index.html` imports it as a side-effecting module
(`index.html:20`), so there is nothing to import and nothing to call.

Extraction has been attempted before, piecemeal (#246 pulled the completion
overlay out; `src/app/` holds nine pure helpers extracted from this file
across earlier PRs). It has stalled at pure functions every time, for one
structural reason: **`gameState` is a module-level `let` (`src/main.ts:257`)
that roughly twenty-five closures read.** Anything touching game state
cannot leave the file without a place for that state to live, so the
orchestration — `startNewGame` (275 lines), `loadSharedPuzzle` (130), the
boot sequence (110), the share-link rescue (125), `initGame`, the toolbar
wiring, the four dev-console hooks — has stayed put and stayed untested.

Two consequences beyond the size. First, the load-bearing invariants in
this file are enforced only by comments, in the one file with no coverage;
#501 documents two of them and #488/#499 are what happens when one breaks.
Second, the file has no floor: nothing stops the next feature appending to
it, which is what the previous extractions failed to change.

This design moves the composition root into `src/app/bootstrap.ts` and
reduces `src/main.ts` to its two CSS imports plus a single `bootstrap()`
call. `bootstrap.ts` exports a function rather than running on import, so a
test can import it without booting the app, and the wiring order itself
becomes unit-testable. A test constraining `main.ts` to imports and that one
call keeps it that way.

Behavior is unchanged throughout. The only user-visible difference this
work is permitted to make is none.

## Design

### The rule that makes extraction possible

> Pass `state` as an argument wherever the caller already has it. Inject a
> `getState()` thunk **only** where a long-lived callback must read whatever
> is current at fire time — toolbar buttons, interaction callbacks, dev hooks.

Thunks everywhere would reintroduce the tangle in a new shape and create
circular wiring: `applyMergeResult` needs the session, and the session needs
`applyMergeResult`. Taking `state` as a parameter breaks that cycle and
leaves most extracted units testable with plain values.

### `src/app/game-session.ts` (new) — the single structural move

Owns the two globals that block everything else: `gameState`
(`src/main.ts:257`) and `cleanupDrag` (`:258`). Absorbs `initGame` (`:894`)
and `restorePersistedSelection` (`:973`).

```ts
export interface GameSession {
    /** The current game, or undefined until the first successful install. */
    current(): GameState | undefined;
    /** True once a puzzle is rendered AND interaction is wired. */
    hasGame(): boolean;
    /** Tear down the previous game, install this one, wire interaction. */
    install(state: GameState): void;
    /** Re-apply a selection persisted from a previous session. */
    restoreSelection(saved: readonly number[]): void;
}

export function createGameSession(deps: GameSessionDeps): GameSession;
```

`current()` returns `GameState | undefined`, which is #501's second ask:
the declaration finally admits the state the app deliberately survives, and
the compiler forces every call site to be explicit instead of each one
rediscovering it. The eight runtime guards #501 enumerates stop being
empirically complete and become provably complete.

`hasGame()` is #501's first ask: a named predicate instead of a drag-teardown
handle doubling as the boot-readiness signal. The invariant — the teardown
handle is assigned by `install`'s last statement, so a throw between state
assignment and `setupInteraction` still reports "no game" and still runs the
boot fallback — moves from a comment asking a maintainer not to move a line
(`:913-919`) to a test that fails when someone does.

`GameSessionDeps` carries `container`, the `Renderer` port,
`ViewportTransform`, `SelectionManager`, `RotationFocus`, and callbacks for
save, merge-result application, snap tolerances, viewport change, and an
`onInstalled(state)` hook covering attribution, rotation-UI sync, and the
completion overlay.

### Pure extractions

Plain functions over plain values. These are where the file's subtlest rules
currently live, buried in comments, with no coverage:

| New module | Extracted from | Why it matters |
| --- | --- | --- |
| `completed-payload.ts` | `buildPuzzleCompletedData` (`:233`) | The derive-then-overlay-cached-fields merge |
| `new-game-payload.ts` | the two `NewGameData` builders (`:1228-1271`, `:1651-1690`) | `tracedChunkDegraded` / `bootFallback` / `sharedColor` flags — the fields that keep degraded games separable from genuine pre-upgrade traffic |
| `generator-configs.ts` | the four `generatorXConfig` derivations (`:1175-1203`) | Trace-set-version stamping: withholding `classicConfig` *is* the `legacy-classic` outcome |
| `share-payload-to-init.ts` | payload → `createNewGame` options (`:1606-1623`) and the traced-chunk predicate (`:1571-1580`) | The predicate is deliberately narrower than the config reconstruction, to deny a crafted link a chunk fetch it will never use |
| `blank-canvas.ts` | `:1103-1114` and `:1589-1596` | **Currently duplicated** — two copies of the same canvas code |
| `snap-tolerances.ts` | `activeSnapTolerances` (`:880`) | The single definition of "would a drop merge?", shared by three consumers |

### Stateful controllers

Each owns state that is a module global today, and takes its collaborators
as constructor dependencies:

- **`viewport-fit.ts`** — `gatherAndZoomToFit` (`:285`) and
  `zoomToFitCompletedPuzzle` (`:324`). ~170 lines with real math currently
  untested: the shortest-path upright spin (`signedAngularDelta`) and the
  `transform-origin` compensation that keeps the pivot from orbiting.
- **`completion-presenter.ts`** — owns `currentCompletionHide` (`:193`).
- **`save-coordinator.ts`** — owns `debouncedSave` (`:745`) and
  `lastSaveFailedToastAt` (`:695`); exposes `autoSave` / `persistNewPuzzle`
  / `notifySaveFailed` and installs the two flush listeners (`:764-767`).
  Covers the 10-second toast-dedup window and the rule that a failure is
  attributed to the *flushed* state, not the current global — a debounced
  save can land after a new game has started.
- **`merge-result.ts`** — `applyMergeResult` (`:813`): selection prune,
  rotate-handle focus retarget onto the survivor, z-reorder with absorbed
  ids remapped, win detection.
- **`rotation-ui.ts`** — `rotateButtons` (`:1423`), `snapPosition` (`:1444`),
  `rotateHandle` (`:1449`), `updateRotationUiVisibility` (`:1503`),
  `getFocusedGroupScreenBounds` (`:780`), and the interactive pivot
  derivation (`:1485-1499`).
- **`install-background-color.ts`** — owns `currentColorId` (`:1525`), the
  picker, the OS-theme re-apply, the change tracking, and an explicit
  `adopt(id)` for the share path (which today reaches in and mutates both
  the global and the picker, `:1653-1658`).

### Flows

Orchestration, extracted as functions over explicit dependency objects.
Tested by faking the dependencies and asserting which branch ran in which
order — not by asserting pixels:

- **`start-new-game.ts`** — `startNewGame` (`:1027`) and
  `StartNewGameOptions` (`:999`).
- **`load-shared-puzzle.ts`** — `loadSharedPuzzle` (`:1562`).
- **`new-game-flow.ts`** — the dialog open, the preference save fan-out, and
  the start call (`:1292-1385`).
- **`share-link-loader.ts`** — `tryLoadSharedPuzzle` (`:1757`),
  `rescueUndecodableLink` (`:1722`), `rescueStillOwnsGuard` (`:1710`), and
  the `rescueReloadPending` flag (`:1699`). The highest-value target in the
  file: rescue guard ownership, the hashchange-during-await race, and the
  same-predicate-two-meanings distinction are all currently untestable.
- **`boot-sequence.ts`** — the boot IIFE (`:1827`): share > saved > fresh,
  the corrupt-save dialog gate, first-run detection, viewport restore, and
  the `startWithBootFallback` wiring.

### Wiring

- **`global-handlers.ts`** — the contextmenu delegation (`:158-163`, whose
  `closest('[data-puzzle-table]')` test is what keeps long-press copy
  working inside the info modal), analytics/error-tracking/sw-bridge init
  (`:165-174`), the resource-timing buffer (`:181`), and the version badge
  (`:185-191`).
- **`install-toolbar.ts`** — new-game, gather, select, marquee, deselect,
  info buttons.
- **`dev-hooks.ts`** — `__solvePuzzle` (`:457`), `__startVennPuzzle`
  (`:501`), `__newComposableGame` (`:547`), `__reproPuzzle` (`:617`).
  Largely documentation, but `__reproPuzzle`'s codec round-trip validation
  and error reporting warrant a test.
- **`bootstrap.ts`** — the composition root, ~140 lines, tested. Exports a
  function; it must not run on import, or importing it in a test would boot
  the app:

  ```ts
  export function bootstrap(
      root: HTMLElement = document.querySelector<HTMLDivElement>('#app')!,
  ): void;
  ```

  The default argument is evaluated at call time, so `main.ts` stays free of
  DOM lookup while a test can pass its own jsdom container.

- **`main.ts`** — two CSS imports, one value import, one call:

  ```ts
  import './palette.css';
  import './style.css';
  import { bootstrap } from './app/bootstrap.js';

  bootstrap();
  ```

The CSS imports stay here, in this order, ahead of bootstrap: ES module
evaluation follows import order, so this preserves today's cascade.

## Testing

Repo conventions apply: test file next to its source, jsdom via a per-file
`@vitest-environment jsdom` pragma (55 files already do this).

- **Pure modules** — direct assertions, no fakes.
- **Controllers** — a fake `Renderer` (`src/renderer/types.ts` already
  defines the port, and it covers every method this file calls), real
  `SelectionManager` / `RotationFocus` / `ViewportTransform` (already
  unit-tested and cheap to construct), jsdom container.
- **Flows** — faked session/save/track/toast/dialog dependencies, real pure
  modules underneath.
- **`bootstrap.test.ts`** — asserts the ordering invariants that are
  comment-only today.

Unit tests cannot establish behavior preservation for a move this size, so
the plan also carries a dev-deploy smoke matrix: fresh boot, reload with a
save, share link, undecodable share link, corrupt save, completion spin, and
each rotation mode.

## Contracts that must survive

The real risk in this work. Two are upgraded from comment to enforcement:

1. **`hasGame()` is false until interaction is wired** (#488, #501). The
   session assigns the teardown handle last; a test asserts `hasGame()` is
   false *during* the render step. Comment-enforced today (`:913-919`).
2. **Rotation UI exists before any `install()`.** Today this is positional
   luck: the consts are declared at `:1423`/`:1449` and the boot IIFE at
   `:1827`. The session's `onInstalled` hook will *receive* the rotation-UI
   handle, so constructing it later will not compile — an accidental
   ordering becomes a type-level one.

Preserved unchanged:

3. `initAnalytics` → `initErrorTracking` → `initSwErrorReporting`, all ahead
   of anything that can throw.
4. `performance.setResourceTimingBufferSize(500)` before any traced-chunk
   fetch — it backs the `cacheState` dimension.
5. The `hashchange` listener registers *after* the boot sequence is kicked
   off. Boot runs synchronously to its first await, so this ordering is
   observable.
6. Both save-flush listeners (`pagehide`, `visibilitychange` → hidden).
7. `palette.css` before `style.css`, both before bootstrap.
8. Save-failure telemetry attributes to the flushed state, not the global.
9. `currentColorId` stays reachable by both the share-adopt path and the
   OS-theme re-apply, or a theme flip re-applies a stale color.
10. The four dev hooks keep their exact names, signatures, and return values
    — `__reproPuzzle` resolves `Promise<boolean>`. They are a documented
    workflow tool.
11. The #499 guards stay no-ops rather than throws: the three New Game
    button reads (`:1289-1291`) and the Gather guard (`:1396`).
12. **PRNG call order is untouched.** Nothing extracted may reorder anything
    reaching `createNewGame`; share links and saves replay through it. The
    generator-config derivations consume no randomness, so this is a
    property to verify, not to redesign.

## Anti-regrowth guard

`src/main.test.ts` reads `./main.ts?raw` and asserts that every non-blank,
non-comment line is either an `import` statement or the single `bootstrap();`
call. Verified that `?raw` resolves for `.ts` under this Vitest config;
`src/style.test.ts` already establishes raw-importing a source file as a repo
pattern, and `npm test` runs in CI (`.github/workflows/ci.yml:24`).

Chosen over a line-count cap deliberately: a threshold is a number the next
feature raises by ten, which is roughly how this file reached 1939 lines.
This assertion has nothing to relax — the next line added to `main.ts` fails
it, whatever that line is.

A CLAUDE.md section states the convention and points new wiring at
`src/app/bootstrap.ts` and its test.

## Out of scope

- **#500** — boot fallback suppressed when a share-link load fails after
  `initGame`. A behavior fix; it stays separate so a regression in this PR
  is attributable to the move. Easier to reason about afterwards.
- **#502** — ESLint. Its own review surface, and it is not what keeps this
  file small.
- **The `viewport-fit` DOM leak** — `zoomToFitCompletedPuzzle` queries
  `[data-group-id]` and calls `applyGroupTransform` directly, bypassing the
  `Renderer` port. It becomes an explicit `container` dependency: honest
  about the coupling, not fixed.
- **Info-modal copy** — no user-visible behavior changes, so per CLAUDE.md
  no help-text update is required.

## Delivery

One PR, ~18 commits, leaf-first so each commit compiles with tests green:
pure extractions, then controllers, then flows, then bootstrap, with
`main.ts` reduced in the final commit. Some commits group closely related
leaves — the two `NewGameData` builders land together. Reviewable commit by
commit; the repo rebase-merges, so the series lands intact on `main`.

Projected: `main.ts` 1939 → 5 lines; 22 new modules; 22 new test files
(21 module tests plus the `main.ts` guard).
