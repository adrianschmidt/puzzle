# Silhouette cut generator — design

**Date:** 2026-07-05
**Status:** Approved for planning
**Surface:** Dev-only (composable base-cut option). Eventual production path is a
fixed-config preset named "Silhouette", per the composable-presets convention.

## Idea

Inspired by wooden children's puzzles where each animal is cut out along its
outline as a single tab-less piece. A new base-cut generator finds salient,
color-coherent regions in the puzzle image, cuts along their outlines with
knife-edge (tab-less) cuts, and fills the rest of the frame with the regular
sine lattice. Regions small enough to be one piece stay whole; larger regions
and the background are subdivided by the lattice, whose edges get normal tabs
from the selected tab generator. Even subdivided regions respect the outline:
the silhouette boundary is always a real cut line.

This is the classical-CV variant. A second, separate style based on curated
images with offline-produced outlines was discussed and deliberately deferred.

## Decisions made during brainstorming

- **Trace source:** classical CV heuristics (color-region segmentation), no ML
  dependency. Traces are "coherent color blobs", not semantic objects — the
  abstract results are acceptable, possibly part of the charm.
- **Big regions:** subdivide but respect the outline. Small regions stay whole.
- **Reproducibility:** best-effort. Saves are unaffected (they serialize final
  piece geometry, as today). Share links re-run the CV from the image URL:
  exact within one browser, potentially divergent across devices/browsers due
  to image-decoding differences. A short disclaimer in the dev UI covers this.
  No versioning gate yet (dev-only); add one before any production preset.
- **UI surface:** new base cut in the dev-only composable picker, id
  `silhouette` (not "trace"/"traced" — avoids confusion with the traced *tab*
  generator).
- **Sliders:** expose the full parameter set, including the sine sub-generator's
  own sliders (amplitudes/frequencies); dev-deploy is the only audience until a
  preset is frozen. Expect gentler sine defaults here than Wavy's.

## Architecture

Three units:

1. **Segmentation module** (`src/puzzle/silhouette/`) — pixels → outline curves.
2. **Silhouette base-cut generator** (`src/puzzle/topology/silhouette-cut-generator.ts`)
   — outlines + sine lattice → `Curve[]`, pixel-blind and synchronous.
3. **Framework extension** — per-curve tab suppression plumbed through the
   topology pipeline.

### 1. Segmentation pipeline

Core is a pure function `segmentImage(imageData, params): TraceRegion[]`,
canvas-free from stage 2 onward:

1. **Downscale** the puzzle image to a working raster (~256 px wide) via
   offscreen canvas (`crossOrigin='anonymous'` is already set by the image
   loader). This is the only canvas-touching step.
2. **Quantize** colors with median-cut to K levels (default 8) in a perceptual
   color space (Oklab). Median-cut is deterministic by construction — no
   k-means seeding/convergence concerns.
3. **Connected components** (4-connectivity) over the label map. Per component:
   area, mean color, bbox, adjacency to other components, frame-edge contact.
4. **Score and select:** score = area x mean color distance to surrounding
   components (saliency — so the parrot outranks the sky). Filter to
   components within [min, max] area bounds; **drop frame-touching
   components**; greedily take the top N. When `allowAdjacent` is off
   (default), skip components adjacent to an already-selected one — the
   sliver-avoidance rule. When on, slivers between adjacent picks are
   possible; auto-group is the safety net (see Hazards).
5. **Contour-trace** each selected component (marching squares); scale
   coordinates into puzzle-frame space.
6. **Simplify** (Douglas–Peucker; tolerance slider with a hard floor — the
   curve-count budget) then **smooth** into closed cubic-Bézier loops.

### 2. Pre-generation stage and data flow

Segmentation runs as an async pre-generation stage, mirroring the
`preloadTracedTabGenerator()` pattern: both the new-game and share-link load
paths call `computeSilhouetteOutlines(imageUrl, frameSize, params)` after the
image resolves, before generation.

**Persistence boundary (by construction):** the generator's config argument is
built fresh at generation time as `{...composableConfig.baseCutConfig,
outlines}` — a transient merged object. The `outlines` field exists only on
that transient object and is never assigned onto `GameState.composableConfig`,
which is what saves and the `cf` share block serialize. Polygon data therefore
cannot leak into localStorage or share links. Saves persist final `Piece[]`
geometry exactly as today (restore = deserialize, no re-segmentation, offline,
byte-exact).

**Degradation:** tainted canvas (non-CORS share-link image), blank image, or
zero surviving regions → empty outline list → plain sine lattice, with a
console warning. No hard failure.

### 3. The `silhouette` base-cut generator

Registered in the generator registry like sine/venn/triangular.
`generate(frame, random, config)`:

1. Emit the 4 border lines first (framework contract).
2. Draw **one** outer PRNG value and seed a local sub-PRNG (repo convention);
   all internal randomness comes from the local stream.
3. Delegate the background lattice to the **sine generator** via the registry,
   passing the sub-PRNG and the forwarded sine slider sub-config; discard its
   first 4 curves (border duplicates).
4. Classify each injected outline: area below the **whole-piece threshold**
   (slider, a multiple of average piece area, default ~3x) → whole; larger →
   subdivided.
5. For **whole** blobs, clip lattice curves out of the blob interior: intersect
   each lattice curve with the outline (`Curve.intersect`), split, keep
   segments whose midpoints lie outside, over-extending kept ends slightly
   *into* the blob so the DCEL cuts at a true intersection (see Spike). For
   **subdivided** blobs, the lattice passes through untouched; the outline
   still becomes real cuts.
6. Return `[border x4, ...outlineCurves, ...latticeCurves]` with outline curves
   flagged `suppressTabs`.

Whole-blob outlines that intersect nothing are already handled by
`splitClosedCurves` (splits closed loops at t=0.5 → two vertices) and the
inner-boundary (hole) machinery proven by the venn generator. Two shared
vertices pin rotation in merge detection; no new framework work.

### 4. Framework extension: tab suppression

`Curve` gains an optional `suppressTabs` flag, propagated through every split
operation (`splitAt`, intersection splitting, `splitClosedCurves`).
`TopologyEdge` exposes it, and `generateTopologyPuzzle` supplies a `TabPolicy`
(the hook already exists in `applyTabs`, currently unplumbed) that skips
flagged edges. Lattice edges keep the selected tab generator; outline edges
stay knife-edged.

## Dev UI and share links

The composable base-cut picker gains "Silhouette" with sliders:

- Segmentation: color levels K; max regions N; min/max region size (% of
  frame); `allowAdjacent` toggle; whole-piece threshold (x avg piece area);
  simplify tolerance (hard floor); smoothing strength.
- Lattice: the sine generator's sliders (horizontal/vertical amplitude and
  frequency), forwarded to the sub-generator.

All slider values persist in `composableConfig.baseCutConfig` → `cf.bgc`, with
decode-side clamping of hostile values, like sine/triangular. A short
disclaimer near the picker: shared Silhouette puzzles may not reproduce
pixel-identically on other devices. No info-modal changes (dev-only).

## Hazards and mitigations

| Hazard | Mitigation |
| --- | --- |
| Sliver faces between adjacent selected blobs | Default: never select adjacent blobs. `allowAdjacent` experiment relies on auto-group (`minPieceArea = avgPieceArea/4`) to glue slivers. Proper fix if adjacency wins: trace each shared boundary once, reuse the identical curve on both sides. Issue #218's general proximity resolver is orthogonal and not required. |
| Blob contours near-coincident with the frame border | Frame-touching components are dropped in v1. |
| Auto-group swallowing a whole traced piece | Effective minimum region area is floored above the auto-group threshold. |
| Clipped lattice endpoints missing the outline (float precision) | Over-extend clipped ends into the blob so a true intersection exists — contingent on the Spike below. |
| Curve-count / generation-time blowup | Simplify-tolerance hard floor. Escape hatch if JIT generation gets too slow: pre-generated puzzle library refreshed on a schedule (GitHub Actions) — out of scope for v1. |
| Polygon data leaking into saves/links | Transient config merge at the generation call site; persisted config holds sliders only. |
| Non-CORS images / blank image | Graceful degradation to plain lattice. |

## Spike (do first)

A DCEL unit test feeding curves with a dangling over-extended stub: does face
extraction prune it, or does it corrupt faces? If pruned → over-extend trick
confirmed. If not → fall back to snapping clipped endpoints onto the outline
within `VERTEX_MERGE_TOLERANCE`.

## Testing

- **Segmentation:** pure-function unit tests on synthetic `ImageData`-shaped
  buffers (colored rectangles → exact expected regions); determinism test
  (identical input → identical output). Tests live next to the source.
- **Generator:** inject synthetic outlines directly (circle, star, adjacent
  squares) — no pixels or canvas. Assert: whole blob → exactly one piece, all
  edges tab-less and mated to background pieces; no lattice-segment midpoint
  inside a whole blob; subdivided blob → multiple pieces whose union boundary
  is the outline.
- **Framework:** `suppressTabs` propagation through all split paths; TabPolicy
  plumbing.
- **Manual:** dev-deploy composable picker on real Unsplash photos — where the
  sliders earn their keep.

## Non-goals (v1)

- ML segmentation, user-marked subjects, curated-image outlines (separate
  future style).
- Cross-device share-link reproducibility guarantees / CV versioning.
- Shared-boundary curve reuse for adjacent picks.
- Production preset, info-modal copy, analytics.
