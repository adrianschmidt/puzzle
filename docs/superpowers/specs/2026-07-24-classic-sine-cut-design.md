# Classic cut style: sine-based cut with traced tabs

**Date:** 2026-07-24
**Status:** Approved (design)

## Summary

Upgrade the **Classic** cut style from the straight-grid `generateProceduralPuzzle`
to the composable sine-based pipeline that Wavy/Triangles already use — a gentle
version of Wavy. New Classic puzzles get:

- **Base cut:** `sine`, `ha = va = 0.11`, `hf = cols / 3`, `vf = rows / 3`
  (Wavy uses `0.5`, `cols / 2`, `rows / 2`).
- **Tabs:** `traced` at the current trace-set version (same as production Wavy).
- **Rotation:** `free` (was `quarter-turn`).
- **Borderless:** always `false`; no new-game dialog option is added.

**Every existing Classic share link must continue to reproduce with the old
`generateProceduralPuzzle`.** This is the hard constraint.

## Background

Two facts from the codebase drive the design:

1. **Share-link reproduction contract.** A `#p=…` link stores only the seed,
   grid, cut style, and per-style config; the receiver re-runs the generator.
   Changing the generator for `c: 'classic'` would silently break every Classic
   link in the wild. (See `project_share_link_prng_contract`.)

2. **Saves store geometry verbatim.** `SerializedStaticState.pieces` holds the
   full pieces array, so loading an old Classic save renders exactly what was
   saved regardless of generator changes. The *only* code path that re-runs a
   generator for an existing puzzle is the share-link decode path (and the
   re-encode of a loaded save, which emits `c: 'classic'` again).

The existing per-style versioning precedents are the template:

- **Wavy** carries `wf: { bl, tv? }`. `tv` present ⇒ traced tabs; absent ⇒
  classic tabs (a legacy pre-versioning link).
- **Triangles** carries `tf: { tv }`. `tv` pins the traced-tab library snapshot.

## Design

### Discriminator: a `clf` block on the share payload

Add `clf?: { tv: number }` to `SharePayload`, mirroring Triangles' `tf`:

- **`clf` present** → new pipeline; `tv` pins the trace-set version.
- **`clf` absent** (every link created before this change) → today's
  `generateProceduralPuzzle`, byte-for-byte unchanged.

The sine parameters (`0.11`, `cols/3`, `rows/3`) are **hard-coded in the
strategy**, exactly as Wavy hard-codes its `0.5`/`cols/2`/`rows/2`. They are
**not** written to the wire, so — like Wavy — Classic links carry no
attacker-controllable `bgc` sine config and need no `MAX_SINE_*` clamp. Only
`composable` links expose raw sine config.

Semantics note (documented in code): for Triangles, a missing/invalid `tv`
falls back to the current trace set but still uses the composable pipeline. For
Classic, a missing/invalid `clf` falls back to the **old generator**. That
asymmetry is the whole point of the discriminator and must be commented.

### Config shape

Model the Classic config identically to Triangles:

```ts
classicConfig?: { traceSetVersion?: number }
```

`traceSetVersion !== undefined` is the signal to use the new pipeline. It threads
through the same plumbing as the other per-style configs:

- `InitOptions.classicConfig` (init.ts)
- `StrategyContext.classicConfig` (cut-style-strategies.ts)
- `GameState.classicConfig` (model/types.ts)
- `configKey: 'classicConfig'` on `classicStrategy`

### `classicStrategy.generatePieces`

Branch on the config. When `classicConfig?.traceSetVersion` is set, use the
composable pipeline (gentle-Wavy config); otherwise fall back to the old
generator so a `clf`-less decoded payload reproduces the legacy puzzle.

```ts
generatePieces: (grid, puzzleSize, seed, ctx) => {
    const traceSetVersion = ctx.classicConfig?.traceSetVersion;
    if (traceSetVersion === undefined) {
        // Legacy Classic: pre-upgrade links/saves. Unchanged contract.
        return { pieces: generateProceduralPuzzle(grid.cols, grid.rows, puzzleSize, seed) };
    }
    const avgPieceArea =
        (puzzleSize.width * puzzleSize.height) / (grid.cols * grid.rows);
    return generateComposablePuzzle(grid.cols, grid.rows, puzzleSize, seed, {
        baseCutGenerator: 'sine',
        baseCutConfig: {
            cols: grid.cols,
            rows: grid.rows,
            ha: 0.11,
            hf: grid.cols / 3,
            va: 0.11,
            vf: grid.rows / 3,
        },
        tabGenerator: 'traced',
        tabConfig: { traceSetVersion },
        minPieceArea: avgPieceArea / 4,
        borderless: false,
        tabDebug: ctx.tabDebug,
    });
},
configKey: 'classicConfig',
```

`scaleGrid` and `inscribePuzzleSize` stay pass-through.

### Touch points

| File | Change |
|------|--------|
| `game/cut-styles.ts` | classic `rotation: 'quarter-turn'` → `'free'`. Description `'Traditional jigsaw tabs'` → `'Traditional jigsaw pieces'`. |
| `game/cut-style-strategies.ts` | `classicStrategy` rewrite above; `StrategyContext.classicConfig`; `configKey` union adds `'classicConfig'`. |
| `game/init.ts` | `InitOptions.classicConfig`; thread into `ctx`; set on returned `GameState` via `configKey`. |
| `model/types.ts` | `GameState.classicConfig?: { traceSetVersion?: number }`. |
| `main.ts` (`startNewGame`) | Stamp `classicConfig: { traceSetVersion: CURRENT_TRACE_SET_VERSION }` for new Classic; add `classic` to the traced-tab preload condition. |
| `main.ts` (`loadSharedPuzzle`) | Pass `classicConfig: payload.clf ? { traceSetVersion: payload.clf.tv } : undefined`; preload traced chunk when `payload.c === 'classic' && payload.clf`; stamp analytics `traceSetVersion` for Classic (fresh + shared), mirroring Wavy/Triangles. |
| `sharing/share-link.ts` | Add `clf?: { tv: number }` to `SharePayload`; encode in `gameStateToPayload` when `state.classicConfig?.traceSetVersion !== undefined`; finite check in `assertPayloadNumbersFinite`; clamp `tv` via `clampTraceSetVersion` on decode, dropping `clf` when invalid (→ old generator). No `isValidPayload` branch: `ff`/`wf`/`tf` have none either, and the clamp-or-drop above is what sanitizes every malformed `clf` shape. Adding one is a separate sweep across all four blocks. |
| `persistence/serialization.ts` | Add `classicConfig` to `SerializedGameState` + `SerializedStaticState`; write in `serializeState`/`serializeStatic`; read in `deserializeState`/`recombine`. **No `STATE_VERSION` bump** — additive optional field, following the `selection`/`viewport` precedent; old builds ignore it and load `pieces` verbatim. |
| `ui/info-modal.ts` | Rotation copy: move Classic from the "90° rotation (Classic and Fractal)" clause to "Free rotation (Classic, Wavy and Triangles)"; Fractal stays 90°. Credits ("Classic jigsaw cuts — Dillo") unchanged — that algorithm still ships for legacy links and as the `'classic'` tab generator. |

### Why no `STATE_VERSION` bump

`classicConfig` affects *reproduction*, but saves store `pieces` directly and
never re-generate on load, so an old build reading a new save renders correctly
(it just ignores the field). Bumping the version would make older builds reject
the whole save during a deploy overlap — strictly worse. This matches how the
`selection` and `viewport` optional fields were added.

Cross-version re-share hazard: an old build that loads a new Classic save and
re-shares it emits `c: 'classic'` with no `clf`, so its recipient uses the old
generator and sees different pieces than the sharer. This is the same transient,
deploy-window hazard that already exists for Wavy/Triangles version fields and is
accepted.

The direct direction has the same shape: a `clf`-bearing link opened on a stale
cached build (a deploy window, or a PWA still serving the previous bundle)
decodes fine — `isValidPayload` ignores unknown keys — so the old build silently
drops `clf` and renders the legacy cut. Because the payload *decodes*,
`rescueUndecodableLink` never fires and there is nothing to surface to the
recipient. Also transient and also accepted: the alternative, bumping the payload
version, would make every old build reject the whole link instead of rendering a
slightly different Classic cut — strictly worse for the same window.

## Testing (TDD)

- `game/cut-styles.test.ts`: `rotationModeForNewGame('classic', true)` now
  `'free'`; move the assertion out of the "quarter-turn for classic and fractal"
  case (Fractal stays quarter-turn).
- `classicStrategy` (new tests): with `classicConfig.traceSetVersion` set,
  generates via the composable sine pipeline with `ha/va = 0.11`, `hf = cols/3`,
  `vf = rows/3`, `tabGenerator: 'traced'`; with it unset, delegates to
  `generateProceduralPuzzle`.
- `sharing/share-link.test.ts`: new Classic game round-trips `clf`; decode clamps
  a too-new `tv` down to `CURRENT_TRACE_SET_VERSION`; an invalid `tv` drops `clf`;
  a `clf`-less `c: 'classic'` payload decodes to no `classicConfig`.
- Reproduction guard: a fixed `clf`-less Classic payload still yields the old
  generator's pieces (snapshot / piece-count / PRNG-stable check), proving old
  links are untouched.
- `persistence/serialization.test.ts`: `classicConfig` survives
  serialize→deserialize and static/progress recombine.

## Out of scope

- Borderless toggle for Classic (explicitly declined).
- Retrofitting old Classic saves onto the new generator (they keep their stored
  geometry by design).
- Any change to the Wavy/Triangles/composable configs.

## Open items for review

- Exact wording of the info-modal rotation clause (mechanical move of "Classic").
