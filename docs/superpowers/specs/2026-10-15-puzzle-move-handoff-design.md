# Moving players to puzzlewise.github.io — save handoff

## Problem

The app is moving from `https://adrianschmidt.github.io/puzzle/` to its own
GitHub org, served at `https://puzzlewise.github.io/`, so it gets its own
origin and therefore its own localStorage quota (today it shares ~5MB with
every other app under `adrianschmidt.github.io`).

localStorage is per origin, so a player's in-progress puzzle and settings do
not follow them to the new site. The old deploy stays up — taking it down would
destroy those saves — but it should steer players to the new site and let them
bring their puzzle along.

## Goal

One click on the old site moves the current puzzle (geometry + progress), its
settings, and the analytics identity to the new site, where play continues
where it left off. Any failure leaves both sides' data as it was.

## Rollout context

The repo is transferred to the `puzzlewise` org and renamed
`puzzlewise.github.io` (base path `/`). A fresh `adrianschmidt/puzzle` repo then
serves a frozen build of this code with `VITE_MOVED_TO` set. Both roles
therefore live in this codebase:

- **Source role** (old site): active only when built with
  `VITE_MOVED_TO=<target origin>`. Unset — the normal build — means none of the
  source behavior exists. This gate matters because `main` deploys to the old
  origin until the transfer; keying off the hostname would start sending
  today's players to a site that does not exist yet.
- **Target role** (new site): always built in, but it only acts on the
  `?receive-move` entry point and only accepts messages from the source origin.
  It is inert when the page's own origin *is* the source origin.

Trusted origins default to the production values and can be overridden for
local testing: `VITE_MOVED_TO` on the source, `VITE_MOVED_FROM` (default
`https://adrianschmidt.github.io`) on the target.

## Mechanism: popup + postMessage

Both pages must be top-level. Third-party storage partitioning (all major
browsers) gives an iframe of origin B embedded in A a storage partition keyed
by A, so an iframe in either direction reads or writes the wrong store.

Rejected:

- **Export/import file** — works everywhere, but clunky for every player to
  cover the one case (installed iOS app) handled below without it.
- **Relay through the Cloudflare Worker** — upload with a one-time code, fetch
  on the new site. Stores player saves server-side and needs KV; out of
  proportion for the user count.

## Source role (old site)

### Startup banner

When `VITE_MOVED_TO` is set and the move has not happened, a small dismissible
banner shows: "Puzzle has moved — bring your puzzle along". Tapping it opens
the move dialog. Dismissing hides it for the rest of the page's life; it
returns on the next load.

### New puzzle

The single entry point (`openNewGameDialog` call in `bootstrap.ts`) is
intercepted: the move dialog shows instead of the new-game dialog.

- Primary action: **Move to the new site** — runs the handoff.
- Secondary: **Start a new puzzle here anyway** — opens the normal new-game
  dialog.

### Installed iOS app

When `navigator.standalone === true` (set only by iOS/iPadOS Safari for
home-screen web apps), the handoff is not offered: a home-screen app's storage
is isolated from Safari's, and a popup from it opens in an in-app browser whose
storage would not reach a later Safari tab or home-screen install of the new
site.

- No startup banner.
- At New puzzle, the dialog instead says the app has moved and explains how to
  open `puzzlewise.github.io` in Safari and add it to the Home Screen, with
  the same "Start a new puzzle here anyway" option.

Installed apps on Android and desktop Chromium share storage with the browser
profile, so they get the normal flow.

### After a successful move

The source writes `puzzle-moved-to` (the target origin), keeps all its own data
as a backup, and the dialog reads "Done — your puzzle is open in the new tab".
From then on:

- The banner reads "Your puzzle is now at puzzlewise.github.io" and links
  there.
- New puzzle navigates straight to the target instead of showing the dialog.

### Share links

- **Outgoing:** links built on the old site (info modal share section,
  completion overlay — both currently use `location.href` without the hash)
  use the target's root as their base URL.
- **Incoming:** a `#p=` link opened on the old site redirects
  (`location.replace`) to the target root with the hash intact, before the
  share-link loader runs. Following a share link starts a new puzzle anyway;
  an unfinished puzzle on the old site stays there for the banner to offer
  later.

## Target role (new site)

### Receive mode

Entered when the URL has `?receive-move` and `window.opener` is non-null.
Bootstrap shows "Receiving your puzzle…" and does not start a game or install
the save coordinator, so no autosave can race the incoming data. Without an
opener, the parameter is stripped and the app boots normally.

### Conflict

If the target already has a save (`puzzle-game-state` present), it asks:
"Replace the puzzle here with the one you're bringing?" **Keep this one**
cancels the whole move — settings included — and reports `declined`.

### What moves

The target holds an explicit allowlist built from the exported key constants:

- Save: `puzzle-game-state`, `puzzle-progress`.
- Every preference key (background color incl. the legacy `-colour` key,
  piece outline + color, merge tolerance, rotation, marquee contain, offset
  drag, image source, image category, vibrant, size, cut style, composable /
  fractal / wavy config).
- Analytics: `puzzle-analytics-userid`, `puzzle-game-analytics`.

Excluded:

- `puzzle-geometry-seed` — derived; the loader rebuilds it.
- `share-link-rescue-attempt` — per-link session guard.
- `puzzle-offline-image-stash` — its images live in the old origin's Cache
  Storage; moving the metadata would claim images the new site does not have.
- `puzzle-moved-to` — source-only.

A test scans `src/` for `'puzzle-…'` storage-key literals and fails if one is in
neither list, so a new key forces a decision.

### Validation and write

1. Drop entries not on the allowlist; reject the message if any value is not a
   string.
2. Run the incoming save pair through the existing load path (decompress,
   deserialize, seed match) without touching storage. A save that would not
   load is rejected — nothing written, `failed` reported.
3. Snapshot current values of every key to be written, then write. If any write
   throws, restore the snapshot and report `failed`.
4. Report `done`, then `location.replace` to the app root, which boots
   normally into the moved puzzle.

Another open tab of the new site sees the `storage` event on
`puzzle-game-state`; the existing geometry-token invalidation (#404/#490)
already handles a foreign geometry write.

## Handshake

All messages are `{ type: 'puzzle-move/<kind>', v: 1, … }`.

1. Source opens `window.open(<target>/?receive-move)` from the button's click
   handler (user gesture, so not popup-blocked by default).
2. Target → opener: `ready`, posted with `targetOrigin` = source origin.
3. Source, on `ready` whose `event.origin` is the target origin and whose
   `event.source` is the popup it opened: sends `payload` with
   `entries: Record<string, string>` — every localStorage entry whose key starts
   with `puzzle-` except `puzzle-moved-to` — with `targetOrigin` = target
   origin.
4. Target, on `payload` from the source origin: validates and writes as above,
   replies `done`, `declined`, or `failed` (`reason`: `invalid-payload`,
   `unloadable-save`, `write-failed`).

Each side ignores messages of the wrong origin, source, type, or version.

### Source-side errors

- `window.open` returns null: "Your browser blocked the new window — allow
  pop-ups and try again."
- No `ready` within 30s: "Couldn't reach the new site."
- `failed`: shows the reason. Source data is never modified except for writing
  `puzzle-moved-to` on `done`.
- `declined`: dialog closes; nothing changes.

## Analytics

Source-side Umami events: move dialog shown (with trigger: banner / new
puzzle / ios-standalone), move started, and the outcome (done / declined /
failed + reason / popup-blocked / timeout). `umami.ts`'s operator-facing doc
comments are updated to stay accurate.

## Testing

- Vitest/jsdom unit tests for both handshake halves with fake windows: wrong
  origin, wrong source window, wrong type/version, malformed entries, conflict
  accepted/declined, unloadable save, write failure with rollback, timeout,
  popup blocked.
- `navigator.standalone` detection and the iOS dialog variant.
- Share base URL with and without `VITE_MOVED_TO`; incoming `#p=` redirect.
- A share link built by the source build decodes on the target (same code
  today; the test pins it against future format changes).
- Allowlist tripwire over storage-key literals.
- `bootstrap.test.ts` wiring: receive mode does not start a game or the save
  coordinator.
- Manual end-to-end with Playwright across two local origins (dev server on two
  ports, `VITE_MOVED_TO` / `VITE_MOVED_FROM` overrides): move with and without
  an existing target save, popup blocked, iOS-standalone stubbed.

## Out of scope

- Moving the offline image stash.
- The repo transfer, the frozen legacy repo, and workflow/base-path changes —
  separate steps after this merges.
- Turning the old site into a plain redirect later.
