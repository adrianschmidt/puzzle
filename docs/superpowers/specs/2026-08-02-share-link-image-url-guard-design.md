# Share-link image-URL guard + CSP `img-src`

Closes #506. Closes #491.

## Problem

`isValidPayload` (`src/sharing/share-link.ts`) guards the two attribution URLs
with `isSafeHttpUrl`, but accepts the image URL on a bare type test:

```ts
if (typeof p.i !== 'string') return false;   // scheme unchecked
```

A crafted `#p=` link can therefore put an arbitrary absolute URL into
`payload.i`, which reaches `state.imageUrl` and the SVG `<image>` href in
`src/renderer/svg-dom-renderer.ts`.

Separately (#491), the per-style config blocks `tf` (triangles) and `clf`
(classic) have no shape validation, so `tf: null` survives decode and
`decodePayload` returns a `SharePayload` whose declared type is a lie.

## Two corrections to the issue text

Both were found while designing this and change what gets built.

**1. #506's accept-list is incomplete.** It proposes accepting
"same-origin/relative URLs plus `http(s):`, and the `'blank'` sentinel". That
omits `data:`. `gameStateToPayload` (share-link.ts:696) deliberately does *not*
call `collapseBlankImageUrl`, so **every blank-puzzle share link carries a raw
multi-KB `data:image/png` in `payload.i`**. A guard built to the issue's list
rejects all of them. The accept-list must include `data:image/*`.

**2. A scheme check does not close #506's stated impact.** The issue describes a
third-party fetch leaking IP/User-Agent. Legitimate links carry arbitrary
`https://images.unsplash.com/...` URLs, so http(s) must stay allowed — and an
attacker simply uses `https://evil.example/pixel.png`. The scheme guard closes
scheme abuse and the type-honesty gap; the origin policy has to live somewhere
that can express it, which is CSP.

**3. #491 is half-done already.** `ff` and `wf` gained `isValidBorderlessBlock`
in commit `b4d1e1f3`, after the issue was written. Only `tf`/`clf` remain.

## Design

### 1. `isSafeImageUrl` — codec scheme guard

New export in `src/sharing/safe-url.ts`, alongside `isSafeHttpUrl` rather than
replacing it. The two have different accept-sets by nature: an anchor `href`
must be absolute http(s), an image URL is legitimately relative or `data:`.
Attribution keeps using `isSafeHttpUrl` unchanged.

| input | verdict | why |
|---|---|---|
| `'blank'` | accept | wire sentinel |
| `data:image/png;base64,…` | accept | blank-canvas share links |
| `first-puzzle.jpg` | accept | bundled image, relative |
| `//evil.example/x.png` | reject | protocol-relative — see revision 1 below |
| `https://images.unsplash.com/…` | accept | normal Unsplash link |
| `http://…` | accept | legacy links |
| `javascript:` / `vbscript:` / `file:` | reject | scheme abuse |
| `data:text/html,…` | reject | non-image `data:` |
| `blob:…` | reject | see below |
| `''` | reject | not a usable image URL |

`blob:` is rejected deliberately. The app's only `URL.createObjectURL` is the
corrupt-save download anchor (`src/ui/corrupt-save-dialog.ts`), never an image
URL, and a `blob:` minted in the sharer's session is already dead on the
recipient's machine.

Wired into `isValidPayload` as:

```ts
if (typeof p.i !== 'string' || !isSafeImageUrl(p.i)) return false;
```

Rejecting the whole payload matches the codec's all-or-nothing handling of every
other malformed field (`a`, `pr`, `bgc`, `ff`, `wf`).

### 2. CSP `img-src` — the origin policy

In `index.html`, early in `<head>` so it precedes any resource load:

```html
<meta http-equiv="Content-Security-Policy"
      content="img-src 'self' data: https://*.unsplash.com">
```

Only `img-src` is set. No `default-src`: that would require script/style/
connect/font policy too, a far larger and riskier change than this issue wants.

Coverage verified against the app's actual image loads:

- Local assets (`favicon-48.png`, `apple-touch-icon.png`, `icon-192/512.png`,
  `first-puzzle.jpg`, `first-puzzle-portrait.jpg`, `puzzle-image.jpg`) are
  same-origin → `'self'`.
- Blank canvas is a `data:` PNG → `data:`.
- Puzzle images (`urls.regular`) and picker thumbnails (`urls.small`) both come
  from Unsplash's CDN → `https://*.unsplash.com`.
- The service worker precaches build output only (same-origin); it does not
  runtime-cache Unsplash.
- No CSS `url()` anywhere in the repo.
- `api.unsplash.com` is a `fetch`, governed by `connect-src`, so it is
  unaffected by an `img-src`-only policy.

`https://*.unsplash.com` matches subdomains but not the bare apex — correct
here, since images never come from `unsplash.com` itself.

The wildcard is chosen over pinning `images.unsplash.com` as a **hedge, not a
fix for an observed case**. Checked against production analytics (2026-04-25 →
2026-08-02): `imageSource: 'fallback'` appears **zero** times across 358
Unsplash games, and `classifyImageSource` routes any host other than
`images.unsplash.com` to that bucket — so no other Unsplash host has ever
served this app, and pinning would have worked. It is wildcarded because the
error is asymmetric: a CDN host we cannot predict blanks every puzzle for every
player, while the extra breadth is one vendor's own subdomains. It blocks
attacker-controlled hosts just as effectively either way.

That measurement also settles a review finding that `classifyImageSource`
(which pins `images.unsplash.com`) is miscounting Unsplash+ images as
`'fallback'`. It is not — the bucket is empty. No classifier change is
warranted, and the apparent inconsistency between the CSP's wildcard and the
classifier's pin is deliberate: they have different jobs, and a security
boundary should err loose where an analytics classifier should err precise.

This is what actually closes the tracking-pixel vector, and it does so for every
image load — resumed saves included — not just share links.

### 3. `tf` / `clf` shape validation (#491 residual)

Add the analogous check to `isValidPayload`, ungated by `p.c`, matching
`isValidBorderlessBlock`'s documented "applied to EVERY cut style" choice.

`tv` is deliberately **not** validated here. `decodePayload` clamps it, and an
unusable value falls back rather than losing the link — the same treatment
`wf.tv` already documents. The check is shape only: non-null object.

This eliminates the falsy-non-object case (`tf: null`), so the decode-time
truthiness guards (`if (translated.c === 'classic' && translated.clf)`) stop
carrying a type lie.

## Testing

- `safe-url.test.ts` — accept/reject table for `isSafeImageUrl`, one case per row
  above.
- `share-link.test.ts` — decode rejection per bad scheme; decode *acceptance* for
  a blank-puzzle `data:` PNG, the bundled relative URL, an Unsplash https URL,
  and `'blank'`.
- A round-trip asserting a blank puzzle's `gameStateToPayload` output still
  decodes. This is the exact regression #506's own accept-list would have
  shipped, so it is the highest-value test here.
- `tf`/`clf` rejection cases (null, non-object) mirroring the existing `pr`/`cf`
  rejection blocks.
- A test asserting `index.html` carries the CSP meta tag with all three sources,
  following the `src/pwa/manifest.test.ts` precedent of testing static config.

## Revisions after review

Three design errors that a clean-room review of the implementation caught.
Recorded rather than silently corrected, because each was a *reasoning* fault
rather than a typo.

**1. "Relative" cannot be inferred from a failed absolute parse.** The first
implementation treated every `new URL(url)` throw as "relative ⇒ same-origin",
and said so in a JSDoc claim. That is false: `//evil.example/pixel.png` and its
`///`, `/\`, `\\`, `\/` variants all throw without a base and all resolve
*cross-origin*, because a relative reference inherits the base's **scheme**,
not its origin. Verified against the shipped function body. The guard now
resolves against a sentinel base and requires the origin back.

The live impact was nil — the guard accepts `https://evil.example/pixel.png`
outright by design, and the CSP blocks both equally — so what was actually
defective was a false claim on a new security guard. Fixed in code rather than
in the comment, so it cannot drift.

**2. Ungating the shape check without ungating the clamp moves the type-honesty
gap rather than closing it.** `isValidTraceSetBlock` is deliberately
style-agnostic, but the `tf`/`clf` clamps in `decodePayload` were gated on
`translated.c`. So `{ c: 'classic', tf: { tv: 'x' } }` passed validation, skipped
a triangles-gated clamp, and decoded to a `tf` contradicting its declared
`{ tv: number }` — the exact defect #491 exists to close. Both clamps now run
ungated.

Note #491's own text contains this mistake ("A truthy non-object … reaches the
clamp … and the block is deleted"), which holds only for a block matching the
payload's own cut style. The implementation inherited the wrong premise.

Rejected alternative: requiring `typeof tv === 'number'` in the validator. It
looks tighter, but `applyStyleConfigs` copies `traceSetVersion` to the wire
without coercion, so a state restored from a save carrying a crafted `tv` would
produce a link its own decoder refuses — precisely the failure mode the `bl`
coercion at `share-link.ts:672` was written to avoid.

**3. A CSP with no violation reporting is an unobservable failure mode.** The
policy names `https://*.unsplash.com`, so an Unsplash CDN move blocks every
puzzle image with `index.html` unchanged — and nothing would notice: the SVG
`<image>` carries no error handler, and `initErrorTracking`'s `error` listener
deliberately omits the capture phase where resource failures surface. Every
puzzle would render transparent pieces while `new-game-started` still reported
a healthy `imageSource`.

`index-html.test.ts` pins the tag against *edits*; only a runtime signal covers
the outside world changing under it. Added a `securitypolicyviolation` listener
reporting `csp-violation`, sharing the existing rate limiter and keyed on the
directive so one bad policy cannot drain the session budget.

## Out of scope

- No info-modal change: nothing here is player-visible (per `CLAUDE.md`, help
  text tracks visible behavior).
- No `default-src` or wider CSP.
- No change to `collapseBlankImageUrl`'s producer divergence (#496 territory).
