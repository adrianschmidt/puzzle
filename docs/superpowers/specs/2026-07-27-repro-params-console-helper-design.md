# Repro params: include image dimensions, add a console helper to replay them

**Date:** 2026-07-27
**Status:** Approved (design)

## Summary

Two changes that close the loop on the info modal's "Reproduction
parameters" block:

1. **The block gains `imageSize` and `imageUrl`.** Geometry inscribes to
   the image, so the same seed/grid/style produces different puzzles at
   different image dimensions (demonstrated by the fused-piece
   investigation: seed 1534700170 at 12×16 fuses a 2×2 block at
   1080×1440 and is fine at three other sizes). A repro block without
   `imageSize` under-specifies the puzzle. `imageUrl` makes the repro
   visually exact. Most state image URLs are short and portable —
   Unsplash https URLs or bundled asset paths — but a blank-canvas
   puzzle stores the painted canvas itself as a multi-KB base64 `data:`
   PNG (`canvas.toDataURL` at `main.ts:1036` and `main.ts:1500`; those
   two are the only `data:`/`blob:` image URLs the app produces). So the
   builder collapses any `data:` URL to the `'blank'` sentinel the share
   codec already understands, keeping the printed block
   screenshot-sized; the load path repaints an identical canvas from
   `imageSize`, so the replay stays exact.
2. **A dev-console helper `__reproPuzzle(params)`** that accepts the
   block's exact JSON and regenerates that puzzle, the way
   `__newComposableGame` covers freeform composable experiments (that
   helper is unchanged — different purpose).

## Design

### `src/sharing/repro-params.ts` (new)

The modal and the helper must agree on the JSON shape, so it becomes a
shared, tested contract in one module. Placed in `sharing/` because its
second half maps onto `SharePayload`.

- `export interface ReproParams` — `seed?`, `cutStyle?`, `imageUrl?`,
  `imageSize?`, `gridSize?`, `rotationMode?`, and the five per-style
  config blocks, mirroring today's `buildReproParams` output plus the
  two new fields. All fields optional at the type level (the object is
  also hand-typed into consoles from screenshots); the payload
  converter is where hard requirements live.
- `export function buildReproParams(state: GameState): ReproParams` —
  moved from `info-modal.ts:68`, gaining `imageSize` and `imageUrl`,
  each guarded like the fields around it (a legacy or hand-built state
  can lack them despite the type). A `data:` `imageUrl` collapses to
  `'blank'` per the summary above. Field order: seed, cutStyle,
  imageUrl, imageSize, gridSize, rotationMode, then config blocks —
  reads top-down from "what puzzle" to "how cut".
- `export function reproParamsToPayload(params: ReproParams): SharePayload`
  — throws a descriptive `Error` when `seed`, `cutStyle`, `imageSize`,
  or `gridSize` is missing (e.g. a params object copied from an old
  screenshot that predates this change), or when `cutStyle`/`rotationMode`
  is not one of the wire-format literals (a typo would otherwise surface
  as the decoder's unattributed `null`); otherwise maps:
  `i: imageUrl ?? 'blank'`, `is: [width, height]`, `g: [cols, rows]`,
  `c`, `s`, `r: rotationMode ?? 'none'`, and the style blocks
  (`composableConfig → cf` via the same field mapping
  `gameStateToPayload` uses, `fractalConfig → ff`, `wavyConfig → wf`,
  `trianglesConfig → tf`, `classicConfig → clf`). Absence semantics
  are preserved exactly — no `classicConfig` means no `clf`, which is
  what selects the legacy Classic generator, matching the on-screen
  puzzle the block described.

`buildReproParams`'s existing doc comment (including the load-bearing
note on `classicConfig` presence) moves with it.

### `src/main.ts` — the helper

```ts
(window as any).__reproPuzzle = (params: ReproParams) => { ... };
```

Wiring, with every reusable part pushed into a tested module because
`main.ts` has no tests; what stays here is the glue that closes over
`app`/`renderer`/`gameState` and so cannot leave:

1. `reproParamsToPayload(params)` — shape errors surface as a clear
   console error (`console.error` + return), not a half-started game.
2. `decodePayload(encodePayload(payload))` — reuses every existing
   validation and clamp (grid dims, image dims, sine config, trace-set
   versions) for free. A `null` decode is reported (echoing the payload,
   since the decoder cannot say which field failed) and aborts.
3. `clearSavedState()` then `loadSharedPuzzle(decoded, hadSavedState)` —
   the same application path a share link takes, minus the confirm dialog
   (a dev deliberately replacing their game) and the hash/URL churn: a
   `#p=` link in the address bar is left in place, exactly as declining
   that dialog does, so the original link stays reloadable. It re-offers
   itself on the next reload; declining keeps the replay, which is
   persisted. A generation failure is logged via `runWithErrorReport`'s
   `logInProduction` option, since its default diagnostic is DEV-gated
   and that failure is the reason the helper exists.

Doc comment mirrors `__newComposableGame`'s, with a usage example
showing "paste the info modal's repro block".

### Info modal

- Import `buildReproParams` from the new module; local copy deleted.
- The repro block's description gains one sentence: "Paste into
  `__reproPuzzle(...)` in the browser console to regenerate it." —
  debug-panel copy, consistent with the keep-help-short rule.

## Testing

`src/sharing/repro-params.test.ts`:

1. `buildReproParams` — includes `imageUrl` and `imageSize`; per-style
   config blocks present/absent per state, `classicConfig` passed
   through when set.
2. `reproParamsToPayload` — one case per cut style asserting the mapped
   payload; legacy Classic (no `classicConfig`) maps to no `clf`;
   `rotationMode` defaulting; `imageUrl` absent → `i: 'blank'`.
3. Missing `imageSize` / `seed` / `cutStyle` / `gridSize` → throws with
   a message naming the field.
4. Round-trip: `reproParamsToPayload(buildReproParams(state))` survives
   `decodePayload(encodePayload(...))` for a representative state —
   pins that the helper's validation path accepts everything the modal
   emits.

Existing info-modal tests updated only if they assert the exact block
contents (two added fields).

## Non-changes

- **`__newComposableGame`** stays as-is.
- **Share links, saves:** untouched. The payload produced by the helper
  is never written to a URL.
- **Analytics:** no new events. The helper reuses the share path's
  `loadSharedPuzzle` and therefore its `shared-load-failed` reporting,
  so that event gains a `source: 'shared' | 'repro'` discriminator —
  matching `share-failed` and `unhandled-error`. Without it a developer
  replaying a puzzle that is *expected* to trip the generator would
  pollute the metric that watches for real share-format regressions.
- **Info modal help text** beyond the one description sentence: none —
  no player-visible behavior changes.
