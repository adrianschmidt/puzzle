# Triangular base-cut generator — design

**Date:** 2026-06-28
**Status:** Approved (brainstorming), pending implementation plan

## Goal

Add a new base-cut generator to the Composable framework that tiles the
puzzle frame with **equilateral / isometric triangles**, selectable from the
Composable section of the new-game dialog. Composable remains hidden in
production behind the `/dev/` gate, so this is an experimental cut path.

## Decisions (from brainstorming)

1. **Geometry:** equilateral / isometric triangle tiling (three line families:
   horizontal + ±60°). The frame's left/right edges cut border triangles into
   partial pieces — accepted.
2. **Exposure:** full Composable dialog UI — a base-cut picker (`Sine` |
   `Triangular`) plus triangle-specific controls, not just a console hook.
3. **Sizing:** derive from the chosen puzzle size. Triangle row height =
   `frame.height / rows`; triangles-per-row derives from `frame.width`. The
   size grid stays the single scale control; `cols` is unused by triangular.
4. **Regularity:** regular triangles **plus** an optional `Irregularity`
   (jitter) slider that displaces interior vertices via a seeded sub-PRNG.

## Architecture

### New generator: `triangular-cut-generator.ts`

A `BaseCutGenerator` with `id: 'triangular'`, living beside `sine` and `venn`
in `src/puzzle/topology/`.

**Output model — per-edge lattice segments, not maximal lines.** The generator
builds an equilateral lattice of vertices covering the frame (plus a small
margin) and emits each unique triangle edge as one `Curve.line(v1, v2)`. This
differs from the sine generator (which emits maximal full-frame lines that
*cross*) for two reasons:

- Jitter displaces shared vertices, breaking the straight-line model — the
  edges between displaced vertices are independent segments.
- The DCEL builder (`dcel.ts`) natively supports a vertex-meeting lattice: it
  merges coincident endpoints within `VERTEX_MERGE_TOLERANCE = 3` px, detects
  T-junctions, and sorts arbitrary-valence vertices (degree 6 at an interior
  lattice vertex) into face cycles. Verified against the existing 3×3-grid
  DCEL test, which builds 9 faces from short segments meeting at shared
  endpoints.

**Hard DCEL rule observed:** each lattice edge is emitted **exactly once**.
No overlapping/duplicate collinear segments (the DCEL line-line check returns
no intersection for collinear overlaps, creating ambiguity).

**Border contract:** the first four curves are the frame borders (top, right,
bottom, left), as full-length lines. Interior edges that reach the border end
*on* the border line, producing T-junctions; the resulting border sub-edges
keep the outer face on one side, so they never receive tabs.

**Frame clipping:** the lattice is generated over a region slightly larger
than the frame, then each edge is clipped to the frame rectangle:

- An edge fully outside the frame is dropped.
- An edge crossing the boundary is truncated so its outside endpoint lands on
  the frame border (→ T-junction). This yields the accepted partial triangles
  at the left/right (and top/bottom) frame edges.

**Borderless:** `supportsBorderless` is left falsy. A jittered, partial-edge
triangular tiling has no clean 1-deep rectangular outer ring for
`strip-border-ring.ts` to remove, so a borderless request is ignored (per the
framework contract).

### Config shape

```ts
export interface TriangularCutConfig {
    /** Number of triangle rows; row height = frame.height / rows. From the
     *  size grid's `rows`. */
    rows: number;
    /** Irregularity amplitude, fraction of side length (0–0.5). Default 0.15.
     *  Drives seeded vertex displacement. */
    jitter: number;
}
```

The config is opaque to the framework. `rows` is injected by the topology
generator (it already spreads `{ cols, rows, ...baseCutConfig }`); `jitter`
comes from the dialog slider / share-link `bgc`. Side length is derived:
`s = 2 · (frame.height / rows) / √3`.

### Seeded randomness — sub-PRNG isolation

Per the repo's reproducibility contract and the sub-PRNG rule in CLAUDE.md:

- `generate()` draws **exactly one** outer `random()` value — constant
  regardless of `rows` or `jitter`.
- That value seeds a local `createSeededRandom` (via the `seedFromFloat`
  helper). All per-vertex jitter draws come from the **local** stream.
- Displacement is computed **per shared vertex identity**, so every edge
  incident to a vertex moves together and the tiling stays gap-free.
- Jitter is **clamped** so two distinct vertices can never be pushed within
  the 3px merge tolerance.
- **Border / near-border vertices are snapped to the frame and not jittered**,
  keeping border intersections clean and deterministic.

The outer stream advancing by exactly one call means future internal changes
to the triangular generator (new params, reordered local draws) only affect
triangular output for a given seed — never the rest of the puzzle's
generation, and only triangular's own share links.

## UI changes (`new-game-dialog.ts`, `main.ts`)

### Base-cut picker

In `buildComposableSlidersSection`, add a segmented row **`Base cut`** with
options `Sine` | `Triangular` at the top of the Composable section.

- **Sine selected** (default): show today's four sliders (H/V Amplitude, H/V
  Frequency) and the Borderless checkbox — unchanged behavior.
- **Triangular selected:** hide those four sliders and Borderless; show a
  single **`Irregularity`** slider (range 0–0.5, step 0.01, default 0.15) bound
  to `jitter`.
- The **`Tab style`** row (`Classic` / `Traced` / `None`) is shared and applies
  to both base cuts.

### Config types & translation

`ComposableSliderConfig` gains:

```ts
baseCut: 'sine' | 'triangular';
jitter: number;
```

`sliderConfigToGeneratorConfig` (`main.ts`) **branches on `baseCut`**:

- `'sine'` → today's `{ baseCutGenerator: 'sine', baseCutConfig: { ha, hf, va,
  vf }, borderless }`.
- `'triangular'` → `{ baseCutGenerator: 'triangular', baseCutConfig: { jitter }
  }` (no borderless; `rows` is injected downstream by the topology generator).

The dialog's `saved` restore path carries `baseCut` and `jitter` so reopening
the dialog restores the last triangular selection.

### Tabs on triangular edges

Tabs are a separate plug-in applied per internal edge with collision
rejection — no work in the base-cut generator. Classic/Traced tabs designed
for ~square edges may frequently fall back to flat on short or 60° triangle
edges (the framework keeps the edge flat when a tab would introduce a
crossing). This is acceptable v1 degradation; tuning tab shapes for triangular
edges is explicitly out of scope.

## Plumbing that needs no change

- **Share links:** `share-link.ts` writes `baseCutConfig` to `bgc` as a generic
  `Record<string, unknown>` and reads it back 1:1, so `{ jitter }` round-trips
  for free. `bg: 'triangular'` is already carried.
- **Saves / serialization:** the composable config is stored opaquely; the
  triangular config round-trips with no schema change.
- **Dev console:** `__newComposableGame({ baseCutGenerator: 'triangular',
  baseCutConfig: { jitter } })` reaches the generator without extra wiring.

## Help text

**No info-modal change.** Composable is dev-gated and intentionally
undocumented in `info-modal.ts`, so the repo's help-text rule (keep the modal
*correct*) imposes nothing here.

## Testing (TDD)

### `triangular-cut-generator.test.ts`

- `id === 'triangular'`.
- First four returned curves are the frame borders.
- **Exactly one outer PRNG call** regardless of `rows`/`jitter` — the
  reproducibility-contract assertion (mirrors the sine test's call-count
  check).
- Same seed + config → byte-identical curve set (determinism).
- No duplicate / overlapping edges in the output.
- All interior edge endpoints lie within the frame (post-clip).
- `supportsBorderless` is falsy.
- Jitter = 0 produces a regular tiling; jitter > 0 displaces interior vertices
  but leaves border-snapped vertices on the frame.

### Dialog tests (`new-game-dialog`)

- Selecting `Triangular` hides the sine sliders + Borderless and shows the
  `Irregularity` slider; selecting `Sine` reverses it.
- `getValues()` returns `baseCut` and `jitter`.

### Translation / round-trip

- `sliderConfigToGeneratorConfig` emits the correct shape for each `baseCut`.
- Share-link encode → decode preserves `bg: 'triangular'` and `bgc.jitter`.

## Registration

Register the generator in `generator-registry.ts` alongside `sine` and `venn`
(`registerBaseCutGenerator(triangularCutGenerator)`).

## Risks & mitigations

- **3px merge tolerance vs. small triangles:** very high `rows` on a small
  frame could place vertices < 3px apart and degenerate. Mitigation: jitter
  clamp + reliance on the bounded size-grid options; revisit a minimum-size
  guard if a size option proves too dense.
- **Border clipping correctness:** the clip-to-frame + snap-to-border step is
  the main implementation complexity. Covered by the endpoint-within-frame and
  determinism tests.
- **Tab fallback frequency:** classic/traced tabs may rarely apply on triangle
  edges; acceptable for v1 and documented above.

## Out of scope

- Tab shapes tuned for triangular edges.
- Borderless support for triangular.
- Documenting Composable / triangular in the info modal.
- Other tessellations (diagonal-split grid, pinwheel) considered and not
  chosen.
