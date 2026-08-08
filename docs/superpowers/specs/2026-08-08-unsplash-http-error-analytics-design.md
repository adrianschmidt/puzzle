# Unsplash HTTP-error analytics — design

Closes the gap in #533: a 4xx/5xx from the image proxy (most likely 403 Rate
Limit Exceeded from Unsplash's 50-requests/hour demo budget) is invisible in
production. `fetchRandomImage`/`fetchRandomImages` log via dev-only
`diagnostics.warn` and return `undefined`, and `image-fetch-failed` fires only
on a genuine throw — by its own documented contract. A rate-limited hour is
indistinguishable from a quiet one.

## Decision: a distinct event, not a widened `image-fetch-failed`

The issue offers two shapes and a deciding criterion: keep the "absence can't
be filtered" problem out of the dashboard. That criterion rejects shape 2
(widen `image-fetch-failed` to carry the HTTP status): the status would be
absent on throw-path rows and on every historical row, and Umami event
properties are key/value rows, so `status != 200` joins on the key and matches
only rows that *have* a status — the exact trap already documented twice in
`umami.ts` (`SharedLoadFailedData.source`, `NewGameFailedData.phase`).

So: a new event where **every field is mandatory on every row**. No
absence arithmetic, ever.

## Event

`image-fetch-http-error` — the image proxy answered a random-photo request
with a non-2xx status.

```ts
interface ImageFetchHttpErrorData {
    /** HTTP status the proxy answered with, e.g. 403. */
    status: number;
    /** 'single' = new-game resolve path; 'batch' = the picker's grid fetch. */
    source: 'single' | 'batch';
}
```

- `status` makes 403 a plain filterable segment (`status = 403`), and gets the
  Worker's own error statuses (500 no-key, 502 Unsplash-unreachable) for free —
  statuses `ImageFetchFailedData`'s doc comment explicitly laments being blind
  to.
- `source` is mandatory, follows the repo's `source`-discriminator naming
  convention, and separates the two producers: the picker burns the shared
  budget while browsing; the new-game path burns one call per start.
- No `orientation`/`imageCategory`: rate limiting and Worker misconfiguration
  are global conditions, and those fields aren't in scope at the emission
  point. No `statusText`: redundant with `status`.

## Emission point

Inside `src/images/unsplash.ts`, in the existing `!response.ok` branches of
`fetchRandomImage` (source `'single'`) and `fetchRandomImages` (source
`'batch'`), beside the existing `diagnostics.warn`. One call site per
function covers both consumers (`resolve-image.ts`, `fetch-candidate-images.ts`)
with no return-contract change and no caller churn. `track()` is already safe
here: it no-ops without `window`/`window.umami`.

`triggerPhotoDownload` is out of scope: its non-ok responses are a trailing
echo of a random fetch that just succeeded, so a rate-limited hour is already
visible through the new event, and the issue scopes to the random-photo path.

## Documentation that must move in the same change

Live docs falsified by the change (the repo's comment policy requires fixing
them in place):

- `ImageFetchFailedData`'s doc comment: "returns `undefined` (and is
  untracked)" and the "Do NOT use this event to answer 'is the proxy up?'"
  paragraph — the sibling event now carries exactly those statuses.
- `resolve-image.ts` header: "a no-usable-photo result is a handled, untracked
  outcome".
- `fetch-candidate-images.ts` header: "failures here are logged but not
  tracked as analytics events".
- New `ImageFetchHttpErrorData` doc comment is the operator-facing query spec:
  document the `source` value mapping and the 403 = rate-limit reading.

## Testing

- `umami.test.ts`: `track` forwards `image-fetch-http-error` with the typed
  payload (existing pattern).
- `unsplash.test.ts`: non-ok response → event tracked with that status and the
  right `source`, for both functions; ok response → not tracked; thrown fetch →
  not tracked (the throw propagates and remains `image-fetch-failed`'s case).
  Assert via the repo's `window.umami` stub idiom (as `resolve-image.test.ts`
  does), which requires switching the file to the jsdom environment — the
  real `track()` reads `window.umami` dynamically, so no module mock is
  needed.

## Out of scope

- Retry UX — the picker's inline error and refresh button already handle it
  (stated in the issue).
- The picker's *throw* path (`fetch-candidate-images.ts` catches and returns
  `null` untracked) — a separate gap, not the one #533 describes.
- Help-modal copy — no user-visible behavior change.
- PRNG/reproducibility — untouched.
