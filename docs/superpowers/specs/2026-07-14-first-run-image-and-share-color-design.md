# First-run image & share-link background colour — design

**Date:** 2026-07-14
**Status:** Approved

## Problem

The first puzzle a brand-new visitor sees uses a random Unsplash image
against the fixed default background (`indigo-darker`). An unlucky image
can blend into the background, making the first impression of the app
"I can hardly see the pieces". Share links have a related gap: the
sharer has usually picked a background that works with the image, but
the link doesn't carry it, so the recipient may get the same bad
pairing.

## Feature 1: Deterministic first-run puzzle image

### Asset

- New file `public/first-puzzle.jpg`: Barney Goodman's "Pink building
  covered in green ivy with people on bicycles" (Norwich, UK), Unsplash
  photo `BS-bOYlt_Lg`, at 1080×722 (~290 KB). Landscape, varied
  regions, strong contrast against `indigo-darker`.
- The old `public/puzzle-image.jpg` **stays in the deploy untouched**.
  Existing saves and share links encode the literal URL
  `puzzle-image.jpg` with 800×600 geometry; replacing its content would
  distort every one of them. New code simply stops referencing it.

### Behaviour

- In the fresh-start branch of startup (no share link, no saved game),
  when **both** hold:
  - the save load returned `'empty'` (an `'unreadable'` save means a
    returning user — they get today's behaviour), and
  - neither `puzzle-image-source` nor `puzzle-image-category` exists in
    localStorage,

  the app skips the Unsplash fetch and starts the puzzle with the
  bundled image instead of a random one.
- Mechanically: a `'first-run'` sentinel image source handled inside
  `startNewGame` alongside the existing `'blank'` branch — sets image
  URL/size/attribution from new constants and bypasses the Unsplash
  call.
- The fallback constants (`FALLBACK_IMAGE_URL`, `FALLBACK_IMAGE_SIZE`)
  point to the new asset too, so the same image serves as the
  network-failure fallback — now with proper photographer attribution
  in both roles (standard `utm_source=puzzle&utm_medium=referral`
  links).
- Seed stays random; size (48) and cut style (classic) stay today's
  defaults. Share links from the first puzzle work like any other: the
  relative image URL resolves against the app origin, exactly as
  fallback-image links already do.

### Analytics

- `classifyImageSource` reports the new bundled filename as
  `'bundled'`. Because the same file also serves as the network-failure
  fallback, URL classification alone can't distinguish the two paths —
  so the first-run branch in `startNewGame` explicitly overrides the
  `new-game-started` field to `'first-run'`. A `'bundled'` value
  therefore means fallback-after-failed-fetch (already accompanied by
  the existing `image-fetch-failed` event), while `'first-run'` means a
  genuine first visit.

## Feature 2: Background colour in share links

### Payload

- New **optional** field `bgc?: string` (palette swatch id, e.g.
  `'indigo-darker'`) in the v1 `SharePayload`. No version bump: old
  clients ignore unknown fields; new clients treat absence as "no
  colour info", so compatibility is clean in both directions.
- Encode always writes the sharer's current colour id.
  `gameStateToPayload` takes the colour id as a parameter from its
  callers (share section, completion overlay) — colour is a UI
  preference, not part of `GameState`.
- Decode: `bgc` must be a string to survive `isValidPayload`; unknown
  ids are dropped at apply time by the preference store's allow-list
  validation, so palette changes can't break link loading.

### Apply rule

- On share-link load, the shared colour is adopted **only if the
  recipient has no stored colour preference** — neither
  `puzzle-background-color` nor the legacy British-spelling key
  `puzzle-background-colour` exists (a pre-rename user is not "new").
  The raw key existence is the test, not `loadColorPreference()`
  (which silently returns the default).
- Adopting means save via the normal preference path **and** apply —
  it persists as the recipient's colour until they change it, so it
  survives reloads (session-only application would surprise on the
  next visit).
- Recipients with any stored colour keep it untouched.
- A new exported helper in `background-color.ts` (e.g.
  `adoptSharedColor(id)`) owns existence check + validation + save +
  apply, keeping `main.ts` thin.

### Analytics

- The existing `new-game-started` event with `source: 'shared'` gains
  an optional field `sharedColor: 'adopted' | 'kept-own' | 'none'`:
  - `adopted` — no existing preference; colour applied and saved.
  - `kept-own` — link carried a colour, recipient has their own.
  - `none` — link had no `bgc` (pre-feature) or the id was invalid.

## Feature 3: Background-colour change analytics (same PR, own commit)

- Colour switching is currently untracked. New event
  `background-color-changed` with `{ from, to }` swatch-id properties,
  fired from the picker's `onSelect` in `main.ts` only when the
  selection actually changes.

## Edge cases

- Sharer on the default colour: still encoded; adopting it is visually
  a no-op and simply becomes the new user's saved preference.
- First-run user opening a share link: share-link path wins (as
  today); they get the shared puzzle and — having no preference — the
  sharer's colour. The bundled first puzzle appears only on a plain
  fresh start.
- Unsplash down on a genuine first run: same outcome as the happy path
  (the bundled image is also the fallback).
- Old share links / old clients: unaffected in both directions (see
  Payload above).

## Testing

- Codec round-trip: `bgc` encodes/decodes; absent field tolerated;
  non-string rejected.
- `adoptSharedColor`: adopts when no keys exist; respects existing
  current-key and legacy-key preferences; ignores invalid ids.
- First-run gate: fires only on `'empty'` save + no image prefs;
  `'unreadable'` save or existing prefs → random Unsplash as today.
- Analytics: `sharedColor` outcome values; `background-color-changed`
  fires on real changes only.
- Info-modal copy: verified unchanged — "Start fresh with a random
  image" describes the new-game dialog, which keeps random images.

## Out of scope

- **Portrait image support** — separate future feature. When it lands,
  the portrait Norwich photo (`q5BV6DBTpFM`) can join as an alternative
  first image.
- No "reset to my colour" affordance for share recipients — the colour
  picker already covers it.
