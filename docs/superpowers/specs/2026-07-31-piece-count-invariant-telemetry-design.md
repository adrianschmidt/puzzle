# Piece-count invariant, reported with replayable repro params

**Date:** 2026-07-31
**Status:** Approved (design)
**Issue:** #512

## Summary

Generation has no piece-count invariant. A puzzle that comes out with the
wrong number of pieces is indistinguishable from a correct one until a
player notices a fused mega-piece. That is how #498 shipped — a missed cut
crossing merged four faces into one, the generator produced 189 pieces
instead of 192, and nothing logged, warned, or threw. Two earlier bugs
(header of `src/puzzle/topology/repro-bug.test.ts`) produced the same
symptom from unrelated causes. Three known instances, no detector.

#512 proposes the detector. This design adds the half that makes the
detector worth having: when the invariant breaks in production, the app
reports the **parameters needed to reproduce that exact puzzle**, so a
field failure can be replayed locally through `__reproPuzzle` and turned
into a regression test. Without that, a mismatch in the wild is a count
with no way to act on it.

Two structural facts shape everything below:

1. **The detection point cannot emit the event.** `generateTopologyPuzzle`
   receives a `random` function, not the seed, and knows nothing about
   `imageUrl`, `rotationMode` or the per-style configs. `buildReproParams`
   needs a whole `GameState`. The generator is also pure — it runs under
   vitest and #489 wants it inside a Web Worker where `window.umami` does
   not exist. The signal must travel up as data.
2. **Umami's event-data limits are the payload contract.** Per the tracker
   docs: strings max 500 chars, numbers max precision 4, arrays stringified
   to 500 chars, objects max 50 properties.

## What the analytics export settled

A CSV export of the live site (2026-07-31) decided the payload shape
empirically rather than by assumption:

- **`event_data.csv` carries `event_id`.** Every property row is tagged
  with the event it belongs to, so flat scalar properties reassemble into a
  single event by grouping on `event_id`. A JSON blob is **not** needed to
  keep the repro params correlated.
- **The widest event today carries 12 properties.** Umami's 50-property cap
  is not a constraint at this scale.
- **The longest string value in the entire dataset is 102 chars**
  (`unhandled-error/reason`, already length-capped by the app). There is no
  evidence of how Umami behaves at 400+ chars — an argument for a design
  that never produces such a value.

Flat scalar properties therefore beat a JSON blob on every axis: they
aggregate in the live dashboard, reassemble exactly in the export, and
confine the 500-char question to the one field that has to carry an opaque
per-style config (`styleConfig`) instead of leaving the whole payload
exposed to it. That one field turned out not to be fully sidestepped after
all — see `styleConfigOmitted` below, added after the initial
implementation found composable's config unbounded.

## Design

### 1. The detector

A new optional hook on `BaseCutGenerator`
(`src/puzzle/topology/plugin-types.ts:28`):

```ts
/**
 * Faces this generator intends to produce for `config`, or undefined if
 * it cannot say. Generators that omit this are exempt from the check.
 */
expectedPieceCount?(config: unknown): number | undefined;
```

It receives the **same opaque config object** `generate()` gets — not
`(cols, rows, config)` as #512 sketched. `generateTopologyPuzzle` already
assembles `baseCutCfg` with the clamped `cols`/`rows` and the resolved
`borderless` flag folded in (`generator.ts:141-147`), so handing a
generator its own config lets it apply its own oversizing rule. For sine
that is `(cols + 2) × (rows + 2)` when borderless and `cols × rows`
otherwise, and the framework never has to encode which.

Implemented for the **sine grid only**. Venn circles and the triangular
lattice legitimately produce counts unrelated to `cols × rows` — they
receive those parameters only because the shared signature passes them
along — so they omit the hook and are exempt rather than false-positive.

**Where the check runs:** at `generator.ts:201`, immediately after
`facesToPieceDefinitions`, against `pieceDefs.length`. That is *before*
`composePuzzle` and *before* `stripBorderRing`, so the comparison never has
to reason about the strip's removal count — an oversized expectation and a
pre-strip actual are in the same coordinate system. `composePuzzle` runs
with `disableTabs: true` here and changes no counts; `minPieceArea`
auto-grouping groups pieces without removing them.

**On mismatch:** `diagnostics.warn` — never throw. A wrong count is a bad
puzzle, not an unusable one, and throwing at generation time would turn a
cosmetic defect into a failed game start (which is the #488 failure mode
#499 just finished building a recovery path for).

### 2. Plumbing

```
generateTopologyPuzzle  →  TopologyPuzzle.pieceCountMismatch?    new optional field, beside
                                                                 the existing tabDebugReport
composable-generator    →  StrategyPuzzle.pieceCountMismatch?    pass-through
init.ts:106             →  options.onPieceCountMismatch?.(m)     new optional InitOptions field
start-new-game.ts:268   ┐
load-shared-puzzle:110  ┘  capture into a local, emit after createNewGame returns
```

The mismatch shape:

```ts
export interface PieceCountMismatch {
    expected: number;
    actual: number;
    baseCutId: string;
}
```

Two constraints drove this over the alternatives:

- **Not a `GameState` field.** A per-generation diagnostic is not game
  state: it describes one run of the generator, is meaningless once the
  puzzle is loaded from a save, and would have to be explained away by
  every consumer that reads the state. (Not, as an earlier draft of this
  section claimed, because it would force a save-format migration —
  `serializeStatic` is an explicit whitelist, so an in-memory-only field
  is invisible to persistence and needs no `STATE_VERSION` bump. The
  decision stands; that reason did not.)
- **Not a `createNewGame` return-shape change.** `createNewGame` has two
  production callers and **33 test call sites**. Returning
  `{ state, generation }` would rewrite all 33 for a diagnostic that fires
  almost never.

The callback fires *during* `createNewGame`, while the state is still being
built, so both call sites capture it into a local and emit after
`createNewGame` returns — the point at which `buildReproParams(state)`
becomes possible. Both already make a `track()` call there.

Every change is additive. No existing signature moves.

### 3. The event

`piece-count-mismatch`, 12 properties — the same width as the widest event
shipping today, and well inside Umami's 50-property cap. `styleConfig` and
`styleConfigOmitted` (below) are mutually exclusive, so at most one of the
two is ever present and the event never actually carries more than 12 at
once. Two groups, by the question each answers.

**Is this happening, and how bad?** Low cardinality, aggregates in the live
dashboard without an export.

| property | type | notes |
|---|---|---|
| `cutStyle` | string | The attribution convention `SaveFailedData`, `NewGameFailedData` and `ProgressSaveSkippedData` all carry, for the same reason: without it a failure arrives as an unattributable count. |
| `baseCut` | string | `'sine'`. Not derivable from `cutStyle` — classic, wavy, triangles and composable all sit on the sine base cut, so the mismatch is a property of the base cut, not the style. |
| `expected` | number | Pre-strip, generation-grid. |
| `actual` | number | Pre-strip, generation-grid. |

No `delta` property. It is `actual − expected` and both are already here,
so the export computes it; adding it would buy a slightly more readable
dashboard top-values list at the cost of a field that can contradict its
own inputs if one of them is ever wrong.

**Which puzzle was it?** The repro params, minus `imageUrl`.

| property | type | notes |
|---|---|---|
| `seed` | number | uint32 (`seeded-random.ts:37`), so the 4-decimal precision rule cannot touch it. |
| `cols`, `rows` | number | The **user** grid, matching `buildReproParams` — so the values replay directly through `__reproPuzzle`. |
| `imageWidth`, `imageHeight` | number | From `state.imageSize`. Fractional values are normal for the inscribed rectangles fractal and wavy produce; precision-4 rounding is *finer* than the decoder's own `clampDim` floor, so nothing is lost relative to replaying a share link. |
| `rotationMode` | string | Does not affect cut geometry, but it is part of the repro contract and costs one property. |
| `styleConfig` | string | Compact JSON of whichever per-style block the puzzle carries (`classicConfig` / `wavyConfig` / `trianglesConfig` / `fractalConfig` / `composableConfig`), omitted when none. One property instead of flattening four mutually-exclusive shapes, and exactly what `reproParamsToPayload` needs to rebuild the payload. Also omitted — in favor of `styleConfigOmitted` — when the serialized block would exceed Umami's 500-char limit. |
| `styleConfigOmitted` | `true` | Present instead of `styleConfig` when the per-style config serialized past 500 chars. In practice this means `cutStyle: 'composable'`: `baseCutConfig`/`tabConfig` are opaque `Record<string, unknown>` with no size bound enforced by the share-link decoder, so a crafted link can produce an oversized config. A row with this flag is not replayable as-is — the config needed to reproduce the exact cut is missing — but every other repro field is still valid. Never `false`; absent when the config fit, matching this schema's absence-is-the-filter convention. Truncating instead of omitting was rejected: truncated JSON doesn't parse, so it would look replayable and not be — the same reasoning `imageUrl`'s omission already uses. |
| `source` | string | `'fresh' \| 'shared' \| 'repro'`. |

#### `imageUrl` is deliberately omitted

Cut geometry is a function of `seed`, `cols`/`rows`, `imageSize`,
`cutStyle` and the style config. The image bytes do not enter it —
`repro-params.ts` states that `imageUrl` only makes a repro "visually
exact". `reproParamsToPayload` already defaults a missing `imageUrl` to
`'blank'`, so a URL-less repro replays with **identical geometry** on the
white canvas, which is the whole of what a fused-piece investigation needs.

Three reasons this is the right cut rather than a reluctant one:

1. Unlike `styleConfig` — usually small, occasionally unbounded, and
   checked against the 500-char limit at runtime (see `styleConfigOmitted`
   above) — `imageUrl` cannot be usefully shortened at all: Unsplash URLs
   run 150–250 chars on their own, and there is no length at which a
   truncated one is still useful. So it is the one repro field dropped
   unconditionally, at build time, rather than bounded at runtime. Both
   mechanisms follow the same principle: never ship something that looks
   replayable and isn't.
2. Truncating it would be worse than omitting it — a truncated URL is a
   *broken* URL, so long ones would degrade to unusable rather than absent.
   (The same reasoning is why an oversized `styleConfig` is omitted rather
   than truncated: truncated JSON doesn't parse either.)
3. This app does not ship URLs to analytics. `traced-chunk-load-failed`
   actively **redacts** them so per-deploy chunk hashes and ad-blocker
   extension IDs stay out (`umami.ts:265-270`). Adding a raw image URL
   would be the first exception to a stated convention.

#### Doc-comment obligations

`umami.ts` doc comments are the operator-facing query spec, so a wrong
claim there is a real defect. Two things must be stated:

- **`expected`/`actual` are generation-grid; `cols`/`rows` are the user
  grid.** With borderless they legitimately disagree — a borderless 16×12
  expects `18 × 14 = 252` pre-strip. Unstated, the event reads as
  self-contradictory.
- **`source: 'repro'` exists to keep developer debugging out of the
  signal.** Replaying a known-bad puzzle through `__reproPuzzle` re-runs
  generation and re-fires the event. The discrimination already exists at
  `dev-hooks.ts:293` (`SharedLoadFailedData.source`), so this threads an
  existing distinction rather than inventing one. As with every other
  optional property here, absence cannot be filtered in Umami — a
  `source`-free population is computed by subtraction, per the rule
  `SharedLoadFailedData` already documents.

#### No volume cap

One event per generated puzzle, and nothing regenerates in a loop. If a
style ships broken, the event count **is** the measurement rather than
something to suppress. A cap would attenuate exactly the signal the event
exists to provide.

## Testing

The detector's own tests matter more than the telemetry's: a
false-positive detector is worse than no detector, because it would train
the operator to ignore the event.

- `expectedPieceCount` for sine, plain and borderless configs.
- **It fires at all.** All three historical fused-piece cases are fixed, so
  none of them mismatch any more — they cannot demonstrate the detector
  working. Proving it fires needs a fake base-cut generator that declares a
  higher `expectedPieceCount` than the faces it emits. `generator.test.ts:271`
  already registers a fake `BaseCutGenerator` for the borderless-capability
  test, so the pattern exists.
- **The historical cases become negative guards.** Asserting
  `pieceCountMismatch === undefined` for the three seeds in
  `repro-bug.test.ts` upgrades those existing `toHaveLength(192)` assertions
  to detector-level ones: if any of the three regresses, the detector is
  proven to catch it rather than merely assumed to.
- **It does not fire on healthy generation**, per shipped cut style. This
  is the false-positive risk #512 explicitly warns about.
- Venn and the triangular lattice never report (hook absent).
- The payload builder omits `imageUrl` and maps every other repro field.
- **A Umami-contract test:** build the payload for every production cut
  style and assert ≤50 properties, every string ≤500 chars, every number
  integral or within precision 4. This pins the external limits the way
  `dcel-broad-phase-equivalence.test.ts` pins geometry. The export shows
  102 chars as today's longest string, so there is headroom — but nothing
  currently *holds* it.
- **An oversized composable `styleConfig`:** a crafted config large enough
  to cross the 500-char limit gets `styleConfig` omitted and
  `styleConfigOmitted: true` set instead, and a normal-sized config carries
  `styleConfig` with no `styleConfigOmitted` key at all (absence, not
  `false`).
- Wiring tests at both call sites, accounting for this repo's vitest mock
  state leaking across tests (no `restoreMocks` in `vite.config.ts`).

## Out of scope

- **Extending the hook beyond sine.** Venn and the lattice would each need
  their own count derivation; neither has a known failure of this kind.
- **Any UI signal.** A mismatch is invisible to the player by design —
  `diagnostics.warn` plus the event. Per `CLAUDE.md` this is a purely
  internal change, so the info modal is untouched.
- **Blocking the puzzle.** Explicitly rejected above.
- **`imageUrl` in any form.** Settled above.

## References

- #512 — the originating issue (detector only)
- #498 / #511 — the third fused-piece instance and its fix
- `src/puzzle/topology/repro-bug.test.ts` — the three historical cases
- `src/sharing/repro-params.ts` — `buildReproParams`, `reproParamsToPayload`
- `src/analytics/umami.ts` — event schema and query-spec conventions
- Umami tracker docs — event data limits (500 / precision 4 / 50 properties)
