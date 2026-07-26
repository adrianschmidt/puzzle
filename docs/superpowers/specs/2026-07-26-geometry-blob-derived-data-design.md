# Geometry blob: stop persisting derived data (bounds for curvePoints, rebuildable shapes)

**Date:** 2026-07-26
**Status:** Approved (design)
**Follow-up to:** [#493](https://github.com/adrianschmidt/puzzle/pull/493) (quantize generated geometry to 2 decimals)

## Summary

Shrink the persisted geometry blob by removing the two places it stores
derived data, in one `STATE_VERSION` 11 → 12 bump:

1. **Drop `edge.curvePoints` after composition**, persisting a per-piece
   `bounds` (4 numbers) instead. Post-composition, the dense samples have
   exactly one consumer — `getPieceBounds` (`model/derive.ts`), a min/max
   scan feeding the debug overlay and legacy image-dimension inference.
2. **Omit `piece.shape` from the blob when it can be rebuilt** from the
   edge paths. `buildShape` (`composable/compose.ts`) constructs `shape`
   by concatenating `edge.path` strings with `M`/`Z` stitching, so the
   blob currently stores every path byte twice.

Expected size for the largest production puzzle (Wavy, 16×12, 1080×720):
~3.80 MB → ~2.15 MB from (1), then **~1.2–1.3 MB** after (2) — measured
precisely during implementation and pinned by the size guard. Against the
~4.75 MB practical `localStorage` quota that is headroom for roughly 3.5×
today's piece count before storage binds again.

**Scope: headroom only.** Raising the UI maximum grid (currently 16×12)
is a separate follow-up with its own concerns (~20 s generation on
phones, presets, UX).

## Constraints and non-goals

- **Share links are untouched.** No PRNG calls are added or removed, and
  no `shape` / `edge.path` string changes — regenerated geometry stays
  byte-identical to today (see `project_share_link_prng_contract`).
- **Load must not regenerate.** Generation takes ~20 s on a phone at
  16×12; the blob keeps the finished render geometry (the path strings).
  This change only removes data *derivable from the blob in
  milliseconds* (string concatenation, min/max), so loads get faster,
  not slower.
- **The curve-sample density inside path strings** (~100 `L` commands
  per curved edge) remains the biggest single pool of bytes but changes
  rendered geometry; it stays exiled to its own issue, per the #493
  design doc.
- **Old saves keep loading forever** via migration; they are **not**
  re-written on load (write-once precedent from #493 — `saveGeometry`
  fires once per puzzle, and rewriting on load adds a failure mode for
  zero benefit to the puzzles that need headroom, which are all future
  ones).

## Design

### Data model

- Model `Edge` (`model/types.ts`) **loses `curvePoints` entirely**. The
  samples remain on the composable `EdgeDefinition`
  (`puzzle/composable/types.ts`), where generation genuinely uses them
  (tab clamping, shoelace area, fallback polylines). The *serialized*
  edge type keeps `curvePoints` optional so v ≤ 11 blobs can be read and
  migrated.
- Model `Piece` **gains `bounds: { minX, minY, maxX, maxY }`**,
  required. `width`/`height` stay derived.
- `getPieceBounds(piece)` keeps its signature and return shape but reads
  `piece.bounds`. The min/max walk over endpoints + `curvePoints`
  survives as an internal helper (`computePieceBounds`) used at
  generation and migration time, so stored bounds are byte-for-byte what
  the old walk produced — including its current tab-exclusion semantics,
  whatever a given generator's `curvePoints` did or didn't contain.

In-memory, on-disk, and regenerated-from-seed geometry stay identical to
each other — the "one geometry" principle from #493. The serializer
grows an omit-`shape` mapping (below) but never emits values that differ
from in-memory ones; `shape` omission is presence-only, resolved at load.

### Generation: the seal pass

A new pure pass in `createNewGame` (`game/init.ts`), **after**
`quantizePieceGeometry` and **before** `createInitialGroups`:

```ts
export function sealPieceGeometry(pieces: Piece[]): Piece[];
```

For each piece: compute `bounds` from the quantized endpoints +
`curvePoints` (2 dp in, 2 dp out — no separate rounding needed), then
strip `curvePoints`. Pure, non-mutating, idempotent, no PRNG calls, no
`shape` / `edge.path` writes. Both puzzle-creating entry points (new
game, share-link load) go through `createNewGame`, so one call site
covers every cut style.

Typing note: `strategy.generatePieces` output still carries
`curvePoints` at this point; the pre-seal piece shape is a
generation-side type (`Piece` + optional per-edge `curvePoints`), and
`sealPieceGeometry` is the boundary that produces the model `Piece`.
Exact type plumbing is left to the implementation plan.

### Serialization (v12)

- `STATE_VERSION` → 12; `12` appended to `SUPPORTED_VERSIONS`.
- `serializeStatic` maps pieces through a shallow step: omit `shape`
  when `buildShape(piece.edges) === piece.shape` (byte equality), else
  keep it verbatim. New small piece objects share the existing edge
  arrays — no deep copy before the multi-MB `JSON.stringify`.
  Verification cost is string concatenation over strings already in
  memory, run once per puzzle at save time.
- `serializeState` (legacy single-blob format, tests only) gets the same
  treatment for symmetry with `deserializeState`.

**Self-verifying by design:** the dedup never *assumes* a generator
builds `shape` as the edge-path concatenation — it checks, per piece.
The chain-aware `buildShape` reproduces legacy Classic's
`M start + paths + Z` for single-loop chained pieces, so those likely
verify too; Fractal builds its `shape` independently and may not, in
which case its pieces simply keep their stored `shape` (Fractal's blob
is 0.55 MB — immaterial). Correctness never depends on the dedup firing.

### Shared `buildShape`

`buildShape` moves from `composable/compose.ts` to the **model layer**
(e.g. `model/build-shape.ts`), and `compose.ts` consumes it from there,
so generation, save-time verification, and load-time rebuild are the
same function — byte-identity between them is structural, not aspired
to. Its `fmt` dependency (2 dp formatting, `composable/bezier-path.ts`)
moves with it or is re-exported so the existing precision-pinning test
still holds; model must not import from the puzzle layer. Exact file
split is left to the implementation plan.

### Load and migration

Shared piece-migration logic used by **both** `deserializeState` and
`recombine`:

- **v12:** `shape = stored ?? buildShape(edges)`; `bounds` required —
  a v12 piece missing `bounds` fails validation and takes the existing
  unreadable-save path (warn + offer download), never a silent guess.
- **v ≤ 11:** `bounds = computePieceBounds(...)` from the blob's
  endpoints + `curvePoints`, then strip `curvePoints`. Millisecond-scale
  (a min/max scan over ≤ ~77k points), paid on each load of an old save.

**Old build reading a v12 blob** (dev/prod share one localStorage
origin): the `SUPPORTED_VERSIONS` check throws → existing
warn-and-offer-download path. Same behaviour as all eleven previous
bumps; accepted.

### Consumers

- `renderer/svg-dom-renderer.ts` (debug overlay) and
  `getPieceBaseDimension` / `getImageDimensions` are unaffected — they
  call `getPieceBounds`, whose values are unchanged.
- `model/quantize-geometry.ts` still quantizes `curvePoints` (it runs
  pre-seal, and bounds derive from the quantized values). Its input type
  is the pre-seal piece shape.
- The generic precision-walk invariant (`test-helpers/precision.ts`)
  applies unchanged; stored `bounds` fall under it automatically.

## Testing

1. **`sealPieceGeometry` unit tests** — bounds equal the existing
   `getPieceBounds` walk on the same input (curved and straight edges);
   `curvePoints` stripped; `shape` / `edge.path` byte-identical; input
   not mutated; idempotent.
2. **v12 round-trip** — `shape` omitted exactly when rebuildable;
   deserialized `shape` byte-identical to pre-save; a synthetic piece
   whose `shape` does *not* match its edge concatenation survives with
   `shape` stored and returned verbatim.
3. **Migration** — a v11 fixture with `curvePoints` loads via both
   `deserializeState` and `recombine`: bounds correct, no `curvePoints`
   in memory, `shape` untouched. Existing older-version fixtures keep
   passing (see `feedback_keep_old_save_migrations`).
4. **Seam invariant per cut style** — `createNewGame(...).pieces` carry
   `bounds` and no `curvePoints`; serialize → deserialize returns
   byte-identical `shape` strings for every style; composable styles
   actually omit `shape` (the dedup demonstrably fires where it should).
5. **Size guard** — regenerate the Wavy 16×12 measurement and pin the
   new size (expected ~1.2–1.3 MB) with commentary and seed spread, as
   in #493.
6. **Golden values** — existing golden-shape and precision tests pass
   unchanged.

## Non-changes

- **Info modal:** nothing user-visible changes; no help-text update.
- **Analytics:** no new instrumentation. `save-compressed` staying
  silent for the largest puzzles remains the success signal, with the
  same attribution caveats noted in the #493 design doc.
- **Progress blob:** untouched — not a size problem, and group offsets
  are player-controlled state.
