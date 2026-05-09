# Composable: topology graph as the central data structure

## Goal

Refactor the Composable cut style's pipeline so that **the topology of a puzzle
is computed once, on the input cuts, and never re-derived from modified
geometry afterwards.** Cuts (including any tab shapes baked into them) define
the puzzle; the framework's job is to discover what falls out and produce
pieces.

The refactor dissolves a class of bugs caused by re-running bezier-js
intersection at multiple pipeline stages on slightly different geometry, and
opens the framework to non-grid base-cut generators (e.g. overlapping
circles).

This spec applies **only to the Composable cut style**. Classic and Fractal
are unrelated and stay untouched.

## Why a refactor (the underlying problem)

Two recently observed bugs (both at small image sizes, e.g. 1080×720, with
`disableTabs: false`):

- Seed `124741785`, low-amp/high-freq settings: 189 pieces produced instead of
  192 — four grid cells fused into a single piece.
- Seed `3215341677`, high-amp settings: 191 pieces instead of 192.

Investigation showed both are symptoms of the same underlying issue: the
pipeline computes intersections at three separate stages on progressively
modified curves, and small floating-point disagreements between stages cause
topology disagreements:

```
generate base cuts
    ↓
[bezier-js intersect pass #1]   in resolveExcessIntersections
    ↓
[bezier-js intersect pass #2]   in mergeTabsIntoCuts.findSplitParameters
                                (splits curves at intersections, places tabs, rejoins)
    ↓
[bezier-js intersect pass #3]   in buildDCEL.findAllIntersections
                                (this is what produces the final topology)
```

When cut H is split at its crossing with cut V, the resulting endpoint is
`evalCubic(H_seg, t_self_for_H)`. When V is later split at the same crossing,
its endpoint is `evalCubic(V_seg, t_self_for_V)`. These differ by ~0.1 px due
to bezier-js's iterative intersection precision. After tab-merge, the two
cuts no longer share an exact point at their crossing; bezier-js's intersection
on the modified, multi-segment, near-tangent curves then **fails to detect the
crossing at all**, dropping a vertex that should exist. The 4 grid cells around
that vertex collapse into one face.

Every existing topology defence — `VERTEX_MERGE_TOLERANCE`,
`resolveExcessIntersections`, `mergeSmallFaces`, skip-on-collision tab
placement, `findExcessPairs` orphan handling — is a fix-up for one specific
disagreement between two of those passes. Each one solves a class of cases
and exposes new ones. The two open bugs are the latest in that sequence.

The deep fix is **structural**: stop re-deriving topology. Compute it once
on the input cuts, carry it forward as a first-class data structure, and
make all subsequent stages operate on that data structure rather than on
raw curves.

## The new architecture

### Data model

Three layers, each with one responsibility:

```
                  ┌────────────────────────────────┐
                  │  CutSet (input)                │
                  │  list of Curve objects         │
                  └───────────┬────────────────────┘
                              │ (compute intersections ONCE)
                              ▼
                  ┌────────────────────────────────┐
                  │  TopologyGraph                 │
                  │  vertices, half-edges, faces   │
                  │  each edge has a curve         │
                  │  topology immutable;           │
                  │  edge curves can be replaced   │
                  └───────────┬────────────────────┘
                              │ (per-edge tab generator + collision rejection)
                              ▼
                  ┌────────────────────────────────┐
                  │  TopologyGraph (decorated)     │
                  │  same topology, edge curves    │
                  │  may now include tab geometry  │
                  └───────────┬────────────────────┘
                              │ (faces → pieces)
                              ▼
                  ┌────────────────────────────────┐
                  │  PieceDefinition[]             │
                  └────────────────────────────────┘
```

`TopologyGraph` is internally a DCEL — the existing `dcel.ts` types
(`Vertex`, `HalfEdge`, `Face`) are reused. The change is **how it's
constructed and how it's consumed**: built once from raw cuts in a single
pass, then treated as the source of truth for everything that follows.

The crucial invariant: once a `TopologyGraph` exists, no operation changes
which vertices are connected to which edges, or how edges bound faces.
Edge curves can change shape; everything else is frozen.

### Plugin points

Composable is a *framework*, not a single cut style. The refactor formalises
three pluggable functions:

```ts
// Produces the cuts. Sees frame size and randomness, nothing else.
type BaseCutGenerator = (
    frame: Size,
    random: () => number,
    config: unknown,           // generator-specific, opaque to framework
) => Curve[];

// Per-edge, called by the framework after topology is built.
// Receives the edge's curve and length; cannot see neighbours.
// Must return a curve with the SAME endpoints as input (or null = no tab).
type TabGenerator = (
    edge: Curve,
    random: () => number,
    config: unknown,
) => Curve | null;

// Optional eligibility filter. Defaults to "all internal edges".
type TabPolicy = (
    edge: TopologyEdge,        // edge id, neighbouring face ids, length
) => boolean;
```

A puzzle "style" within Composable is then a triple
`{ baseCuts, tabGenerator?, tabPolicy? }`. Sine-grid is one. Two-circle
Venn is another. Future plugins are a third.

The framework owns:
- Computing intersections (once).
- Building the graph.
- Calling `tabGenerator` per eligible edge.
- **Checking the candidate tab curve for new crossings** against the rest of
  the graph; rejecting it (falling back to the original flat edge) if the
  candidate would change topology.
- Face extraction and piece definition output.

The framework does **not** own: what cuts look like, what tabs look like,
where tabs go beyond the eligibility policy.

The "tab generator can't see neighbours" rule (collision handling owned by
the framework) is the architectural commitment that lets us collapse the
multi-stage intersection re-derivation. If a future style genuinely needs
tabs that mesh with each other, that's not a tab generator — it's a more
sophisticated `BaseCutGenerator` that produces cuts already shaped to mesh.

## Robustness — handling numerical noise

In the new architecture, intersections are computed exactly once, on the
input cuts. That eliminates most current fragility. What remains is
near-coincident intersections from bezier-js: when two curves are nearly
tangent at their crossing, bezier-js sometimes returns two intersection
points 0.1–0.5 px apart that are really one geometric crossing.

The fix happens at graph construction:

1. **Vertex merge by tolerance** (already exists, keep): intersections
   within `VERTEX_MERGE_TOLERANCE` collapse to one vertex.
2. **Multi-edge collapse** (new): if vertex merging leaves two parallel
   edges between the same vertex pair, collapse them. They were reporting a
   "lens" that wasn't really there. Pick the one closer to a straight line
   between the vertices, or the average of both — implementation detail.

That's it. No `resolveExcessIntersections`, no orphan-pair handling, no
special "excess" concept. The graph just merges what's geometrically close.

Faces with area below the float-precision floor (sub-pixel area, or zero
area within rounding) are dropped as numerical artefacts — they're not real
geometry. Everything else is kept.

## Minimum piece area (replaces `mergeSmallFaces`)

A real puzzle could have a real small piece — the lens of a Venn, or a
triangular convergence where three cuts meet near each other but not at
one point. Under the "puzzle = whatever falls out of the cuts" rule those
are legitimate pieces; the framework must not silently merge them away.

But pieces still need to be physically handle-able — both at print size and
on screen — so a **minimum piece area** is a first-class config parameter
on the Composable style.

Implementation: faces below `minPieceArea` are produced as normal pieces,
then auto-grouped with a neighbour into a starting `PieceGroup` before the
puzzle is delivered to the game. Visually identical to merging;
behaviourally the player can never pull the tiny piece off (it's
pre-glued); inspectable as separate pieces under the debug overlay.

Reasons this is preferred over real topological merging:

- **Preserves the "puzzle = cuts" invariant.** The topology layer never
  lies about what fell out. Grouping is a delivery-time concern.
- **Reuses the existing `PieceGroup` mechanism**, already used for both
  render and interaction.
- **Strictly less destructive.** A real merge throws away an edge; auto-
  grouping keeps it as data even if it's hidden by default.

Deterministic auto-group rule (must be repeatable so share-links produce
identical results):

- Iterate faces in ascending area order.
- For each face below `minPieceArea`, group it with its **largest
  non-grouped neighbour**. Tie-break by lowest face id (face ids come from
  a deterministic traversal).
- If a face's only neighbours are also tiny, the larger of them grows by
  absorbing it, then re-checked on the next iteration. Cascades naturally.

`minPieceArea` is a config field on the Composable style with a sensible
default. The default is picked empirically by running the existing failing
seeds and seeing what threshold cleans up numerical-noise slivers without
absorbing legitimate small pieces. Whether to expose it in the UI is a
separate decision deferred to a follow-up.

## Multi-component support — the Venn requirement

Cuts that don't all touch the frame produce multiple disconnected components
in the graph. Two circles inside a frame, not touching the frame, give:

- **Frame component**: 4 corners, 4 sides.
- **Circle pair component**: 2 vertices (the circle intersections), 4 arcs.

The plane this produces has 4 inner faces — frame piece, two crescents,
lens — and the **frame piece has a hole in it** (the circle component sits
inside it as an inner boundary).

Implementation requirements:

- **DCEL component detection** in graph construction: union-find or BFS
  over the half-edge graph.
- **Hole assignment**: for each non-frame component, determine which inner
  face of which other component contains it (point-in-polygon test from any
  vertex of the inner component, against each candidate face), and record
  it as that face's inner boundary.
- **`PieceDefinition`** grows an `innerBoundaries: EdgeDefinition[][]`
  field — array of inner edge loops, in addition to the outer `edges`
  loop.
- **`composePuzzle`** produces an SVG path with a sub-path per inner
  boundary (`M ... Z M ... Z` with `fill-rule: evenodd`).
- **Hit testing** for clicks on a piece-with-hole must respect the hole.
  The current SVG-based renderer likely already gets this right via native
  hit-testing; verify before relying on it.

This is the largest single chunk of the refactor. Including it in V1 is a
deliberate choice: rejecting valid puzzles because they have a hole would
contradict the framework's whole pitch.

## Order of work

Each step is independently shippable / reviewable. The new pipeline runs
in parallel with the existing one until step 7 deletes the old paths.

1. **Introduce `TopologyGraph` as a thin wrapper over the existing DCEL.**
   No behaviour change — just a named type and an explicit "topology is
   fixed once" boundary. Existing tests still pass.
2. **Single-pass intersection finding.** Move all bezier-js intersection
   calls into one place that produces a `TopologyGraph`. Drop
   `findSplitParameters` and `findAllIntersections` as separate things.
   No tab work yet — the pipeline runs with `disableTabs: true` through the
   new path.
3. **Per-edge tab generator interface + collision-rejection harness.**
   Implement the C-style framework. Port `classicTabTemplate` to the new
   `TabGenerator` interface. `disableTabs: false` works through the new
   path. The two original repro seeds produce 192 pieces.
4. **Multi-component + holes.** DCEL component detection, `PieceDefinition`
   grows `innerBoundaries`, `composePuzzle` handles them, renderer hit-
   tests respect holes.
5. **Two-circle Venn generator.** Plug it into the framework as the second
   `BaseCutGenerator`. Any latent grid-assumption surfaces as a Venn test
   failure.
6. **Auto-grouping for small faces.** Replace `mergeSmallFaces` with the
   deterministic `minPieceArea` rule.
7. **Delete dead code.** `mergeTabsIntoCuts`, `resolveExcessIntersections`,
   `mergeSmallFaces`, the orphan-pair logic in `findExcessPairs`, the
   tip-piece tests. The Composable framework now has a single code path.

### Existing share links

Existing share links will not reproduce identical puzzles after this
refactor — both the PRNG call count and the topology pipeline change for a
given seed. Given the puzzle currently has effectively no users beyond the
maintainer, this is acceptable; we don't carry the old generator behind a
version switch. The share-link format itself doesn't need a version bump
because the *encoding* is unchanged; only the seed→puzzle function
changes.

## Out of scope

- Classic and Fractal cut styles. Untouched.
- New base-cut generators beyond Venn (concentric rings, polar, etc.).
  The framework supports them; this spec only commits to one extra style
  for cross-checking grid-assumptions.
- Exposing `minPieceArea` as a UI setting. Config-only for V1.
- Free-rotation work and other in-flight features. Independent.

## Testing strategy

- Existing Composable tests (tip-pieces, generator, dcel, faces-to-pieces,
  collision, tab-merge, excess-intersection) keep running until the
  modules they cover are deleted in step 7. Tests that target deleted
  internals are removed with their target.
- Integration test asserting both original repro seeds (`124741785`,
  `3215341677` at 1080×720) produce exactly 192 pieces.
- Per-step regression: the existing `tip-pieces.test.ts` 6×4-grid seed
  matrix keeps producing 24 pieces.
- Venn smoke test: 2 circles + frame produces exactly 4 inner pieces
  (frame, 2 crescents, lens) with the frame piece having one inner
  boundary.
- Determinism test: the same seed produces the same puzzle (including the
  same auto-groupings) across runs.
