# Umami analytics — design spec

**Date:** 2026-04-25
**Status:** Draft, pending user review

## Summary

Add lightweight, privacy-friendly usage tracking to the puzzle app via
Umami Cloud (free tier). The primary goal is to know how much the app
is being used; the secondary goal is to learn what kinds of puzzles
players actually start, finish, and share — so design changes can be
informed by real-world play patterns rather than guesswork.

Tracking is implemented as a thin wrapper around Umami's public
JavaScript API. Pageviews are automatic; three custom events
(`new-game-started`, `puzzle-completed`, `puzzle-shared`) carry the
puzzle metadata (style, size, image source, etc.) on their payloads.

The integration is gated by build-time env vars, so localhost is
silent, the PR-preview and production deploys both report into the
same Umami "website" (separated on the dashboard by URL path), and
any forgotten secret falls back to a no-op without errors.

## Goals

- **Usage signal.** Know how often the app is loaded, by how many
  distinct visitors, on what days, from what regions, on which
  devices — covered by Umami's automatic pageview / session metrics.
- **Puzzle-mix signal.** Know what cut styles, sizes, and image
  settings players choose, and which of those they actually finish.
- **Sharing signal.** Know whether the share-and-challenge feature is
  being used (sender side) and whether share recipients tend to be
  returning players or first-timers (recipient side).
- **Privacy by default.** No cookies, no fingerprinting, no consent
  banner — Umami is GDPR-friendly out of the box, and we keep it that
  way by not adding anything that would require consent.
- **No infrastructure burden.** No backend, no DB, no proxy. One
  third-party service plus a script tag.
- **Clean dev / prod separation.** Localhost never reports. PR
  previews and production share one Umami site, and we rely on the
  dashboard's URL-path filter to slice dev vs. prod traffic.

## Non-goals

- **Per-interaction analytics.** No events for every drag, zoom,
  rotate, or settings toggle. Only puzzle-level lifecycle events.
- **Funnel analytics across sessions.** Umami doesn't natively join
  events across sessions, and we're not adding our own user IDs.
- **Anti-ad-blocker measures.** Umami's default cloud script is on
  some block lists. For a personal hobby project, accept the
  collection loss rather than proxying through a custom domain.
- **Server-side analytics.** The app is a static GitHub Pages deploy.

## Tooling: Umami Cloud, free tier

Account holds a single "website":

| Umami site | Domain | Tracking destination for |
|---|---|---|
| `puzzle` | `adrianschmidt.github.io` | Production (`/puzzle/`) and PR preview (`/puzzle/dev/`) |

Umami Cloud doesn't allow two separate "websites" at the same domain,
so production and PR preview both report to one site. Dev vs. prod
are sliced on the dashboard side using the URL-path filter
(`/puzzle/` vs. `/puzzle/dev/`).

Free tier limits (10,000 events/month, 3 websites) are well within
budget for a personal app. If usage ever exceeds the cap, a follow-up
can add a donation/tip path to fund a paid tier — out of scope here.

The user creates the account and the website manually. From Umami,
two artifacts are needed:

- **Website ID** — public UUID embedded in the tracking script.
  Stored as a GitHub Actions secret.
- **API key** — private key for read access. Stored only in the
  user's local environment (not in CI), and used by Claude when the
  user asks for stats.

## Build-time configuration

Two new Vite env vars, mirroring the existing
`VITE_UNSPLASH_ACCESS_KEY` pattern:

| Env var | Purpose |
|---|---|
| `VITE_UMAMI_WEBSITE_ID` | Which Umami site to report to |
| `VITE_UMAMI_SCRIPT_URL` | Optional override for the Umami script URL (default `https://cloud.umami.is/script.js`) |

Wired up per build target:

| Build target | `VITE_UMAMI_WEBSITE_ID` | Result |
|---|---|---|
| `npm run dev` (localhost) | unset | Tracking disabled (no script injected) |
| PR preview (`/puzzle/dev/`) | `secrets.UMAMI_WEBSITE_ID` | Reports to the puzzle Umami site (filter by path on the dashboard for dev) |
| Production (`/puzzle/`)    | `secrets.UMAMI_WEBSITE_ID` | Reports to the puzzle Umami site (filter by path on the dashboard for prod) |

The tracking module checks `if (!import.meta.env.VITE_UMAMI_WEBSITE_ID) return;`
at init time — so localhost and any deploy that forgets to set the
secret simply produce a no-op. No console errors, no broken builds.

The two GitHub Actions workflows that build for deploy
(`deploy-preview.yml` and `deploy.yml`) each pass the same
`UMAMI_WEBSITE_ID` secret in their `env:` block.

## Tracking module

A new `src/analytics/` directory:

- `src/analytics/umami.ts` — exports:
  - `initAnalytics()` — injects the Umami `<script>` tag into
    `<head>` if `VITE_UMAMI_WEBSITE_ID` is set. Otherwise no-op.
    Called once from `main.ts` near the top, before any rendering.
  - `track(event)` — thin typed wrapper around `window.umami?.track(...)`.
    Accepts a discriminated-union event object (see schema below).
    The optional chaining means it's safe to call before the script
    loads or if the script has been blocked by an ad-blocker — calls
    are simply dropped.
- `src/analytics/index.ts` — barrel re-export of the public surface.

**Why a wrapper instead of calling `window.umami.track` directly?**

- Type safety on event names + payload shape — one source of truth.
- Single chokepoint to add/remove tracking later.
- Easy to stub in tests.

### Event schema

```ts
type AnalyticsEvent =
  | { name: 'new-game-started'; data: NewGameData }
  | { name: 'puzzle-completed'; data: PuzzleCompletedData }
  | {
      name: 'puzzle-shared';
      data: {
        source: 'completion-overlay' | 'info-modal';
        includesProgress: boolean;
      };
    };

interface NewGameData {
  source: 'fresh' | 'shared';
  cutStyle: string;                   // 'classic' | 'fractal' | 'composable'
  rotationMode: 'none' | 'quarter-turn';
  cols: number;
  rows: number;
  pieceCount: number;                 // cols * rows, pre-computed for easy slicing
  imageSource?: string;               // 'unsplash' | 'blank' | 'fallback' (see "Field-sourcing" below for shared loads)
  imageCategory?: string;             // only set when source === 'fresh' AND imageSource === 'unsplash' — not recoverable from a share payload
  vibrant?: boolean;                  // only set when source === 'fresh' AND imageSource === 'unsplash' — not recoverable from a share payload
  includesProgress?: boolean;         // only when source === 'shared'
  recipientHadSavedState?: boolean;   // only when source === 'shared'
}

// puzzle-completed has the same shape, but every field outside the
// puzzle-shape core is optional — for resumed-then-completed games we
// only know the puzzle's geometry, not how it was originally started.
type PuzzleCompletedData = Pick<
  NewGameData,
  'cutStyle' | 'rotationMode' | 'cols' | 'rows' | 'pieceCount'
> & Partial<NewGameData>;
```

The same field names mean a single dashboard query ("`puzzle-completed`
grouped by `cutStyle`") gives completion-by-style without needing to
join two event types.

**How `puzzle-completed` gets its bonus fields.** When a game starts
(fresh or shared), we cache the full `NewGameData` in a module-local
variable in `main.ts`. On `puzzle-completed`, we send that cached data
augmented with anything still derivable from `gameState`. If the user
resumed an earlier session's puzzle from localStorage, the cache is
empty and we fall back to deriving only what `gameState` gives us
(`cutStyle`, `rotationMode`, `cols`, `rows`, `pieceCount`, plus
`imageSource` heuristically from `imageUrl`). The optional fields
simply stay `undefined`; the dashboard can filter on "completed events
with `source` defined" if it wants to ignore the resumed cohort.

### Reading the data: caveats

- **`recipientHadSavedState: false`** does *not* prove the recipient
  is new to the app. They may have cleared site data, opened the link
  in a private window, switched devices, or never started a puzzle
  on a previous visit.
- **`recipientHadSavedState: true`** *does* reliably indicate a
  returning player — `loadState()` cannot return non-null without a
  prior puzzle session.
- Umami's built-in "new vs returning visitor" metric (based on a
  separate Umami session ID) answers a different question — whether
  *this browser* has hit the site before — and applies to all
  pageviews, not just shared-link loads.

## Where events fire

| Event | Call site | Trigger |
|---|---|---|
| `new-game-started` (`source: 'fresh'`) | `startNewGame()` in `src/main.ts`, right after `initGame(state)` succeeds | New Game dialog → puzzle is built |
| `new-game-started` (`source: 'shared'`) | `loadSharedPuzzle()` in `src/main.ts`, right after `initGame(state)` succeeds | Recipient opens a `#p=...` link and confirms (if a confirm prompt was shown) |
| `puzzle-completed` | `onDrop` handler in `src/main.ts`, inside `if (checkAndMarkWin(gameState))` | The final merge that completes the puzzle |
| `puzzle-shared` (`source: 'completion-overlay'`) | Share-button click handler inside `showCompletionOverlay()` in `src/main.ts` | Sender clicks "Challenge a friend" |
| `puzzle-shared` (`source: 'info-modal'`) | Share-button click handler in `src/ui/share-section.ts` (same site that already calls `gameStateToPayload`) | Sender clicks share in the info modal |

### Field-sourcing details

- For `puzzle-shared.includesProgress`:
  - Completion-overlay path: always `false` (the existing call passes
    `{ includeProgress: false }`).
  - Info-modal path: `checkbox.checked && !checkbox.disabled` —
    exactly the same expression already passed to
    `gameStateToPayload`.
- For `new-game-started` image fields:
  - `imageSource` is derived from the resulting image URL by a single
    `classifyImageSource()` helper used on *all* paths (fresh, shared,
    completed): `'blank'` if the URL is a `data:` sentinel; otherwise
    `'unsplash'` if the URL host is `images.unsplash.com`; otherwise
    `'fallback'`. The dialog's internal source value (`'random'` /
    `'blank'`) is *not* used directly because it can't distinguish a
    successful Unsplash fetch from a fallback to the bundled default
    image when the API key is missing or the request fails.
  - `imageCategory` and `vibrant` only attach when the resolved
    `imageSource` is `'unsplash'`. On the fresh path they come from
    the dialog selection. On the shared path they are *not*
    recoverable — the share link only carries the image URL, not the
    search terms used to pick it — so they're left undefined.
- For `new-game-started.recipientHadSavedState` and
  `includesProgress`:
  - `recipientHadSavedState` is captured in `tryLoadSharedPuzzle()`
    as `!!loadState()` *before* `clearSavedState()` is called. The
    existing code already computes this value to decide whether to
    show the "Load shared puzzle? Your current progress will be
    lost." confirm dialog, so it's free.
  - `includesProgress` is `payload.pr !== undefined` — the same
    condition that gates the existing `applyProgress(state, payload.pr)`
    branch.

### Deliberately not tracked

- **Auto-resumed games.** When the page loads and a saved state is
  restored from localStorage, no `new-game-started` event fires.
  The pageview already counts the session, and `new-game-started`
  is meant to capture an active "I'm starting/opening a puzzle"
  intent, not a passive resume.
- **Solver-debug completions.** `__solvePuzzle()` calls
  `showCompletionOverlay()` directly without going through the merge
  path, so the `puzzle-completed` `track()` call (placed in the
  natural `onDrop` win branch) is naturally bypassed. No extra guard
  needed.
- **Settings changes before starting a puzzle.** Players can flip
  size, cut style, image category, etc. in the New Game dialog
  before clicking Start; we capture only the final values that the
  resulting puzzle was built with.

## Privacy posture

- Umami Cloud uses no cookies and no cross-site tracking. No consent
  banner is added.
- No personally identifying data is sent — only the typed event
  payloads above (puzzle settings, all of which the user just
  selected themselves) and Umami's own pageview metadata (URL, UA,
  referrer, country derived from IP).
- The Umami cloud script URL is reachable from `cloud.umami.is`. Some
  ad-blockers block this; tracking calls then become silent no-ops
  thanks to the optional-chaining wrapper. Acceptable loss for a
  personal project.

## Testing

- Unit tests for the `track()` wrapper:
  - Calls `window.umami.track(name, data)` when defined.
  - Drops the call silently when `window.umami` is undefined.
  - Drops the call silently when `VITE_UMAMI_WEBSITE_ID` is unset.
- Manual smoke test: build with the dev website ID, deploy a PR
  preview, open the preview URL, watch the Umami dashboard for the
  pageview and any triggered events.
- No event-firing assertions inside the existing puzzle-flow tests —
  those should stay decoupled from analytics. The wrapper is the
  unit boundary.

## Open questions / follow-ups (not in scope)

- Donation / tip-jar UI to fund a paid Umami tier if the free cap is
  exceeded. (User-mentioned future possibility.)
- Custom-domain proxy for the Umami script to bypass ad-blockers.
  Not worth it for a personal project today.
- QR-code or short-URL share variants — already noted in the
  sharing spec as out of scope.
