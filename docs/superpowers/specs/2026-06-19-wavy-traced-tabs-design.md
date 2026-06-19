# Design: Release traced tabs as Wavy's tab shape

**Date:** 2026-06-19
**Status:** Approved (brainstorming) — ready for implementation plan

## Goal

Release the traced-tab generator by making it the tab shape for all **new**
Wavy games (drawn on the existing sine base cuts). Every existing Wavy
share-link and save must keep reproducing **exactly** as it does today
(classic tabs on sine cuts). Build the trace-set versioning so that future
trace-set revisions are frozen snapshots that old links keep replaying
against.

## Decisions (locked during brainstorming)

1. **Classic-tab Wavy becomes reproduce-only.** New Wavy games always use
   traced tabs. Classic-tab Wavy is no longer creatable — it survives only to
   reproduce old share-links/saves. No UI toggle, no new dialog control.
2. **Trace sets are "free to revise."** Traces may be added, removed,
   reworked, or reordered between releases. Each released version is a
   **frozen, named snapshot**: an explicit ordered list of which traces and in
   what order, retained forever and indexed by version. PRNG selection scales
   to that snapshot's length.
3. **Versioning mechanism = one `traced` generator + a versioned manifest**
   (Approach A). The Wavy payload records a single optional integer
   `wf.tv`. Contract stays local to the Wavy feature.
4. **Save size needs no new work.** `saveGeometry` already routes through
   `writeWithOverflow` (compress-on-overflow), and `saveNewPuzzle` surfaces a
   clean "too large to save" failure without corrupting the prior save. Traced
   Wavy inherits this existing, shared behavior.

## Current state (recap)

- **Wavy** = the composable pipeline with `baseCutGenerator: 'sine'` +
  `tabGenerator: 'classic'`, hard-coded in `wavyStrategy.generatePieces`
  (`src/game/cut-style-strategies.ts:149-181`).
- **Traced tabs** = a lazy-loaded `TabGenerator` behind a registry stub
  (`src/puzzle/topology/traced-tab-loader.ts`,
  `generator-registry.ts:55`). The real chunk (generator + ~20 trace JSONs)
  loads via `preloadTracedTabGenerator()` (idempotent). The stub **throws if
  used before preload**.
- Traced tabs are currently reachable only through the dev/preview-only
  **Composable** style (`cf.tg = 'traced'`).
- **Wavy share-link block:** `wf?: { bl: boolean }` — does *not* record the tab
  generator (it is implicit in the code). Composable, by contrast, records
  `cf.tg` explicitly.
- **Share-link schema** is fixed at `v: 1`; variation is handled by
  field-presence detection, not version bumps.
- **Save format** is at `STATE_VERSION = 11`, with a typed `wavyConfig`
  (currently just `borderless`).
- **Reproducibility contract:** the exact number and order of `random()` calls
  during generation must not change for a given seed, or existing links/saves
  break. See `project_share_link_prng_contract` and the CLAUDE.md sub-PRNG
  rule.

## Core mechanism — versioned trace manifest (Approach A)

### 1. Frozen, versioned manifest

A manifest maps `traceSetVersion → ordered list of trace ids`:

- Today's ~20 traces become **version 1**: a frozen, ordered id list, never
  edited again.
- A future revision (add/remove/rework/reorder) becomes **version 2** with its
  own frozen list. All versions' trace data is retained forever.

Placement:

- The **full manifest** (version → ordered ids) lives in the **lazy** traced
  module, next to the generator that consumes it. The trace *data* stays lazy.
- A single lightweight `CURRENT_TRACE_SET_VERSION` integer lives in the **main
  chunk**, so the new-game path can stamp it into config without loading the
  heavy chunk.

### 2. The generator reads the version

The `traced` generator takes `traceSetVersion` in its `tabConfig`, resolves it
to that version's frozen ordered trace list, and scales its PRNG selection to
that list's length. Per the CLAUDE.md sub-PRNG rule, its per-edge randomness is
isolated in a local sub-stream so a future version can change selection logic
without disturbing the outer puzzle's seeded generation.

**Critical:** whatever the generator does for v1 becomes a **frozen contract**
the moment it ships in production Wavy. The implementation plan must pin down
v1's PRNG consumption and lock it with a golden test. (Today the generator is
dev-only via Composable, so its current behavior is not yet a public contract —
shipping it in Wavy makes it one.)

### 3. Wavy strategy picks the generator by config

`wavyStrategy.generatePieces` currently hard-codes `tabGenerator: 'classic'`.
New logic:

- `wavyConfig.traceSetVersion` present → `tabGenerator: 'traced'`,
  `tabConfig: { traceSetVersion }`.
- absent → `tabGenerator: 'classic'` (legacy reproduction).

New games stamp `CURRENT_TRACE_SET_VERSION` into the Wavy config.

`WavyConfig` (`src/game/wavy-config.ts`) gains an optional
`traceSetVersion?: number`.

## Encoding (the back-compat hinge)

### Share-link

- `wf` gains an optional `tv` (trace version). **Present → traced at that
  version; absent → classic.** Every existing wavy link has no `tv` → classic,
  untouched.
- Encode: `gameStateToPayload` writes `wf.tv` when the Wavy config carries a
  `traceSetVersion`.
- Decode: `wf.tv` present → Wavy config with that version (→ traced); absent →
  classic.
- DoS guard: validate `tv` is a positive integer; clamp out-of-range values
  (consistent with the existing grid/image/sine clamps).

### Save

- Serialized `wavyConfig` gains optional `traceSetVersion`. Treated like the
  existing additive optional fields (viewport, selection): absent → classic, no
  migration function required, **no `STATE_VERSION` bump**.
- It is stored so that after a reload-from-save the in-memory Wavy config is
  complete and a subsequent **Share** emits the correct `tv`. (Loading a save
  restores stored geometry directly — it does not re-run the generator — so the
  save path itself needs no chunk load.)

### Forward-compat edge case

A `tv` higher than this client knows (only v1 exists at launch): **clamp to the
highest known version with a diagnostic**, so the puzzle still plays. Minor
decision, flagged here; revisit if/when v2 ships.

## Async / lazy-load wiring

Generation is synchronous, but `traced` is lazy-loaded behind a stub that
throws if used before preload. Two generation entry points must
`await preloadTracedTabGenerator()` (idempotent) before generating:

1. **New-game create** when Wavy is the selected style. The dialog already
   exposes `onPreloadTracedTabs`; wire Wavy selection to trigger preload, and
   await it before the synchronous generate.
2. **Share-link load** (`tryLoadSharedPuzzle` in `main.ts`) when the decoded
   payload is wavy with `wf.tv` present.

**Save reload needs neither** — it loads stored geometry and does not invoke
the generator.

## Composable interaction

Composable is dev/preview-only and offers `traced` directly via `cf.tg`. Its
traced config defaults `traceSetVersion` to v1 when absent. No public
reproducibility promise is made for dev-only composable-traced links.

## Help text (info-modal)

Switching Wavy's tabs to hand-traced shapes is a visible change. Review the
**Cut Styles** entry for Wavy in `src/ui/info-modal.ts` and update it only if
the current wording becomes wrong or misleading (per the repo's
"keep the help text correct, not exhaustive" convention). Do not add copy for
behavior a player would already expect.

## Testing

- **Regression linchpin:** a golden test proving an existing wavy link (no
  `tv`) produces byte-identical geometry to current `main`. Capture the golden
  from `main` before changing the strategy.
- Traced Wavy v1 reproducibility: same seed + `tv: 1` → identical pieces across
  runs (golden).
- Manifest: version 1 resolves to the frozen ordered id list; generator scales
  selection to its length.
- Share-link round-trip: `tv` preserved on encode/decode; absent → classic; DoS
  clamp on out-of-range `tv`.
- Save round-trip: `traceSetVersion` persisted and restored, so a re-share
  after reload emits `tv`.
- Wavy strategy unit: selects `traced` when `traceSetVersion` is set, `classic`
  when absent.
- Manual (per the `verify`/`run` flow): create a Wavy game and confirm traced
  tabs render well on sine edges; reload; share; open the link in a fresh
  session; open a pre-existing wavy link and confirm classic tabs.

## Anticipated files

- `src/game/cut-style-strategies.ts` — Wavy strategy picks tab generator by
  config.
- `src/game/wavy-config.ts` — add `traceSetVersion?`.
- `src/sharing/share-link.ts` — encode/decode `wf.tv` + DoS guard.
- `src/persistence/serialization.ts` — persist/read `traceSetVersion` in the
  Wavy config.
- Traced generator + loader (`src/puzzle/topology/traced-tab-generator.ts`,
  `traced-tab-loader.ts`) — version → trace-set manifest; generator reads
  `traceSetVersion`; per-version sub-PRNG isolation; `CURRENT_TRACE_SET_VERSION`
  constant exposed to the main chunk.
- New-game dialog/flow + `src/main.ts` — preload/await the traced chunk for
  Wavy create and wavy-with-`tv` share-link load; stamp
  `CURRENT_TRACE_SET_VERSION` into new Wavy config.
- `src/ui/info-modal.ts` — review/update the Wavy Cut Styles copy.
- Tests alongside each touched module.

## Reproducibility risk callouts

- The classic-wavy golden regression test is the linchpin: prove old links are
  unchanged.
- The traced generator must isolate its per-edge randomness in a sub-PRNG keyed
  off one outer draw, and its v1 PRNG consumption must be frozen at ship time.
- Do not retrofit the sub-PRNG pattern onto the existing classic/sine
  generators — their current outer-call counts are the contract.
