# Traced-tab R4 retry ladder + locality culling — design

**Date:** 2026-05-29
**Status:** Approved design, pending implementation plan
**Scope:** Reduce the rate of flat (tab-less) internal edges produced by the
**traced** tab generator in the Composable cut style, without regressing
puzzle-generation performance or tab aesthetics.

---

## 1. Problem & measured cause

The traced tab generator asks the `applyTabs` harness to place one tab per
shared internal edge. If the single candidate it produces is rejected, the
edge is left flat — there is no retry today. Players using aggressive sine
settings report "quite a few" tab-less edges.

### What the data actually shows

A throwaway measurement harness reproduced the exact Composable pipeline
(`sineCutGenerator` → `buildDCEL` → per-edge `generate` + the `applyTabs`
accept gates) and attributed every outcome to a specific rejection reason,
fidelity-validated against the real `applyTabs` (accepted counts matched).

Rejection reasons (one of):

- **R1** edge too short (`computeTabPlacement` → null)
- **R2** tab too wide (`prepareTab`/splice → null)
- **R3** folds back through self (`foldsBackThroughSelf`)
- **R4** crosses another edge (`introducesNewCrossing`)
- **R5** endpoint mismatch (`endpointsMatch` false)

**At mild settings** (≤0.35 amplitude, 1.5 frequency, 8×6…20×15): rejection
3.3–4.6%, **100% R4**, R1/R2/R3/R5 all 0%.

**At the user's real settings** (16×12, `ha=va=0.5`, `hf=8`, `vf=6`, 15 seeds,
two frame sizes):

| metric | value |
|---|---|
| rejection rate | **20.7%** (~74 flat edges in a 356-edge puzzle) |
| R1 / R2 / R3 / R5 | **0.0% each** |
| R4 (crosses a neighbour) | **100% of rejections** |
| frame-invariance | identical 20.7% at 1600×1200 and 1200×900 |
| min edge length | 40–53px (30px R1 cutoff never bites) |

**R4 sub-classification — what the bump crosses:**

| crossed | share of R4 |
|---|---|
| adjacent edge (shares a corner), neighbour already had a tab | **52.7%** |
| adjacent edge (shares a corner), neighbour still flat | **43.6%** |
| distant edge, had a tab | 3.7% |
| distant edge, flat | 0.0% |

### Conclusions that drive the design

1. **Width/length/fold prevention is wasted effort** — R1/R2/R3 never fire,
   even at extreme settings and 40px edges. The problem is purely R4.
2. **~96% of crossings are at a shared corner with an adjacent edge.** It is a
   *local* problem; global obstacle-awareness is unnecessary (distant
   crossings ~4%, and never against a flat edge).
3. **~53% of crossings hit a neighbour's already-committed tab** — order
   dependent crowding at a vertex, which a retry naturally resolves. The other
   ~44% reach across the corner onto a still-flat adjacent edge — fixed by
   reducing the bump's reach or moving it off the corner.

---

## 2. Approach

Two complementary changes:

- **A retry ladder** in the traced generator: when the base tab is rejected,
  try a small ordered set of cheap local variations and commit the first that
  passes the harness's existing accept gates.
- **Locality culling** in the harness's crossing check: a baseline speedup
  that applies to *every* tab placement (first attempt included) and *every*
  generator (classic/wavy benefit too), offsetting the cost of the extra
  retries.

### 2.1 Variant interface

Extend `TabGenerator` with an optional method:

```ts
generateVariants?(edge: Curve, random: () => number, config: unknown): Iterable<Curve>;
```

`applyTabs` per shared edge:

- If the generator implements `generateVariants`, iterate the candidates and
  **commit the first** that satisfies the existing gates
  (`endpointsMatch && !foldsBackThroughSelf && !introducesNewCrossing`). If
  none pass, leave the edge flat (unchanged behaviour).
- Otherwise, fall back to today's single `generate` + gates.

Rationale: validation stays centralized in the harness (one source of truth
for "is this candidate legal"); only the *geometry* of the variations lives in
the generator. Classic and `none` generators don't implement the method, so
their behaviour is byte-for-byte unchanged.

*Alternative considered:* inject an `accept` predicate into `generate` and let
the generator run the ladder internally. Rejected: it splits acceptance logic
between harness and generator, and the harness would still have to re-validate
to stay the source of truth.

### 2.2 PRNG-safe variant production

Today `prepareTab` calls `template.generate(random)` *inside* the splice, so
re-splicing each rung would redraw the PRNG and change outer-stream
consumption per rung.

Refactor so the **PRNG-consuming step is done once**:

- Keep `computeTabPlacement(edge, …, random)` (2 outer draws) and
  `template.generate(random)` (1 outer draw) as the only PRNG consumers.
- Split `prepareTab` into:
  - path generation (calls `template.generate`) — done once, and
  - `spliceWithPath(edge, normalizedPath, tCenter, isTab)` — a **pure,
    deterministic** placement/splice/tangent-align that takes a
    pre-generated path.
- `tracedTabGenerator.generateVariants` draws path + placement **once**
  (3 outer draws, identical to today), then yields each rung as a deterministic
  transform of that path/placement. **Zero extra PRNG draws**; outer stream
  advances by exactly 3 per edge regardless of how many rungs are tried.

This preserves within-session reproducibility (same seed → same puzzle). There
are no traced share-links to protect (Composable + traced is dev-deploy only),
but the fixed-consumption discipline is kept anyway and matches the existing
traced sub-PRNG pattern.

### 2.3 The ladder

Best-first; the first candidate to pass the gates is committed; if none pass,
the edge stays flat (today's outcome). Initial composition:

1. **base** — exactly today's tab (so unchanged puzzles stay unchanged where
   the first attempt already succeeds).
2. **shrink ×0.8** — scale the normalized path in x and y (head reaches less
   far across the corner). Helps adj/flat and adj/tab.
3. **pull-to-centre** — move `tCenter` halfway to 0.5 (away from whichever
   corner it sat near; blind, no feedback needed since ~96% of crossings are
   at a corner).
4. **shrink + pull-to-centre** — combined.
5. **flip sign** — bump to the other piece's side (dodges a subset, esp.
   adj/tab). Placed last because it perturbs local tab/blank parity.

Exact shrink factor, pull fraction, and rung order are **tunable**; they are
locked empirically in §4 against the user's real settings. The ladder is a
fixed, small list (≤6 rungs) — no unbounded search.

### 2.4 Locality culling (baseline speedup, generator-agnostic)

`introducesNewCrossing` currently calls `candidate.intersect(he.curve)` for
every other half-edge in the graph. `Curve.intersect` already culls per
*segment* internally, but the per-edge object setup still happens for every
edge.

- Add `Curve.boundingBox()` (axis-aligned; from segment control points or the
  existing `sample()`).
- In `applyTabs`, compute and cache each half-edge's bounding box once. In the
  crossing check, **skip the `intersect` call entirely when the candidate's box
  does not overlap the other edge's box.** A non-overlapping bbox proves the
  curves cannot intersect, so skipping is always correct (the rare distant
  crossing — boxes *do* overlap — is still checked).

This runs on **every** candidate's crossing check — including the first
(and often only) attempt on edges that never retry — and benefits **every**
generator that uses `applyTabs` (classic in Composable and Wavy, not just
traced). Net effect on wall-clock is **not measured** (the gated harness
measures rejection rate, not duration): the cull is a constant-factor
saving on 100% of edges while the ladder adds a bounded ≤5-rung cost on
the retry fraction. Both scale with E per candidate, so at tested grid
sizes the cull should offset most of the ladder's added cost, but total
time isn't guaranteed monotonic-better at very large grids with a high
retry fraction. The crossing check stays O(E²) per generation (the cull
changes the constant, not the class).

---

## 3. Components & responsibilities

- `Curve.boundingBox()` — new pure helper.
- `apply-tabs.ts`
  - `introducesNewCrossing` — bbox pre-check before `intersect`.
  - `applyTabs` — per-edge half-edge bbox cache; variant-aware loop
    (`generateVariants` if present, else single `generate`).
- `tab-generator-helpers.ts`
  - split `prepareTab` into path-generation + pure `spliceWithPath`.
  - path-transform helpers: `scalePath` (shrink), reuse `mirrorBezierPathY`
    (sign), `tCenter` adjustment (move).
- `traced-tab-generator.ts`
  - implement `generateVariants` (base + ladder), built on the split helpers.
- `plugin-types.ts` — add optional `generateVariants` to `TabGenerator`.

The DCEL/topology, face extraction, and compose layers are untouched.

---

## 4. Validation

- **Quantitative:** keep a gated version of the measurement harness. Re-run at
  the user's real settings (16×12, ha=va=0.5, hf=8, vf=6, ≥15 seeds) before and
  after. Expect 20.7% → a substantially lower residual; confirm R1/R2/R3 stay
  ~0; record the residual and the per-rung recovery (how many edges each rung
  rescued) to justify/trim the ladder.
- **Performance:** generation wall-time is not asserted (the shipped harness
  measures rejection rate only). If a timing question arises, measure at the
  user's settings before vs after (culling on/off, ladder on/off); the cull is
  expected to offset most of the ladder's added cost at tested grid sizes, not
  to be guaranteed faster at every size.
- **Visual:** dev-deploy pass at the user's settings to confirm no obvious
  "small-tab" / "centred-tab" / parity pattern on wavy-corner edges.
- **Tests:** unit tests for `Curve.boundingBox`, `spliceWithPath` determinism
  (same inputs → same curve, no PRNG), the variant-aware `applyTabs` loop
  (first-passing-variant committed; all-fail → flat), and the cull (an edge
  whose bbox can't overlap is never intersected; a real crossing is still
  caught). Test files sit next to the source they cover.

---

## 5. Out of scope / explicit non-goals

- Width/length/fold prevention (R1/R2/R3) — never observed; no work.
- Obstacle-aware directional nudging — crossings are local; the blind ladder
  suffices. Not built.
- A "different template" rung — would cost extra PRNG draws for marginal gain.
- Help-text/info-modal update — traced/Composable is dev-deploy only and not in
  the player-facing cut-styles help. Verify during implementation; update only
  if that assumption is wrong.

## 6. Adverse-consequence watch

- Shrunk/centred tabs may concentrate on wavy-corner edges (faint size/position
  pattern). Checked visually in §4.
- Flip-sign shifts local tab/blank parity; rare (last rung). Checked visually.

Both judged acceptable against a 20% flat-edge rate.
