# Compiler/test-force the hand-maintained cut-style touch points

Closes #492.

## Problem

Adding a cut style touches six places; only two are compiler-forced:

| # | touch point | status |
|---|---|---|
| 1 | `CUT_STYLE_OPTIONS` (`cut-styles.ts`) | ✅ forced (`readonly CutStyleOption[]`) |
| 2 | `STRATEGIES` record (`cut-style-strategies.ts`) | ✅ forced (`Record<CutStyle, …>`) |
| 3 | `configKey` on the strategy | ❌ `configKey?` is optional → silently omittable |
| 4 | `traceSetVersionOf` (`app/trace-set-version.ts`) | ❌ nested ternary on `cutStyle` |
| 5 | wire keys in `share-link.ts` (encode / validate / clamp) | ❌ bespoke per-style branches |
| 6 | share-path preload predicate `needsTracedTabChunk` (`app/share-payload-to-init.ts`) | ❌ per-style predicate |

The remaining four are restated by hand, and #486's review caught three real misses of exactly this kind. Worth closing before the next cut style lands, since that is when the hand-maintained list bites.

Scope for this change is **Focused**: force #3–#6 where cheap, leave the security/reproducibility-critical share codec internals and `generator-configs.ts` structurally intact.

## Design

### 1. `configKey` becomes required (#3)

In `game/cut-style-strategies.ts`:

- Extract the key union as a named type:
  ```ts
  export type StyleConfigKey =
      | 'fractalConfig' | 'composableConfig' | 'wavyConfig'
      | 'trianglesConfig' | 'classicConfig';
  ```
- Change `configKey?: …` → `configKey: StyleConfigKey` on `CutStyleStrategy`. Every existing strategy already sets it, so no strategy body changes; a *new* strategy now fails to compile without it.
- Add a guarded lookup beside `STRATEGIES` (raw indexing lies about `undefined` because `noUncheckedIndexedAccess` is off, so use the same `hasOwnProperty` membership pattern `isCutStyle` uses):
  ```ts
  export function configKeyForCutStyle(
      cutStyle: string | undefined,
  ): StyleConfigKey | undefined;
  ```

Consumer cleanup:

- `app/piece-count-mismatch-payload.test.ts` iterates strategies and branches on `configKey === undefined`; that branch is now unreachable and is removed.

`init.ts`'s five `configKey === 'xConfig' ? …` reads still compile unchanged — left as-is (not one of the six points).

### 2. `traceSetVersionOf` derives from `configKey` (#4)

Replace the nested `cutStyle` ternary in `app/trace-set-version.ts` with a derivation:

```ts
export function traceSetVersionOf(state: GameState): number | undefined {
    const key = configKeyForCutStyle(state.cutStyle);
    const config = key && state[key];
    return config && 'traceSetVersion' in config ? config.traceSetVersion : undefined;
}
```

- `'traceSetVersion' in config` narrows the config union cleanly — fractal/composable configs lack the field, so they yield `undefined`.
- The cutStyle→configKey gate preserves the existing guarantee (a stray foreign config block on a crafted/hand-edited state can't mis-attribute a version to a style that didn't generate with one) — now automatic.
- A future traced style is picked up here with **zero edits**.

Callers (`new-game-payload.ts`, `completed-payload.ts`, `save-coordinator.ts`) are unaffected — they just call it.

### 3. Compile-forced wire-key round-trip test (#5)

The bespoke per-style encode/validate/clamp logic in `share-link.ts` stays (fully unifying it is out of scope and the issue flags it as "resist unification by design"). Instead, make an omission fail fast:

- Generalize the existing 2-style `it.each` (`['wavy', …], ['fractal', …]`) in `sharing/share-link.test.ts` into an exhaustive fixture keyed by the wire style union:
  ```ts
  const STYLE_WIRE: Record<SharePayload['c'], { wireKey: keyof SharePayload; state: Partial<GameState> }> = { … };
  ```
- Because it is a **total** `Record<SharePayload['c'], …>`, adding a style to the wire union won't compile until a row is added (wire key + a minimal sample state). The round-trip assertion (`payload[wireKey]` present; `decode(encode(payload))` deep-equals) then stays red until `encode`/`decode` actually handle it.

### 4. Compile-forced preload-predicate test (#6)

- Mirror the pattern in `app/share-payload-to-init.test.ts` with an exhaustive `Record<SharePayload['c'], { … expectedNeedsChunk }>` fixture asserting `needsTracedTabChunk` per style, so a new style forces a coverage row here too.

`needsTracedTabChunk` itself stays payload-data-driven (legacy Classic/Wavy without a `tv` block need no chunk despite the style declaring `'always'`), so it is not replaced — only guarded.

## Deliberate divergence from the issue text

The issue floats a production `Record<CutStyle, wireKey>`. Not adding one: nothing in the bespoke codec can consume a bare key name, so it would be dead ceremony with ongoing upkeep cost. The exhaustive **test** fixture is the same compiler tripwire without the dead production code.

## Out of scope (Focused)

- Codec internals (`applyStyleConfigs` / `assertPayloadNumbersFinite` / `decodePayload` / `isValidPayload`) — unchanged.
- `generator-configs.ts` per-style branches — unchanged (already consolidated into one function; folding onto strategies was the "Consolidate" scope, declined).
- `init.ts` config-block writing — unchanged.

## Testing

- `traceSetVersionOf`: existing `trace-set-version.test.ts` coverage kept; verify each current style reads the right block and a stray foreign block is ignored.
- Wire round-trip: exhaustive fixture in `share-link.test.ts`.
- Preload predicate: exhaustive fixture in `share-payload-to-init.test.ts`.
- `piece-count-mismatch-payload.test.ts`: simplified after `configKey` is required.
- Full `npm test` + typecheck + lint green; verify CI, not just local.

## Files touched

- `src/game/cut-style-strategies.ts` — `StyleConfigKey`, required `configKey`, `configKeyForCutStyle`.
- `src/app/trace-set-version.ts` — derivation.
- `src/sharing/share-link.test.ts` — exhaustive wire round-trip fixture.
- `src/app/share-payload-to-init.test.ts` — exhaustive preload fixture.
- `src/app/piece-count-mismatch-payload.test.ts` — drop dead `configKey === undefined` branch.
