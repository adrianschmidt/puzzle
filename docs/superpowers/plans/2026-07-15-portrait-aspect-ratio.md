# Portrait Aspect-Ratio Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a new puzzle match the shape of the screen it's created on — a portrait viewport produces a portrait puzzle from a portrait image; landscape is unchanged.

**Architecture:** Orientation is derived once, in `startNewGame`, from the viewport aspect ratio, and threaded as an explicit `Orientation` parameter into image selection and grid sizing. It transposes the selected landscape grid preset for portrait and picks portrait image variants. Nothing is stored separately: the portrait grid + portrait image size already flow into saves/share links, so replay reproduces correctly without re-reading the viewport.

**Tech Stack:** TypeScript, Vite, Vitest (`npm run test` → `vitest run`), jsdom for DOM tests.

## Global Constraints

- **American English** in all identifiers, comments, and code (`color`, `behavior`, `orientation`).
- **Test files live next to their source** (`foo.ts` → `foo.test.ts`).
- **Reproducibility contract:** do not add, remove, or reorder `random()` calls in `generateProceduralPuzzle`. This plan adds none — orientation only changes grid/image *inputs*.
- **Do not touch** the existing landscape bundled constants (`BUNDLED_IMAGE_URL/SIZE/ATTRIBUTION`) or `public/first-puzzle.jpg` / `public/puzzle-image.jpg` — old saves and share links reference them.
- Square viewport counts as **landscape** (the existing default).
- Commit style: conventional commits. End commit messages with the two trailer lines used in this repo (`Co-Authored-By:` and `Claude-Session:`).

---

### Task 1: Orientation module

**Files:**
- Create: `src/app/orientation.ts`
- Test: `src/app/orientation.test.ts`

**Interfaces:**
- Consumes: `Size`, `GridSize` from `src/model/types.js` (`{ width, height }`, `{ cols, rows }`).
- Produces:
  - `type Orientation = 'landscape' | 'portrait'`
  - `orientationForViewport(size: Size): Orientation`
  - `orientGridSize(grid: GridSize, o: Orientation): GridSize`

- [ ] **Step 1: Write the failing test**

Create `src/app/orientation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { orientationForViewport, orientGridSize } from './orientation.js';

describe('orientationForViewport', () => {
    it('is landscape when wider than tall', () => {
        expect(orientationForViewport({ width: 1000, height: 600 })).toBe('landscape');
    });

    it('is portrait when taller than wide', () => {
        expect(orientationForViewport({ width: 600, height: 1000 })).toBe('portrait');
    });

    it('treats a square viewport as landscape', () => {
        expect(orientationForViewport({ width: 800, height: 800 })).toBe('landscape');
    });

    it('treats a degenerate 0x0 viewport as landscape', () => {
        expect(orientationForViewport({ width: 0, height: 0 })).toBe('landscape');
    });
});

describe('orientGridSize', () => {
    it('keeps the long axis horizontal for landscape', () => {
        expect(orientGridSize({ cols: 6, rows: 4 }, 'landscape')).toEqual({ cols: 6, rows: 4 });
    });

    it('transposes a landscape preset to portrait', () => {
        expect(orientGridSize({ cols: 6, rows: 4 }, 'portrait')).toEqual({ cols: 4, rows: 6 });
    });

    it('normalizes an already-portrait grid to landscape', () => {
        expect(orientGridSize({ cols: 4, rows: 6 }, 'landscape')).toEqual({ cols: 6, rows: 4 });
    });

    it('leaves an already-portrait grid portrait', () => {
        expect(orientGridSize({ cols: 4, rows: 6 }, 'portrait')).toEqual({ cols: 4, rows: 6 });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/app/orientation.test.ts`
Expected: FAIL — cannot resolve `./orientation.js` / functions not exported.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/orientation.ts`:

```ts
/**
 * Viewport-driven puzzle orientation.
 *
 * A new puzzle matches the shape of the screen it is created on. Orientation
 * is derived once, at generation time, and used to transpose the grid and
 * choose the image. It is never stored on its own — the resulting grid and
 * image size are what saves and share links encode, so replay reproduces the
 * orientation without re-reading the viewport.
 */

import type { Size, GridSize } from '../model/types.js';

export type Orientation = 'landscape' | 'portrait';

/**
 * Portrait when the viewport is taller than it is wide; otherwise landscape.
 * A square (or degenerate 0x0) viewport counts as landscape — the historical
 * default.
 */
export function orientationForViewport(size: Size): Orientation {
    return size.height > size.width ? 'portrait' : 'landscape';
}

/**
 * Normalize a grid to an orientation. Landscape puts the long axis horizontal
 * (cols >= rows); portrait puts it vertical (rows >= cols). Defined by
 * normalization rather than a blind swap, so it is correct and idempotent
 * regardless of the input grid's current orientation.
 */
export function orientGridSize(grid: GridSize, o: Orientation): GridSize {
    const long = Math.max(grid.cols, grid.rows);
    const short = Math.min(grid.cols, grid.rows);
    return o === 'portrait'
        ? { cols: short, rows: long }
        : { cols: long, rows: short };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/app/orientation.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/orientation.ts src/app/orientation.test.ts
git commit -m "feat(orientation): derive puzzle orientation from viewport, transpose grid

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AtPUje14CAshHjzF5NVcTR"
```

---

### Task 2: Thread orientation through the Unsplash request

**Files:**
- Modify: `src/images/unsplash.ts` (`buildRandomPhotoUrl`, `fetchRandomImage`)
- Test: `src/images/unsplash.test.ts`

**Interfaces:**
- Consumes: `Orientation` from `src/app/orientation.js`.
- Produces:
  - `buildRandomPhotoUrl(accessKey: string, query?: string, orientation?: Orientation): string` (default `'landscape'`)
  - `fetchRandomImage(accessKey: string, fetchFn?: typeof fetch, query?: string, orientation?: Orientation): Promise<UnsplashImageResult | undefined>` (default `'landscape'`)

- [ ] **Step 1: Write the failing tests**

In `src/images/unsplash.test.ts`, add these tests inside the existing `describe('buildRandomPhotoUrl', …)` block:

```ts
    it('uses orientation=portrait when requested', () => {
        const url = buildRandomPhotoUrl('test-key', undefined, 'portrait');

        expect(url).toContain('orientation=portrait');
    });

    it('uses orientation=landscape when requested', () => {
        const url = buildRandomPhotoUrl('test-key', undefined, 'landscape');

        expect(url).toContain('orientation=landscape');
    });
```

And add this test inside the existing `describe('fetchRandomImage', …)` block:

```ts
    it('threads portrait orientation into the request URL', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeUnsplashResponse()),
        });

        await fetchRandomImage('test-key', mockFetch as unknown as typeof fetch, 'city', 'portrait');

        const calledUrl = mockFetch.mock.calls[0][0] as string;
        expect(calledUrl).toContain('orientation=portrait');
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/images/unsplash.test.ts`
Expected: FAIL — the new URLs still contain `orientation=landscape` (portrait arg ignored).

- [ ] **Step 3: Implement the change**

In `src/images/unsplash.ts`, add the import near the top (after the existing `diagnostics` import):

```ts
import type { Orientation } from '../app/orientation.js';
```

Replace `buildRandomPhotoUrl` (currently lines 67-81) with:

```ts
export function buildRandomPhotoUrl(
    accessKey: string,
    query?: string,
    orientation: Orientation = 'landscape',
): string {
    const params = new URLSearchParams({
        orientation,
        client_id: accessKey,
    });

    if (query) {
        params.set('query', query);
    }

    return `${UNSPLASH_RANDOM_URL}?${params.toString()}`;
}
```

Replace the signature and URL-build line of `fetchRandomImage` (currently lines 169-174) with:

```ts
export async function fetchRandomImage(
    accessKey: string,
    fetchFn: typeof fetch = fetch,
    query?: string,
    orientation: Orientation = 'landscape',
): Promise<UnsplashImageResult | undefined> {
    const url = buildRandomPhotoUrl(accessKey, query, orientation);
```

(Leave the rest of `fetchRandomImage`'s body unchanged.)

Also update the file's top doc-comment wording from "landscape photos" to "photos" so it no longer claims landscape-only (line 1-2 comment).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/images/unsplash.test.ts`
Expected: PASS (existing tests still green; 3 new tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/images/unsplash.ts src/images/unsplash.test.ts
git commit -m "feat(unsplash): accept an orientation param on the random-photo request

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AtPUje14CAshHjzF5NVcTR"
```

---

### Task 3: Thread orientation through resolveUnsplashImage

**Files:**
- Modify: `src/app/resolve-image.ts` (`resolveUnsplashImage`)
- Test: `src/app/resolve-image.test.ts`

**Interfaces:**
- Consumes: `Orientation` from `src/app/orientation.js`; `fetchRandomImage(accessKey, fetchFn?, query?, orientation?)` from Task 2.
- Produces: `resolveUnsplashImage(accessKey: string, imageCategory: string, vibrant: boolean, orientation: Orientation, fetchFn?: typeof fetch): Promise<ResolvedImage | null>`

Note: `orientation` is inserted **before** the test-only `fetchFn` param, keeping the real inputs grouped.

- [ ] **Step 1: Update existing tests + add a portrait test**

In `src/app/resolve-image.test.ts`, update the three existing `resolveUnsplashImage(...)` calls to pass an orientation before the `fetchFn`:

- Line ~36: `await resolveUnsplashImage('key', 'any', false, 'landscape', vi.fn());`
- Line ~53: `await resolveUnsplashImage('key', 'any', false, 'landscape', vi.fn());`
- Line ~62: `await resolveUnsplashImage('key', 'any', false, 'landscape', vi.fn());`

Then add this test to the `describe` block:

```ts
    it('forwards orientation to fetchRandomImage and scales a portrait photo', async () => {
        vi.mocked(fetchRandomImage).mockResolvedValue({
            imageUrl: 'https://images.example/portrait',
            width: 2000,
            height: 3000,
            photographerName: 'Ada',
            photographerUrl: 'https://u.example/ada',
            photoUrl: 'https://p.example/1',
        });

        const fetchFn = vi.fn();
        const resolved = await resolveUnsplashImage('key', 'any', false, 'portrait', fetchFn);

        // Orientation is forwarded as the 4th arg to fetchRandomImage.
        expect(vi.mocked(fetchRandomImage).mock.calls[0][3]).toBe('portrait');
        // 1080 wide, height derived from the 2:3 portrait aspect.
        expect(resolved?.imageSize).toEqual({ width: 1080, height: 1620 });
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/app/resolve-image.test.ts`
Expected: FAIL — signature mismatch / `fetchRandomImage` not called with orientation.

- [ ] **Step 3: Implement the change**

In `src/app/resolve-image.ts`, add the import (after the existing imports):

```ts
import type { Orientation } from './orientation.js';
```

Replace the `resolveUnsplashImage` signature (currently lines 24-29) with:

```ts
export async function resolveUnsplashImage(
    accessKey: string,
    imageCategory: string,
    vibrant: boolean,
    orientation: Orientation,
    fetchFn: typeof fetch = fetch,
): Promise<ResolvedImage | null> {
```

Replace the `fetchRandomImage` call (currently line 33) with:

```ts
        const result = await fetchRandomImage(accessKey, fetchFn, query, orientation);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/app/resolve-image.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/resolve-image.ts src/app/resolve-image.test.ts
git commit -m "feat(resolve-image): forward orientation to the Unsplash fetch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AtPUje14CAshHjzF5NVcTR"
```

---

### Task 4: Portrait bundled image asset + selector

**Files:**
- Create asset: `public/first-puzzle-portrait.jpg`
- Modify: `src/app/bundled-image.ts`
- Test: `src/app/bundled-image.test.ts` (new)

**Interfaces:**
- Consumes: `Orientation` from `src/app/orientation.js`; `Size`, `ImageAttribution` from `src/model/types.js`.
- Produces:
  - `BUNDLED_PORTRAIT_IMAGE_URL: string`
  - `BUNDLED_PORTRAIT_IMAGE_SIZE: Size`
  - `BUNDLED_PORTRAIT_IMAGE_ATTRIBUTION: ImageAttribution`
  - `pickBundledImage(orientation: Orientation): { url: string; size: Size; attribution: ImageAttribution }`

- [ ] **Step 1: Download the portrait asset and measure it**

The chosen photo is Barney Goodman's "pastel-colored buildings" (Unsplash `q5BV6DBTpFM`). Download it at 1080px wide and read its real pixel dimensions:

```bash
curl -sL "https://images.unsplash.com/photo-1782754569208-38bc42575761?w=1080&q=80&fm=jpg&fit=max" -o public/first-puzzle-portrait.jpg
sips -g pixelWidth -g pixelHeight public/first-puzzle-portrait.jpg
```

Record the reported `pixelWidth` (expected 1080) and `pixelHeight` — call them `<W>` and `<H>`. Confirm `<H> > <W>` (it must be portrait). Use these exact numbers in Step 3's `BUNDLED_PORTRAIT_IMAGE_SIZE`.

- [ ] **Step 2: Write the failing test**

Create `src/app/bundled-image.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    BUNDLED_IMAGE_URL,
    BUNDLED_IMAGE_SIZE,
    BUNDLED_IMAGE_ATTRIBUTION,
    BUNDLED_PORTRAIT_IMAGE_URL,
    BUNDLED_PORTRAIT_IMAGE_SIZE,
    BUNDLED_PORTRAIT_IMAGE_ATTRIBUTION,
    pickBundledImage,
} from './bundled-image.js';

describe('pickBundledImage', () => {
    it('returns the landscape asset for landscape', () => {
        expect(pickBundledImage('landscape')).toEqual({
            url: BUNDLED_IMAGE_URL,
            size: BUNDLED_IMAGE_SIZE,
            attribution: BUNDLED_IMAGE_ATTRIBUTION,
        });
    });

    it('returns the portrait asset for portrait', () => {
        expect(pickBundledImage('portrait')).toEqual({
            url: BUNDLED_PORTRAIT_IMAGE_URL,
            size: BUNDLED_PORTRAIT_IMAGE_SIZE,
            attribution: BUNDLED_PORTRAIT_IMAGE_ATTRIBUTION,
        });
    });

    it('ships a genuinely portrait bundled image', () => {
        expect(BUNDLED_PORTRAIT_IMAGE_SIZE.height).toBeGreaterThan(
            BUNDLED_PORTRAIT_IMAGE_SIZE.width,
        );
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- src/app/bundled-image.test.ts`
Expected: FAIL — portrait exports and `pickBundledImage` don't exist.

- [ ] **Step 4: Implement the change**

In `src/app/bundled-image.ts`, extend the imports:

```ts
import type { ImageAttribution, Size } from '../model/types.js';
import type { Orientation } from './orientation.js';
```

Append after the existing landscape constants (do not modify them). Use the `<H>` you measured in Step 1:

```ts
/** Portrait first-run / fallback asset (Barney Goodman, Unsplash q5BV6DBTpFM). */
export const BUNDLED_PORTRAIT_IMAGE_URL = 'first-puzzle-portrait.jpg';

export const BUNDLED_PORTRAIT_IMAGE_SIZE = { width: 1080, height: <H> };

export const BUNDLED_PORTRAIT_IMAGE_ATTRIBUTION: ImageAttribution = {
    photographerName: 'Barney Goodman',
    photographerUrl:
        'https://unsplash.com/@bgoodpic?utm_source=puzzle&utm_medium=referral',
    photoUrl:
        'https://unsplash.com/photos/q5BV6DBTpFM?utm_source=puzzle&utm_medium=referral',
};

/**
 * Choose the bundled first-run / fallback image for the puzzle orientation.
 * Landscape returns the original asset; portrait returns the portrait variant.
 */
export function pickBundledImage(orientation: Orientation): {
    url: string;
    size: Size;
    attribution: ImageAttribution;
} {
    return orientation === 'portrait'
        ? {
            url: BUNDLED_PORTRAIT_IMAGE_URL,
            size: BUNDLED_PORTRAIT_IMAGE_SIZE,
            attribution: BUNDLED_PORTRAIT_IMAGE_ATTRIBUTION,
        }
        : {
            url: BUNDLED_IMAGE_URL,
            size: BUNDLED_IMAGE_SIZE,
            attribution: BUNDLED_IMAGE_ATTRIBUTION,
        };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- src/app/bundled-image.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add public/first-puzzle-portrait.jpg src/app/bundled-image.ts src/app/bundled-image.test.ts
git commit -m "feat(bundled-image): add portrait first-run/fallback asset and selector

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AtPUje14CAshHjzF5NVcTR"
```

---

### Task 5: Wire orientation into startNewGame

**Files:**
- Modify: `src/main.ts` (`startNewGame`, ~lines 890-1013; imports ~122-128)

**Interfaces:**
- Consumes: `orientationForViewport`, `orientGridSize` (Task 1); `pickBundledImage` (Task 4); `resolveUnsplashImage(accessKey, imageCategory, vibrant, orientation, fetchFn?)` (Task 3).
- Produces: no new exports; behavior change only.

This task edits `main.ts`, which has no unit-test harness. It is verified by the full test suite, a typecheck, and a manual portrait/landscape smoke test.

- [ ] **Step 1: Add imports**

In `src/main.ts`, replace the bundled-image import block (currently lines 124-128) — the three `BUNDLED_IMAGE_*` constants are only used at the default-image block that Step 3 rewrites, so they become unused; drop them and import `pickBundledImage` instead:

```ts
import { pickBundledImage } from './app/bundled-image.js';
```

And add a new import line after it:

```ts
import { orientationForViewport, orientGridSize } from './app/orientation.js';
```

- [ ] **Step 2: Derive orientation and transpose the grid**

In `startNewGame`, immediately after the `viewport` object is built (currently lines 918-921), insert:

```ts
        // Match the puzzle to the shape of the screen it's created on. This is
        // the only place orientation is decided; the resulting grid and image
        // size flow into the save/share payload, so replay reproduces it
        // without re-reading the viewport.
        const orientation = orientationForViewport(viewport);
        gridSize = orientGridSize(gridSize, orientation);
```

(Reassigning the `gridSize` param propagates to both `createNewGame` and the analytics `NewGameData` below, so both reflect the actual portrait grid.)

- [ ] **Step 3: Use the oriented bundled image for the defaults**

Replace the default-image block (currently lines 923-925):

```ts
        let imageUrl: string = BUNDLED_IMAGE_URL;
        let imageSize = BUNDLED_IMAGE_SIZE;
        let attribution: GameState['attribution'] = BUNDLED_IMAGE_ATTRIBUTION;
```

with:

```ts
        const bundled = pickBundledImage(orientation);
        let imageUrl: string = bundled.url;
        let imageSize = bundled.size;
        let attribution: GameState['attribution'] = bundled.attribution;
```

(The `BUNDLED_IMAGE_*` constants are no longer referenced in `main.ts` — Step 1 already removed them from the import list. They remain exported from `bundled-image.ts`, where `pickBundledImage` and old-save/link references still use them.)

- [ ] **Step 4: Orient the blank canvas**

Replace the blank-puzzle block (currently lines 927-939):

```ts
        // Blank puzzle: white image, no photo
        if (imageSource === 'blank') {
            // Create a white 1080×720 image via canvas data URL
            const canvas = document.createElement('canvas');
            canvas.width = 1080;
            canvas.height = 720;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 1080, 720);
            imageUrl = canvas.toDataURL('image/png');
            imageSize = { width: 1080, height: 720 };
            attribution = undefined;
        }
```

with:

```ts
        // Blank puzzle: white image, no photo. Match the puzzle orientation so
        // a portrait screen gets a portrait blank canvas.
        if (imageSource === 'blank') {
            const blankSize = orientation === 'portrait'
                ? { width: 720, height: 1080 }
                : { width: 1080, height: 720 };
            const canvas = document.createElement('canvas');
            canvas.width = blankSize.width;
            canvas.height = blankSize.height;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, blankSize.width, blankSize.height);
            imageUrl = canvas.toDataURL('image/png');
            imageSize = blankSize;
            attribution = undefined;
        }
```

- [ ] **Step 5: Pass orientation to the Unsplash resolve**

Replace the `resolveUnsplashImage` call (currently line 950):

```ts
            const resolved = await resolveUnsplashImage(accessKey, imageCategory ?? 'any', vibrant);
```

with:

```ts
            const resolved = await resolveUnsplashImage(accessKey, imageCategory ?? 'any', vibrant, orientation);
```

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run test`
Expected: all tests pass.

- [ ] **Step 7: Manual smoke test (portrait + landscape)**

Run: `npm run dev`, open the app. In DevTools device toolbar (or by narrowing the window so height > width), make the viewport **portrait**, then start a New Game with "Random photo": the puzzle should be a tall portrait rectangle from a portrait photo. Make the viewport **landscape** (wider than tall), start another New Game: it should be the usual wide landscape puzzle. Repeat with "Blank (white)" — the blank canvas should be tall in portrait, wide in landscape. If Unsplash is not configured locally, the fallback bundled image should be the portrait "pastel buildings" photo in a portrait viewport.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts
git commit -m "feat(new-game): match puzzle orientation to the viewport

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AtPUje14CAshHjzF5NVcTR"
```

---

### Task 6: Remove grid dimensions from the size picker

**Files:**
- Modify: `src/ui/new-game-dialog.ts` (`buildSizeSection` → `updateLabels`, ~lines 175-198)
- Modify: `src/style.css` (remove `.size-picker-dims` rule, ~lines 641-645)
- Test: `src/ui/new-game-dialog.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no exports; the size-picker buttons no longer render a `.size-picker-dims` element.

Rationale: the `cols × rows` label was only shown for 2 of 4 cut styles and is misleading once a puzzle can be portrait (the preset reads landscape). Piece count is what players care about.

- [ ] **Step 1: Update the tests**

In `src/ui/new-game-dialog.test.ts`, delete the entire `it('displays grid dimensions in each button', …)` test (currently lines 165-177).

In the `it('shows approximate piece counts without grid dims for triangles', …)` test, the assertion `expect(container.querySelectorAll('.size-picker-dims')).toHaveLength(0);` (line 192) stays valid. Add a dedicated test after it that asserts dims are gone for the default (classic) cut style too:

```ts
    it('never renders grid dimensions in size buttons', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            onSelect: vi.fn(),
        });

        expect(container.querySelectorAll('.size-picker-dims')).toHaveLength(0);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/ui/new-game-dialog.test.ts`
Expected: FAIL — the new "never renders grid dimensions" test fails because classic still renders dims.

- [ ] **Step 3: Remove the dims element**

In `src/ui/new-game-dialog.ts`, in `updateLabels` (inside `buildSizeSection`), delete the dims-appending block (currently lines 192-197):

```ts
            if (!isApproximate) {
                const dims = document.createElement('span');
                dims.className = 'size-picker-dims';
                dims.textContent = `${opt.cols} × ${opt.rows}`;
                btn.appendChild(dims);
            }
```

Keep the `isApproximate` computation above it — it still drives the `~` prefix on the count. The loop now appends only the count span and the "pieces" label span.

- [ ] **Step 4: Remove the dead CSS**

In `src/style.css`, delete the `.size-picker-dims` rule (currently lines 641-645):

```css
.size-picker-dims {
  font-size: 0.7rem;
  opacity: 0.5;
  margin-top: 4px;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- src/ui/new-game-dialog.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/new-game-dialog.ts src/ui/new-game-dialog.test.ts src/style.css
git commit -m "refactor(new-game): drop grid dimensions from size-picker buttons

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AtPUje14CAshHjzF5NVcTR"
```

---

## Final verification

- [ ] Run `npm run test` — the whole suite is green.
- [ ] Run `npm run build` — `tsc` typecheck + SW build + Vite build all succeed, and `public/first-puzzle-portrait.jpg` is included in the build output.
- [ ] Manual: portrait viewport → portrait puzzle (random, blank, and bundled-fallback); landscape viewport → unchanged landscape puzzle. Confirm a portrait puzzle's share link, opened in a landscape window, still renders portrait.

## Notes for the reviewer

- **No help-text change** is included: auto orientation matching the screen is behavior a player would naturally expect, and the repo's help-text rule documents only the non-obvious.
- **No PRNG-contract impact:** orientation changes grid/image inputs only; it adds no `random()` calls. Existing share links and saves are unaffected.
- The `nature` category query string (`'nature landscape'`) is intentionally left unchanged — "landscape" there is a scenery search term, not an aspect hint.
- A user-facing Landscape/Portrait/Auto control is deliberately out of scope; the `Orientation` parameter is threaded so it can be added later with minimal change.
