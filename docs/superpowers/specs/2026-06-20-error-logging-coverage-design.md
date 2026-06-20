# Error-logging coverage (#429)

## Problem

The global backstop (`src/analytics/error-tracking.ts`) reports uncaught
exceptions and unhandled rejections as `unhandled-error`, and several paths
emit their own typed events (`save-failed`, `traced-chunk-load-failed`,
`pwa-update-apply-failed`, …). Coverage is mostly good, but an audit of
locally-caught error paths found user-visible failures that are caught and
swallowed **without** any `track()` call, so they are invisible in analytics.
Two in-code comments also overstate coverage.

This is observability work: with a tiny user base these failures are rare, but
they are exactly the signals we want as usage grows — especially shared-link
breakage, since share links are how the audience reaches the app.

## Goal

Add distinct typed analytics events at the un-instrumented catch sites, and
correct the two misleading comments. Keep scope to the catch-site logging;
larger structural work (service-worker instrumentation, a labeled update-check
event) is split into follow-up issues #430 and #431.

## Design

### New typed events

Four new `track()` overloads in `src/analytics/umami.ts`, each with a
documented `*Data` interface, following the existing pattern. Every `reason`
is run through `sanitizeErrorReason` (URL/extension redaction + length cap).

| Event | Call site | Payload |
|---|---|---|
| `shared-load-failed` | `src/main.ts:1418` catch (`loadSharedPuzzle`) | `{ reason: string }` |
| `image-fetch-failed` | `src/main.ts:984` catch (Unsplash fetch) | `{ reason: string }` |
| `new-game-failed` | `src/main.ts:1128` `.catch` (`startNewGame`) | `{ reason: string }` |
| `share-failed` | `src/ui/share-section.ts:112` & `src/ui/completion-overlay.ts:80` `onError` | `{ source: 'info-modal' \| 'completion-overlay'; reason: string }` |

Notes per site:

- **`shared-load-failed`** — the high-value one. A link can satisfy
  surface-shape validation yet trip the topology pipeline (e.g. a config
  combination the current build doesn't support). Currently only a toast.

- **`image-fetch-failed`** — `fetchRandomImage()` already returns `undefined`
  on 4xx/5xx (a handled "no image" outcome, **not** tracked), so this catch
  only fires on a genuine throw (network/parse). The `*Data` doc comment must
  state this so the event isn't misread as "image not found."

- **`new-game-failed`** — kept as its own event despite overlap: the most
  likely cause (traced-tab lazy chunk import) *also* emits
  `traced-chunk-load-failed` one layer down, so a single failure can produce
  two events. There is **no guaranteed 1-to-1 correlation** (topology and
  other errors reach this catch without a chunk event), and this event
  captures the user-facing "click produced a toast, nothing started" outcome
  that the inner event does not. The `*Data` doc comment must call out the
  possible double-count.

- **`share-failed`** — instrumented at the two `onError` callback sites, **not**
  inside the pure `src/ui/share.ts` util (which stays analytics-free). The
  `source` discriminant mirrors the existing `puzzle-shared` event
  (`info-modal` from `share-section.ts`, `completion-overlay` from
  `completion-overlay.ts`). User cancellation (`AbortError`) is already
  filtered inside `share.ts` before `onError` fires, so cancels are never
  tracked — this must be preserved and covered by a negative test.

### Comment corrections (no behavior change)

- **`src/analytics/error-tracking.ts:13`** — the "this catches … the service
  worker" claim is false. `window` `error`/`unhandledrejection` listeners run
  in the page realm and cannot see throws inside the SW's own scope. Reword to
  scope the claim to SW→page message errors. Real SW instrumentation is #430.

- **`src/pwa/update-controller.ts:188-193`** — the claim that the backstop
  "does not catch these void-swallowed rejections" is wrong. `void` does not
  attach a rejection handler; an unhandled rejected promise still fires
  `unhandledrejection`, which the backstop listens for. Reword to state that a
  failed update *check* **does** reach the backstop as a generic, rate-limited
  `unhandled-error{source:'rejection'}` — observable but unlabeled. A distinct
  labeled `pwa-update-check-failed` event is #431.

### Out of scope (follow-up issues)

- **#430** — real service-worker error instrumentation; requires migrating
  `vite-plugin-pwa` from `generateSW` to `injectManifest` with a custom SW
  entry. Build-level change, separate testing surface.
- **#431** — a distinct `pwa-update-check-failed` event; needs its own
  flood-guard because update checks poll on a timer.

## Testing (TDD)

Write the test first for each change, watch it fail, then implement.

- **Positive:** each of the four catch sites, when its operation throws,
  calls `track()` once with the documented payload (asserted via the existing
  `umami` mock pattern used in `umami.test.ts` / `error-tracking.test.ts`).
  `reason` is the sanitized message.
- **Negative (must NOT track):**
  - Unsplash image 4xx/5xx fallback path (`fetchRandomImage()` → `undefined`)
    emits no `image-fetch-failed`.
  - Share user-cancel (`AbortError`) emits no `share-failed`.
- **Comment corrections** carry no behavior change, so no new test; existing
  suites must stay green.

## Files touched

- `src/analytics/umami.ts` — 4 new overloads + `*Data` interfaces.
- `src/main.ts` — 3 catch sites gain a `track()` call.
- `src/ui/share-section.ts`, `src/ui/completion-overlay.ts` — `onError` gains a
  `track('share-failed', …)`.
- `src/analytics/error-tracking.ts`, `src/pwa/update-controller.ts` — comment
  fixes.
- Corresponding `*.test.ts` files for the positive/negative assertions.

## Non-goals

- No new rate-limiting/dedup for the four new events: all four fire on discrete
  user actions (load shared link, start game, share), not in loops, so flooding
  is not a concern. (The timer-driven update-check path, which *would* need a
  guard, is deferred to #431.)
- No refactor of the existing event scheme — it is already distinct typed
  events, which is the style this work follows.
