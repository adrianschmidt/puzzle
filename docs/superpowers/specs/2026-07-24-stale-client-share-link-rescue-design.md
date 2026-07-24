# Stale-client share-link rescue — design

Date: 2026-07-24
Status: Approved

## Problem

A user with an old cached (or installed) app version who opens a share
link in a format that version doesn't understand gets an "Invalid share
link" toast, and the hash is stripped from the URL. They have no way to
recover except somehow getting the app updated and then re-opening the
original link — which most users won't figure out.

The share payload carries a `v: 1` schema version, but the format has
historically grown *without* bumping `v` (e.g. the `triangles` cut style
was added as a new enum value under `v: 1`). An old client rejecting a
newer link therefore does not reliably see a newer version number — it
just sees a payload that fails validation somewhere. "Link is newer than
me" and "link is garbage" are not reliably distinguishable.

## Decision summary

- **Trigger scope:** any `#p=` link that fails to decode (`decodePayload`
  → `null`) triggers one update-check-and-reload rescue attempt, guarded
  per link so it cannot loop. No attempt to distinguish "plausibly newer"
  from "corrupt".
- **UX:** fully automatic. Keep the hash, show "Checking for app update…"
  on the loading overlay, and if a new version is found, apply it and
  reload immediately. No prompt.
- **Terminal failure:** if the link is still invalid after the rescue (or
  no update was available), show today's "Invalid share link" toast and
  strip the hash — unchanged messaging, since at that point we have just
  confirmed the client is on the latest available version.

## Design

### Detection & loop guard (main.ts)

In `tryLoadSharedPuzzle`, when `parseLocationHash` returns `null` for a
hash starting with `#p=`:

1. Consult a sessionStorage guard whose key derives from the raw hash
   body (the `#p=...` payload string), so the guard is per-link.
2. If no rescue has been attempted for this link: record the attempt in
   sessionStorage and start the rescue flow.
3. If a rescue *was* already attempted (i.e. we just reloaded for this
   exact link and it still fails): clear the guard entry and fall through
   to the existing behaviour — "Invalid share link" toast + hash strip.

sessionStorage (not localStorage) so a stale guard can't outlive the tab
and suppress a legitimate future rescue after the app has genuinely
updated.

The guard entry is cleared whenever the flow terminates in the
invalid-link toast — both on the post-reload second failure and when a
rescue ends `no-update` / `unavailable` without reloading — so the only
state it ever carries across a page load is "a rescue reload for this
link is in flight".

### Rescue flow (new module in src/pwa/)

A small module exposing a check-and-apply function, wired from
`register.ts` (which owns the SW registration and the `updateSW` handle;
`virtual:pwa-register` must stay out of the barrel/unit tests, so the
new module receives its dependencies via injection like
`update-controller.ts` does).

Outcomes:

- **`updated`** — `registration.update()` found a new worker and it
  reached installed/waiting: flush the autosave, call `updateSW(true)`,
  and reload with the hash intact. (Reuse the update-controller's
  fallback-reload pattern in case the `controlling` event never fires —
  the shared-origin case from #404.)
- **`no-update`** — the check completed and no new worker appeared: the
  client is current. Fall through to the invalid-link toast.
- **`unavailable`** — the check failed (offline), timed out (~8s
  ceiling), or there is no SW registration at all (dev server). Same
  fall-through as `no-update`.

While the check runs, the already-visible loading overlay shows
"Checking for app update…". A reload before any puzzle is loaded risks
no data: the current save is untouched.

### Live-tab paste path

The `hashchange` listener reuses the same flow via
`tryLoadSharedPuzzle`. The rescue reload is safe mid-session: progress
is autosaved, and after reload the normal boot path — including the
"your progress will be lost" confirm — handles the now-decodable link.
The confirm correctly fires *after* the rescue reload; there is no point
asking before we know the link is loadable.

### Analytics

New funnel events for the rescue (naming to follow existing
`pwa-update-*` / `shared-load-*` conventions):

- rescue attempted → outcome (`updated` / `no-update` / `unavailable`);
- after a rescue reload, whether the link then decoded successfully or
  fell through to the invalid-link toast.

This measures how often stale clients hit the path and whether the
rescue works in the wild.

### Help text

None. This is self-healing behaviour a player would already expect;
per repo policy, no info-modal copy for it.

## Testing

- Unit tests for the rescue module with fake registration / `updateSW` /
  timers: update found, no update, offline rejection, timeout, missing
  registration.
- Unit tests for the guard logic in the boot path: first failure
  triggers rescue and preserves the hash; second failure for the same
  link toasts and strips; a *different* link after a failed rescue gets
  its own fresh attempt.
- The share-link codec and update-controller are untouched; their
  existing tests stand.

## Out of scope

- Version-stamping share links (changes the wire format — itself an
  old-client hazard — and helps no link already in the wild).
- Distinguishing "newer format" from "corrupt" in messaging.
- Any always-on pre-decode update check (adds latency to every valid
  share-link open).
