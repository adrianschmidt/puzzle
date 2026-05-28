# Splice tangent spread — design

## Summary

`smoothedTabSplicer` (traced-tab generator) currently makes a tab join
its parent edge C1-in-direction by rotating only the tab's outermost
control points (`alignTangentsAtSplice`): first segment's `cp1` and last
segment's `cp2` are rotated onto the parent's tangent, cp distances
preserved. On a highly-curved parent (the sine base-cut) the entire
angle correction is forced into that one outermost segment, so the curve
still reads as a sharp corner just inside the splice.

This replaces the body of `alignTangentsAtSplice` with an **anchor-removal
+ single-cubic bridge** (issue #371 "Variant B"): drop the template
anchors that fall within a small zone of the splice and replace that span
with one cubic that leaves the splice in the parent's direction and
arrives at the first surviving anchor along that anchor's natural
tangent. The size of the zone scales with the angle correction `θ`, so a
bigger correction is spread over a longer arc. Small corrections fall
back to today's outermost-cp rotation.

Variant A (fractionally rotating several interior anchors' tangents) is
**not** implemented: rotating interior tangents tends to add waviness
rather than remove the corner, so it was rejected by reasoning rather
than by screenshot.

## Goals

- Remove the sharp splice corner on the seed `1086655870` reference
  puzzle (pieces 1 / 19 / 22) when traced tabs sit on a sine base-cut.
- Don't reintroduce the S-curve / wiggle artifacts that the reverted
  cp-distance boost (474b77a, reverted in efdfa83) produced.
- Keep the splice C1-in-direction (existing guarantee), symmetrically at
  both ends of the tab.
- Leave the classic generator (`standardTabSplicer`) and the share-link
  PRNG contract completely untouched.

## Non-goals

- Variant A (per-anchor tangent rotation). Rejected; see Summary.
- Any new toggle / config field. Variant B becomes the default behaviour
  of `smoothedTabSplicer`; the user A/Bs old-vs-new by deploying.
- Help-text changes. This is an internal geometry refinement with no new
  button, setting, gesture, or interaction, so the info modal stays
  accurate as-is (per the repo `CLAUDE.md` help-text rule).

## Algorithm

Applied symmetrically at each splice end, operating on the
already-transformed world-space tab in `prepared.tabCurve`. The parent
tangents are taken from `tangentAtEnd(before)` (left splice) and
`tangentAtStart(after)` (right splice) — the same helpers
`alignTangentsAtSplice` already uses.

1. **θ** — angle between the parent's tangent at the splice and the tab's
   *natural* tangent there. Natural tangent is `p0→cp1` of the first
   segment (left end) / `p3→cp2` of the last segment (right end), i.e.
   the template's own direction before any alignment.

2. **θ → d** — a monotonic, piecewise-linear ramp giving a smoothing
   distance `d` as a fraction of the tab's splice-to-splice chord
   (`|firstAnchor → lastAnchor|`). Breakpoints (the issue's starting
   values, kept as named constants so they're easy to retune on the
   deploy):

   | θ        | d (chord fraction) |
   |----------|--------------------|
   | ≤ 10°    | 0 (fall back)      |
   | 30°      | 0.05               |
   | 60°      | 0.15               |
   | ≥ 90°    | 0.30 (clamp)       |

   Linear interpolation between breakpoints; clamped flat above 90°. A
   smooth ramp rather than a hard table avoids a discontinuity at each
   boundary.

3. **Walk inward** over the tab's anchors (`segs[0].p0`, then each
   `seg.p3`), accumulating straight-line inter-anchor distance from the
   splice. Anchors whose accumulated distance `< d·chord` are the
   smoothing zone for that end.

4. **Bridge** — drop the in-zone anchors and replace the dropped span
   with a single cubic:
   - `p0` = splice point, tangent `t1` = parent direction at the splice.
   - `p3` = first surviving anchor, tangent `t2` = that anchor's natural
     tangent (taken from the surviving kept segment, pointing back into
     the bridge), so the join with surviving template geometry stays C1.
   - control magnitudes = `chord/3` (cubic-Hermite default), matching
     `tools/trace-tab/smooth-clusters.py:_bridge_single_cubic`.

5. **Fallback** — if no anchor falls in the zone (θ below the 10°
   threshold, or the nearest anchor is already past `d·chord`), apply
   today's behaviour: rotate the outermost cp only, distance preserved.
   This keeps near-straight parents and the classic-template unit cases
   bit-for-bit as they are now.

## Guards / edge cases

- **Head protection.** The inward walk never consumes the tab's head:
  both end-zones together must leave the highest-|y| anchor(s) and at
  least one interior anchor surviving. A large `d` on a short tab is
  clamped so the two bridges can't meet and flatten the head.
- **Zone overlap.** The left and right zones are computed against the
  same anchor list and clamped so they never cross.
- **Degenerate tab.** Single-segment tab, or zero-length chord → return
  `prepared` unchanged (mirrors the existing `segs.length === 0` guard).

## Why C1 is preserved

The bridge sets the splice-end tangent to the *exact* parent direction
(`t1` = `beforeTangent` / `afterTangent`), so the existing "matches
parent tangent at both splice points" test stays green to 6 decimals.
The tab's segment count shrinks when anchors are removed, but that test
computes the tab span dynamically (`N = segs.length - 2`) and reads the
tab's first/last segments by that index, so it keeps working.

## Testing (TDD)

New unit tests in `tab-generator-helpers.test.ts`, using a strongly
curved single-segment parent like the existing `curvedParent()` helper.
To keep the assertions independent of the photographed trace assets
(which get re-smoothed by `smooth-clusters.py`), the tests use a
synthetic multi-anchor `TabTemplate` with known anchor spacing rather
than the real `tracedTabTemplate`, so anchor-drop counts are
deterministic:

1. **Anchors removed on a curved parent** — segment count of the tab
   span is strictly less than the standard splicer's tab span (the zone
   dropped at least one anchor), and the splice is still C1 at both ends.
2. **Fallback on a near-straight parent** — tab span segment count equals
   the standard splicer's (no anchors removed) and the splice is C1.
3. **Head survives a forced-large correction** — under a parent that
   yields θ ≥ 90°, the tab's highest-|y| anchor is still present in the
   output and at least one interior anchor remains between the two
   bridges.

Existing `smoothedTabSplicer` tests (C1 at splice, differs-from-standard)
must still pass unchanged.

## Validation (manual, on dev-deploy)

The reference puzzle is reproduced verbatim from the browser console —
no code path or toggle needed, since Variant B is the default traced
behaviour:

```js
__newComposableGame({
    seed: 1086655870,
    cols: 6, rows: 4,
    baseCutGenerator: 'sine',
    baseCutConfig: { cols: 6, rows: 4, ha: 0.5, hf: 3.2, va: 0.5, vf: 2.1 },
    tabGenerator: 'traced',
    tabConfig: {},
})
```

A successful fix removes the sharp corners on pieces 1 / 19 / 22 (or
matches the "acceptable" threshold from PR #367) without introducing
wiggle artifacts, and leaves Wavy / classic puzzles visibly unchanged
(different splicer, but verify). If the corner is over- or under-rounded,
the ramp breakpoint constants are tuned and re-deployed.

## PRNG contract

No `random()` calls are added, removed, or reordered. The smoothing runs
on the output of `prepareTab` inside the splicer, after all PRNG
consumption, so every existing share link and save reproduces
identically.

## Files

- `src/puzzle/topology/tab-generator-helpers.ts` — replace the body of
  `alignTangentsAtSplice`; add the θ→d ramp and the bridge/anchor-walk
  helpers. `smoothedTabSplicer`, `standardTabSplicer`, `prepareTab`,
  `commitTab` signatures unchanged.
- `src/puzzle/topology/tab-generator-helpers.test.ts` — new tests above.
