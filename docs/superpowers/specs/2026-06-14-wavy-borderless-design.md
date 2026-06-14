# Wavy borderless mode — design

Follow-up to [#415](https://github.com/adrianschmidt/puzzle/pull/415) (which added
borderless to Composable and Fractal and deliberately scoped Wavy out).

## Problem

The Wavy cut style has no borderless option. Wavy already generates through
`generateComposablePuzzle` with the **sine** base cut generator — which supports
borderless (oversize grid → strip outer ring, built in #415) — so the *generation*
is free. The missing work is the player-facing wiring: a toggle, persistence, a
share-link field, and help text. Wavy ships in the **production** build (unlike
dev-only Composable), so its help text must be updated.

## Key constraint

Wavy currently has **no config** — its strategy omits `configKey` ("fully
reproducible from seed + gridSize"). Adding borderless requires giving Wavy a
place to persist/round-trip the flag. Per the resolved decision (Option A): add a
dedicated minimal `wavyConfig: { borderless }`, mirroring Fractal's single-field
`fractalConfig` exactly. This keeps a clean 1:1 `cutStyle → configKey` mapping and
avoids Wavy and Composable configs bleeding together.

## Approach

### Generation (free)

`wavyStrategy.generatePieces` adds `borderless: ctx.wavyConfig?.borderless ?? false`
to the inline sine `ComposableConfig` it already builds. The sine generator
oversizes and `stripBorderRing` runs automatically (both from #415). No generator
change.

### New config field + strategy

- `GameState.wavyConfig?: { borderless?: boolean }` (inlined in `model/types.ts`,
  mirroring `fractalConfig`).
- `StrategyContext.wavyConfig?` and `InitOptions.wavyConfig?`; `init.ts` threads it
  into the context and writes it back via `configKey: 'wavyConfig'`.
- `CutStyleStrategy.configKey` type widens to include `'wavyConfig'`.
- `wavyStrategy` gains `configKey: 'wavyConfig'`.

### Persistence (preference)

New `src/game/wavy-config.ts` mirroring `fractal-config.ts`:
`WavyConfigPreference { borderless: boolean }`, `loadWavyConfigPreference` /
`saveWavyConfigPreference`, localStorage key `puzzle-wavy-config`.

### Serialization

Add `wavyConfig?: GameState['wavyConfig']` to `SerializedGameState` and
`SerializedStaticState`; write it in `serializeState`/`serializeStatic`; read it in
`deserializeState`/`recombine`. No legacy migration needed (Wavy never had a
config), so a simple `if (data.wavyConfig) state.wavyConfig = data.wavyConfig`
inline read — no resolver. No `STATE_VERSION` bump (additive optional field, like
the existing configs).

### Share-link

Add `wf?: { bl: boolean }` to `SharePayload`, parallel to fractal's `ff: { bl }`.
Encode in `gameStateToPayload` (`if (cutStyle === 'wavy' && state.wavyConfig)
payload.wf = { bl: state.wavyConfig.borderless ?? false }`). Decode in `main.ts`
(`wavyConfig: payload.wf ? { borderless: payload.wf.bl } : undefined`). Mirrors
fractal exactly, including that `ff`/`wf` are not validated in `isValidPayload`
(the decode read is crash-safe; the sine generator only acts on `borderless ===
true`). The cut-style enum already includes `'wavy'`.

### New-game dialog

- `WavyDialogConfig { borderless: boolean }` + `WavySection` interface (mirroring
  `FractalDialogConfig` / `FractalSection`).
- `buildWavyOptionsSection` — a `Borderless` checkbox (testid
  `wavy-borderless-toggle`), mirroring `buildFractalOptionsSection`.
- `NewGameSelection.wavyConfig?`, `NewGameDialogOptions.savedWavyConfig?`.
- Visibility: show the wavy section iff `currentCutStyleId === 'wavy'` (alongside the
  existing fractal/composable section toggles); include `wavyConfig` in the
  selection when wavy is chosen.

### main.ts wiring

- Load `savedWavyConfig` and pass to the dialog; save it in `onSelect` when present.
- Thread `wavyConfig` through `startNewGame` (new param, mirroring `fractalConfig`)
  → `createNewGame` options. Update all `startNewGame` call sites.
- Decode `payload.wf` into `wavyConfig` on the share path.
- Pass `preferredWavyConfig` on the startup/auto-start path.

### Help text

Add a **Borderless** sub-bullet to the **Wavy** item in the info-modal Cut Styles
section (`info-modal.ts`), alongside the existing Free-rotation sub-bullet.

## Reproducibility

`borderless` defaults `false`. With it false/absent, `wavyStrategy` builds the
exact same sine config as today → the sine generator's `extra = 0` → identical
grid, cut count, and PRNG draw sequence → every existing bordered Wavy save and
share-link replays byte-for-byte. `borderless: true` defines a new deterministic
stream (oversize + strip, both gated on the flag and drawing no extra outer
randomness beyond the sine grid the generator already owns). The strip draws no
randomness.

## Scope

- Wavy only. Composable/Fractal borderless already shipped in #415.
- No generator changes (sine + strip already support borderless).
- No `startNewGame` refactor beyond adding the `wavyConfig` param (its positional
  signature is pre-existing; mirror the `fractalConfig` param rather than
  restructure).

## Testing

- `wavy-config.ts`: preference load/save round-trip + default-false parse (mirror
  `fractal-config.test.ts`).
- `cut-style-strategies` / `init`: a wavy game with `wavyConfig.borderless: true`
  writes `wavyConfig` back onto state and produces the requested piece count
  (oversize+strip nets to `cols×rows`); without it, `wavyConfig` is undefined and
  generation is unchanged (the existing "wavy → no config" test still holds, just
  extended to assert `wavyConfig` undefined).
- Serialization: `wavyConfig.borderless` round-trips (mirror the composable test).
- Share-link: `wf` round-trips; encode emits `wf` for wavy with a config; decode
  maps `wf.bl → borderless` (mirror the fractal/composable `bl` tests).
- Dialog: the Borderless checkbox renders when wavy is selected and feeds
  `wavyConfig.borderless` into the selection; hidden for non-wavy styles.
- Info-modal: the Wavy bullet mentions borderless.
