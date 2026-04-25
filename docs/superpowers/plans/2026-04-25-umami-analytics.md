# Umami Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lightweight, privacy-friendly usage tracking to the puzzle app via Umami Cloud. Pageviews are automatic; three custom events (`new-game-started`, `puzzle-completed`, `puzzle-shared`) carry puzzle metadata.

**Architecture:** A single thin wrapper module under `src/analytics/` injects the Umami script (gated by a build-time env var) and exposes a typed `track()` function. Event payloads are typed via TypeScript overloads. A module-local cache in `main.ts` carries new-game metadata forward so `puzzle-completed` can include source/category/vibrant on the same-session-completion path. Localhost stays silent (env var unset); PR-preview and production each get their own Umami "website" via separate GitHub-Actions secrets.

**Tech Stack:** Vite + TypeScript, vitest with jsdom for tests, Umami Cloud `script.js`, GitHub Actions for build-time env var injection.

**Spec:** `docs/superpowers/specs/2026-04-25-umami-analytics-design.md`

---

## File Structure

**Create:**
- `src/analytics/umami.ts` — `initAnalytics()`, `track()`, all event types, ambient `Window.umami` declaration. Single-purpose module.
- `src/analytics/umami.test.ts` — vitest jsdom tests for `initAnalytics` (script-tag injection / no-op) and `track` (calls `window.umami.track` / silent when undefined).
- `src/analytics/index.ts` — barrel re-export, matching the pattern used by `src/persistence/index.ts`, `src/sharing/index.ts`, etc.

**Modify:**
- `src/main.ts` — call `initAnalytics()` once at startup; fire `new-game-started` (fresh) inside `startNewGame`; fire `new-game-started` (shared) inside `loadSharedPuzzle` (taking `recipientHadSavedState` as a new arg from `tryLoadSharedPuzzle`); fire `puzzle-completed` in the `onDrop` win branch; fire `puzzle-shared` in the completion-overlay share-button handler. Holds the `currentGameAnalytics` module-local cache.
- `src/ui/share-section.ts` — fire `puzzle-shared` (`source: 'info-modal'`) in the share-button click handler.
- `.github/workflows/deploy.yml` — add `VITE_UMAMI_WEBSITE_ID: ${{ secrets.UMAMI_WEBSITE_ID_PROD }}` to the build step's `env:`.
- `.github/workflows/deploy-preview.yml` — same, with `UMAMI_WEBSITE_ID_DEV`.

No persistence schema bump. The `currentGameAnalytics` cache is session-scoped on purpose — for resumed-then-completed games, optional fields are simply omitted from the completion event.

---

## Conventions to follow

- 4-space indentation (matches existing files).
- Test files use `@vitest-environment jsdom` directive at top when DOM access is needed (matches `src/persistence/storage.test.ts`).
- Imports use `.js` extensions on TS source paths (matches `tsconfig.json` `allowImportingTsExtensions: true`).
- Env vars accessed as `import.meta.env.VITE_X as string | undefined` (matches `src/images/unsplash.ts:177` and `src/main.ts:91`).
- Module-level barrel `index.ts` re-exports the public surface (matches the rest of `src/`).
- Conventional Commits style for messages (matches recent history: `feat(...)`, `fix(...)`, `docs(...)`).

---

## Task 1: Wrapper module — types, `track()`, `initAnalytics()`

**Files:**
- Create: `src/analytics/umami.ts`
- Test: `src/analytics/umami.test.ts`

This task is TDD: tests first, then implementation.

- [ ] **Step 1: Write the failing tests**

Create `src/analytics/umami.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initAnalytics, track } from './umami.js';

describe('initAnalytics', () => {
    beforeEach(() => {
        document.head.replaceChildren();
        vi.unstubAllEnvs();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('does nothing when VITE_UMAMI_WEBSITE_ID is unset', () => {
        vi.stubEnv('VITE_UMAMI_WEBSITE_ID', '');

        initAnalytics();

        expect(document.head.querySelectorAll('script').length).toBe(0);
    });

    it('injects the Umami script with website id and default URL when env var is set', () => {
        vi.stubEnv('VITE_UMAMI_WEBSITE_ID', 'abc-123');
        vi.stubEnv('VITE_UMAMI_SCRIPT_URL', '');

        initAnalytics();

        const scripts = document.head.querySelectorAll('script');
        expect(scripts.length).toBe(1);
        expect(scripts[0].src).toBe('https://cloud.umami.is/script.js');
        expect(scripts[0].dataset.websiteId).toBe('abc-123');
        expect(scripts[0].defer).toBe(true);
    });

    it('honours VITE_UMAMI_SCRIPT_URL override when provided', () => {
        vi.stubEnv('VITE_UMAMI_WEBSITE_ID', 'abc-123');
        vi.stubEnv('VITE_UMAMI_SCRIPT_URL', 'https://my-proxy.example/script.js');

        initAnalytics();

        const script = document.head.querySelector('script')!;
        expect(script.src).toBe('https://my-proxy.example/script.js');
    });
});

describe('track', () => {
    beforeEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
    });

    it('calls window.umami.track with name and data when umami is defined', () => {
        const umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = {
            track: umamiTrack,
        };

        track('new-game-started', {
            source: 'fresh',
            cutStyle: 'classic',
            rotationMode: 'none',
            cols: 8,
            rows: 6,
            pieceCount: 48,
            imageSource: 'unsplash',
        });

        expect(umamiTrack).toHaveBeenCalledOnce();
        expect(umamiTrack).toHaveBeenCalledWith('new-game-started', {
            source: 'fresh',
            cutStyle: 'classic',
            rotationMode: 'none',
            cols: 8,
            rows: 6,
            pieceCount: 48,
            imageSource: 'unsplash',
        });
    });

    it('is silent when window.umami is undefined', () => {
        expect(() => {
            track('puzzle-shared', {
                source: 'completion-overlay',
                includesProgress: false,
            });
        }).not.toThrow();
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run src/analytics/umami.test.ts
```

Expected: failure — `Cannot find module './umami.js'` (or similar — the file doesn't exist yet).

- [ ] **Step 3: Implement the module**

Create `src/analytics/umami.ts`:

```ts
/**
 * Umami analytics wrapper.
 *
 * Injects the Umami tracking script at startup (when configured) and
 * exposes a typed `track()` function for custom events. Both functions
 * are no-ops when:
 * - `VITE_UMAMI_WEBSITE_ID` is unset (e.g. localhost), or
 * - the Umami script hasn't loaded / has been blocked by an ad-blocker.
 *
 * Event schema lives here as the single source of truth.
 */

declare global {
    interface Window {
        umami?: {
            track: (eventName: string, eventData?: Record<string, unknown>) => void;
        };
    }
}

const DEFAULT_SCRIPT_URL = 'https://cloud.umami.is/script.js';

/**
 * Data attached to `new-game-started`.
 *
 * `source` records how the puzzle started (fresh new-game vs. opening a
 * shared link). The image-related fields and the share-recipient fields
 * are conditionally populated — see the spec for details.
 */
export interface NewGameData {
    source: 'fresh' | 'shared';
    cutStyle: string;
    rotationMode: 'none' | 'quarter-turn';
    cols: number;
    rows: number;
    pieceCount: number;
    imageSource?: string;
    imageCategory?: string;
    vibrant?: boolean;
    includesProgress?: boolean;
    recipientHadSavedState?: boolean;
}

/**
 * Data attached to `puzzle-completed`.
 *
 * Same field names as `NewGameData`, but every field outside the
 * puzzle-shape core is optional — for resumed-then-completed games we
 * only know the puzzle's geometry, not how it was originally started.
 */
export type PuzzleCompletedData = Pick<
    NewGameData,
    'cutStyle' | 'rotationMode' | 'cols' | 'rows' | 'pieceCount'
> &
    Partial<NewGameData>;

/** Data attached to `puzzle-shared`. */
export interface PuzzleSharedData {
    source: 'completion-overlay' | 'info-modal';
    includesProgress: boolean;
}

/**
 * Inject the Umami tracking script if a website ID is configured.
 *
 * Safe to call multiple times — but should be called exactly once,
 * early in app startup, before any rendering.
 */
export function initAnalytics(): void {
    const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID as string | undefined;
    if (!websiteId) {
        return;
    }

    const scriptUrl =
        (import.meta.env.VITE_UMAMI_SCRIPT_URL as string | undefined) ||
        DEFAULT_SCRIPT_URL;

    const script = document.createElement('script');
    script.defer = true;
    script.src = scriptUrl;
    script.dataset.websiteId = websiteId;
    document.head.appendChild(script);
}

/**
 * Send a typed analytics event.
 *
 * Drops the call silently when `window.umami` is undefined (script
 * hasn't loaded, is blocked, or analytics aren't configured for this
 * build). Never throws.
 */
export function track(name: 'new-game-started', data: NewGameData): void;
export function track(name: 'puzzle-completed', data: PuzzleCompletedData): void;
export function track(name: 'puzzle-shared', data: PuzzleSharedData): void;
export function track(name: string, data: Record<string, unknown>): void {
    window.umami?.track(name, data);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx vitest run src/analytics/umami.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Add the barrel re-export**

Create `src/analytics/index.ts`:

```ts
export { initAnalytics, track } from './umami.js';
export type { NewGameData, PuzzleCompletedData, PuzzleSharedData } from './umami.js';
```

- [ ] **Step 6: Verify the build still passes**

```bash
npm run build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/analytics/
git commit -m "$(cat <<'EOF'
feat(analytics): add Umami wrapper module with typed track API

Self-contained wrapper that injects the Umami tracking script when
VITE_UMAMI_WEBSITE_ID is set and exposes a typed track() function for
the three puzzle-lifecycle events. Both functions degrade to a silent
no-op when analytics aren't configured or the Umami script is blocked.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Initialize analytics at app startup

**Files:**
- Modify: `src/main.ts` (add import + one call near top)

- [ ] **Step 1: Add the import**

Open `src/main.ts`. After the existing imports (the last one is `} from './ui/loading-overlay.js';`), add:

```ts
import { initAnalytics } from './analytics/index.js';
```

- [ ] **Step 2: Call `initAnalytics()` at startup**

Find the block that registers the version display:

```ts
// Display app version in bottom-right corner.
// Injected at build time by the deploy workflow via VITE_APP_VERSION.
const appVersion = import.meta.env.VITE_APP_VERSION as string | undefined;
```

Insert this line *immediately before* the `const appVersion` line:

```ts
initAnalytics();
```

The placement is deliberate: after `app` is queried but before any rendering or game-state setup, so the script can start downloading in parallel with the rest of bootstrapping.

- [ ] **Step 3: Verify the build still passes**

```bash
npm run build
```

Expected: build succeeds. (Tests don't touch `main.ts` so no test run required here.)

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "$(cat <<'EOF'
feat(analytics): inject Umami tracking script at startup

Call initAnalytics() once during boot so pageviews are recorded and the
window.umami.track function is available for subsequent custom events.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Cache + fire `new-game-started` (fresh path)

**Files:**
- Modify: `src/main.ts`

Adds the module-local analytics cache and the first event call site. The fresh path doesn't need any helpers — the dialog hands us `imageSource`, `imageCategory`, and `vibrant` directly, so we just shape them into a `NewGameData` payload.

- [ ] **Step 1: Extend the analytics import**

In `src/main.ts`, extend the analytics import added in Task 2 to also pull in `track` and the `NewGameData` type:

```ts
import { initAnalytics, track } from './analytics/index.js';
import type { NewGameData } from './analytics/index.js';
```

- [ ] **Step 2: Add the cache**

Find the `let gameState: GameState;` declaration (around line 166). Insert this block *immediately before* it:

```ts
/**
 * Analytics metadata for the currently-playing puzzle.
 *
 * Populated when a puzzle starts (fresh or shared). Stays null when
 * the user resumes a previous session from localStorage — in that
 * case `puzzle-completed` falls back to deriving fields from
 * gameState alone.
 */
let currentGameAnalytics: NewGameData | null = null;
```

- [ ] **Step 3: Fire `new-game-started` inside `startNewGame`**

In `src/main.ts`, find this block inside `startNewGame()` (around lines 631-638):

```ts
        if (attribution) {
            state.attribution = attribution;
        }

        initGame(state);
        gatherAndZoomToFit();
        renderer.renderState(gameState);
        autoSave();
    } finally {
        hideLoadingOverlay();
    }
```

Replace it with:

```ts
        if (attribution) {
            state.attribution = attribution;
        }

        initGame(state);
        gatherAndZoomToFit();
        renderer.renderState(gameState);
        autoSave();

        const data: NewGameData = {
            source: 'fresh',
            cutStyle,
            rotationMode,
            cols: gridSize.cols,
            rows: gridSize.rows,
            pieceCount: state.pieces.length,
            imageSource: imageSource ?? 'unsplash',
        };
        if (data.imageSource === 'unsplash') {
            data.imageCategory = imageCategory ?? 'any';
            data.vibrant = vibrant;
        }
        currentGameAnalytics = data;
        track('new-game-started', data);
    } finally {
        hideLoadingOverlay();
    }
```

Notes on the values:
- `cutStyle` and `rotationMode` are already in scope as local consts/parameters.
- `imageSource ?? 'unsplash'` — when the dialog doesn't pass a source, the function falls through to the Unsplash fetch path, so `'unsplash'` is the honest default.
- `imageCategory ?? 'any'` mirrors the same default `findImageCategory(imageCategory ?? 'any')` already uses inside the function.
- `imageCategory` and `vibrant` only attach when the source is `'unsplash'` because they're meaningless for `'blank'` or `'fallback'`.

- [ ] **Step 4: Verify the build still passes**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Manual sanity check**

```bash
VITE_UMAMI_WEBSITE_ID=test-id npm run dev
```

Open the dev URL, click New Game, start a puzzle. Open DevTools → Network tab and confirm:
1. `script.js` from `cloud.umami.is` is requested at boot.
2. After clicking Start, an `api/send` request is made with `name: "new-game-started"` in the JSON body and the expected fields (cutStyle, cols, rows, etc.) under `data:`.

Then stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "$(cat <<'EOF'
feat(analytics): track new-game-started on fresh puzzles

Captures cut style, grid dims, image source/category/vibrant on the
fresh new-game path and stashes the payload for the eventual
puzzle-completed event.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Image-source helper + fire `new-game-started` (shared path)

**Files:**
- Modify: `src/main.ts`

Adds `classifyImageSource` (URL → `'unsplash' | 'blank' | 'fallback'`) and uses it for the shared-load event. We also thread `recipientHadSavedState` through `loadSharedPuzzle` as a new parameter — `tryLoadSharedPuzzle` already computes that boolean for the existing "lose progress?" prompt, so this is free.

- [ ] **Step 1: Add the `classifyImageSource` helper**

In `src/main.ts`, find the `currentGameAnalytics` declaration added in Task 3. Insert this helper *immediately after* it:

```ts
/**
 * Heuristically classify a puzzle image URL into one of the three
 * sources we care about for analytics. Used when the puzzle origin
 * (a share payload, or a resumed save) only carries the URL — not
 * the choice that produced it.
 */
function classifyImageSource(imageUrl: string): 'unsplash' | 'blank' | 'fallback' {
    if (imageUrl.startsWith('data:')) {
        return 'blank';
    }
    try {
        const host = new URL(imageUrl, window.location.href).host;
        if (host === 'images.unsplash.com') {
            return 'unsplash';
        }
    } catch {
        // Fall through to 'fallback' on malformed URLs.
    }
    return 'fallback';
}
```

- [ ] **Step 2: Update the `loadSharedPuzzle` signature**

Find `async function loadSharedPuzzle(payload: SharePayload): Promise<void> {` (around line 792) and change it to accept a second argument:

```ts
async function loadSharedPuzzle(
    payload: SharePayload,
    recipientHadSavedState: boolean,
): Promise<void> {
```

- [ ] **Step 3: Fire `new-game-started` inside `loadSharedPuzzle`**

In the same function, find this block (around lines 848-854):

```ts
        initGame(state);
        gatherAndZoomToFit();
        renderer.renderState(gameState);
        autoSave();
    } finally {
        hideLoadingOverlay();
    }
```

Replace it with:

```ts
        initGame(state);
        gatherAndZoomToFit();
        renderer.renderState(gameState);
        autoSave();

        const data: NewGameData = {
            source: 'shared',
            cutStyle: state.cutStyle ?? 'classic',
            rotationMode: state.rotationMode ?? 'none',
            cols: state.gridSize.cols,
            rows: state.gridSize.rows,
            pieceCount: state.pieces.length,
            imageSource: classifyImageSource(state.imageUrl),
            includesProgress: payload.pr !== undefined,
            recipientHadSavedState,
        };
        currentGameAnalytics = data;
        track('new-game-started', data);
    } finally {
        hideLoadingOverlay();
    }
```

Notes on the values:
- `payload.pr !== undefined` is the same condition that already gates the existing `applyProgress(state, payload.pr)` call.
- `imageCategory` and `vibrant` are intentionally absent — they aren't recoverable from the share payload.

- [ ] **Step 4: Update the caller in `tryLoadSharedPuzzle`**

Find `tryLoadSharedPuzzle()` (around line 857). Locate this section:

```ts
    const hasExistingProgress = !!loadState();
    if (hasExistingProgress) {
        const ok = window.confirm('Load shared puzzle? Your current progress will be lost.');
        if (!ok) {
            // Leave the hash in place so the user can reload to retry.
            return false;
        }
    }

    clearSavedState();
    history.replaceState(null, '', window.location.pathname + window.location.search);
    await loadSharedPuzzle(payload);
    return true;
```

Change the `loadSharedPuzzle(payload)` call to pass the captured boolean:

```ts
    await loadSharedPuzzle(payload, hasExistingProgress);
```

- [ ] **Step 5: Verify the build still passes**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 6: Manual sanity check**

```bash
VITE_UMAMI_WEBSITE_ID=test-id npm run dev
```

Construct a share URL by:
1. Loading the dev URL once and starting a puzzle so localStorage has saved state.
2. In the info modal, copy the share URL.
3. Open it in a new tab. Confirm the prompt asking about losing progress, click OK.
4. In DevTools Network tab, confirm the `api/send` call with `name: "new-game-started"`, `data.source: "shared"`, `data.recipientHadSavedState: true`, `data.includesProgress: false`.

Then stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "$(cat <<'EOF'
feat(analytics): track new-game-started on shared-link loads

Threads recipientHadSavedState (already computed for the existing
"lose progress?" prompt) through to loadSharedPuzzle so the analytics
event can record whether the share recipient looks like a returning
player. Also adds a small helper to classify image URLs into
unsplash/blank/fallback for sources where only the URL is preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Completion-payload builder + fire `puzzle-completed`

**Files:**
- Modify: `src/main.ts`

Adds `buildPuzzleCompletedData` (merges cached new-game data with fields derived from `gameState`) and uses it in the `onDrop` win branch. This is the path where resumed games matter: `currentGameAnalytics` will be `null` for them, and we still want a useful event.

- [ ] **Step 1: Extend the analytics imports**

In `src/main.ts`, extend the analytics type import to also include `PuzzleCompletedData`:

```ts
import type { NewGameData, PuzzleCompletedData } from './analytics/index.js';
```

- [ ] **Step 2: Add the `buildPuzzleCompletedData` helper**

Find the `classifyImageSource` helper added in Task 4. Insert this helper *immediately after* it:

```ts
/**
 * Build the analytics payload for a puzzle completion.
 *
 * Always derives geometry/style fields from gameState (so resumed
 * games still get a useful event), then merges in any cached
 * NewGameData fields the user wouldn't be able to recover otherwise
 * (source, imageCategory, vibrant, etc.).
 */
function buildPuzzleCompletedData(state: GameState): PuzzleCompletedData {
    const derived: PuzzleCompletedData = {
        cutStyle: state.cutStyle ?? 'classic',
        rotationMode: state.rotationMode ?? 'none',
        cols: state.gridSize.cols,
        rows: state.gridSize.rows,
        pieceCount: state.pieces.length,
        imageSource: classifyImageSource(state.imageUrl),
    };

    if (currentGameAnalytics) {
        return { ...derived, ...currentGameAnalytics };
    }

    return derived;
}
```

- [ ] **Step 3: Fire `puzzle-completed` in the win branch**

In `src/main.ts`, find this block inside the drag-handling `onDrop` callback (around lines 510-521):

```ts
                if (checkAndMarkWin(gameState)) {
                    // Animate zoom to fit the completed puzzle, then show overlay
                    if (gameState.groups.length === 1) {
                        zoomToFitCompletedPuzzle(gameState.groups[0], () => {
                            showCompletionOverlay();
                        });
                    } else {
                        // Fallback: show overlay immediately if multiple groups (shouldn't happen)
                        showCompletionOverlay();
                    }
                    autoSave();
                }
```

Insert one `track()` line *as the first line inside the if-block* (before the rendering animation logic):

```ts
                if (checkAndMarkWin(gameState)) {
                    track('puzzle-completed', buildPuzzleCompletedData(gameState));
                    // Animate zoom to fit the completed puzzle, then show overlay
                    if (gameState.groups.length === 1) {
                        zoomToFitCompletedPuzzle(gameState.groups[0], () => {
                            showCompletionOverlay();
                        });
                    } else {
                        // Fallback: show overlay immediately if multiple groups (shouldn't happen)
                        showCompletionOverlay();
                    }
                    autoSave();
                }
```

The `__solvePuzzle` debug helper bypasses this code path entirely (it sets `gameState.completed = true` directly without triggering `onDrop`), so debug solves naturally don't fire the event.

- [ ] **Step 4: Verify the build still passes**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Manual sanity check**

```bash
VITE_UMAMI_WEBSITE_ID=test-id npm run dev
```

Start a small puzzle (e.g. the smallest available size), drag pieces together until the win triggers, and confirm the `api/send` call with `name: "puzzle-completed"` and the expected fields. Then stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "$(cat <<'EOF'
feat(analytics): track puzzle-completed on the natural win path

Fires inside the onDrop checkAndMarkWin branch, merging cached
NewGameData (source/category/vibrant) with fields derived from
gameState. Resumed-then-completed games still get a useful event
with just geometry/style. Debug __solvePuzzle is naturally skipped
because it short-circuits past onDrop.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Fire `puzzle-shared` from the completion overlay

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add the track call in the share-button handler**

In `src/main.ts`, find the completion-overlay share-button click handler (around lines 127-138):

```ts
    challengeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const payload = gameStateToPayload(gameState, { includeProgress: false });
        const url = buildShareUrl(window.location.href.split('#')[0], payload);
        void sharePuzzle({
            url,
            title: 'Puzzle',
            text: 'I finished this puzzle — can you?',
            onCopied: () => showToast('Link copied to clipboard'),
            onError: (err) => showToast(`Couldn't share: ${err.message}`),
        });
    });
```

Add a `track()` call as the first line inside the handler, right after `e.stopPropagation()`:

```ts
    challengeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        track('puzzle-shared', { source: 'completion-overlay', includesProgress: false });
        const payload = gameStateToPayload(gameState, { includeProgress: false });
        const url = buildShareUrl(window.location.href.split('#')[0], payload);
        void sharePuzzle({
            url,
            title: 'Puzzle',
            text: 'I finished this puzzle — can you?',
            onCopied: () => showToast('Link copied to clipboard'),
            onError: (err) => showToast(`Couldn't share: ${err.message}`),
        });
    });
```

The `includesProgress: false` is hardcoded because the completion-overlay path always passes `{ includeProgress: false }` to `gameStateToPayload`.

- [ ] **Step 2: Verify the build still passes**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "$(cat <<'EOF'
feat(analytics): track puzzle-shared from the completion overlay

The completion-overlay share path always omits progress, so
includesProgress is hardcoded false here.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Fire `puzzle-shared` from the info-modal share section

**Files:**
- Modify: `src/ui/share-section.ts`

- [ ] **Step 1: Add the import**

At the top of `src/ui/share-section.ts`, after the existing imports:

```ts
import type { GameState } from '../model/types.js';
import {
    buildShareUrl,
    gameStateToPayload,
    hasShareableProgress,
} from '../sharing/index.js';
import { sharePuzzle } from './share.js';
import { showToast } from './toast.js';
```

Add:

```ts
import { track } from '../analytics/index.js';
```

- [ ] **Step 2: Add the track call inside the click handler**

Find the share-button click handler (around lines 103-111):

```ts
    button.addEventListener('click', () => {
        void sharePuzzle({
            url: currentUrl(),
            title: 'Puzzle',
            text: 'Have a go at this puzzle!',
            onCopied: () => showToast('Link copied to clipboard'),
            onError: (e) => showToast(`Couldn't share: ${e.message}`),
        });
    });
```

Replace it with:

```ts
    button.addEventListener('click', () => {
        const includesProgress = checkbox.checked && !checkbox.disabled;
        track('puzzle-shared', { source: 'info-modal', includesProgress });
        void sharePuzzle({
            url: currentUrl(),
            title: 'Puzzle',
            text: 'Have a go at this puzzle!',
            onCopied: () => showToast('Link copied to clipboard'),
            onError: (e) => showToast(`Couldn't share: ${e.message}`),
        });
    });
```

The `checkbox.checked && !checkbox.disabled` expression is exactly the value already passed to `gameStateToPayload` inside `currentUrl()`, so they stay consistent.

- [ ] **Step 3: Verify the build still passes**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Run the full test suite to confirm nothing else broke**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/share-section.ts
git commit -m "$(cat <<'EOF'
feat(analytics): track puzzle-shared from the info-modal share section

Captures the includesProgress toggle value at click time so we can see
how often shared links carry progress vs. just the puzzle definition.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire up GitHub Actions secrets

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/deploy-preview.yml`

This task is environment-only — no code changes.

- [ ] **Step 1: Add the env var to the production deploy workflow**

In `.github/workflows/deploy.yml`, find the `npm run build` step:

```yaml
      - run: npm run build
        env:
          VITE_UNSPLASH_ACCESS_KEY: ${{ secrets.VITE_UNSPLASH_ACCESS_KEY }}
          VITE_APP_VERSION: "#${{ github.run_number }}"
```

Add one line under `env:`:

```yaml
      - run: npm run build
        env:
          VITE_UNSPLASH_ACCESS_KEY: ${{ secrets.VITE_UNSPLASH_ACCESS_KEY }}
          VITE_APP_VERSION: "#${{ github.run_number }}"
          VITE_UMAMI_WEBSITE_ID: ${{ secrets.UMAMI_WEBSITE_ID_PROD }}
```

- [ ] **Step 2: Add the env var to the PR preview workflow**

In `.github/workflows/deploy-preview.yml`, find the `npm run build` step:

```yaml
      - run: npm run build
        env:
          VITE_BASE_PATH: /puzzle/dev/
          VITE_UNSPLASH_ACCESS_KEY: ${{ secrets.VITE_UNSPLASH_ACCESS_KEY }}
          VITE_APP_VERSION: "PR #${{ github.event.pull_request.number }} (run ${{ github.run_number }})"
```

Add one line under `env:`:

```yaml
      - run: npm run build
        env:
          VITE_BASE_PATH: /puzzle/dev/
          VITE_UNSPLASH_ACCESS_KEY: ${{ secrets.VITE_UNSPLASH_ACCESS_KEY }}
          VITE_APP_VERSION: "PR #${{ github.event.pull_request.number }} (run ${{ github.run_number }})"
          VITE_UMAMI_WEBSITE_ID: ${{ secrets.UMAMI_WEBSITE_ID_DEV }}
```

- [ ] **Step 3: Tell the user to add the secrets**

Pause and report to the user:

> "Workflows updated. Before merging, please add two GitHub Actions secrets at the repo's Settings → Secrets and variables → Actions page:
>
> - `UMAMI_WEBSITE_ID_PROD` — Website ID of the `puzzle-prod` site in Umami Cloud.
> - `UMAMI_WEBSITE_ID_DEV` — Website ID of the `puzzle-dev` site in Umami Cloud.
>
> Without these, `VITE_UMAMI_WEBSITE_ID` will be empty in the deploy and tracking will silently no-op (no errors, just no data). Let me know once they're set so I can verify the PR-preview deploy actually reports."

Wait for confirmation before continuing.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml .github/workflows/deploy-preview.yml
git commit -m "$(cat <<'EOF'
ci(analytics): pass Umami website ID into deploy builds

Production and PR-preview workflows each get their own
VITE_UMAMI_WEBSITE_ID, sourced from separate secrets so the two deploys
report to separate Umami "websites".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: End-to-end verification on the PR preview

**Files:** none modified — this is a manual verification task.

- [ ] **Step 1: Push the branch and open a PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat: add Umami analytics" --body "$(cat <<'EOF'
## Summary

- Adds Umami Cloud tracking via a thin typed wrapper module
- Custom events: new-game-started, puzzle-completed, puzzle-shared
- Localhost stays silent (env var unset); PR preview uses puzzle-dev, prod uses puzzle-prod

See `docs/superpowers/specs/2026-04-25-umami-analytics-design.md` for the full design.

## Test plan

- [ ] PR-preview deploy shows the Umami script loading in DevTools
- [ ] Starting a new game fires `new-game-started` (visible in puzzle-dev dashboard within ~1 min)
- [ ] Completing a small puzzle fires `puzzle-completed`
- [ ] Sharing from the info modal fires `puzzle-shared` with `includesProgress` matching the toggle
- [ ] Sharing from the completion overlay fires `puzzle-shared` with `includesProgress: false`
- [ ] Loading a share link fires `new-game-started` with `source: 'shared'` and the correct `recipientHadSavedState`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Wait for the preview deploy**

Watch the GitHub Actions run for `deploy-preview.yml` to complete. Once the PR comment links to the preview URL, open it.

- [ ] **Step 3: Walk through the test plan**

Open DevTools → Network tab on the preview URL and tick off each item in the PR description's test plan. For each event, also confirm the corresponding row appears in the Umami Cloud dashboard for the `puzzle-dev` site.

If anything is missing, file the issue against the relevant Task above and fix it before merging.

- [ ] **Step 4: Report back**

Tell the user the preview is verified. Hand the PR over for human review and merge.

---

## Done state

After all tasks: pageviews flowing into both Umami "websites", three custom events firing on the right paths, localhost silent, PR-preview and production reporting separately. Implementation matches `docs/superpowers/specs/2026-04-25-umami-analytics-design.md`. No persistence schema changes; no public API surface added beyond the new `src/analytics/` module.
