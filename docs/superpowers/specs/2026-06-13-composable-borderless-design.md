# Composable borderless mode — design

Implements [#139](https://github.com/adrianschmidt/puzzle/issues/139); design decision in
[#131](https://github.com/adrianschmidt/puzzle/issues/131).

## Problem

The composable cut style always produces a rectangular puzzle with flat
border edges. A **borderless** mode should produce pieces that have a
tab/blank on every side (no recognizable frame → harder puzzle), per the
resolved decision in #131:

> Generate an oversized grid (1 extra row/column on each side), map the
> image to the full grid, then discard the outer ring. The inner pieces
> all have tab/blank edges on every side; the image maps to the full
> oversized grid so the newly-exposed outer tabs still show valid image
> content. The visible area is slightly smaller than the full image.

## Key architectural decision

Borderless is **not** a property of "Composable" as a whole. Composable
(the topology pipeline) has no inherent notion of a grid — the grid lives
in the **base cut generator** (the sine generator owns `cols`/`rows`).
Therefore borderless is a **base-cut-generator capability**:

- A base cut generator advertises whether it supports borderless.
- The **sine** generator implements the grid-specific part (oversize).
- The **strip** is generic (topological) and carries no grid knowledge.
- Composable just threads a `borderless` flag through to the base-cut
  config and the strip gate; it gains no grid concept.

This also means Wavy (which uses the sine base cut) gets borderless
*generation* for free — but wiring Wavy's UI/persistence/help-text is
**out of scope** for this PR (fast follow-up).

## Approach

### 1. Capability flag

`BaseCutGenerator` (`src/puzzle/topology/plugin-types.ts`) gains an
optional `supportsBorderless?: boolean`. The sine generator sets it
`true`; Venn and others leave it falsy.

### 2. Oversize (sine generator)

`sine-cut-generator.ts` reads `borderless` from its config. When true it
generates cuts for a `cols+2 × rows+2` grid across the same image frame
(1 extra column left/right, 1 extra row top/bottom). The grid knowledge —
and the extra per-cut PRNG draws — stay inside the generator.

### 3. Strip (generic post-pass)

A new pure module `src/puzzle/topology/strip-border-ring.ts` operates on
the generated `Piece[]` (+ `autoGroups`):

1. **Identify** the outer ring: every piece that has at least one border
   edge (`matePieceId === -1`). On the oversized grid this is exactly the
   1-deep outer ring.
2. **Remove** those pieces.
3. **Re-mark** survivors' exposed edges: any edge whose `matePieceId`
   referenced a removed piece becomes a border edge (`mateEdgeId = -1`,
   `matePieceId = -1`). The edge's `path` and the piece's baked `shape`
   are untouched, so the inward tab geometry is retained — the exposed
   edges keep their tabs.
4. **Reconcile** `autoGroups`: drop references to removed pieces; discard
   groups that become empty or singleton.

No re-indexing of piece ids is needed: composable puzzles regenerate
deterministically from seed + config on load, so ids never persist, and
the model keys pieces by id (gaps are fine). The strip consumes **no**
randomness.

The topology generator (`generateTopologyPuzzle`) invokes the strip only
when `config.borderless && baseCutGenerator.supportsBorderless`, and
forwards `borderless` into the base-cut config so the sine generator
oversizes. If a base cut generator doesn't support borderless, the flag
is ignored entirely (no oversize, no strip).

### 4. Config plumbing (Composable)

- `ComposableConfig.borderless?: boolean`
  (`src/puzzle/composable-generator.ts`) → forwarded to
  `TopologyGeneratorConfig.borderless`.
- `ComposableSliderPreference.borderless: boolean`
  (`src/game/composable-config.ts`), default `false`, parsed with a
  permanent migration default like the existing fields.
- New-game dialog: a "Borderless" checkbox in the Composable options
  section, shown only when the active base cut generator advertises
  `supportsBorderless` (sine → always, for Composable today).
- Share-link `cf` payload gains `bl?: boolean`
  (`src/sharing/share-link.ts`).
- `GameState.composableConfig.borderless` round-trips through
  serialization (`src/persistence/serialization.ts`).

### 5. No help text

Composable is **not** in the production build, so per repo convention we
do **not** touch the info-modal help text. (If Wavy borderless is wired
later, *that* gets help text.)

## Reproducibility

`borderless` is a new flag. The oversize (extra sine PRNG draws / extra
tab applications) and the strip happen **only** when `borderless === true`.
For `borderless` false/absent, `cols`/`rows` and the entire pipeline are
byte-for-byte unchanged, so every existing bordered Composable and Wavy
share-link/save replays identically. Borderless puzzles define a new
deterministic stream, frozen going forward. The strip itself draws no
randomness, so it cannot perturb the stream regardless.

## Out of scope

- Wavy borderless UI/persistence/help-text (generation works for free;
  player-facing wiring is a follow-up).
- Borderless for non-grid base cut generators (Venn) — they don't
  advertise the capability.
- Any change to bordered generation, the renderer, or the game engine.
- Re-scaling the image so the inner puzzle fills the frame — the slight
  crop is accepted per #131.

## Testing

- **Sine oversize**: with `borderless`, the generator emits the cut count
  for `cols+2 × rows+2`; without it, unchanged (locks the PRNG contract).
- **Strip module** (pure unit tests): a synthetic grid of pieces → strip
  removes exactly the border-edge pieces; survivors' edges that pointed
  at removed pieces become `mate*Id = -1` while their `path`/`shape` are
  untouched; autoGroups reconciled; no-op when nothing borders.
- **Capability gating**: borderless requested on a non-supporting base
  cut generator is a no-op (no oversize, no strip).
- **End-to-end composable**: a borderless composable puzzle has no
  `matePieceId === -1` piece that also has a flat (tab-free) silhouette —
  i.e. every remaining piece has tabs on all sides; piece count equals the
  requested `cols × rows`.
- **Config/persistence/share**: `borderless` round-trips through the
  preference store, `GameState`, serialization, and the share link;
  default is `false`.
- **Dialog**: the Borderless checkbox renders when the base cut generator
  supports it and feeds its value into the generated config.
