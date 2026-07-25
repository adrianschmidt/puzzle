# Geometry coordinate precision: quantize generated pieces to 2 decimals

**Date:** 2026-07-25
**Status:** Approved (design)
**Issue:** [#487](https://github.com/adrianschmidt/puzzle/issues/487)

## Summary

Round every coordinate of a generated puzzle's geometry to **2 decimal places**,
in a single pass over the finished `Piece[]` at the end of `createNewGame`.

This cuts the persisted geometry blob by ~33% and puts the largest supported
puzzle (192 pieces, Wavy) back on the plain-write `localStorage` path, removing
the several-hundred-millisecond synchronous lz-string fallback that currently
fires right after generation.

The change is to **generated geometry**, not to the serializer: in-memory,
on-disk, and re-generated-from-share-link geometry all stay identical to each
other. `shape` / `edge.path` strings are untouched.

## Background

### Where the bytes are

Measured on this branch (`serializeStatic` → `JSON.stringify`, 1080×720 image,
16×12 = the UI maximum from `puzzle-sizes.ts`):

| style | today | after 2 dp |
|---|---|---|
| Wavy | 5.697 MB | **3.799 MB** |
| Classic (sine + traced) | 5.588 MB | 3.705 MB |
| Triangles (168 faces) | 3.332 MB | 2.235 MB |
| Fractal | 0.552 MB | 0.552 MB |

`edge.curvePoints` is 3.43 MB of Classic's 5.59 MB (61%): `curve.sample(8)`
emits 8 points per Bézier segment, ~100 points per curved edge, ~77k points at
16×12 — each a pair of full-precision doubles. Fractal emits no `curvePoints`,
which is why it is unaffected.

The practical `localStorage` budget is ~4.75 MB (the ceiling hit in #399), so
3.80 MB clears it with ~1 MB of headroom. Unsplash always delivers 1080-wide
images (`unsplash-display-image.ts`), so that grid/image combination is the real
production ceiling, not a synthetic one.

### Why 2 decimals

Two independent anchors agree:

1. **`fmt` already emits `toFixed(2)`** (`puzzle/composable/bezier-path.ts`).
   Every rendered path — `shape`, `edge.path` — is already truncated to 2 dp.
   Precision finer than that *cannot reach the screen*.
2. **Snap tolerance.** The strictest preset is `fraction: 0.133` of the
   reference piece width (`ui/merge-tolerance.ts`); at 16 cols on a 1080 px
   image that is 8.98 px. A 2 dp round moves a coordinate by ≤0.005 px —
   1/1800 of the tightest tolerance the game ever applies.

Anchor 1 decides the value; anchor 2 is the safety check.

The dependency runs one way on purpose: `fmt` does not read
`GEOMETRY_PRECISION_DECIMALS`, because the rendering pipeline should not take a
dependency on a storage constant when it is the thing doing the deciding.
Instead a test in `bezier-path.test.ts` pins `fmt`'s decimal count against the
constant, so raising `fmt` to 3 dp fails loudly rather than silently making
storage the binding constraint on rendered geometry.

A side effect worth naming: today `curvePoints` and the coordinates inside
`shape` disagree by up to 0.005 px, because `fmt` rounds and `curvePoints` do
not. After this change they agree.

### Why at generation, not at serialization

Issue #487 sketches rounding inside `serializeStatic` / `serializeState` "so
in-memory geometry stays exact". We are deliberately **not** doing that.

- The premise does not hold. After composition, `curvePoints` has exactly one
  consumer in the entire app — `getPieceBounds` (`model/derive.ts`), a min/max
  scan. `edge.start` / `edge.end` feed merge detection at a ≥8.98 px tolerance,
  group bounds (min/max), pile detection (min/max), and a debug-only stroke in
  the renderer. Two consumers are worth naming rather than waving past:

  - `getGridCols` / `getGridRows` (`model/derive.ts`) *do* compare geometry for
    exact equality — `new Set(pieces.map(p => p.imageOffset.x))`. Rounding can
    only merge buckets, so the failure mode is an under-count, and producing
    one needs two columns within 0.01 px of each other where the real spacing
    is ~67 px at 16 cols. Both are exported from `model/index.ts` but have no
    non-test callers today.
  - `computeMergedOffsets` (`game/reconstruct-groups.ts`) and `mergeGroups`
    (`game/group-merging.ts`) *accumulate* the error instead of bounding it
    per use: each BFS hop adds `edge.start − mateEdge.end`, so ≤0.005 px per
    coordinate compounds along the chain. The longest chain at 16×12 is ~27
    hops, giving ~0.27 px worst case and ~0.03 px realistically (errors are
    signed and cancel) — under one rendered pixel and still far inside the
    8.98 px tolerance, but the "1/1800 of tolerance" figure below is
    per-comparison and does not apply verbatim at these two call sites.

  Nothing else compares geometry for equality, and neither of these can
  observe the difference at the magnitudes the app produces.
- Serialization-time rounding would create a permanent, invisible fork: the
  geometry you play is not the geometry you reload. Sub-pixel and untested — the
  kind of discrepancy that costs an afternoon in two years.
- It would also force a deep copy of ~77k points immediately before a multi-MB
  `JSON.stringify`. Today `serializeStatic` is a pass-through
  (`pieces: state.pieces`); this change keeps it one.

### Why *after* composition, not inside `extractCurvePoints`

Rounding at the point `curvePoints` are produced (`topology/faces-to-pieces.ts`)
would feed rounded points into `clampTabToCurve`, shifting the emitted Bézier
control points and therefore the `shape` strings.

Rounding the finished `Piece[]` instead means:

- `shape` strings come out **byte-identical** to today, because they are built
  earlier and are already 2 dp. The golden shape values pinned in `af15b81`
  still pass, and every existing share link renders exactly as it does now.
- No rounded input ever reaches the tab-placement bisection, so the one real
  "rounding creates degenerate geometry" risk does not exist.
- One pass covers all five cut styles, because they all funnel through
  `strategy.generatePieces`.

## Design

### `src/model/quantize-geometry.ts`

```ts
export const GEOMETRY_PRECISION_DECIMALS = 2;

export function quantizePieceGeometry(pieces: Piece[]): Piece[];
```

Pure; returns new objects and does not mutate its input (pieces are treated as
immutable throughout — see `model/helpers.ts`). Rounds:

- `edge.start.x/y`, `edge.end.x/y`
- every `edge.curvePoints[i].x/y` (when present)
- `piece.imageOffset.x/y`

Leaves `piece.shape` and `edge.path` verbatim — they are strings, already at
this precision.

Rounding is `Math.round(v * 100) / 100`. Coordinates are bounded by the image
dimensions, far below the magnitude where that loses the shortest-round-trip
2 dp representation, so `JSON.stringify` emits at most 2 decimals — which is
where the size win comes from.

`-0` is folded to `0`. A small negative coordinate rounds to `-0`, which
`JSON.stringify` writes as `"0"` — leaving it would make in-memory geometry
differ from the same geometry read back, defeating the point of the pass.

A non-finite *result* is discarded in favour of the input: `v * 100` overflows
to `Infinity` above ~1.798e306, and `JSON.stringify` writes a non-finite number
as `null`, which nothing on the load path re-validates. Unreachable from any
real generator, but rounding must not be the step that turns a finite
coordinate into an unrepresentable one. Non-finite *inputs* pass through
unchanged — this pass rounds coordinates, it does not police them.

### Call site — `game/init.ts`

Inside `createNewGame`, on the `pieces` returned by `strategy.generatePieces`,
**before** `createInitialGroups`. Multi-piece group offsets are derived from
`imageOffset` deltas (`buildGroupPieceMap`), so building the groups first would
describe geometry the state no longer holds. Note this does not make the offsets
themselves 2 dp — the difference of two 2 dp values need not be one — and the
progress blob those offsets live in is not a size problem, so no invariant is
claimed there.

Both entry points that create a puzzle — new game (`main.ts`) and share-link
load (`main.ts`) — call `createNewGame`, so this single site covers every cut
style and every path that produces geometry.

### Legacy saves

Not re-rounded on load. The geometry blob is written once per puzzle
(`saveGeometry`), so re-rounding at load time would cost a 77k-point pass for
zero bytes saved. Existing large saves keep loading exactly as they do today,
via the compressed path they were written with.

## Testing

1. **`src/model/quantize-geometry.test.ts`** — each coordinate family is
   rounded; `shape` and `edge.path` are byte-identical; absent `curvePoints`
   is tolerated; `-0` survives a JSON round-trip; a coordinate too large to
   scale is left alone; the input array and its pieces are not mutated; the
   function is idempotent.
2. **Invariant at the real seam** — for each cut style, no number on
   `createNewGame(...).pieces` carries more than 2 decimals. This is the "one
   geometry" property the design rests on, asserted where it matters rather
   than only on the helper. The probe is a **generic recursive walk** over the
   pieces (`test-helpers/precision.ts`), not a list of known coordinate
   fields: a numeric field added to `Edge` or `Piece` later must fail this
   test without anyone remembering to extend the probe. Scoped to
   `state.pieces` rather than the whole `serializeStatic` blob, whose other
   fields (the inscribed puzzle rectangle, the cut-style config) are
   deliberately full precision.
3. **Shape regression** — for every cut style, `shape` and `edge.path` strings
   from `createNewGame` are compared against the same generator run directly,
   so the byte-identical property is asserted on legacy Classic and Fractal
   (which build their paths independently) as well as the composable
   pipeline. Plus the existing golden-value test from `af15b81` passing
   unchanged.
4. **Size guard** (issue bullet 4) — generate Wavy at 16×12 / 1080×720 (the
   largest blob any production style produces) and assert
   `JSON.stringify(serializeStatic(state)).length` stays below 4.5 M UTF-16
   code units — `String.length`, the unit browsers meter `localStorage` in and
   the unit #399's ceiling was established in. Today's measured 3.80 M and the
   ~4.75 M practical quota are recorded in a comment, along with the seed
   spread (3.695–3.799 M across four seeds), since one seed is a sample rather
   than the distribution. Needs an explicit ~20 s timeout: generation takes
   ~2.6 s and the vitest default is 5 s.

## Out of scope

Named explicitly so they read as decisions, not oversights:

- **Flat `[x, y, x, y, …]` coordinate arrays** (would reach 2.97 MB) and
  **dropping `curvePoints` from the blob** in favour of a persisted bbox
  (2.15 MB). Both need a `STATE_VERSION` bump plus a load-time migration, and
  buy headroom that 192-piece puzzles do not currently need.
- **Reducing `curve.sample(8)` density.** The single biggest untapped lever —
  ~100 points per curved edge is one per 0.67 px, heavily oversampled for
  rendering — but it changes rendered geometry for existing share links, so it
  belongs in its own issue.
- **Rounding the progress blob.** 192 group positions is not a size problem,
  and rounding player-controlled positions is a behaviour change.

## Non-changes

- **Info modal:** no update. Nothing user-visible changes — no new control, no
  new behaviour, no changed interaction.
- **Analytics:** no new instrumentation. The save-outcome telemetry added in
  `8d3f0b7` already measures the result; success looks like `save-compressed`
  ceasing to fire for the largest puzzles.

  Query it by `cutStyle` plus a piece-count *range*, not `pieceCount === 192`.
  Classic, Wavy and Composable pass the requested grid straight through, so
  16×12 is exactly 192 pieces — but Triangles derives its lattice from
  `selectTriangleRows` and Fractal from `scaleFractalGrid`, so their largest
  puzzles land *near* 192, not on it. Triangles is not merely off by a fixed
  amount either: `selectTriangleRows` picks the row count from the image
  aspect, so its `pieceCount` moves per image rather than sitting at the 168
  measured above. `new-game-started` carries exact `cols`/`rows` and can be
  cross-referenced for the denominator.

  One limit of the existing event, unchanged by this PR: `saveNewPuzzle`
  reports the worse of the geometry and initial-progress writes, and
  `save-compressed` carries no `op` dimension, so a *residual* signal after
  this ships cannot be attributed to one key or the other without widening
  that return type. Geometry dominates the payload, and the event ceasing
  entirely is unambiguous either way.
