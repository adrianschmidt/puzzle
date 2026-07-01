# Deeper tab resolution for triangular cuts

**Date:** 2026-07-01
**Status:** Design — approved for planning

## Problem

Triangular base cuts produce small, sharp pieces. There is less free interior
space inside each piece than in a rectangular/sine cut, so the traced tab
resolver more often fails to place a tab without intersecting a neighbor, and
the edge is left flat (no tab). Visually, triangular puzzles end up with many
tab-less edges.

The traced generator's fallback "ladder" (`tracedTabVariants` in
`src/puzzle/topology/traced-tab-generator.ts`) currently has four rungs:

```
0. base            (tCenter, isTab,  basePath)     // == generate()
1. flip sign       (tCenter, !isTab, basePath)     // invert tab <-> blank
2. shrink          (tCenter, isTab,  shrunk 0.8)
3. shrink + center (tPulled, isTab,  shrunk 0.8)
```

Two shortcomings for cramped cuts:

1. **Inversion (tab -> blank) is tried only once**, at full size (rung 1). It is
   never combined with shrinking or moving. A cramped edge that needs *both* a
   smaller shape *and* the opposite orientation is never offered that
   combination.
2. **Scaling stops at one level (0.8).** There is no progressively-smaller
   fallback before the resolver gives up.

## Goal

For the **triangular** base cut only, give the traced resolver a deeper ladder
that (a) offers inversion as an alternative at every level, and (b) steps the
tab down through several progressively smaller scales before giving up. Recover
tabs on edges that currently go flat.

## Scope decision: triangular only

The traced tab generator is shared. **Wavy** (a shipped production preset) and
sine-based composable puzzles both use it. Extending the ladder unconditionally
would change which variant wins on any edge that previously went flat, altering
existing Wavy production share links (reproducibility drift).

Triangular, by contrast, is **unreleased / dev-only** (see the note at
`src/puzzle/topology/triangular-cut-generator.ts:88` — "triangular is unreleased
so no existing share link depends on..."). It is reached only through the
dev/preview composable UI, never a production preset. We are therefore free to
change its output.

**Decision:** gate the deep ladder to triangular. Wavy and sine-composable keep
today's exact four-rung ladder, byte-identical — no share-link changes for any
released cut style.

## Gating mechanism

The tab generator has no knowledge of the base cut today; `applyTabs` and
`generateVariants` receive only the edge curve and the opaque `tabConfig`.

The gate is derived in **one** place — `generateTopologyPuzzle`
(`src/puzzle/topology/generator.ts:169`), where `baseCutId` is already known and
`applyTabs` is about to be called. When `baseCutId === 'triangular'`, merge a
derived flag into the tab config:

```ts
const tabConfig =
    baseCutId === 'triangular'
        ? { ...(config?.tabConfig ?? {}), deepResolve: true }
        : config?.tabConfig;
applyTabs(graph, tabGenerator, random, { tabConfig, onCandidate: ... });
```

Deriving the flag here (rather than in `composable-config.ts` where the
triangular slider config is built) means **every** path that reaches the
generator with a triangular base cut gets the deep ladder — no config
construction site (share-link decode, new-game dialog, tests) can silently
forget to set it. The flag is a pure function of `baseCutId`, which is part of
the reproduced config, so share links reproduce it deterministically.

The traced generator reads the flag alongside the trace-set version it already
reads from `tabConfig`. Non-traced generators (`classic`, `none`) ignore it, as
they ignore all of `tabConfig`.

## The deep ladder

`tracedTabVariants` gains a `deep: boolean` parameter. When `false` (default,
non-triangular) it yields exactly today's four rungs, unchanged. When `true` it
yields:

```
scales = [1.0, 0.8, 0.64, 0.512]        // each = previous * 0.8

for each scale s in scales:
    (tCenter, isTab,  path(s))          // upright
    (tCenter, !isTab, path(s))          // inverted

# final center-pull tier, smallest scale only:
    (tPulled, isTab,  path(0.512))      // upright, pulled toward mid-edge
    (tPulled, !isTab, path(0.512))      // inverted, pulled toward mid-edge
```

Concretely, 10 rungs in order:

```
0.  1.0   center  upright   (== base == generate())
1.  1.0   center  inverted
2.  0.8   center  upright
3.  0.8   center  inverted
4.  0.64  center  upright
5.  0.64  center  inverted
6.  0.512 center  upright
7.  0.512 center  inverted
8.  0.512 pulled  upright
9.  0.512 pulled  inverted
```

This realizes the requested ordering: place -> invert -> scale -> scale+invert
-> ... The framework (`applyTabs`) still commits the first rung that survives its
crossing checks, so an edge takes the largest, most-upright tab that fits and
only falls to smaller/inverted/pulled shapes when it must.

### Details / invariants

- **`path(s)`** is `scaleBezierPath(basePath, s, s)`. For `s === 1.0` use
  `basePath` directly (no scaling call), so rung 0 stays geometrically
  byte-identical to today's base and to `generate()`.
- **`path(0.8)`** reuses the existing `shrunk`. The 0.64 and 0.512 paths are new
  precomputed scalings.
- **`tPulled`** uses the existing `CENTER_PULL = 0.5` formula, unchanged.
- **PRNG contract preserved.** All random draws (2 placement + 1 template
  subseed) happen before the first yield, exactly as today. Adding rungs does
  not add draws — the per-edge count stays 3 regardless of `deep`. This is the
  existing reproducibility contract and must not change.
- **`generate()`** (the single-shot, non-variants entry point) is unchanged: it
  returns the first non-null variant, which is the base rung. `deep` only
  affects the variants ladder.
- Scale constants: introduce `SCALE_STEP = 0.8` and derive the four scales, or
  list them explicitly. `SHRINK` (0.8) is subsumed by the scale list.

## Performance

Worst case per fully-flat triangular edge rises from 4 to 10 rung attempts, each
a splice + crossing check (`BUMP_SAMPLE_COUNT = 60` samples). This only affects
edges that fail the earlier, cheaper rungs. Triangular already has a raised
curve budget and a re-enabled worst-case timing test (recent commits). The plan
must re-run that timing test and confirm the deeper ladder stays within budget;
if it regresses materially, revisit the scale depth (fewer levels) before
widening tolerances.

## Testing

- **`traced-tab-generator.test.ts`**
  - Regression: with `deep` unset/false, the ladder yields exactly the four
    original rungs in the original order (guards Wavy/sine).
  - Deep ladder: with `deep` true, yields the 10 rungs above in order; first
    variant still equals `generate()` (base); endpoints preserved on every
    yielded variant; still exactly 3 outer PRNG calls regardless of `deep` or
    how many rungs are pulled.
- **`generator.ts` gating**: a triangular base cut causes `deepResolve: true` to
  reach the traced `generateVariants`; a sine/other base cut does not. Test at
  the seam (e.g. a spy/fake tab generator recording the `tabConfig` it
  receives), so the gate is verified through the real generator path, not by
  reading internals.
- **`tab-rejection-measurement.test.ts`** (gated by `MEASURE_TABS=1`): update the
  rung-index -> label map for the deep case so the per-rung recovery counts stay
  meaningful; optionally report recovered-vs-flat for triangular to demonstrate
  the improvement.
- Follow TDD: write the ladder-shape and gating tests first (red), then
  implement.

## Out of scope / non-changes

- No change to the `classic` or `none` tab generators.
- No change to the non-triangular (default) ladder.
- **Help text (`info-modal.ts`): no update.** Triangular is a dev-only composable
  base cut, not documented in the modal, and this change adds no user-facing
  control or named feature — it only makes triangular tabs appear more often,
  which is what a player already expects a tab resolver to do.
- No new PRNG draws, no sub-PRNG needed (no new randomness is consumed).
