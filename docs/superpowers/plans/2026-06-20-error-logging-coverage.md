# Error-Logging Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Report the user-visible failures that are currently caught-and-swallowed (shared-link load, Unsplash fetch, new-game start, share) to Umami as distinct typed events, and correct two misleading coverage comments.

**Architecture:** Add four typed `track()` overloads in the analytics layer. Extract the three inline `main.ts` catch sites into small, unit-tested helpers under a new `src/app/` directory (`runWithErrorReport` wraps an async operation; `resolveUnsplashImage` wraps the Unsplash fetch), so the error-reporting behavior is testable without a `main.ts` harness. Instrument `share-failed` at the two existing `onError` callback sites, which already have test files. Fix two comments with no behavior change.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom environment for DOM/`window.umami` tests). Analytics via `src/analytics/umami.ts` `track()` + `sanitizeErrorReason`.

## Global Constraints

- **American English** for all identifiers, comments, code artifacts (e.g. `color`, `behavior`).
- **No new seeded randomness** is introduced; the `generateProceduralPuzzle` PRNG call sequence is untouched, so the share-link reproducibility contract is unaffected. Do not add any `random()` calls.
- **No in-app help-text change needed:** these are observability-only changes. The user-facing toasts ("Couldn't load shared puzzle", "Couldn't start new game", "Couldn't share: …") already exist and are unchanged; nothing new is surfaced to the player, so `src/ui/info-modal.ts` does not need editing.
- **Every `reason` field** must be produced by `sanitizeErrorReason` (URL/extension redaction + length cap), imported from `./analytics/index.js`.
- **Test single files** with `npx vitest run <path>`; full suite with `npx vitest run`.
- **Service-worker instrumentation (#430) and a labeled `pwa-update-check-failed` event (#431) are OUT OF SCOPE** — do not implement them; only the comment corrections in Task 5 reference them.

## File Structure

- `src/analytics/umami.ts` (modify) — 4 new `track()` overloads + 4 `*Data` interfaces.
- `src/analytics/index.ts` (modify) — re-export the 4 new `*Data` types.
- `src/app/run-with-error-report.ts` (create) — generic wrapper: run an async op; on throw, warn + `track` + toast + return fallback. Used by the shared-load and new-game catches.
- `src/app/run-with-error-report.test.ts` (create).
- `src/app/resolve-image.ts` (create) — Unsplash fetch + map to `ResolvedImage`; `track('image-fetch-failed')` on throw.
- `src/app/resolve-image.test.ts` (create).
- `src/main.ts` (modify) — wire the three helpers into `startNewGame`, the new-game `.catch`, and `tryLoadSharedPuzzle`.
- `src/ui/share-section.ts` + `src/ui/share-section.test.ts` (modify) — `share-failed` (source `info-modal`).
- `src/ui/completion-overlay.ts` + `src/ui/completion-overlay.test.ts` (modify) — `share-failed` (source `completion-overlay`).
- `src/analytics/error-tracking.ts` (modify) — comment fix (SW claim).
- `src/pwa/update-controller.ts` (modify) — comment fix (`void` rejection claim).

---

### Task 1: Add the four typed analytics events

**Files:**
- Modify: `src/analytics/umami.ts` (interfaces near the other `*Data` blocks ~line 150-260; overloads at the `track` overload list ~line 293-308)
- Modify: `src/analytics/index.ts:4-17` (type re-exports)
- Test: `src/analytics/umami.test.ts`

**Interfaces:**
- Produces:
  - `interface SharedLoadFailedData { reason: string }`
  - `interface ImageFetchFailedData { reason: string }`
  - `interface NewGameFailedData { reason: string }`
  - `interface ShareFailedData { source: 'info-modal' | 'completion-overlay'; reason: string }`
  - `track('shared-load-failed', SharedLoadFailedData)`, `track('image-fetch-failed', ImageFetchFailedData)`, `track('new-game-failed', NewGameFailedData)`, `track('share-failed', ShareFailedData)`

- [ ] **Step 1: Write the failing tests**

Add to the `describe('track', …)` block in `src/analytics/umami.test.ts`:

```ts
it('forwards shared-load-failed with the typed payload', () => {
    const umamiTrack = vi.fn();
    (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };

    track('shared-load-failed', { reason: 'topology unsupported' });

    expect(umamiTrack).toHaveBeenCalledWith('shared-load-failed', { reason: 'topology unsupported' });
});

it('forwards image-fetch-failed with the typed payload', () => {
    const umamiTrack = vi.fn();
    (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };

    track('image-fetch-failed', { reason: 'network down' });

    expect(umamiTrack).toHaveBeenCalledWith('image-fetch-failed', { reason: 'network down' });
});

it('forwards new-game-failed with the typed payload', () => {
    const umamiTrack = vi.fn();
    (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };

    track('new-game-failed', { reason: 'chunk load failed' });

    expect(umamiTrack).toHaveBeenCalledWith('new-game-failed', { reason: 'chunk load failed' });
});

it('forwards share-failed with source and reason', () => {
    const umamiTrack = vi.fn();
    (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };

    track('share-failed', { source: 'completion-overlay', reason: 'No share mechanism available' });

    expect(umamiTrack).toHaveBeenCalledWith('share-failed', {
        source: 'completion-overlay',
        reason: 'No share mechanism available',
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/analytics/umami.test.ts`
Expected: FAIL — TypeScript error "No overload matches this call" for the four new event names (they aren't declared yet).

- [ ] **Step 3: Add the interfaces and overloads**

In `src/analytics/umami.ts`, add these interfaces alongside the existing `*Data` blocks (e.g. just after `UnhandledErrorData`):

```ts
/**
 * Data attached to `shared-load-failed` — a shared puzzle link satisfied
 * surface-shape validation but failed while building the puzzle (e.g. a
 * config combination the current build's topology pipeline doesn't support).
 * The user saw a "Couldn't load shared puzzle" toast. `reason` is the
 * sanitized error message.
 */
export interface SharedLoadFailedData {
    reason: string;
}

/**
 * Data attached to `image-fetch-failed` — fetching a random Unsplash image
 * threw (network/parse failure). This is NOT the "no image found" case:
 * `fetchRandomImage` returns `undefined` (and is untracked) on a 4xx/5xx
 * response, so this event only fires on a genuine throw. The new game still
 * proceeds with the fallback image. `reason` is the sanitized error message.
 */
export interface ImageFetchFailedData {
    reason: string;
}

/**
 * Data attached to `new-game-failed` — starting a fresh puzzle rejected and
 * the user saw a "Couldn't start new game" toast. The most likely cause (the
 * traced-tab lazy chunk import) ALSO emits `traced-chunk-load-failed` one
 * layer down, so a single failure can produce both events; there is no
 * guaranteed 1-to-1 correlation (topology and other errors reach this catch
 * without a chunk event). This event captures the user-facing outcome that
 * the inner event does not. `reason` is the sanitized error message.
 */
export interface NewGameFailedData {
    reason: string;
}

/**
 * Data attached to `share-failed` — the share flow fell through to its error
 * path (clipboard write failed, or no share mechanism was available) and the
 * user saw a "Couldn't share" toast. User cancellation of the native share
 * sheet (`AbortError`) is NOT a failure and is never tracked. `source` mirrors
 * `puzzle-shared`: the info-modal share section or the completion overlay.
 */
export interface ShareFailedData {
    source: 'info-modal' | 'completion-overlay';
    reason: string;
}
```

Add these overload signatures to the `track` overload list (after `track(name: 'unhandled-error', …)`):

```ts
export function track(name: 'shared-load-failed', data: SharedLoadFailedData): void;
export function track(name: 'image-fetch-failed', data: ImageFetchFailedData): void;
export function track(name: 'new-game-failed', data: NewGameFailedData): void;
export function track(name: 'share-failed', data: ShareFailedData): void;
```

- [ ] **Step 4: Re-export the new types from the barrel**

In `src/analytics/index.ts`, add to the `export type { … } from './umami.js';` list:

```ts
    SharedLoadFailedData,
    ImageFetchFailedData,
    NewGameFailedData,
    ShareFailedData,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/analytics/umami.test.ts`
Expected: PASS (all four new tests plus the existing ones).

- [ ] **Step 6: Commit**

```bash
git add src/analytics/umami.ts src/analytics/index.ts src/analytics/umami.test.ts
git commit -m "feat(analytics): add typed events for caught feature failures"
```

---

### Task 2: `runWithErrorReport` helper + wire shared-load & new-game catches

**Files:**
- Create: `src/app/run-with-error-report.ts`
- Test: `src/app/run-with-error-report.test.ts`
- Modify: `src/main.ts` — `tryLoadSharedPuzzle` try/catch at `:1416-1428`; the new-game `.catch` at `:1128-1136`

**Interfaces:**
- Consumes: `track` + `sanitizeErrorReason` from `./analytics/index.js` (Task 1 events `'shared-load-failed'` and `'new-game-failed'`), `diagnostics` from `./diagnostics.js`, `showToast` from `./ui/toast.js`.
- Produces:
  ```ts
  function runWithErrorReport<T>(opts: {
      run: () => Promise<T>;
      warnMessage: string;
      event: 'shared-load-failed' | 'new-game-failed';
      toastMessage: string;
      fallback: T;
  }): Promise<T>
  ```

- [ ] **Step 1: Write the failing test**

Create `src/app/run-with-error-report.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../ui/toast.js', () => ({ showToast: vi.fn() }));

import { showToast } from '../ui/toast.js';
import { runWithErrorReport } from './run-with-error-report.js';

describe('runWithErrorReport', () => {
    let umamiTrack: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
        vi.restoreAllMocks();
        vi.mocked(showToast).mockClear();
    });

    it('returns the operation result and reports nothing on success', async () => {
        const result = await runWithErrorReport({
            run: async () => true,
            warnMessage: 'unused',
            event: 'shared-load-failed',
            toastMessage: 'unused',
            fallback: false,
        });

        expect(result).toBe(true);
        expect(umamiTrack).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
    });

    it('reports a sanitized reason, shows the toast, and returns the fallback on failure', async () => {
        const result = await runWithErrorReport({
            run: async () => {
                throw new Error('boom at https://secret.example/path');
            },
            warnMessage: 'Failed to load shared puzzle:',
            event: 'shared-load-failed',
            toastMessage: "Couldn't load shared puzzle",
            fallback: false,
        });

        expect(result).toBe(false);
        expect(umamiTrack).toHaveBeenCalledWith('shared-load-failed', { reason: 'boom at <url>' });
        expect(showToast).toHaveBeenCalledWith("Couldn't load shared puzzle");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/run-with-error-report.test.ts`
Expected: FAIL — cannot resolve `./run-with-error-report.js` (module not created yet).

- [ ] **Step 3: Create the helper**

Create `src/app/run-with-error-report.ts`:

```ts
/**
 * Run an async application operation and, if it rejects, report the failure
 * uniformly: a dev diagnostic, a typed Umami event, and a user-facing toast —
 * then resolve to a caller-supplied fallback instead of propagating.
 *
 * Used by the entry-point flows whose failures were previously caught and
 * swallowed without analytics (shared-link load, new-game start). Extracted
 * from `main.ts` so the reporting behavior is unit-testable.
 */

import { diagnostics } from '../diagnostics.js';
import { track, sanitizeErrorReason } from '../analytics/index.js';
import { showToast } from '../ui/toast.js';

export async function runWithErrorReport<T>(opts: {
    run: () => Promise<T>;
    warnMessage: string;
    event: 'shared-load-failed' | 'new-game-failed';
    toastMessage: string;
    fallback: T;
}): Promise<T> {
    try {
        return await opts.run();
    } catch (error) {
        diagnostics.warn(opts.warnMessage, error);
        track(opts.event, { reason: sanitizeErrorReason(error) });
        showToast(opts.toastMessage);
        return opts.fallback;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/run-with-error-report.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into `tryLoadSharedPuzzle`**

In `src/main.ts`, add the import near the other analytics/app imports:

```ts
import { runWithErrorReport } from './app/run-with-error-report.js';
```

Replace the try/catch block at `src/main.ts:1416-1428`:

```ts
    try {
        await loadSharedPuzzle(payload, hasExistingProgress);
    } catch (error) {
        // Surface-shape validation (`isValidComposableCf` etc.) catches
        // most malformed payloads at decode time, but a link can still
        // satisfy the schema and then trip the topology pipeline — e.g.
        // a config combination the current build doesn't support. A
        // toast is friendlier than an unhandled rejection.
        diagnostics.warn('Failed to load shared puzzle:', error);
        showToast("Couldn't load shared puzzle");
        return false;
    }
    return true;
}
```

with:

```ts
    // Surface-shape validation (`isValidComposableCf` etc.) catches most
    // malformed payloads at decode time, but a link can still satisfy the
    // schema and then trip the topology pipeline — e.g. a config combination
    // the current build doesn't support. Report it and toast rather than
    // letting it surface as an unhandled rejection.
    return runWithErrorReport({
        run: async () => {
            await loadSharedPuzzle(payload, hasExistingProgress);
            return true;
        },
        warnMessage: 'Failed to load shared puzzle:',
        event: 'shared-load-failed',
        toastMessage: "Couldn't load shared puzzle",
        fallback: false,
    });
}
```

- [ ] **Step 6: Wire it into the new-game `.catch`**

Replace the `.catch` at `src/main.ts:1128-1136`:

```ts
                ).catch((error) => {
                    // The chunk-load path (traced tabs lazy import) is
                    // the most likely source of a rejection here — a
                    // network blip or stale deploy hash. Surface a
                    // toast so the user knows the click didn't silently
                    // do nothing.
                    diagnostics.warn('Failed to start new game:', error);
                    showToast("Couldn't start new game");
                });
```

with (note the call is now wrapped, so the `startNewGame(...)` argument list closes with `)` and is passed as the `run` thunk):

```ts
                );
                void runWithErrorReport({
                    // The chunk-load path (traced tabs lazy import) is the most
                    // likely source of a rejection here — a network blip or
                    // stale deploy hash. The user gets a toast so the click
                    // doesn't silently do nothing; `new-game-failed` records it.
                    run: () => newGame,
                    warnMessage: 'Failed to start new game:',
                    event: 'new-game-failed',
                    toastMessage: "Couldn't start new game",
                    fallback: undefined,
                });
```

To make `newGame` available, change the line that begins the call (currently `startNewGame(`) to assign it. The `onSelect` body's `startNewGame(` invocation at `src/main.ts:1115` becomes:

```ts
                const newGame = startNewGame(
```

(the argument list and closing `)` at line 1128 are unchanged except the `.catch(...)` is removed per the replacement above).

- [ ] **Step 7: Run the full suite to verify nothing regressed**

Run: `npx vitest run`
Expected: PASS. (No direct `main.ts` test exists; this confirms the wiring typechecks and no other test breaks.)

- [ ] **Step 8: Commit**

```bash
git add src/app/run-with-error-report.ts src/app/run-with-error-report.test.ts src/main.ts
git commit -m "feat(analytics): report shared-load and new-game failures"
```

---

### Task 3: `resolveUnsplashImage` helper + wire into `startNewGame`

**Files:**
- Create: `src/app/resolve-image.ts`
- Test: `src/app/resolve-image.test.ts`
- Modify: `src/main.ts:960-987` (the inline Unsplash try/catch inside `startNewGame`)

**Interfaces:**
- Consumes: `fetchRandomImage` from `./images/index.js`; `findImageCategory`, `buildImageQuery` from `./game/image-categories.js`; `track` + `sanitizeErrorReason` from `./analytics/index.js`; `diagnostics`.
- Produces:
  ```ts
  interface ResolvedImage {
      imageUrl: string;
      imageSize: { width: number; height: number };
      attribution: { photographerName: string; photographerUrl: string; photoUrl: string };
  }
  function resolveUnsplashImage(
      accessKey: string,
      imageCategory: string,
      vibrant: boolean,
      fetchFn?: typeof fetch,
  ): Promise<ResolvedImage | null>
  ```
  Returns `null` when no image is available (caller keeps its fallback); tracks `image-fetch-failed` only on a thrown error.

- [ ] **Step 1: Write the failing test**

Create `src/app/resolve-image.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../images/index.js', () => ({ fetchRandomImage: vi.fn() }));

import { fetchRandomImage } from '../images/index.js';
import { resolveUnsplashImage } from './resolve-image.js';

describe('resolveUnsplashImage', () => {
    let umamiTrack: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
        vi.restoreAllMocks();
    });

    it('maps a fetched photo into a ResolvedImage and reports nothing', async () => {
        vi.mocked(fetchRandomImage).mockResolvedValue({
            imageUrl: 'https://images.example/photo',
            width: 2000,
            height: 1000,
            photographerName: 'Ada',
            photographerUrl: 'https://u.example/ada',
            photoUrl: 'https://p.example/1',
        });

        const resolved = await resolveUnsplashImage('key', 'any', false, vi.fn());

        expect(resolved).toEqual({
            imageUrl: 'https://images.example/photo',
            imageSize: { width: 1080, height: 540 },
            attribution: {
                photographerName: 'Ada',
                photographerUrl: 'https://u.example/ada',
                photoUrl: 'https://p.example/1',
            },
        });
        expect(umamiTrack).not.toHaveBeenCalled();
    });

    it('returns null and reports nothing when no image is found (4xx/5xx)', async () => {
        vi.mocked(fetchRandomImage).mockResolvedValue(undefined);

        const resolved = await resolveUnsplashImage('key', 'any', false, vi.fn());

        expect(resolved).toBeNull();
        expect(umamiTrack).not.toHaveBeenCalled();
    });

    it('reports image-fetch-failed and returns null when the fetch throws', async () => {
        vi.mocked(fetchRandomImage).mockRejectedValue(new Error('network down'));

        const resolved = await resolveUnsplashImage('key', 'any', false, vi.fn());

        expect(resolved).toBeNull();
        expect(umamiTrack).toHaveBeenCalledWith('image-fetch-failed', { reason: 'network down' });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/resolve-image.test.ts`
Expected: FAIL — cannot resolve `./resolve-image.js`.

- [ ] **Step 3: Create the helper**

Create `src/app/resolve-image.ts`:

```ts
/**
 * Fetch a random Unsplash image for a new puzzle and map it into the shape
 * the game needs. Returns `null` when no image is available — either Unsplash
 * returned no usable photo (a handled, untracked outcome) or the fetch threw
 * (reported as `image-fetch-failed`). Either way the caller falls back to its
 * default image. Extracted from `main.ts` so the failure reporting is testable.
 */

import { diagnostics } from '../diagnostics.js';
import { track, sanitizeErrorReason } from '../analytics/index.js';
import { fetchRandomImage } from '../images/index.js';
import { findImageCategory, buildImageQuery } from '../game/image-categories.js';

export interface ResolvedImage {
    imageUrl: string;
    imageSize: { width: number; height: number };
    attribution: {
        photographerName: string;
        photographerUrl: string;
        photoUrl: string;
    };
}

export async function resolveUnsplashImage(
    accessKey: string,
    imageCategory: string,
    vibrant: boolean,
    fetchFn: typeof fetch = fetch,
): Promise<ResolvedImage | null> {
    try {
        const category = findImageCategory(imageCategory);
        const query = buildImageQuery(category.query, vibrant);
        const result = await fetchRandomImage(accessKey, fetchFn, query);

        if (!result) {
            return null;
        }

        // The Unsplash "regular" URL delivers images scaled to 1080px wide.
        // Compute the height from the original aspect ratio so the puzzle
        // generator produces correctly proportioned pieces.
        const aspectRatio = result.height / result.width;
        const displayWidth = 1080;
        return {
            imageUrl: result.imageUrl,
            imageSize: {
                width: displayWidth,
                height: Math.round(displayWidth * aspectRatio),
            },
            attribution: {
                photographerName: result.photographerName,
                photographerUrl: result.photographerUrl,
                photoUrl: result.photoUrl,
            },
        };
    } catch (error) {
        diagnostics.warn('Failed to fetch Unsplash image, using fallback:', error);
        track('image-fetch-failed', { reason: sanitizeErrorReason(error) });
        return null;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/resolve-image.test.ts`
Expected: PASS.

If the success test fails on a property name (the real `fetchRandomImage` result type may name fields differently), open `src/images/index.ts` / its result type, align the mock object and `ResolvedImage` mapping to the real field names, and re-run. Do not invent fields.

- [ ] **Step 5: Wire it into `startNewGame`**

In `src/main.ts`, add the import:

```ts
import { resolveUnsplashImage } from './app/resolve-image.js';
```

Replace the Unsplash block at `src/main.ts:960-987`:

```ts
        if (accessKey) {
            try {
                const category = findImageCategory(imageCategory ?? 'any');
                const query = buildImageQuery(category.query, vibrant);
                const result = await fetchRandomImage(accessKey, fetch, query);

                if (result) {
                    imageUrl = result.imageUrl;
                    attribution = {
                        photographerName: result.photographerName,
                        photographerUrl: result.photographerUrl,
                        photoUrl: result.photoUrl,
                    };

                    // The Unsplash "regular" URL delivers images scaled to 1080px
                    // wide. Compute the height from the original aspect ratio so
                    // the puzzle generator produces correctly proportioned pieces.
                    const aspectRatio = result.height / result.width;
                    const displayWidth = 1080;
                    imageSize = {
                        width: displayWidth,
                        height: Math.round(displayWidth * aspectRatio),
                    };
                }
            } catch (error) {
                diagnostics.warn('Failed to fetch Unsplash image, using fallback:', error);
            }
        }
```

with:

```ts
        if (accessKey) {
            const resolved = await resolveUnsplashImage(accessKey, imageCategory ?? 'any', vibrant);
            if (resolved) {
                imageUrl = resolved.imageUrl;
                imageSize = resolved.imageSize;
                attribution = resolved.attribution;
            }
        }
```

- [ ] **Step 6: Remove now-unused imports if any**

After the edit, `findImageCategory` / `buildImageQuery` / `fetchRandomImage` may no longer be used in `main.ts`. Run `npx vitest run` (Vite/TS will flag unused-import errors if the project enforces them) and run the project's lint/typecheck:

Run: `npx tsc --noEmit`
Expected: PASS. If any of those three symbols is now unused in `main.ts`, remove it from the imports at `src/main.ts:72` and `:103/:106`. If still used elsewhere in `main.ts`, leave it.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/resolve-image.ts src/app/resolve-image.test.ts src/main.ts
git commit -m "feat(analytics): report Unsplash image-fetch failures"
```

---

### Task 4: `share-failed` at the two share call sites

**Files:**
- Modify: `src/ui/share-section.ts:104-114` (the `onError` callback)
- Modify: `src/ui/completion-overlay.ts:75-82` (the `onError` callback)
- Test: `src/ui/share-section.test.ts`, `src/ui/completion-overlay.test.ts`

**Interfaces:**
- Consumes: `track` (already imported in both files), `sanitizeErrorReason` from `../analytics/index.js`, Task 1 event `'share-failed'`.

- [ ] **Step 1: Write the failing test (completion overlay)**

In `src/ui/completion-overlay.test.ts`, the suite already assigns `window.umami` mocks and stubs `navigator.share`. Add a test that forces the error path (share rejects with a non-AbortError and no clipboard is available) and asserts `share-failed` is tracked. Adapt the variable names to the file's existing setup helpers:

```ts
it('tracks share-failed when the share flow has no working mechanism', async () => {
    const umamiTrack = vi.fn();
    (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
    // Native share present but rejects (non-Abort); no clipboard => onError fires.
    (navigator as unknown as { share: unknown }).share = vi
        .fn()
        .mockRejectedValue(new Error('share unavailable'));
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    // Render the overlay and click the share button (use the file's existing
    // render helper / selector for the `.completion-share-btn`).
    const overlay = renderCompletionOverlayForTest();
    overlay.querySelector<HTMLButtonElement>('.completion-share-btn')!.click();

    await vi.waitFor(() => {
        expect(umamiTrack).toHaveBeenCalledWith('share-failed', {
            source: 'completion-overlay',
            reason: 'No share mechanism available',
        });
    });
});
```

> Note for the implementer: reuse whatever render/setup the existing tests in this file use (the snippet's `renderCompletionOverlayForTest()` is a placeholder for that existing helper). The behavior under test is: clicking share with no working share/clipboard mechanism calls `track('share-failed', …)`. `sharePuzzle` ends at `onError(new Error('No share mechanism available'))`, so `reason` is exactly that string.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/completion-overlay.test.ts`
Expected: FAIL — `umamiTrack` not called with `'share-failed'` (the `onError` only toasts today).

- [ ] **Step 3: Instrument the completion-overlay `onError`**

In `src/ui/completion-overlay.ts`, add `sanitizeErrorReason` to the analytics import:

```ts
import { track, sanitizeErrorReason } from '../analytics/index.js';
```

Change the `onError` callback (currently at `:80`):

```ts
            onError: (err) => showToast(`Couldn't share: ${err.message}`),
```

to:

```ts
            onError: (err) => {
                track('share-failed', {
                    source: 'completion-overlay',
                    reason: sanitizeErrorReason(err),
                });
                showToast(`Couldn't share: ${err.message}`);
            },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/completion-overlay.test.ts`
Expected: PASS.

- [ ] **Step 5: Repeat for the share section (source `info-modal`)**

In `src/ui/share-section.test.ts`, add an equivalent test that drives the share button's `onError` path and asserts:

```ts
expect(umamiTrack).toHaveBeenCalledWith('share-failed', {
    source: 'info-modal',
    reason: 'No share mechanism available',
});
```

using the file's existing `attachShareSection` setup and the `[data-testid="share-primary-btn"]` button. Run it and confirm it FAILS first:

Run: `npx vitest run src/ui/share-section.test.ts`
Expected: FAIL.

Then in `src/ui/share-section.ts` add `sanitizeErrorReason` to the analytics import (`:15`) and change the `onError` (currently at `:112`):

```ts
            onError: (e) => showToast(`Couldn't share: ${e.message}`),
```

to:

```ts
            onError: (e) => {
                track('share-failed', {
                    source: 'info-modal',
                    reason: sanitizeErrorReason(e),
                });
                showToast(`Couldn't share: ${e.message}`);
            },
```

Run: `npx vitest run src/ui/share-section.test.ts`
Expected: PASS.

- [ ] **Step 6: Confirm the cancel path stays untracked**

`sharePuzzle` returns on `AbortError` before calling `onError` (see `src/ui/share.ts:41`), so user-cancel never reaches the new `track` call. Confirm `src/ui/share.test.ts` still covers that the AbortError path is a silent no-op:

Run: `npx vitest run src/ui/share.test.ts`
Expected: PASS (no changes needed; this is a guard check). If no AbortError-no-op test exists there, add one asserting `onError` is not called when `navigator.share` rejects with a `{ name: 'AbortError' }`.

- [ ] **Step 7: Commit**

```bash
git add src/ui/share-section.ts src/ui/share-section.test.ts src/ui/completion-overlay.ts src/ui/completion-overlay.test.ts
git commit -m "feat(analytics): report share failures (excluding user cancel)"
```

---

### Task 5: Correct the two misleading coverage comments

**Files:**
- Modify: `src/analytics/error-tracking.ts:10-14`
- Modify: `src/pwa/update-controller.ts:188-193`

No behavior change, so no new test; the existing suites must stay green.

- [ ] **Step 1: Fix the service-worker claim**

In `src/analytics/error-tracking.ts`, replace the doc paragraph at `:10-14`:

```ts
 * The traced-chunk preload paths catch and report their own failures
 * (`traced-chunk-load-failed`), so they don't reach here; this catches
 * everything else — image fetches, persistence, future async code, and
 * the service worker.
```

with:

```ts
 * The traced-chunk preload paths catch and report their own failures
 * (`traced-chunk-load-failed`), so they don't reach here; this catches
 * everything else uncaught in the page realm — image fetches, persistence,
 * future async code. It does NOT see errors thrown inside the service
 * worker's own scope: a `window` listener runs in the page realm, so only
 * SW→page message failures surface here. Dedicated SW instrumentation is
 * tracked separately (#430).
```

- [ ] **Step 2: Fix the `void`-rejection claim**

In `src/pwa/update-controller.ts`, replace the comment at `:188-193`:

```ts
    // `registration.update()` rejections are deliberately swallowed here and in
    // the visibility path below: a failed *check* is best-effort and self-heals
    // on the next poll / visibility change. This leaves the detection stage
    // intentionally uninstrumented — a consistently-failing check is invisible
    // (the unhandled-error backstop does not catch these void-swallowed
    // rejections). Instrumentation only begins once an update is *applied*.
```

with:

```ts
    // `registration.update()` rejections are deliberately not given a distinct
    // event here and in the visibility path below: a failed *check* is
    // best-effort and self-heals on the next poll / visibility change. The
    // rejection is NOT swallowed — `void` does not attach a handler — so a
    // consistently-failing check still surfaces via the global backstop as a
    // generic, rate-limited `unhandled-error{source:'rejection'}` (observable
    // but unlabeled). A dedicated `pwa-update-check-failed` event is tracked
    // separately (#431).
```

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/analytics/error-tracking.ts src/pwa/update-controller.ts
git commit -m "docs(analytics): correct service-worker and update-check coverage comments"
```

---

## Self-Review

**1. Spec coverage:**
- `shared-load-failed` → Task 1 (event) + Task 2 (wiring). ✓
- `image-fetch-failed` → Task 1 + Task 3. ✓ (negative 4xx/5xx case covered by `unsplash.test.ts` and re-asserted in `resolve-image.test.ts` step 1). ✓
- `new-game-failed` (kept, double-count documented) → Task 1 + Task 2 step 6. ✓
- `share-failed` with `source` → Task 1 + Task 4; cancel-excluded via Task 4 step 6. ✓
- Comment corrections (SW, `void`) → Task 5. ✓
- Out-of-scope #430/#431 → referenced only in Task 5 comments, not implemented. ✓
- No PRNG / no help-text change → Global Constraints. ✓

**2. Placeholder scan:** One intentional placeholder remains — `renderCompletionOverlayForTest()` / the share-section render in Task 4 — flagged explicitly because the implementer must reuse each test file's existing render helper, which differs per file. The behavior under test and the exact `track` assertion are fully specified. No other TODO/TBD.

**3. Type consistency:** `runWithErrorReport<T>` `event` union is `'shared-load-failed' | 'new-game-failed'`, matching the Task 1 overloads (both `{ reason }`). `ResolvedImage` field names (`imageUrl`, `imageSize`, `attribution`) match the `main.ts` assignment sites. `share-failed` payload `{ source, reason }` matches `ShareFailedData`. Task 3 step 4 explicitly guards the one cross-module assumption (the `fetchRandomImage` result field names) with a "verify against the real type" instruction.
