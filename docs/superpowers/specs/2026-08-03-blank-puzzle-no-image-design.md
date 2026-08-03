# Blank puzzles: model "no image", paint pieces white in SVG

Date: 2026-08-03
Issues: [#503](https://github.com/adrianschmidt/puzzle/issues/503) (primary),
[#496](https://github.com/adrianschmidt/puzzle/issues/496) (subsumed)

## Problem

A blank puzzle has no photo, but the whole pipeline is built around one:
generation needs an image size, and the renderer paints each piece as an
`<image>` clipped by the piece shape. So the app fabricates an image —
`createBlankImageDataUrl` (`src/app/blank-canvas.ts`) allocates a `<canvas>`,
fills it `#ffffff`, and returns `canvas.toDataURL('image/png')`.

Two consequences:

1. **It is the only `<canvas>` in the app.** The renderer is SVG+DOM by
   deliberate choice; canvas appears nowhere else. It is used as an image
   *factory*, not as a renderer.
2. **The fabricated PNG is persisted and shared.** `imageUrl` is serialized as
   a plain string, so a blank puzzle writes a base64 white PNG into
   localStorage, and `gameStateToPayload` copies it onto the wire verbatim —
   a multi-KB share link for a puzzle whose image content is one colour.

Separately (#496), `GameState` records *what* image a puzzle uses but not
*what kind*, so two consumers recover "is this blank?" by sniffing a `data:`
prefix: `classifyImageSource` and `collapseBlankImageUrl`. Fixing #503
requires modelling blankness in `GameState`, which is #496's entire ask — so
both close together.

## Approach

Model blank as **dimensions, no image**: `GameState.imageUrl` becomes
`string | null`, and the renderer paints a flat white `<path>` instead of an
`<image>` when it is `null`. Nothing is synthesized, nothing is stored, and
the app's last canvas dependency goes away.

Alternatives considered and rejected:

- **A discriminated union** (`image: { kind: 'url'; url } | { kind: 'blank' }`)
  — most explicit at the type level, but the heaviest churn and more verbose at
  every read site, for no additional safety over `| null`.
- **`imageUrl: string` plus an `isBlank?: boolean` flag** — least churn, but
  two fields encoding one fact can disagree, and `imageUrl` would have to hold
  something meaningless. Rejected: it reintroduces the modelling defect #496
  is about.

## Invariants this must not break

- **The seeded generation call sequence.** Share links and saves replay a
  puzzle by re-running the PRNG from its seed. `imageUrl` never reaches
  `buildGenerationRequest(gridSize, imageSize, seed, options)`
  (`src/game/init.ts:103`) — only `imageSize` does, and it is unchanged. The
  contract is safe by construction, not by care.
- **Rendering parity.** Blank pieces must look identical: same clip path, same
  outline filter, same piece-outline colour modes, same selection glow, same
  debug overlays.
- **Old saves and old links keep working.** Both carry a white-PNG `imageUrl`,
  so the `data:` interpretation survives inside migration paths — the same
  conclusion #496 reached.

## Design

### 1. State

```ts
// src/model/types.ts
/**
 * URL of the puzzle image, or `null` for a blank puzzle — one with no photo,
 * whose pieces the renderer paints flat white.
 */
imageUrl: string | null;
```

`imageSize` stays required and unchanged. `createNewGame` /
`createNewGameAsync` / `assembleGameState` widen their `imageUrl` parameter to
`string | null` and otherwise only store it.

### 2. Renderer

`SvgDomRenderer.createPieceSvg` branches at the point where the `<image>` is
built, appending the fill in the same child position so z-order is unchanged:

```ts
if (imageUrl === null) {
    const fill = document.createElementNS(svgNS, 'path');
    fill.setAttribute('d', piece.shape);
    fill.setAttribute('fill', BLANK_PIECE_FILL);   // '#ffffff'
    fill.setAttribute('fill-rule', 'evenodd');
    fill.setAttribute('pointer-events', 'none');
    fill.dataset.pieceBlank = 'true';
    svg.appendChild(fill);
} else {
    // <image> exactly as today
}
```

Filling the shape path *is* the clipped result — a uniform white raster
clipped to the shape and the shape filled white are the same silhouette, so
`preserveAspectRatio="xMidYMid slice"` and the per-piece `imageOffset` have
nothing to reproduce. The clip path, hit area, mateless-edge overlay and debug
overlay are unchanged; the outline filter, selection glow and
`--piece-outline-color` all apply to the group `<div>`, outside this element.

`BLANK_PIECE_FILL` is a hardcoded `#ffffff`, matching what the fabricated PNG
painted. Not a CSS custom property: a second visual mode for blank puzzles is
the issue's own trigger for *future* work, and inventing the seam now buys
nothing.

`currentImageUrl` (the new-game cache-invalidation fingerprint) widens to
`string | null`; its `''` initial value stays distinct from `null`. Two
consecutive blank puzzles compare equal and fall through to the piece-count and
shape fingerprint — exactly as they do today, where the same size produces a
byte-identical data URL.

### 3. CSS

Two selectors currently reach the `<image>` and must reach the blank fill too,
or blank puzzles silently lose both debug controls:

- `src/style.css:370` — `[data-piece-id] image { opacity: var(--piece-opacity) }`
- `src/style.css:390` — `.show-debug-pieces [data-piece-id] image { display: none }`

Both gain `, [data-piece-blank]`.

### 4. Producers

| Site | Change |
| --- | --- |
| `app/start-new-game.ts:236` | `imageUrl = null` instead of `createBlankImageDataUrl(blankSize)`; `blankSizeForOrientation` still supplies `imageSize` |
| `app/load-shared-puzzle.ts:132` | `payload.i === 'blank' \|\| payload.i.startsWith('data:')` → `null`. The `data:` arm is the legacy-link migration. |
| `sharing/share-link.ts:746` | `i: state.imageUrl ?? 'blank'` |
| `sharing/repro-params.ts:47` | `if (state.imageUrl) params.imageUrl = state.imageUrl` — `null` is falsy, so it already lands on `reproParamsToPayload`'s `params.imageUrl ?? 'blank'`; the call just drops the helper |
| `app/classify-image-source.ts:18` | `if (imageUrl === null) return 'blank'`, replacing the `data:` sniff (#496) |

`gameStateToPayload` emitting `'blank'` converges the two producers.
`collapseBlankImageUrl`'s own doc comment names that as "a separate,
deliberate change"; this is that change. The decoder has always accepted both
forms, so no existing link breaks, and a blank puzzle's share link drops from
multi-KB to five characters.

**Deleted:** `src/app/blank-canvas.ts` and its test; `collapseBlankImageUrl`
and its tests. That removes the last `getContext` call in the app.

### 5. Persistence — `STATE_VERSION` 13

`SerializedGameState.imageUrl` and `SerializedStaticState.imageUrl` become
optional. **Absent means blank.** `serializeState` and `serializeStatic` omit
the key when `state.imageUrl === null`.

- **Validation** (`serialization.ts:554`, `:852`): `imageUrl` must be a
  non-empty string on v≤12, and may be absent on v13+. Version-scoping keeps
  corrupt-old-save detection rather than widening it away.
- **Migration:**

  ```ts
  const imageUrl =
      data.imageUrl === undefined || data.imageUrl.startsWith('data:')
          ? null
          : data.imageUrl;
  ```

  This is the `data:` interpretation the issue predicts will survive forever —
  it now lives here and nowhere else. Unconditional rather than version-scoped,
  since v13+ never writes a `data:` URL and a second branch would be inert.
- `deriveImageSize`'s synthetic temp state uses `imageUrl: null` (inert
  padding either way).

The version bump is what protects an older deployed build from reading a v13
save: `SUPPORTED_VERSIONS` rejects it cleanly instead of restoring
`imageUrl: undefined` and rendering a broken `<image>`.

### 6. CSP tightening

`index.html:30` is `img-src 'self' data: https://*.unsplash.com`, and its
comment states the rationale: *"`data:` is required — a blank puzzle's share
link carries the painted canvas as a PNG."* After this change nothing ever
renders a `data:` image — fresh blanks never produce one, and old links and old
saves both collapse to `null` before the href is written. So `data:` is dropped
from the directive, along with the sentence in the surrounding comment that
justified it and the `index-html.test.ts:75` case that asserts the now-false
rationale. Both are deleted, not rewritten — the directive that remains needs
no explanation of a source it never had.

`isSafeImageUrl` keeps accepting `data:image/*`: wire validation runs in
`decodePayload`, upstream of the collapse, so rejecting it there would make
every previously-shared blank link fail to load outright. The scheme guard and
the CSP now cover different halves — the guard admits the legacy value, the
load path neutralizes it, and the CSP guarantees that if some path were ever
missed the browser refuses the fetch rather than silently loading it.

Residual risk: a missed collapse point renders blank pieces transparent instead
of white, and reports a `csp-violation` with `blockedUri: 'data'`. That is a
loud, diagnosable failure rather than a silent one, and the two collapse points
(save deserialize, share decode) are the only paths by which a `data:` URL can
enter state.

### 7. Comments that become false — delete, don't rewrite

Several live comments assert the fabricated PNG as fact. **The default
treatment is deletion.** A comment whose subject no longer exists is removed,
not extended into an account of what is true now or how it changed; a comment
whose non-obvious half survives is cut down to that half. Nothing here
narrates the migration — this codebase is already heavy on long-winded
comments, and a change that falsifies one is an opportunity to shed weight
rather than add it. The same restraint applies to the code this change adds:
the renderer's blank branch and the persistence migration are self-describing
and get at most one line each.

| Site | Treatment |
| --- | --- |
| `share-link.ts:26` — `SharePayload.i` doc | Cut to one line: image URL, or `'blank'` for a puzzle with no image. The `{@link collapseBlankImageUrl}` cross-reference and the which-producers-collapse-and-which-don't paragraph both describe a divergence that no longer exists. |
| `share-link.ts:287` — `clampDim(is)` rationale | Delete the canvas-allocation sentence outright, and the "a crafted `is:[1e9,1e9]` is capped" line, which restates `clampDim(…, MAX_IMAGE_DIM)`. Keep only the fractional-`is` note: that fractal/wavy links legitimately produce 607.5 is the one thing a reader would get wrong, and it is what stops someone "fixing" the floor. ~7 lines → ~3. |
| `share-link.ts:403` — `isValidPayload` ordering | Delete the parenthetical sizing the canvas PNG. The ordering rationale (parse last, it is the expensive check) survives as-is. |
| `safe-url.ts:36` — `data:image/*` bullet | Cut the `collapseBlankImageUrl` reference and the "every blank-puzzle link ever shared" paragraph to a single line: legacy blank links carry a canvas PNG; `image/` subtypes only. |
| `safe-url.ts:74` — read MIME off `pathname` | Keep the guidance, delete the 6–20 KB sizing that justified it; the reason to avoid copying a long `href` does not need a number. |
| `load-shared-puzzle.ts:5` and `:130` | Delete "locally-regenerated blank canvas" from the module doc. Replace the inline `// If the sentinel is the blank canvas, regenerate it locally.` with one line covering the only non-obvious arm — that a legacy `data:` URL means the same thing as the sentinel. |
| `dev-hooks.ts:227` | "renders on the blank canvas" → "renders as a blank puzzle". |
| `umami.ts:473` | Delete the blank-canvas-PNG half of the `blockedUri` redaction argument. The argument itself (browsers report the literal `'data'`) is unchanged and stays. **No new operator note** about `blockedUri: 'data'` now meaning an escaped legacy puzzle — the CSP rationale lives in `index.html`, and an alert story for an event that should never fire is exactly the kind of speculative prose being cut. |
| `umami.ts:674` | "the blank canvas" → "a blank puzzle". |

`app/blank-canvas.ts`'s module doc and `collapseBlankImageUrl`'s 20-line doc
need no treatment: they leave with their code.

### 8. Explicitly out of scope

- A tripwire test asserting no `getContext` under `src/`. Testing for the
  absence of a dependency is busywork.
- Any change to `blankSizeForOrientation` or the orientation logic: a blank
  puzzle still has dimensions, chosen the same way.
- Info-modal help text. Blank puzzles look identical to the player and no
  feature is added or removed, so per the repo's help-text rule there is
  nothing to correct.

## Testing

- **Renderer:** a blank state renders a `[data-piece-blank]` path filled
  `#ffffff` and no `<image>`; a normal state renders the `<image>` unchanged;
  the clip path, hit area and debug overlay are present in both.
- **Serialization:** v13 round-trips `null` (key absent); a v12 blob with a
  `data:` `imageUrl` deserializes to `null`; a v12 blob with an http URL is
  untouched; validation rejects a v12 blob missing `imageUrl` and accepts a v13
  one; the split static/progress path matches the full-blob path.
- **Share codec:** `gameStateToPayload` emits `i: 'blank'` for a null
  `imageUrl` and the URL otherwise; a `'blank'` payload loads as `null`; a
  legacy `data:` payload also loads as `null` and still passes
  `isValidPayload`.
- **Repro params:** a blank puzzle's block omits `imageUrl` and round-trips
  through `reproParamsToPayload` to `'blank'`.
- **classifyImageSource:** `null` → `'blank'`.
- **start-new-game:** the blank path installs a state with `imageUrl === null`
  and never touches a canvas.
- **index-html:** `img-src` no longer lists `data:`.

The bezier-js geometry digest test
(`puzzle/topology/dcel-broad-phase-equivalence.test.ts`) must stay green
untouched — it is the tripwire proving generated geometry did not move.
