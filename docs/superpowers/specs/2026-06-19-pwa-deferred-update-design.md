# PWA freshness / deferred update — design

**Date:** 2026-06-19
**Status:** Approved (pending implementation plan)

## Problem

The app is a PWA served via `vite-plugin-pwa` with `registerType: 'autoUpdate'`
and no custom registration or update polling. With `autoUpdate`, a new service
worker (SW) is applied only once the browser *discovers* it, and discovery only
happens on navigation and roughly once every 24h. An installed PWA that is
reopened from the home screen (resuming a backgrounded tab, no real navigation)
or a long-lived tab can therefore run a stale version for a long time.

We want the app to reliably pick up new versions without disrupting an
in-progress puzzle.

## Key existing facts

- `main.ts` already flushes the debounced save on `pagehide` and on
  `visibilitychange → hidden` (`src/main.ts:669-671`). So by the time the app is
  backgrounded, progress is already persisted. **Reloading when the app regains
  focus can never lose progress** — this is what makes the chosen UX safe.
- `src/ui/toast.ts` is a transient, auto-dismissing, single-instance toast. It
  is *not* suitable for a persistent "update available" affordance.

## Behavior

1. While the app is open, check for a new SW periodically (~60 min) **and** on
   every `visibilitychange → visible` (catches "reopened from home screen").
2. When a new version is detected, **do not reload immediately**. Activate it in
   the background, set an `updatePending` flag, and show a subtle persistent
   indicator.
3. Apply the update (reload) at the next safe moment:
   - **App regains focus** (`visibilitychange → visible`) while an update is
     pending → reload. Safe because progress was already flushed on the way out.
   - **User taps the indicator** → reload now.

## Components

Each unit is small, single-purpose, and testable, following repo conventions
(tests next to source; new seeded randomness N/A here).

### `vite.config.ts`
Change `registerType: 'autoUpdate'` → `'prompt'`. `autoUpdate` skip-waits and
reloads on its own; `prompt` lets us decide when to activate + reload. Keep the
existing `navigateFallbackDenylist` untouched.

### `src/pwa/update-controller.ts` (new)
Pure, unit-testable decision logic. Holds `updatePending` and the `updateSW`
reference. Dependencies (the save-flush hook and the reload function) are
injected so tests never touch the real SW or `location`.

Exposes:
- `onNeedRefresh()` — mark pending; show the indicator.
- `requestReloadIfPending()` — if pending: flush, then reload; no-op otherwise.
- `reloadNow()` — flush, then reload (used by the manual indicator).

### `src/pwa/register.ts` (new)
Browser glue. Imports `registerSW` from `virtual:pwa-register`, wires
`onNeedRefresh` → controller. In `onRegisteredSW(swUrl, registration)`:
- start a ~60-min interval calling `registration.update()`;
- on `visibilitychange → visible`, call `registration.update()` (detect promptly
  on reopen) and `controller.requestReloadIfPending()`.

### `src/ui/update-available-indicator.ts` (new)
A small persistent, clickable affordance ("Update ready — tap to refresh"),
styled like the existing glassmorphism toast but **not** auto-dismissing.
Tapping invokes the controller's `reloadNow()`.

### `src/main.ts`
Call the PWA init during startup, passing `debouncedSave.flush` as the
pre-reload hook.

## Out of scope

- **Help text (info modal):** intentionally *not* updated. The indicator is
  self-explanatory and the auto-reload-on-reopen needs no explanation; keeping
  the help text short has value.
- **"Hidden for > N seconds" guard** before auto-reloading on focus-regain:
  deferred (YAGNI). Can be added later if a quick alt-tab-and-back reload ever
  feels abrupt.

## One-time transition for already-installed clients

This switch from `autoUpdate` to `prompt` is forward-looking for every client
that installs *after* it ships, but existing installs cross over through a
single degraded update before the new behavior takes hold:

- A client currently running the old `autoUpdate` SW has no deferred-update
  logic. When it next discovers the build that contains this change, the **old**
  SW is still in control, so that one update is applied the old way (auto
  skip-waiting / reload on discovery), not deferred.
- Once that build's SW activates, the page is controlled by the new `prompt`
  registration. From the *next* update onward, detection, the indicator, and the
  deferred-apply flow all work as designed.

So the regression window is exactly one update per existing install, and it
self-heals on first activation. No migration code or version gate is needed; the
behavior is inherent to how a controlling SW hands off. (The PR description
carries the same note as a deploy caveat.)

## Tests

- `src/pwa/update-controller.test.ts`: pending + visible → reload called; not
  pending → no reload; manual trigger → reload; flush called before reload.
- `src/ui/update-available-indicator.test.ts`: renders; click invokes callback.
- `virtual:pwa-register` is mocked in tests (it only exists at build time).

## Decisions / defaults

- **60-min poll interval** — reasonable default; the reopen-check is the main
  driver anyway.
- **Reload immediately on first focus-regain** while pending — simple; safe due
  to the existing flush-on-hidden.
