# Stale-Client Share-Link Rescue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a `#p=` share link fails to decode, run one automatic service-worker update-check-and-reload attempt (guarded per link) before showing the "Invalid share link" toast, so stale cached clients self-heal instead of dead-ending.

**Architecture:** A new `src/pwa/share-link-rescue.ts` module holds the sessionStorage loop guard and the injected-deps rescue attempt (check → wait for update-ready → apply). `register.ts` supplies the real service-worker deps and `initPwaUpdates` now returns a handle exposing the rescue. `main.ts`'s `tryLoadSharedPuzzle` failure branch drives the flow and closes the analytics funnel on the post-reload page load. The share-link codec is untouched.

**Tech Stack:** TypeScript, Vite, vite-plugin-pwa (`virtual:pwa-register`), Vitest (jsdom), Umami analytics.

**Spec:** `docs/superpowers/specs/2026-07-24-stale-client-share-link-rescue-design.md`

## Global Constraints

- Work on a feature branch `stale-share-link-rescue` cut from local `main` (which carries the spec commit; it rides along in the PR).
- Trigger scope: **any** `#p=` link that decodes to `null` — no attempt to distinguish "newer format" from "corrupt".
- UX: fully automatic; overlay text exactly `Checking for app update…` (U+2026 ellipsis, matching `Building puzzle…`).
- Terminal failure keeps today's exact toast text `Invalid share link` and strips the hash.
- Guard lives in **sessionStorage** (not localStorage); the only state it may carry across a page load is "a rescue reload for this link is in flight". Clear it on every terminal path.
- The rescue must be loop-proof: if the guard cannot be persisted (storage throws), do **not** attempt the rescue.
- `virtual:pwa-register` must not leak into any barrel or unit test import graph — `register.ts` stays the only importer; all decision logic is injected.
- No info-modal help-text changes (per spec and repo policy).
- Programming in American English.
- Tests: `npx vitest run <file>` per task; full suite `npm test`; typecheck via `npx tsc --noEmit`.
- Commit messages: conventional commits, ending with the Claude co-author/session trailer used in this repo.

---

### Task 0: Branch

**Files:** none

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/bot/src/puzzle && git checkout -b stale-share-link-rescue main
```

Expected: `Switched to a new branch 'stale-share-link-rescue'`.

---

### Task 1: Analytics event types

**Files:**
- Modify: `src/analytics/umami.ts` (new payload interfaces after `PwaRegisterFailedData`, ~line 398; new `track` overloads after the `pwa-register-failed` overload, ~line 458)
- Test: `src/analytics/umami.test.ts` (add forwarding tests next to the `shared-load-failed` one, ~line 195)
- Check: `src/analytics/index.ts` — re-export the two new interfaces **only if** that barrel already re-exports the other payload interfaces (mirror whatever it does for `PwaUpdateAppliedData`).

**Interfaces:**
- Consumes: nothing new.
- Produces: `ShareLinkRescueAttemptedData { outcome: 'updated' | 'no-update' | 'unavailable' }`, `ShareLinkRescueResultData { decoded: boolean }`, and `track('share-link-rescue-attempted', …)` / `track('share-link-rescue-result', …)` overloads. Task 3 derives `RescueOutcome` from `ShareLinkRescueAttemptedData['outcome']` (single source of truth, same pattern as `UpdateApplyTrigger`).

- [ ] **Step 1: Write the failing tests**

In `src/analytics/umami.test.ts`, after the `shared-load-failed` forwarding test:

```ts
it('forwards share-link-rescue-attempted with the typed payload', () => {
    const umamiTrack = vi.fn();
    (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };

    track('share-link-rescue-attempted', { outcome: 'no-update' });

    expect(umamiTrack).toHaveBeenCalledWith('share-link-rescue-attempted', { outcome: 'no-update' });
});

it('forwards share-link-rescue-result with the typed payload', () => {
    const umamiTrack = vi.fn();
    (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };

    track('share-link-rescue-result', { decoded: true });

    expect(umamiTrack).toHaveBeenCalledWith('share-link-rescue-result', { decoded: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/analytics/umami.test.ts`
Expected: the two new tests FAIL — TypeScript rejects the unknown event-name overloads (or the assertion fails). Existing tests PASS.

- [ ] **Step 3: Add the payload interfaces and overloads**

In `src/analytics/umami.ts`, after `PwaRegisterFailedData` (~line 398):

```ts
/**
 * Data attached to `share-link-rescue-attempted` — a `#p=` share link failed
 * to decode, and since the payload format has historically grown without
 * bumping `v`, the client may simply be a stale cached build. The app ran the
 * rescue: one forced service-worker update check, guarded per link.
 *
 * `outcome` records how it ended: `updated` (a newer build was found and
 * applied — a reload with the hash intact is imminent, and the follow-up
 * `share-link-rescue-result` event on the next page load closes the funnel),
 * `no-update` (the check completed and this client is already current), or
 * `unavailable` (no service-worker registration — e.g. dev server —, the
 * check rejected while offline, or the overall deadline expired). The
 * `no-update` / `unavailable` legs fall straight through to the
 * invalid-link toast.
 *
 * The pwa share-link-rescue module derives its `RescueOutcome` union from
 * this payload, so the set of outcomes has a single source of truth here
 * (same pattern as `PwaUpdateAppliedData` / `UpdateApplyTrigger`).
 */
export interface ShareLinkRescueAttemptedData {
    outcome: 'updated' | 'no-update' | 'unavailable';
}

/**
 * Data attached to `share-link-rescue-result` — the page load after a rescue
 * reload re-parsed the same link. `decoded` records whether the updated build
 * understood it (`true`) or it still fell through to the invalid-link toast
 * (`false`). Paired with `share-link-rescue-attempted` outcome `updated`,
 * this measures whether the rescue actually fixes links in the wild.
 */
export interface ShareLinkRescueResultData {
    decoded: boolean;
}
```

After the `pwa-register-failed` overload (~line 458):

```ts
export function track(name: 'share-link-rescue-attempted', data: ShareLinkRescueAttemptedData): void;
export function track(name: 'share-link-rescue-result', data: ShareLinkRescueResultData): void;
```

Then check `src/analytics/index.ts`: if it re-exports payload types (e.g. `PwaUpdateAppliedData`), add `ShareLinkRescueAttemptedData` and `ShareLinkRescueResultData` alongside; if it only re-exports `track`/functions, change nothing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/analytics/umami.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/analytics/umami.ts src/analytics/umami.test.ts src/analytics/index.ts
git commit -m "feat(analytics): add share-link-rescue funnel events"
```

---

### Task 2: Rescue loop guard (sessionStorage)

**Files:**
- Create: `src/pwa/share-link-rescue.ts`
- Test: `src/pwa/share-link-rescue.test.ts`

**Interfaces:**
- Consumes: `ShareLinkRescueAttemptedData` from `../analytics/index.js` (or `../analytics/umami.js` if the barrel doesn't re-export it — match Task 1's outcome).
- Produces (used by Task 6 in `main.ts`):
  - `wasRescueAttempted(hashBody: string, storage?: Storage): boolean`
  - `recordRescueAttempt(hashBody: string, storage?: Storage): boolean` — `true` only if the guard verifiably persisted
  - `clearRescueAttempt(storage?: Storage): void`
  - `type RescueOutcome = ShareLinkRescueAttemptedData['outcome']`
- Note: `storage` defaults must be resolved lazily (`storage ?? sessionStorage` *inside* the function body), so importing the module never touches `sessionStorage` at module-eval time.

- [ ] **Step 1: Write the failing tests**

Create `src/pwa/share-link-rescue.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    wasRescueAttempted,
    recordRescueAttempt,
    clearRescueAttempt,
} from './share-link-rescue.js';

/** Minimal in-memory Storage stand-in. */
function fakeStorage(): Storage {
    const map = new Map<string, string>();
    return {
        get length() { return map.size; },
        clear: () => map.clear(),
        getItem: (k: string) => map.get(k) ?? null,
        key: (i: number) => [...map.keys()][i] ?? null,
        removeItem: (k: string) => { map.delete(k); },
        setItem: (k: string, v: string) => { map.set(k, v); },
    };
}

/** Storage whose writes throw (private mode / quota). */
function throwingStorage(): Storage {
    const base = fakeStorage();
    return {
        ...base,
        setItem: () => { throw new Error('quota'); },
        getItem: () => { throw new Error('quota'); },
    };
}

describe('share-link rescue guard', () => {
    it('reports no attempt for a link never recorded', () => {
        expect(wasRescueAttempted('abc', fakeStorage())).toBe(false);
    });

    it('reports an attempt only for the exact recorded link', () => {
        const storage = fakeStorage();
        expect(recordRescueAttempt('abc', storage)).toBe(true);
        expect(wasRescueAttempted('abc', storage)).toBe(true);
        // A different link gets its own fresh attempt.
        expect(wasRescueAttempted('other', storage)).toBe(false);
    });

    it('recording a new link replaces the previous guard entry', () => {
        const storage = fakeStorage();
        recordRescueAttempt('abc', storage);
        recordRescueAttempt('other', storage);
        expect(wasRescueAttempted('abc', storage)).toBe(false);
        expect(wasRescueAttempted('other', storage)).toBe(true);
    });

    it('clearRescueAttempt removes the guard entry', () => {
        const storage = fakeStorage();
        recordRescueAttempt('abc', storage);
        clearRescueAttempt(storage);
        expect(wasRescueAttempted('abc', storage)).toBe(false);
    });

    it('returns false from recordRescueAttempt when storage throws (loop-proofing)', () => {
        // If the guard cannot be persisted, the caller must NOT rescue:
        // an unpersisted guard would let a still-invalid link reload forever.
        expect(recordRescueAttempt('abc', throwingStorage())).toBe(false);
    });

    it('treats a throwing storage as "not attempted" without throwing', () => {
        expect(wasRescueAttempted('abc', throwingStorage())).toBe(false);
        expect(() => clearRescueAttempt(throwingStorage())).not.toThrow();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pwa/share-link-rescue.test.ts`
Expected: FAIL — cannot resolve `./share-link-rescue.js`.

- [ ] **Step 3: Implement the guard**

Create `src/pwa/share-link-rescue.ts`:

```ts
/**
 * Stale-client share-link rescue — when a `#p=` link fails to decode, this
 * client may simply be an old cached build that predates the link's format
 * (the share payload has historically grown without bumping `v`). This
 * module holds the two halves of the recovery flow:
 *
 * - a sessionStorage loop guard ensuring exactly one rescue attempt per
 *   link (the attempt reloads the page, so the guard is what stops a
 *   still-invalid link from reload-looping);
 * - the rescue attempt itself (added in a later task): force a
 *   service-worker update check and, if a newer build is waiting, apply it
 *   and reload with the hash intact.
 *
 * sessionStorage (not localStorage) so a stale guard can't outlive the tab
 * and suppress a legitimate future rescue after the app has genuinely
 * updated. All service-worker specifics are injected; `register.ts`
 * supplies the real ones.
 */

import type { ShareLinkRescueAttemptedData } from '../analytics/index.js';

/** How a rescue attempt ended. Single source of truth: the analytics payload. */
export type RescueOutcome = ShareLinkRescueAttemptedData['outcome'];

const GUARD_KEY = 'share-link-rescue-attempt';

/** True when a rescue reload for exactly this link body is in flight. */
export function wasRescueAttempted(hashBody: string, storage?: Storage): boolean {
    try {
        return (storage ?? sessionStorage).getItem(GUARD_KEY) === hashBody;
    } catch {
        return false;
    }
}

/**
 * Record that a rescue is being attempted for this link. Returns true only
 * when the guard verifiably persisted — callers must skip the rescue on
 * false, because an unpersisted guard would let a still-invalid link
 * reload-loop forever.
 */
export function recordRescueAttempt(hashBody: string, storage?: Storage): boolean {
    try {
        const s = storage ?? sessionStorage;
        s.setItem(GUARD_KEY, hashBody);
        return s.getItem(GUARD_KEY) === hashBody;
    } catch {
        return false;
    }
}

/** Drop the guard entry (every terminal path of the flow ends here). */
export function clearRescueAttempt(storage?: Storage): void {
    try {
        (storage ?? sessionStorage).removeItem(GUARD_KEY);
    } catch {
        // Nothing to clean up if storage is unavailable.
    }
}
```

If Task 1 did **not** re-export the payload types from `src/analytics/index.ts`, import from `../analytics/umami.js` instead.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pwa/share-link-rescue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pwa/share-link-rescue.ts src/pwa/share-link-rescue.test.ts
git commit -m "feat(pwa): add per-link session guard for share-link rescue"
```

---

### Task 3: Rescue attempt logic

**Files:**
- Modify: `src/pwa/share-link-rescue.ts` (append)
- Test: `src/pwa/share-link-rescue.test.ts` (append)

**Interfaces:**
- Consumes: `RescueOutcome` from Task 2.
- Produces (used by Task 5 in `register.ts`):

```ts
export interface RescueRegistration {
    update(): Promise<unknown> | void;
    readonly installing: unknown;
    readonly waiting: unknown;
}

export interface ShareLinkRescueDeps {
    getRegistration: () => Promise<RescueRegistration | null>;
    isUpdateReady: () => boolean;
    onUpdateReady: (handler: () => void) => () => void; // returns unsubscribe
    applyUpdate: () => void;
    timeoutMs?: number;        // default 8000
    schedule?: (handler: () => void, ms: number) => () => void; // returns cancel
}

export function attemptShareLinkRescue(deps: ShareLinkRescueDeps): Promise<RescueOutcome>;
```

- [ ] **Step 1: Write the failing tests**

Append to `src/pwa/share-link-rescue.test.ts` (extend the import to include `attemptShareLinkRescue`, and `vi` from vitest):

```ts
import { attemptShareLinkRescue, type ShareLinkRescueDeps, type RescueRegistration } from './share-link-rescue.js';
import { vi } from 'vitest';

/** Deps harness: manual control over registration, readiness, and the deadline. */
function makeDeps(overrides: Partial<ShareLinkRescueDeps> = {}) {
    const applyUpdate = vi.fn();
    let readyHandler: (() => void) | null = null;
    let fireDeadline: (() => void) | null = null;
    const deps: ShareLinkRescueDeps = {
        getRegistration: () => new Promise<RescueRegistration | null>(() => {}),
        isUpdateReady: () => false,
        onUpdateReady: (handler) => {
            readyHandler = handler;
            return () => { readyHandler = null; };
        },
        applyUpdate,
        schedule: (handler) => {
            fireDeadline = handler;
            return () => { fireDeadline = null; };
        },
        ...overrides,
    };
    return {
        deps,
        applyUpdate,
        fireReady: () => readyHandler?.(),
        fireDeadline: () => fireDeadline?.(),
        isReadySubscribed: () => readyHandler !== null,
        isDeadlineScheduled: () => fireDeadline !== null,
    };
}

function registration(overrides: Partial<RescueRegistration> = {}): RescueRegistration {
    return { update: () => Promise.resolve(), installing: null, waiting: null, ...overrides };
}

describe('attemptShareLinkRescue', () => {
    it('applies immediately when an update is already waiting', async () => {
        const h = makeDeps({ isUpdateReady: () => true });
        await expect(attemptShareLinkRescue(h.deps)).resolves.toBe('updated');
        expect(h.applyUpdate).toHaveBeenCalledTimes(1);
    });

    it('resolves no-update when the check completes with no new worker', async () => {
        const h = makeDeps({ getRegistration: () => Promise.resolve(registration()) });
        await expect(attemptShareLinkRescue(h.deps)).resolves.toBe('no-update');
        expect(h.applyUpdate).not.toHaveBeenCalled();
    });

    it('applies when the update check finds a new worker that becomes ready', async () => {
        const h = makeDeps({
            getRegistration: () => Promise.resolve(registration({ installing: {} })),
        });
        const outcome = attemptShareLinkRescue(h.deps);
        // Let getRegistration + update() settle, then simulate onNeedRefresh.
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        h.fireReady();
        await expect(outcome).resolves.toBe('updated');
        expect(h.applyUpdate).toHaveBeenCalledTimes(1);
    });

    it('resolves unavailable when there is no registration', async () => {
        const h = makeDeps({ getRegistration: () => Promise.resolve(null) });
        await expect(attemptShareLinkRescue(h.deps)).resolves.toBe('unavailable');
        expect(h.applyUpdate).not.toHaveBeenCalled();
    });

    it('resolves unavailable when the update check rejects (offline)', async () => {
        const h = makeDeps({
            getRegistration: () =>
                Promise.resolve(registration({ update: () => Promise.reject(new Error('offline')) })),
        });
        await expect(attemptShareLinkRescue(h.deps)).resolves.toBe('unavailable');
    });

    it('resolves unavailable when the deadline fires first', async () => {
        const h = makeDeps(); // getRegistration never resolves
        const outcome = attemptShareLinkRescue(h.deps);
        h.fireDeadline();
        await expect(outcome).resolves.toBe('unavailable');
        expect(h.applyUpdate).not.toHaveBeenCalled();
    });

    it('settles once: a late update-ready after the deadline does not apply', async () => {
        const h = makeDeps({
            getRegistration: () => Promise.resolve(registration({ installing: {} })),
        });
        const outcome = attemptShareLinkRescue(h.deps);
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        h.fireDeadline();
        h.fireReady();
        await expect(outcome).resolves.toBe('unavailable');
        expect(h.applyUpdate).not.toHaveBeenCalled();
    });

    it('cancels the deadline and unsubscribes after settling', async () => {
        const h = makeDeps({ getRegistration: () => Promise.resolve(registration()) });
        await attemptShareLinkRescue(h.deps);
        expect(h.isDeadlineScheduled()).toBe(false);
        expect(h.isReadySubscribed()).toBe(false);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pwa/share-link-rescue.test.ts`
Expected: new tests FAIL (`attemptShareLinkRescue` not exported); guard tests still PASS.

- [ ] **Step 3: Implement the attempt**

Append to `src/pwa/share-link-rescue.ts`:

```ts
/**
 * Minimal slice of ServiceWorkerRegistration the rescue depends on.
 * `installing` / `waiting` are only ever null-checked, hence `unknown`.
 */
export interface RescueRegistration {
    update(): Promise<unknown> | void;
    readonly installing: unknown;
    readonly waiting: unknown;
}

export interface ShareLinkRescueDeps {
    /**
     * Resolves with the SW registration once known, or null when
     * registration failed. May never resolve (no SW registered — e.g. the
     * dev server); the deadline turns that into `unavailable`.
     */
    getRegistration: () => Promise<RescueRegistration | null>;
    /** True when a new worker is already waiting (detected before the rescue). */
    isUpdateReady: () => boolean;
    /** Subscribe to "a new worker is waiting"; returns an unsubscribe. */
    onUpdateReady: (handler: () => void) => () => void;
    /** Activate the waiting update (flush + skip-waiting + reload). */
    applyUpdate: () => void;
    /** Overall deadline for the whole attempt. Defaults to 8000ms. */
    timeoutMs?: number;
    /** Injectable timer for tests; returns a cancel function. */
    schedule?: (handler: () => void, ms: number) => () => void;
}

const DEFAULT_RESCUE_TIMEOUT_MS = 8000;

/**
 * Run one update-check rescue. Resolves `updated` after calling
 * `applyUpdate` (a reload is then imminent — the caller should halt boot),
 * `no-update` when the client is already current, or `unavailable` when
 * the check can't run or the deadline expires. Never rejects.
 */
export function attemptShareLinkRescue(deps: ShareLinkRescueDeps): Promise<RescueOutcome> {
    const timeoutMs = deps.timeoutMs ?? DEFAULT_RESCUE_TIMEOUT_MS;
    const schedule =
        deps.schedule ??
        ((handler: () => void, ms: number) => {
            const id = globalThis.setTimeout(handler, ms);
            return () => globalThis.clearTimeout(id);
        });

    return new Promise((resolve) => {
        let settled = false;
        let unsubscribe: (() => void) | null = null;

        const settle = (outcome: RescueOutcome): void => {
            if (settled) return;
            settled = true;
            unsubscribe?.();
            cancelDeadline();
            if (outcome === 'updated') deps.applyUpdate();
            resolve(outcome);
        };

        const cancelDeadline = schedule(() => settle('unavailable'), timeoutMs);

        if (deps.isUpdateReady()) {
            settle('updated');
            return;
        }
        unsubscribe = deps.onUpdateReady(() => settle('updated'));

        void (async () => {
            const registration = await deps.getRegistration();
            if (settled) return;
            if (!registration) {
                settle('unavailable');
                return;
            }
            try {
                await Promise.resolve(registration.update());
            } catch {
                settle('unavailable');
                return;
            }
            if (settled) return;
            // The check resolved without starting an install and nothing is
            // waiting: this client is already the latest build. If a worker
            // IS installing/waiting, the onUpdateReady subscription (or the
            // deadline, if installation hangs) settles the attempt.
            if (!registration.installing && !registration.waiting) {
                settle('no-update');
            }
        })();
    });
}
```

Note: `cancelDeadline` is referenced inside `settle` before its `const` declaration — that's fine because `settle` only *runs* later, but if TypeScript's use-before-assign analysis complains, declare `let cancelDeadline: () => void = () => {};` before `settle` and assign after.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pwa/share-link-rescue.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/pwa/share-link-rescue.ts src/pwa/share-link-rescue.test.ts
git commit -m "feat(pwa): add update-check rescue attempt for undecodable share links"
```

---

### Task 4: `share-link-rescue` trigger in the update controller

**Files:**
- Modify: `src/analytics/umami.ts:356-358` (`PwaUpdateAppliedData.trigger` union)
- Modify: `src/pwa/update-controller.ts:61,147-149` (`reloadNow` signature)
- Test: `src/pwa/update-controller.test.ts` (append)

**Interfaces:**
- Consumes: `UpdateApplyTrigger` (already derived from `PwaUpdateAppliedData['trigger']`).
- Produces: `reloadNow(trigger?: UpdateApplyTrigger): void` (default `'manual'` — existing callers unchanged) and the widened trigger union `'focus-regain' | 'manual' | 'share-link-rescue'`. Task 5 calls `controller.reloadNow('share-link-rescue')`.

- [ ] **Step 1: Write the failing test**

Append to `src/pwa/update-controller.test.ts`, inside the main describe block (reuse the file's existing helper for building a controller with mocked deps — match local conventions):

```ts
it('reloadNow reports a supplied trigger on the applied event', () => {
    const controller = createUpdateController({
        flush: vi.fn(),
        showIndicator: vi.fn(),
        scheduleFallback: vi.fn(),
    });
    controller.setUpdateSW(vi.fn(() => Promise.resolve()));

    controller.reloadNow('share-link-rescue');

    expect(track).toHaveBeenCalledWith('pwa-update-applied', {
        trigger: 'share-link-rescue',
    });
});
```

Adapt the construction to the test file's existing setup helpers/mocks (it already mocks `track` via `vi.mock` on the analytics module — reuse that binding).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pwa/update-controller.test.ts`
Expected: the new test FAILS (TypeScript: `reloadNow` takes no arguments / trigger not in union). Existing tests PASS.

- [ ] **Step 3: Widen the union and the signature**

In `src/analytics/umami.ts`, extend the `PwaUpdateAppliedData` doc comment's trigger list to mention the new value and change:

```ts
export interface PwaUpdateAppliedData {
    trigger: 'focus-regain' | 'manual' | 'share-link-rescue';
}
```

(Doc addition: `share-link-rescue` — an undecodable `#p=` link forced an update check that found a newer build; applied automatically so the reload can re-parse the link.)

In `src/pwa/update-controller.ts`:

```ts
    /** Apply the update now (manual indicator tap, or a share-link rescue). */
    reloadNow(trigger?: UpdateApplyTrigger): void;
```

```ts
        reloadNow(trigger = 'manual') {
            apply(trigger);
        },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pwa/update-controller.test.ts src/analytics/umami.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/analytics/umami.ts src/pwa/update-controller.ts src/pwa/update-controller.test.ts
git commit -m "feat(pwa): support share-link-rescue trigger on update apply"
```

---

### Task 5: Wire the rescue into `register.ts`

**Files:**
- Modify: `src/pwa/register.ts`
- Test: `src/pwa/register.test.ts` (append)

**Interfaces:**
- Consumes: `attemptShareLinkRescue`, `RescueRegistration`, `RescueOutcome` (Task 3); `controller.reloadNow('share-link-rescue')` (Task 4); `controller.pending` (existing).
- Produces (used by Task 6): `initPwaUpdates(flush)` now returns

```ts
export interface PwaUpdates {
    /** Run the stale-client share-link rescue (see share-link-rescue.ts). */
    attemptShareLinkRescue: () => Promise<RescueOutcome>;
}
```

- [ ] **Step 1: Write the failing tests**

Append to `src/pwa/register.test.ts`:

```ts
describe('initPwaUpdates share-link rescue wiring', () => {
    it('resolves no-update when the registered SW checks clean', async () => {
        const pwa = initPwaUpdates(() => {});
        const registration = {
            update: vi.fn(() => Promise.resolve()),
            installing: null,
            waiting: null,
        };
        capturedOptions.current?.onRegisteredSW?.(
            'sw.js',
            registration as unknown as ServiceWorkerRegistration,
        );

        await expect(pwa.attemptShareLinkRescue()).resolves.toBe('no-update');
        expect(registration.update).toHaveBeenCalled();
    });

    it('resolves unavailable when registration failed', async () => {
        const pwa = initPwaUpdates(() => {});
        capturedOptions.current?.onRegisterError?.(new Error('boom'));

        await expect(pwa.attemptShareLinkRescue()).resolves.toBe('unavailable');
    });

    it('applies and resolves updated when the check surfaces a waiting worker', async () => {
        const updateSW = vi.fn(() => Promise.resolve());
        registerSW.mockImplementationOnce((options?: RegisterSWOptions) => {
            capturedOptions.current = options;
            return updateSW;
        });
        const flush = vi.fn();
        const pwa = initPwaUpdates(flush);
        const registration = {
            update: vi.fn(() => {
                // The real update() kicks off an install that ends in
                // onNeedRefresh; simulate that resolution order.
                queueMicrotask(() => capturedOptions.current?.onNeedRefresh?.());
                return Promise.resolve();
            }),
            installing: {},
            waiting: null,
        };
        capturedOptions.current?.onRegisteredSW?.(
            'sw.js',
            registration as unknown as ServiceWorkerRegistration,
        );

        await expect(pwa.attemptShareLinkRescue()).resolves.toBe('updated');
        expect(flush).toHaveBeenCalled();
        expect(updateSW).toHaveBeenCalledWith(true);
        expect(track).toHaveBeenCalledWith('pwa-update-applied', {
            trigger: 'share-link-rescue',
        });
    });
});
```

Note: the third test drives `controller.reloadNow('share-link-rescue')` through the real controller, which schedules a fallback reload via `globalThis.setTimeout` and calls `location.reload` 3s later. Under jsdom, guard against that by stubbing `location.reload` if the existing test setup doesn't already; jsdom's `location.reload` throws "Not implemented" as an *async* uncaught error — if it surfaces, add `vi.useFakeTimers()` for this test (never advancing past the fallback) or stub `reload`. Follow whatever pattern keeps the run clean.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pwa/register.test.ts`
Expected: FAIL — `initPwaUpdates` returns `void`, no `attemptShareLinkRescue` property.

- [ ] **Step 3: Implement the wiring**

Rewrite `src/pwa/register.ts` (keeping the existing header comment, extended with a note that it also supplies the rescue's SW deps):

```ts
import { registerSW } from 'virtual:pwa-register';
import {
    createUpdateController,
    setupUpdateChecks,
} from './update-controller.js';
import {
    attemptShareLinkRescue,
    type RescueOutcome,
    type RescueRegistration,
} from './share-link-rescue.js';
import { createUpdateAvailableIndicator } from '../ui/index.js';
import { track, sanitizeErrorReason } from '../analytics/index.js';
import { diagnostics } from '../diagnostics.js';

/** Handle returned to main.ts for flows that need the update machinery. */
export interface PwaUpdates {
    /**
     * Run the stale-client share-link rescue: one forced update check;
     * applies + reloads on success. See share-link-rescue.ts.
     */
    attemptShareLinkRescue: () => Promise<RescueOutcome>;
}

export function initPwaUpdates(flush: () => void): PwaUpdates {
    const controller = createUpdateController({
        flush,
        showIndicator: (onRefresh) => {
            createUpdateAvailableIndicator({ onRefresh });
        },
    });

    // Rescue deps: the registration arrives asynchronously via
    // onRegisteredSW; a rescue started before then awaits this promise
    // (bounded by the rescue's own deadline — in particular it never
    // resolves on the dev server, where no SW is registered at all).
    let resolveRegistration: (r: RescueRegistration | null) => void = () => {};
    const registrationPromise = new Promise<RescueRegistration | null>(
        (resolve) => { resolveRegistration = resolve; },
    );
    const updateReadyListeners = new Set<() => void>();

    const updateSW = registerSW({
        onNeedRefresh() {
            controller.onNeedRefresh();
            for (const listener of updateReadyListeners) listener();
        },
        onRegisteredSW(_swScriptUrl, registration) {
            if (registration) setupUpdateChecks(registration, controller);
            resolveRegistration(registration ?? null);
        },
        // (keep the existing onRegisterError comment)
        onRegisterError(error) {
            resolveRegistration(null);
            diagnostics.warn('[pwa] service worker registration failed', error);
            track('pwa-register-failed', { reason: sanitizeErrorReason(error) });
        },
    });

    controller.setUpdateSW(updateSW);

    return {
        attemptShareLinkRescue: () =>
            attemptShareLinkRescue({
                getRegistration: () => registrationPromise,
                isUpdateReady: () => controller.pending,
                onUpdateReady: (handler) => {
                    updateReadyListeners.add(handler);
                    return () => updateReadyListeners.delete(handler);
                },
                applyUpdate: () => controller.reloadNow('share-link-rescue'),
            }),
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pwa/register.test.ts`
Expected: PASS (all, including the pre-existing onRegisterError tests).

- [ ] **Step 5: Commit**

```bash
git add src/pwa/register.ts src/pwa/register.test.ts
git commit -m "feat(pwa): expose share-link rescue from initPwaUpdates"
```

---

### Task 6: Drive the rescue from `main.ts`

**Files:**
- Modify: `src/main.ts` — import block (~line 133), `initPwaUpdates` call (~line 668), `tryLoadSharedPuzzle` (~line 1459)

**Interfaces:**
- Consumes: `PwaUpdates` handle (Task 5); guard functions (Task 2); `track('share-link-rescue-attempted'|'share-link-rescue-result', …)` (Task 1); existing `showLoadingOverlay` / `hideLoadingOverlay` / `showToast`.
- Produces: end-user behaviour; no new exports.

- [ ] **Step 1: Wire the imports and handle**

In `src/main.ts`:

```ts
import { initPwaUpdates } from './pwa/register.js';
import {
    wasRescueAttempted,
    recordRescueAttempt,
    clearRescueAttempt,
} from './pwa/share-link-rescue.js';
```

Change the init call (~line 668, keep its existing comment):

```ts
const pwaUpdates = initPwaUpdates(() => debouncedSave.flush());
```

- [ ] **Step 2: Add the rescue driver and hook it into `tryLoadSharedPuzzle`**

Add above `tryLoadSharedPuzzle`:

```ts
/**
 * A `#p=` link that fails to decode may just be newer than this cached
 * build (the share format grows without bumping `v`). Run one
 * update-check-and-reload rescue per link: on success the page reloads
 * with the hash intact and the updated build re-parses it. Returns true
 * when that reload is imminent (the caller must halt the boot flow); on
 * every other outcome the caller falls through to the invalid-link toast.
 */
async function rescueUndecodableLink(hashBody: string): Promise<boolean> {
    if (wasRescueAttempted(hashBody)) {
        // This load IS the rescue reload for this exact link, and it still
        // doesn't decode: the latest build doesn't understand it either.
        clearRescueAttempt();
        track('share-link-rescue-result', { decoded: false });
        return false;
    }
    // A guard that can't be persisted would let a still-invalid link
    // reload forever; skip the rescue instead of risking the loop.
    if (!recordRescueAttempt(hashBody)) return false;
    showLoadingOverlay('Checking for app update…');
    const outcome = await pwaUpdates.attemptShareLinkRescue();
    track('share-link-rescue-attempted', { outcome });
    if (outcome === 'updated') {
        // The new worker is activating; the update-controller reloads the
        // page (with a hard-reload fallback). Keep the overlay and hash up.
        return true;
    }
    clearRescueAttempt();
    // The boot path's finally would hide it, but the hashchange path has
    // no such backstop — hide explicitly before the toast.
    hideLoadingOverlay();
    return false;
}
```

Replace the failure branch at the top of `tryLoadSharedPuzzle`:

```ts
async function tryLoadSharedPuzzle(): Promise<boolean> {
    const payload = parseLocationHash(window.location.hash);
    if (!payload) {
        if (window.location.hash.startsWith('#p=')) {
            if (await rescueUndecodableLink(window.location.hash.slice(3))) {
                // Rescue reload imminent — report "handled" so the boot
                // flow doesn't start a saved/fresh game underneath it.
                return true;
            }
            showToast('Invalid share link');
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        return false;
    }

    // The link decoded. If this load is the back half of a rescue reload,
    // close the analytics funnel: the update fixed the link. Clearing
    // unconditionally also drops any stale guard from an abandoned rescue.
    if (wasRescueAttempted(window.location.hash.slice(3))) {
        track('share-link-rescue-result', { decoded: true });
    }
    clearRescueAttempt();

    // …existing body unchanged from `const hasExistingProgress = …` on.
```

- [ ] **Step 3: Typecheck, full test suite, build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: typecheck clean; all tests PASS; build succeeds.

- [ ] **Step 4: Manual smoke check (documented, best-effort)**

The stale-build scenario can't be reproduced without two deployed versions; verify the plumbing instead:
1. `npm run dev`, open `http://localhost:5173/#p=garbage` — expect the "Checking for app update…" overlay, then after the ~8s deadline (no SW in dev) the "Invalid share link" toast, hash stripped, fresh puzzle boots. No reload loop.
2. Open a valid share link — expect unchanged behaviour, no rescue events.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: auto-update and retry undecodable share links"
```

---

### Task 7: PR

**Files:** none

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin stale-share-link-rescue
gh pr create --title "feat: auto-update and retry share links the cached build can't decode" --body "$(cat <<'EOF'
## Summary
- A `#p=` link that fails to decode now triggers one automatic service-worker update check; if a newer build is found it is applied and the page reloads with the hash intact so the new build can re-parse the link.
- A per-link sessionStorage guard makes the flow loop-proof; after the one attempt (or when no update exists) the existing "Invalid share link" toast + hash strip behaviour is unchanged.
- New analytics funnel: `share-link-rescue-attempted` (outcome) and `share-link-rescue-result` (decoded), plus a `share-link-rescue` trigger on `pwa-update-applied`.

Spec: `docs/superpowers/specs/2026-07-24-stale-client-share-link-rescue-design.md` (included in this PR).

## Testing
- Unit tests: guard, rescue attempt (update found / none / offline / timeout / no registration / late-ready), controller trigger, register wiring.
- `npx tsc --noEmit`, `npm test`, `npm run build` all clean.
- Dev-server smoke: invalid link shows the update-check overlay, then falls through to the invalid-link toast once, without a reload loop.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TD4o2ymDNxZNkoQj78saPS
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** trigger scope (Task 6 failure branch), guard + clearing rules (Tasks 2, 6), rescue outcomes incl. timeout/dev-server (Task 3, 5), automatic UX with overlay copy (Task 6), unchanged terminal toast (Task 6), hashchange path (reuses `tryLoadSharedPuzzle`; overlay hidden explicitly — Task 6), analytics funnel (Tasks 1, 4, 6), no help text (no task — deliberate), codec/controller-behaviour untouched (no edits to `share-link.ts`; controller change is additive).
- **Reload-fallback reuse:** `applyUpdate` goes through `controller.reloadNow`, which already carries the #404 fallback hard-reload — spec requirement met without new code.
- **Type consistency:** `RescueOutcome` defined once in `umami.ts` payload, derived in `share-link-rescue.ts`, consumed by `register.ts`; `reloadNow(trigger?: UpdateApplyTrigger)` matches the widened `PwaUpdateAppliedData['trigger']`.
