# PWA Deferred Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PWA reliably pick up new versions — detecting updates while open and on reopen, then applying them at a safe moment (focus-regain or a manual tap) without disrupting an in-progress puzzle.

**Architecture:** Switch `vite-plugin-pwa` from `autoUpdate` to `prompt` so the app controls *when* a new service worker activates. A pure, unit-tested `update-controller` holds the pending-update state and the flush-then-reload logic; a `setupUpdateChecks` helper wires periodic + on-visible update checks; a persistent `update-available-indicator` gives the manual fallback; a thin `register.ts` glues these to the build-time-only `virtual:pwa-register` module; `main.ts` initializes it, passing the existing autosave flush as the pre-reload hook.

**Tech Stack:** TypeScript (strict, `verbatimModuleSyntax`, `erasableSyntaxOnly`), Vite 8, `vite-plugin-pwa` 1.2, Vitest 4 (default `node` env; `jsdom` opt-in per-file via `@vitest-environment` docblock).

## Global Constraints

- American English in all code identifiers, comments, and copy (e.g. `behavior`, `center`).
- Tests live next to the source they test (`foo.ts` → `foo.test.ts`).
- `verbatimModuleSyntax` is on: use `import type` (or inline `type` modifiers) for type-only imports.
- `noUnusedLocals` / `noUnusedParameters` are on: prefix intentionally-unused params with `_`.
- This feature consumes **no** seeded `random()` — the PRNG reproducibility contract is not touched.
- No info-modal/help-text change (decided in the spec: the indicator is self-explanatory).
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

### Task 1: Update controller + check scheduling

**Files:**
- Create: `src/pwa/update-controller.ts`
- Test: `src/pwa/update-controller.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `interface UpdatableRegistration { update(): Promise<unknown> | void }`
  - `interface UpdateControllerDeps { flush: () => void; showIndicator: (onRefresh: () => void) => void }`
  - `interface UpdateController { onNeedRefresh(): void; setUpdateSW(updateSW: (reload?: boolean) => Promise<void>): void; requestReloadIfPending(): void; reloadNow(): void; readonly pending: boolean }`
  - `function createUpdateController(deps: UpdateControllerDeps): UpdateController`
  - `interface UpdateCheckDeps { pollIntervalMs?: number; setInterval?: (handler: () => void, ms: number) => unknown; addVisibilityListener?: (handler: () => void) => void; isVisible?: () => boolean }`
  - `function setupUpdateChecks(registration: UpdatableRegistration, controller: UpdateController, deps?: UpdateCheckDeps): void`

- [ ] **Step 1: Write the failing tests**

Create `src/pwa/update-controller.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
    createUpdateController,
    setupUpdateChecks,
    type UpdateController,
} from './update-controller.js';

describe('createUpdateController', () => {
    it('is not pending before any refresh is needed', () => {
        const controller = createUpdateController({
            flush: vi.fn(),
            showIndicator: vi.fn(),
        });
        expect(controller.pending).toBe(false);
    });

    it('marks pending and shows the indicator on onNeedRefresh', () => {
        const showIndicator = vi.fn();
        const controller = createUpdateController({ flush: vi.fn(), showIndicator });
        controller.onNeedRefresh();
        expect(controller.pending).toBe(true);
        expect(showIndicator).toHaveBeenCalledOnce();
    });

    it('reloadNow flushes before calling updateSW(true)', () => {
        const flush = vi.fn();
        const updateSW = vi.fn().mockResolvedValue(undefined);
        const controller = createUpdateController({ flush, showIndicator: vi.fn() });
        controller.setUpdateSW(updateSW);
        controller.reloadNow();
        expect(flush).toHaveBeenCalledOnce();
        expect(updateSW).toHaveBeenCalledWith(true);
        expect(flush.mock.invocationCallOrder[0]).toBeLessThan(
            updateSW.mock.invocationCallOrder[0],
        );
    });

    it('reloadNow is a no-op when updateSW is not set yet', () => {
        const flush = vi.fn();
        const controller = createUpdateController({ flush, showIndicator: vi.fn() });
        controller.reloadNow();
        expect(flush).not.toHaveBeenCalled();
    });

    it('requestReloadIfPending reloads only when pending', () => {
        const updateSW = vi.fn().mockResolvedValue(undefined);
        const controller = createUpdateController({ flush: vi.fn(), showIndicator: vi.fn() });
        controller.setUpdateSW(updateSW);

        controller.requestReloadIfPending();
        expect(updateSW).not.toHaveBeenCalled();

        controller.onNeedRefresh();
        controller.requestReloadIfPending();
        expect(updateSW).toHaveBeenCalledWith(true);
    });

    it('the indicator callback applies the update', () => {
        const updateSW = vi.fn().mockResolvedValue(undefined);
        let captured: (() => void) | null = null;
        const controller = createUpdateController({
            flush: vi.fn(),
            showIndicator: (onRefresh) => {
                captured = onRefresh;
            },
        });
        controller.setUpdateSW(updateSW);
        controller.onNeedRefresh();
        captured!();
        expect(updateSW).toHaveBeenCalledWith(true);
    });
});

function fakeController(): UpdateController {
    return {
        onNeedRefresh: vi.fn(),
        setUpdateSW: vi.fn(),
        requestReloadIfPending: vi.fn(),
        reloadNow: vi.fn(),
        pending: false,
    } as unknown as UpdateController;
}

describe('setupUpdateChecks', () => {
    it('polls registration.update on the interval', () => {
        const registration = { update: vi.fn() };
        const controller = fakeController();
        let intervalFn: (() => void) | null = null;
        setupUpdateChecks(registration, controller, {
            pollIntervalMs: 1000,
            setInterval: (fn) => {
                intervalFn = fn;
                return 0;
            },
            addVisibilityListener: () => {},
            isVisible: () => true,
        });
        expect(registration.update).not.toHaveBeenCalled();
        intervalFn!();
        expect(registration.update).toHaveBeenCalledOnce();
    });

    it('on visible: checks for an update and requests reload-if-pending', () => {
        const registration = { update: vi.fn() };
        const controller = fakeController();
        let visHandler: (() => void) | null = null;
        setupUpdateChecks(registration, controller, {
            setInterval: () => 0,
            addVisibilityListener: (fn) => {
                visHandler = fn;
            },
            isVisible: () => true,
        });
        visHandler!();
        expect(registration.update).toHaveBeenCalledOnce();
        expect(controller.requestReloadIfPending).toHaveBeenCalledOnce();
    });

    it('ignores visibility changes when not visible', () => {
        const registration = { update: vi.fn() };
        const controller = fakeController();
        let visHandler: (() => void) | null = null;
        setupUpdateChecks(registration, controller, {
            setInterval: () => 0,
            addVisibilityListener: (fn) => {
                visHandler = fn;
            },
            isVisible: () => false,
        });
        visHandler!();
        expect(registration.update).not.toHaveBeenCalled();
        expect(controller.requestReloadIfPending).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pwa/update-controller.test.ts`
Expected: FAIL — cannot resolve `./update-controller.js` / exports not defined.

- [ ] **Step 3: Write the implementation**

Create `src/pwa/update-controller.ts`:

```ts
/**
 * PWA update controller — decides *when* a freshly-built service worker is
 * applied, without disrupting an in-progress puzzle.
 *
 * The controller holds no DOM or service-worker references of its own; every
 * side effect (flushing the autosave, activating the new SW, showing the
 * indicator) is injected, which keeps the decision logic unit-testable.
 */

/** Minimal slice of ServiceWorkerRegistration we depend on. */
export interface UpdatableRegistration {
    update(): Promise<unknown> | void;
}

export interface UpdateControllerDeps {
    /** Flush any pending autosave before the page reloads. */
    flush: () => void;
    /**
     * Render the persistent "update ready" indicator. The supplied callback
     * applies the update (reload) when the user taps it.
     */
    showIndicator: (onRefresh: () => void) => void;
}

export interface UpdateController {
    /** A new service worker is waiting — remember it and surface the indicator. */
    onNeedRefresh(): void;
    /** Supply the `updateSW` function returned by `registerSW`. */
    setUpdateSW(updateSW: (reload?: boolean) => Promise<void>): void;
    /** Apply the update only if one is pending (e.g. on focus regain). */
    requestReloadIfPending(): void;
    /** Apply the update now (manual indicator tap). */
    reloadNow(): void;
    /** Whether an update is currently waiting to be applied. */
    readonly pending: boolean;
}

export function createUpdateController(
    deps: UpdateControllerDeps,
): UpdateController {
    let pending = false;
    let updateSW: ((reload?: boolean) => Promise<void>) | null = null;

    function reloadNow(): void {
        // Without the updateSW handle there is no waiting worker to activate.
        if (!updateSW) return;
        deps.flush();
        void updateSW(true);
    }

    return {
        onNeedRefresh() {
            pending = true;
            deps.showIndicator(reloadNow);
        },
        setUpdateSW(fn) {
            updateSW = fn;
        },
        requestReloadIfPending() {
            if (pending) reloadNow();
        },
        reloadNow,
        get pending() {
            return pending;
        },
    };
}

const DEFAULT_POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export interface UpdateCheckDeps {
    pollIntervalMs?: number;
    setInterval?: (handler: () => void, ms: number) => unknown;
    addVisibilityListener?: (handler: () => void) => void;
    isVisible?: () => boolean;
}

/**
 * Wire up update detection for a registered service worker:
 * - poll `registration.update()` on an interval while the app is open;
 * - on every visibility → visible, check for an update (catches "reopened
 *   from the home screen") and apply any already-pending update.
 */
export function setupUpdateChecks(
    registration: UpdatableRegistration,
    controller: UpdateController,
    deps: UpdateCheckDeps = {},
): void {
    const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const setIntervalFn =
        deps.setInterval ??
        ((handler: () => void, ms: number) => globalThis.setInterval(handler, ms));
    const isVisible =
        deps.isVisible ?? (() => document.visibilityState === 'visible');
    const addVisibilityListener =
        deps.addVisibilityListener ??
        ((handler: () => void) =>
            document.addEventListener('visibilitychange', handler));

    setIntervalFn(() => {
        void registration.update();
    }, pollIntervalMs);

    addVisibilityListener(() => {
        if (!isVisible()) return;
        void registration.update();
        controller.requestReloadIfPending();
    });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/pwa/update-controller.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/pwa/update-controller.ts src/pwa/update-controller.test.ts
git commit -m "feat: add PWA update controller and check scheduling

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Update-available indicator (UI + CSS)

**Files:**
- Create: `src/ui/update-available-indicator.ts`
- Test: `src/ui/update-available-indicator.test.ts`
- Modify: `src/style.css` (add `.update-available-indicator` rule after the `.app-toast` block, ~line 1369)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `interface UpdateAvailableIndicatorOptions { onRefresh: () => void }`
  - `function createUpdateAvailableIndicator(options: UpdateAvailableIndicatorOptions): () => void` (returns a cleanup that removes the element)

- [ ] **Step 1: Write the failing tests**

Create `src/ui/update-available-indicator.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUpdateAvailableIndicator } from './update-available-indicator.js';

describe('createUpdateAvailableIndicator', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('renders a persistent indicator button with refresh copy', () => {
        createUpdateAvailableIndicator({ onRefresh: vi.fn() });
        const el = document.querySelector('.update-available-indicator');
        expect(el).not.toBeNull();
        expect(el!.tagName).toBe('BUTTON');
        expect(el!.textContent).toBe('Update ready — tap to refresh');
    });

    it('calls onRefresh when tapped', () => {
        const onRefresh = vi.fn();
        createUpdateAvailableIndicator({ onRefresh });
        document
            .querySelector<HTMLButtonElement>('.update-available-indicator')!
            .click();
        expect(onRefresh).toHaveBeenCalledOnce();
    });

    it('keeps only one indicator at a time', () => {
        createUpdateAvailableIndicator({ onRefresh: vi.fn() });
        createUpdateAvailableIndicator({ onRefresh: vi.fn() });
        expect(
            document.querySelectorAll('.update-available-indicator').length,
        ).toBe(1);
    });

    it('cleanup removes the indicator', () => {
        const cleanup = createUpdateAvailableIndicator({ onRefresh: vi.fn() });
        cleanup();
        expect(
            document.querySelector('.update-available-indicator'),
        ).toBeNull();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/update-available-indicator.test.ts`
Expected: FAIL — cannot resolve `./update-available-indicator.js`.

- [ ] **Step 3: Write the implementation**

Create `src/ui/update-available-indicator.ts`:

```ts
/**
 * Persistent "update ready" indicator. Unlike `showToast`, this does not
 * auto-dismiss — it stays until the user taps it (which reloads into the new
 * version) or the page reloads on its own (e.g. on focus regain).
 */

export interface UpdateAvailableIndicatorOptions {
    /** Invoked when the user taps the indicator. */
    onRefresh: () => void;
}

const INDICATOR_CLASS = 'update-available-indicator';

/**
 * Show the indicator. Returns a cleanup function that removes it. Only one
 * indicator exists at a time.
 */
export function createUpdateAvailableIndicator(
    options: UpdateAvailableIndicatorOptions,
): () => void {
    document
        .querySelectorAll(`.${INDICATOR_CLASS}`)
        .forEach((el) => el.remove());

    const indicator = document.createElement('button');
    indicator.className = INDICATOR_CLASS;
    indicator.type = 'button';
    indicator.textContent = 'Update ready — tap to refresh';
    indicator.addEventListener('click', () => options.onRefresh());

    document.body.appendChild(indicator);

    return () => indicator.remove();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/update-available-indicator.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the CSS**

In `src/style.css`, immediately after the `@keyframes app-toast-in { ... }` block (around line 1369), add:

```css
/* Persistent "update ready" indicator. Reuses the toast look but is a real
   button (clickable, no auto-dismiss). Tapping reloads into the new version. */
.update-available-indicator {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 20px;
  background: var(--ui-toast-bg);
  color: #fff;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  z-index: 10002;
  animation: app-toast-in 180ms ease-out;
}
```

- [ ] **Step 6: Re-run the indicator tests (CSS must not break them)**

Run: `npx vitest run src/ui/update-available-indicator.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/update-available-indicator.ts src/ui/update-available-indicator.test.ts src/style.css
git commit -m "feat: add persistent update-available indicator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Build-time glue, config switch, and app wiring

This task has no unit test of its own — `register.ts` is thin glue over the
build-time-only `virtual:pwa-register` module, and its logic is already covered
by Task 1's tests. Its deliverable is verified by a clean `tsc` typecheck +
`vite build` and the full existing test suite still passing.

**Files:**
- Create: `src/pwa/register.ts`
- Modify: `tsconfig.json` (add `vite-plugin-pwa/client` to `compilerOptions.types`)
- Modify: `vite.config.ts` (`registerType: 'autoUpdate'` → `'prompt'`)
- Modify: `src/main.ts` (import + call `initPwaUpdates`)

**Interfaces:**
- Consumes:
  - `createUpdateController`, `setupUpdateChecks` from `src/pwa/update-controller.ts` (Task 1)
  - `createUpdateAvailableIndicator` from `src/ui/update-available-indicator.ts` (Task 2)
  - `debouncedSave.flush` from `src/main.ts` (existing, defined ~line 651)
- Produces:
  - `function initPwaUpdates(flush: () => void): void`

- [ ] **Step 1: Add the PWA client types to tsconfig**

In `tsconfig.json`, change:

```json
    "types": ["vite/client"],
```

to:

```json
    "types": ["vite/client", "vite-plugin-pwa/client"],
```

This declares the `virtual:pwa-register` module so `tsc` can typecheck the import in the next step.

- [ ] **Step 2: Create the glue module**

Create `src/pwa/register.ts`:

```ts
/**
 * Wires service-worker update handling for the PWA. Kept as thin glue: all
 * decision logic lives in `update-controller.ts` (unit-tested) and the
 * indicator UI in `ui/update-available-indicator.ts`. `virtual:pwa-register`
 * is provided by vite-plugin-pwa and only exists at build time, so this file
 * is intentionally not imported from the `pwa/index.ts` barrel (that would
 * pull the virtual module into unit tests).
 */

import { registerSW } from 'virtual:pwa-register';
import {
    createUpdateController,
    setupUpdateChecks,
} from './update-controller.js';
import { createUpdateAvailableIndicator } from '../ui/update-available-indicator.js';

/**
 * Initialize PWA update handling.
 *
 * @param flush  Flush pending autosave before any reload, so a change made
 *               within the autosave debounce window survives the version
 *               switch.
 */
export function initPwaUpdates(flush: () => void): void {
    const controller = createUpdateController({
        flush,
        showIndicator: (onRefresh) => {
            createUpdateAvailableIndicator({ onRefresh });
        },
    });

    const updateSW = registerSW({
        onNeedRefresh() {
            controller.onNeedRefresh();
        },
        onRegisteredSW(_swScriptUrl, registration) {
            if (registration) setupUpdateChecks(registration, controller);
        },
    });

    controller.setUpdateSW(updateSW);
}
```

- [ ] **Step 3: Switch the plugin to prompt mode**

In `vite.config.ts`, inside the `VitePWA({ ... })` options, change:

```ts
      registerType: 'autoUpdate',
```

to:

```ts
      registerType: 'prompt',
```

Leave `manifest`, `workbox.navigateFallbackDenylist`, and everything else unchanged. (`injectRegister` stays at its default `'auto'`, which detects the `registerSW` import in `register.ts` and skips auto-injecting a second registration.)

- [ ] **Step 4: Wire it into the app entry**

In `src/main.ts`, add the import alongside the other local imports near the top (e.g. just after the `./pwa`-adjacent or persistence imports):

```ts
import { initPwaUpdates } from './pwa/register.js';
```

Then, immediately after the existing `pagehide` / `visibilitychange → hidden` flush listeners (the block ending at `src/main.ts:671`), add:

```ts
// Keep the installed PWA current: detect new versions while open and on
// reopen, and apply them at a safe moment (focus regain or a manual tap).
// `debouncedSave.flush` runs first so progress within the debounce window
// survives the reload.
initPwaUpdates(() => debouncedSave.flush());
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run build`
Expected: PASS — `tsc` reports no errors (virtual module resolves via the added type) and `vite build` completes, emitting a service worker.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — all existing tests plus the new Task 1 / Task 2 tests. No test imports `register.ts` or `main.ts`, so the `virtual:pwa-register` module is never loaded in vitest.

- [ ] **Step 7: Commit**

```bash
git add src/pwa/register.ts tsconfig.json vite.config.ts src/main.ts
git commit -m "feat: apply PWA updates on reopen via prompt-mode registration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- Periodic (~60 min) update check → `setupUpdateChecks` interval (Task 1). ✓
- Check on `visibilitychange → visible` → `setupUpdateChecks` visibility listener (Task 1). ✓
- Don't reload immediately; mark pending + show indicator → `onNeedRefresh` (Task 1) + indicator (Task 2). ✓
- Reload on focus regain when pending → `requestReloadIfPending` called from the visibility listener (Task 1). ✓
- Manual reload via indicator → `createUpdateAvailableIndicator` → `reloadNow` (Tasks 1, 2). ✓
- `registerType` `'autoUpdate'` → `'prompt'` (Task 3). ✓
- Flush autosave before reload → `reloadNow` calls `deps.flush()` first; wired to `debouncedSave.flush` (Tasks 1, 3). ✓
- Help text intentionally unchanged → no task; stated in Global Constraints. ✓
- Tests for controller + indicator, with `virtual:pwa-register` never loaded in tests → Tasks 1, 2; register.ts kept out of the barrel (Task 3). ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. ✓

**3. Type consistency:** `createUpdateController`, `setupUpdateChecks`, `UpdateController`, `UpdatableRegistration`, `createUpdateAvailableIndicator`, `initPwaUpdates`, and `updateSW(reload?: boolean) => Promise<void>` are used identically across tasks. The indicator class string `update-available-indicator` matches between the component, its tests, and the CSS rule. ✓
