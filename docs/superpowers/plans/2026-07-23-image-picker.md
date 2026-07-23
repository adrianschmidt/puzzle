# New Game Image Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The new-game dialog shows four Unsplash candidate photos; tapping a photo (or Surprise me / Blank puzzle) starts the game, and the size grid becomes a plain `select`.

**Architecture:** A new `fetchRandomImages` variant in the Unsplash client fetches 4 photos in one API request. A new `src/ui/image-picker.ts` component owns candidate state (loading/loaded/error, stale-response protection) and reports picks; the dialog treats a pick as the game-start trigger. `startNewGame` accepts an optional pre-picked photo and skips its own fetch. Share links/saves are untouched (they already store the resolved URL verbatim).

**Tech Stack:** TypeScript + Vite, Vitest (jsdom for UI tests), plain DOM (no framework), plain CSS in `src/style.css`.

**Spec:** `docs/superpowers/specs/2026-07-23-image-picker-design.md`

## Global Constraints

- American English in all identifiers/comments (e.g. `color`, not `colour`) — but **user-facing copy uses British English** where the app already does ("Vibrant colours").
- Test files live next to the source they test.
- No new colors: reference existing `--ui-*` CSS variables only.
- Do not touch the share-link codec (`src/sharing/share-link.ts`) or the seeded-PRNG call sequence — image choice is outside that contract.
- Verification commands: `npx vitest run <file>` per task, `npm test` + `npm run build` at the end.
- Commit after each task with a conventional message (`generating-commit-messages` conventions; no AI attribution).

---

### Task 1: Unsplash client — multi-photo fetch, download_location, download trigger

**Files:**
- Modify: `src/images/unsplash.ts`
- Modify: `src/images/index.ts`
- Test: `src/images/unsplash.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `UnsplashImageResult` gains `thumbUrl: string`, `downloadLocation: string`, `description?: string`.
  - `buildRandomPhotoUrl(accessKey: string, query?: string, orientation?: Orientation, count?: number): string`
  - `fetchRandomImages(accessKey: string, count: number, fetchFn?: typeof fetch, query?: string, orientation?: Orientation): Promise<UnsplashImageResult[] | undefined>` — `undefined` on HTTP error, throws on malformed body.
  - `triggerPhotoDownload(downloadLocation: string, accessKey: string, fetchFn?: typeof fetch): Promise<void>`

- [ ] **Step 1: Update the fixture and write failing tests**

In `src/images/unsplash.test.ts`, extend `makeUnsplashResponse()` (the guard will require the new fields, so the fixture change is part of the red→green cycle):

```ts
function makeUnsplashResponse() {
    return {
        urls: {
            regular: 'https://images.unsplash.com/photo-abc?w=1080',
            full: 'https://images.unsplash.com/photo-abc',
            small: 'https://images.unsplash.com/photo-abc?w=400',
        },
        width: 4000,
        height: 2667,
        user: {
            name: 'Test Photographer',
            links: {
                html: 'https://unsplash.com/@testphotographer',
            },
        },
        links: {
            html: 'https://unsplash.com/photos/abc123',
            download_location: 'https://api.unsplash.com/photos/abc123/download?ixid=xyz',
        },
        alt_description: 'a mountain lake at dawn',
    };
}
```

Add to the `buildRandomPhotoUrl` describe:

```ts
    it('includes count when provided', () => {
        const url = buildRandomPhotoUrl('test-key', undefined, 'landscape', 4);

        expect(url).toContain('count=4');
    });

    it('omits count when not provided', () => {
        const url = buildRandomPhotoUrl('test-key');

        expect(url).not.toContain('count=');
    });
```

Add to the `parseUnsplashResponse` describe:

```ts
    it('extracts thumb URL, download location and description', () => {
        const result = parseUnsplashResponse(makeUnsplashResponse());

        expect(result.thumbUrl).toBe('https://images.unsplash.com/photo-abc?w=400');
        expect(result.downloadLocation).toBe(
            'https://api.unsplash.com/photos/abc123/download?ixid=xyz',
        );
        expect(result.description).toBe('a mountain lake at dawn');
    });

    it('omits description when alt_description is null', () => {
        const response = { ...makeUnsplashResponse(), alt_description: null };

        expect(parseUnsplashResponse(response).description).toBeUndefined();
    });

    it('throws on response missing download_location', () => {
        const response = makeUnsplashResponse();
        response.links = { html: response.links.html } as typeof response.links;

        expect(() => parseUnsplashResponse(response)).toThrow(
            'Invalid Unsplash API response',
        );
    });
```

Add new describes (import `fetchRandomImages` and `triggerPhotoDownload`):

```ts
describe('fetchRandomImages', () => {
    it('parses an array response into results', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([makeUnsplashResponse(), makeUnsplashResponse()]),
        });

        const results = await fetchRandomImages('test-key', 2, mockFetch as unknown as typeof fetch);

        expect(results).toHaveLength(2);
        expect(results![0].imageUrl).toBe('https://images.unsplash.com/photo-abc?w=1080');
        expect(results![0].thumbUrl).toBe('https://images.unsplash.com/photo-abc?w=400');
    });

    it('requests the given count and orientation', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([makeUnsplashResponse()]),
        });

        await fetchRandomImages('test-key', 4, mockFetch as unknown as typeof fetch, 'nature', 'portrait');

        const calledUrl = mockFetch.mock.calls[0][0] as string;
        expect(calledUrl).toContain('count=4');
        expect(calledUrl).toContain('orientation=portrait');
        expect(calledUrl).toContain('query=nature');
    });

    it('returns undefined on HTTP error', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
        });

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const results = await fetchRandomImages('test-key', 4, mockFetch as unknown as typeof fetch);

        expect(results).toBeUndefined();
        warnSpy.mockRestore();
    });

    it('throws when the body is not an array', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeUnsplashResponse()),
        });

        await expect(
            fetchRandomImages('test-key', 4, mockFetch as unknown as typeof fetch),
        ).rejects.toThrow('Invalid Unsplash API response');
    });
});

describe('triggerPhotoDownload', () => {
    it('calls the download location with client_id appended', async () => {
        const mockFetch = vi.fn().mockResolvedValue({ ok: true });

        await triggerPhotoDownload(
            'https://api.unsplash.com/photos/abc123/download?ixid=xyz',
            'my-key',
            mockFetch as unknown as typeof fetch,
        );

        expect(mockFetch).toHaveBeenCalledOnce();
        const calledUrl = new URL(mockFetch.mock.calls[0][0] as string);
        expect(calledUrl.searchParams.get('client_id')).toBe('my-key');
        expect(calledUrl.searchParams.get('ixid')).toBe('xyz');
        expect(calledUrl.pathname).toBe('/photos/abc123/download');
    });

    it('warns but does not throw on HTTP error', async () => {
        const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' });

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(
            triggerPhotoDownload('https://api.unsplash.com/x/download', 'k', mockFetch as unknown as typeof fetch),
        ).resolves.toBeUndefined();
        expect(warnSpy).toHaveBeenCalledOnce();
        warnSpy.mockRestore();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/images/unsplash.test.ts`
Expected: FAIL — `fetchRandomImages`/`triggerPhotoDownload` not exported; parse tests fail on missing `thumbUrl`.

- [ ] **Step 3: Implement in `src/images/unsplash.ts`**

Extend `UnsplashPhoto`:

```ts
export interface UnsplashPhoto {
    /** Raw image URLs at various sizes. */
    urls: {
        /** Processed image URL with configurable dimensions. */
        regular: string;
        /** Full-size image URL. */
        full: string;
        /** Small (400px) URL — used for picker thumbnails. */
        small: string;
    };
    /** Original image dimensions. */
    width: number;
    /** Original image dimensions. */
    height: number;
    /** Photographer attribution. */
    user: {
        name: string;
        links: {
            html: string;
        };
    };
    /** Links for the photo page (attribution) and download reporting. */
    links: {
        html: string;
        download_location: string;
    };
    /** Accessibility description; null when the photographer set none. */
    alt_description?: string | null;
}
```

Extend `UnsplashImageResult` with:

```ts
    /** Small (400px) URL for thumbnail display. */
    thumbUrl: string;
    /** Unsplash download-reporting endpoint for this photo. */
    downloadLocation: string;
    /** Alt text for the photo, when Unsplash provides one. */
    description?: string;
```

In `buildRandomPhotoUrl`, add a trailing optional param and set it on the URL:

```ts
export function buildRandomPhotoUrl(
    accessKey: string,
    query?: string,
    orientation: Orientation = 'landscape',
    count?: number,
): string {
    const params = new URLSearchParams({
        orientation,
        client_id: accessKey,
    });

    if (query) {
        params.set('query', query);
    }

    if (count !== undefined) {
        params.set('count', String(count));
    }

    return `${UNSPLASH_RANDOM_URL}?${params.toString()}`;
}
```

In `parseUnsplashResponse`, add to the returned object:

```ts
        thumbUrl: data.urls.small,
        downloadLocation: data.links.download_location,
        description: typeof data.alt_description === 'string' && data.alt_description.length > 0
            ? data.alt_description
            : undefined,
```

In `isUnsplashPhoto`, add two conjuncts:

```ts
        hasString(data, 'urls', 'small') &&
        hasString(data, 'links', 'download_location') &&
```

Append the two new functions:

```ts
/**
 * Fetch several random photos in a single API request.
 *
 * Uses `/photos/random?count=N`, which returns an array and costs one
 * request against the (per-application) rate limit regardless of count.
 *
 * @returns The parsed results, or `undefined` if the fetch fails.
 * @throws {Error} If the response body is not an array of photos.
 */
export async function fetchRandomImages(
    accessKey: string,
    count: number,
    fetchFn: typeof fetch = fetch,
    query?: string,
    orientation: Orientation = 'landscape',
): Promise<UnsplashImageResult[] | undefined> {
    const url = buildRandomPhotoUrl(accessKey, query, orientation, count);

    const response = await fetchFn(url);

    if (!response.ok) {
        diagnostics.warn(
            `Unsplash API error: ${response.status} ${response.statusText}`,
        );

        return undefined;
    }

    const data: unknown = await response.json();

    if (!Array.isArray(data)) {
        throw new Error('Invalid Unsplash API response');
    }

    return data.map(parseUnsplashResponse);
}

/**
 * Report a photo as used, per the Unsplash API guidelines: apps must hit
 * the photo's `download_location` when the photo is actually used (here:
 * when a puzzle starts with it), not when it is merely displayed.
 *
 * Fire-and-forget semantics — failures are logged, never thrown, and the
 * response body is irrelevant.
 */
export async function triggerPhotoDownload(
    downloadLocation: string,
    accessKey: string,
    fetchFn: typeof fetch = fetch,
): Promise<void> {
    const url = new URL(downloadLocation);
    url.searchParams.set('client_id', accessKey);

    const response = await fetchFn(url.toString());

    if (!response.ok) {
        diagnostics.warn(
            `Unsplash download trigger failed: ${response.status} ${response.statusText}`,
        );
    }
}
```

In `src/images/index.ts`, add `fetchRandomImages` and `triggerPhotoDownload` to the export list from `./unsplash.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/images/unsplash.test.ts`
Expected: PASS (all, including pre-existing).

- [ ] **Step 5: Commit**

```bash
git add src/images/unsplash.ts src/images/index.ts src/images/unsplash.test.ts
git commit -m "feat(images): multi-photo fetch, download_location, download trigger"
```

---

### Task 2: Thread downloadLocation through resolveUnsplashImage

**Files:**
- Modify: `src/app/resolve-image.ts`
- Test: `src/app/resolve-image.test.ts`

**Interfaces:**
- Consumes: `UnsplashImageResult.downloadLocation` (Task 1).
- Produces: `ResolvedImage` gains `downloadLocation: string`.

- [ ] **Step 1: Write the failing test**

In `src/app/resolve-image.test.ts`, the existing `vi.mocked(fetchRandomImage).mockResolvedValue({...})` fixtures must gain the new required fields. Add to every mocked result object:

```ts
            thumbUrl: 'https://images.unsplash.com/photo-abc?w=400',
            downloadLocation: 'https://api.unsplash.com/photos/abc123/download?ixid=xyz',
```

Add one assertion to the existing happy-path test (the one mocking a successful fetch):

```ts
        expect(resolved!.downloadLocation).toBe(
            'https://api.unsplash.com/photos/abc123/download?ixid=xyz',
        );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/resolve-image.test.ts`
Expected: FAIL — `downloadLocation` is `undefined` on the resolved result.

- [ ] **Step 3: Implement**

In `src/app/resolve-image.ts`, add to `ResolvedImage`:

```ts
    /** Unsplash download-reporting endpoint, triggered when the game starts. */
    downloadLocation: string;
```

and add to the returned object in `resolveUnsplashImage`:

```ts
            downloadLocation: result.downloadLocation,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/resolve-image.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/resolve-image.ts src/app/resolve-image.test.ts
git commit -m "feat(app): expose downloadLocation on resolved Unsplash images"
```

---

### Task 3: Image picker component

**Files:**
- Create: `src/ui/image-picker.ts`
- Test: `src/ui/image-picker.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (candidate type defined here).
- Produces (used by Tasks 4, 5, 6):
  - `interface CandidateImage { imageUrl: string; thumbUrl: string; imageSize: { width: number; height: number }; attribution: { photographerName: string; photographerUrl: string; photoUrl: string }; downloadLocation: string; description?: string }`
  - `type NewGameImageChoice = { kind: 'photo'; photo: CandidateImage } | { kind: 'surprise' } | { kind: 'blank' }`
  - `createImagePicker(options: { fetchCandidates?: () => Promise<CandidateImage[] | null>; onPick: (choice: NewGameImageChoice) => void }): { element: HTMLElement; refresh(): void }`
  - Test ids: `image-picker-refresh`, `image-picker-tile`, `image-picker-surprise`, `image-picker-blank`. CSS hooks: `.image-picker`, `.image-picker-header`, `.image-picker-grid`, `.image-picker-tile`, `.image-picker-tile--loading`, `.image-picker-thumb`, `.image-picker-error`, `.image-picker-actions`, `.image-picker-action`.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/image-picker.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the new-game dialog's image picker section.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createImagePicker, type CandidateImage } from './image-picker.js';

function makeCandidate(n: number): CandidateImage {
    return {
        imageUrl: `https://images.unsplash.com/photo-${n}?w=1080`,
        thumbUrl: `https://images.unsplash.com/photo-${n}?w=400`,
        imageSize: { width: 1080, height: 720 },
        attribution: {
            photographerName: `Photographer ${n}`,
            photographerUrl: `https://unsplash.com/@p${n}`,
            photoUrl: `https://unsplash.com/photos/${n}`,
        },
        downloadLocation: `https://api.unsplash.com/photos/${n}/download`,
        description: `photo ${n}`,
    };
}

/** Flush pending microtasks so a resolved fetch promise applies. */
async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('createImagePicker', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    it('renders heading, four tiles, refresh, and both action buttons', () => {
        const picker = createImagePicker({
            fetchCandidates: vi.fn().mockResolvedValue([]),
            onPick: vi.fn(),
        });
        container.appendChild(picker.element);

        expect(container.querySelector('.size-picker-subtitle')?.textContent)
            .toBe('Pick an image to start');
        expect(container.querySelectorAll('[data-testid="image-picker-tile"]')).toHaveLength(4);
        expect(container.querySelector('[data-testid="image-picker-refresh"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="image-picker-surprise"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="image-picker-blank"]')).not.toBeNull();
    });

    it('fetches candidates on creation and shows loading tiles meanwhile', () => {
        const fetchCandidates = vi.fn().mockReturnValue(new Promise(() => {}));
        const picker = createImagePicker({ fetchCandidates, onPick: vi.fn() });
        container.appendChild(picker.element);

        expect(fetchCandidates).toHaveBeenCalledOnce();
        const tiles = container.querySelectorAll<HTMLButtonElement>('[data-testid="image-picker-tile"]');
        for (const tile of tiles) {
            expect(tile.disabled).toBe(true);
            expect(tile.classList.contains('image-picker-tile--loading')).toBe(true);
        }
    });

    it('renders thumbnails and enables tiles once candidates arrive', async () => {
        const candidates = [1, 2, 3, 4].map(makeCandidate);
        const picker = createImagePicker({
            fetchCandidates: vi.fn().mockResolvedValue(candidates),
            onPick: vi.fn(),
        });
        container.appendChild(picker.element);
        await flush();

        const imgs = container.querySelectorAll<HTMLImageElement>('.image-picker-thumb');
        expect(imgs).toHaveLength(4);
        expect(imgs[0].src).toBe('https://images.unsplash.com/photo-1?w=400');
        expect(imgs[0].alt).toBe('photo 1');
        const tiles = container.querySelectorAll<HTMLButtonElement>('[data-testid="image-picker-tile"]');
        expect(tiles[0].disabled).toBe(false);
    });

    it('hides surplus tiles when fewer candidates than tiles arrive', async () => {
        const picker = createImagePicker({
            fetchCandidates: vi.fn().mockResolvedValue([makeCandidate(1), makeCandidate(2)]),
            onPick: vi.fn(),
        });
        container.appendChild(picker.element);
        await flush();

        const tiles = container.querySelectorAll<HTMLButtonElement>('[data-testid="image-picker-tile"]');
        expect(tiles[1].hidden).toBe(false);
        expect(tiles[2].hidden).toBe(true);
        expect(tiles[3].hidden).toBe(true);
    });

    it('reports a photo pick with the full candidate', async () => {
        const onPick = vi.fn();
        const candidates = [1, 2, 3, 4].map(makeCandidate);
        const picker = createImagePicker({
            fetchCandidates: vi.fn().mockResolvedValue(candidates),
            onPick,
        });
        container.appendChild(picker.element);
        await flush();

        container.querySelectorAll<HTMLButtonElement>('[data-testid="image-picker-tile"]')[2].click();

        expect(onPick).toHaveBeenCalledWith({ kind: 'photo', photo: candidates[2] });
    });

    it('reports surprise and blank picks without any fetch dependency', () => {
        const onPick = vi.fn();
        const picker = createImagePicker({
            fetchCandidates: vi.fn().mockReturnValue(new Promise(() => {})),
            onPick,
        });
        container.appendChild(picker.element);

        container.querySelector<HTMLButtonElement>('[data-testid="image-picker-surprise"]')!.click();
        expect(onPick).toHaveBeenCalledWith({ kind: 'surprise' });

        container.querySelector<HTMLButtonElement>('[data-testid="image-picker-blank"]')!.click();
        expect(onPick).toHaveBeenCalledWith({ kind: 'blank' });
    });

    it('shows the error message when the fetch resolves null and retries on refresh', async () => {
        const fetchCandidates = vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce([1, 2, 3, 4].map(makeCandidate));
        const picker = createImagePicker({ fetchCandidates, onPick: vi.fn() });
        container.appendChild(picker.element);
        await flush();

        const error = container.querySelector<HTMLElement>('.image-picker-error')!;
        expect(error.hidden).toBe(false);

        container.querySelector<HTMLButtonElement>('[data-testid="image-picker-refresh"]')!.click();
        await flush();

        expect(error.hidden).toBe(true);
        expect(container.querySelectorAll('.image-picker-thumb')).toHaveLength(4);
    });

    it('shows the error message when the fetch rejects', async () => {
        const picker = createImagePicker({
            fetchCandidates: vi.fn().mockRejectedValue(new Error('boom')),
            onPick: vi.fn(),
        });
        container.appendChild(picker.element);
        await flush();

        expect(container.querySelector<HTMLElement>('.image-picker-error')!.hidden).toBe(false);
    });

    it('ignores a stale response that resolves after a newer refresh', async () => {
        let resolveFirst!: (v: CandidateImage[] | null) => void;
        const first = new Promise<CandidateImage[] | null>((r) => { resolveFirst = r; });
        const second = [1, 2, 3, 4].map(makeCandidate);
        const fetchCandidates = vi.fn()
            .mockReturnValueOnce(first)
            .mockResolvedValueOnce(second);

        const picker = createImagePicker({ fetchCandidates, onPick: vi.fn() });
        container.appendChild(picker.element);

        container.querySelector<HTMLButtonElement>('[data-testid="image-picker-refresh"]')!.click();
        await flush();
        expect(container.querySelectorAll('.image-picker-thumb')).toHaveLength(4);

        // The stale first fetch finally resolves with different (old) data —
        // it must not clobber the newer result.
        resolveFirst([makeCandidate(9)]);
        await flush();

        const imgs = container.querySelectorAll<HTMLImageElement>('.image-picker-thumb');
        expect(imgs).toHaveLength(4);
        expect(imgs[0].src).toBe('https://images.unsplash.com/photo-1?w=400');
    });

    it('hides the grid and refresh button when no fetchCandidates is provided', () => {
        const picker = createImagePicker({ onPick: vi.fn() });
        container.appendChild(picker.element);

        expect(container.querySelector<HTMLElement>('.image-picker-grid')!.hidden).toBe(true);
        expect(container.querySelector<HTMLElement>('[data-testid="image-picker-refresh"]')!.hidden).toBe(true);
        expect(container.querySelector('[data-testid="image-picker-surprise"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="image-picker-blank"]')).not.toBeNull();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/image-picker.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/ui/image-picker.ts`**

```ts
/**
 * Image picker — the start group of the new-game dialog. Shows four
 * candidate photos (tap one to start a game with it), a refresh control
 * that swaps the candidates, and Surprise me / Blank puzzle actions.
 *
 * Unlike the other dialog sections, this one is the game-start trigger:
 * every tile and action button fires `onPick`, and the dialog dismisses
 * itself in response. There is no selected state.
 */

/** A candidate photo the player can pick, pre-scaled for the puzzle. */
export interface CandidateImage {
    /** Full-quality URL used as the puzzle image (Unsplash `regular`). */
    imageUrl: string;
    /** Small URL hotlinked as the grid thumbnail (Unsplash `small`). */
    thumbUrl: string;
    /** Display size of the puzzle image (1080px wide, aspect-scaled). */
    imageSize: { width: number; height: number };
    attribution: {
        photographerName: string;
        photographerUrl: string;
        photoUrl: string;
    };
    /** Unsplash download-reporting endpoint, triggered when the game starts. */
    downloadLocation: string;
    /** Alt text, when Unsplash provides one. */
    description?: string;
}

/** What the player clicked to start the game. */
export type NewGameImageChoice =
    | { kind: 'photo'; photo: CandidateImage }
    | { kind: 'surprise' }
    | { kind: 'blank' };

export interface ImagePickerOptions {
    /**
     * Fetch a fresh candidate set. Absent when no Unsplash access key is
     * configured — the grid and refresh button are then hidden and only
     * Surprise me / Blank puzzle remain.
     */
    fetchCandidates?: () => Promise<CandidateImage[] | null>;
    /** Called when the player picks a photo, surprise, or blank. */
    onPick: (choice: NewGameImageChoice) => void;
}

export interface ImagePicker {
    element: HTMLElement;
    /** Re-fetch the candidate set (used when category/vibrant change). */
    refresh(): void;
}

/** Number of candidate photos requested and displayed. */
export const CANDIDATE_COUNT = 4;

export function createImagePicker(options: ImagePickerOptions): ImagePicker {
    const section = document.createElement('div');
    section.className = 'image-picker';

    const header = document.createElement('div');
    header.className = 'image-picker-header';

    const heading = document.createElement('h3');
    heading.className = 'size-picker-subtitle';
    heading.textContent = 'Pick an image to start';
    header.appendChild(heading);

    const refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.className = 'image-picker-refresh';
    refreshButton.dataset.testid = 'image-picker-refresh';
    refreshButton.title = 'Show different images';
    refreshButton.setAttribute('aria-label', 'Show different images');
    refreshButton.textContent = '↻';
    refreshButton.addEventListener('click', () => refresh());
    header.appendChild(refreshButton);

    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'image-picker-grid';
    const tiles: HTMLButtonElement[] = [];
    for (let i = 0; i < CANDIDATE_COUNT; i++) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'image-picker-tile';
        tile.dataset.testid = 'image-picker-tile';
        tile.disabled = true;
        tiles.push(tile);
        grid.appendChild(tile);
    }
    section.appendChild(grid);

    const error = document.createElement('p');
    error.className = 'image-picker-error';
    error.textContent = "Couldn't load images — tap ↻ to try again.";
    error.hidden = true;
    section.appendChild(error);

    const actions = document.createElement('div');
    actions.className = 'image-picker-actions';

    const surpriseButton = document.createElement('button');
    surpriseButton.type = 'button';
    surpriseButton.className = 'image-picker-action';
    surpriseButton.dataset.testid = 'image-picker-surprise';
    surpriseButton.textContent = '🎲 Surprise me';
    surpriseButton.addEventListener('click', () => options.onPick({ kind: 'surprise' }));
    actions.appendChild(surpriseButton);

    const blankButton = document.createElement('button');
    blankButton.type = 'button';
    blankButton.className = 'image-picker-action';
    blankButton.dataset.testid = 'image-picker-blank';
    blankButton.textContent = 'Blank puzzle';
    blankButton.addEventListener('click', () => options.onPick({ kind: 'blank' }));
    actions.appendChild(blankButton);

    section.appendChild(actions);

    // Stale-response guard: each refresh bumps the token, and only the
    // newest in-flight fetch may apply its result. A slow response from a
    // superseded fetch (earlier category, earlier refresh) is dropped.
    let fetchToken = 0;

    function setLoading(): void {
        error.hidden = true;
        for (const tile of tiles) {
            tile.replaceChildren();
            tile.hidden = false;
            tile.disabled = true;
            tile.classList.add('image-picker-tile--loading');
        }
    }

    function showCandidates(candidates: CandidateImage[]): void {
        for (let i = 0; i < tiles.length; i++) {
            const tile = tiles[i];
            const candidate = candidates[i];
            tile.replaceChildren();
            tile.classList.remove('image-picker-tile--loading');

            // Unsplash may return fewer photos than requested for narrow
            // queries; hide the tiles that have nothing to show.
            if (!candidate) {
                tile.hidden = true;
                tile.disabled = true;
                continue;
            }

            tile.hidden = false;
            tile.disabled = false;

            const img = document.createElement('img');
            img.className = 'image-picker-thumb';
            img.src = candidate.thumbUrl;
            img.alt = candidate.description ?? 'Puzzle image';
            img.draggable = false;
            tile.appendChild(img);

            // Property assignment (not addEventListener) so each refresh
            // replaces the previous candidate's handler.
            tile.onclick = () => options.onPick({ kind: 'photo', photo: candidate });
        }
    }

    function showError(): void {
        error.hidden = false;
        for (const tile of tiles) {
            tile.replaceChildren();
            tile.classList.remove('image-picker-tile--loading');
            tile.disabled = true;
        }
    }

    function refresh(): void {
        const fetchCandidates = options.fetchCandidates;
        if (!fetchCandidates) return;

        const token = ++fetchToken;
        setLoading();
        fetchCandidates().then(
            (candidates) => {
                if (token !== fetchToken) return;
                if (!candidates || candidates.length === 0) {
                    showError();
                    return;
                }
                showCandidates(candidates);
            },
            () => {
                if (token === fetchToken) showError();
            },
        );
    }

    if (options.fetchCandidates) {
        refresh();
    } else {
        grid.hidden = true;
        refreshButton.hidden = true;
    }

    return { element: section, refresh };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/image-picker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/image-picker.ts src/ui/image-picker.test.ts
git commit -m "feat(new-game-dialog): image picker component with candidate grid"
```

---

### Task 4: Candidate-fetch wrapper

**Files:**
- Create: `src/app/fetch-candidate-images.ts`
- Test: `src/app/fetch-candidate-images.test.ts`

**Interfaces:**
- Consumes: `fetchRandomImages` (Task 1), `CandidateImage` type (Task 3), `findImageCategory`/`buildImageQuery` (existing).
- Produces: `fetchCandidateImages(accessKey: string, imageCategory: string, vibrant: boolean, orientation: Orientation, fetchFn?: typeof fetch): Promise<CandidateImage[] | null>` and `CANDIDATE_IMAGE_COUNT = 4`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/fetch-candidate-images.test.ts` (mirrors `resolve-image.test.ts`'s mocking pattern — `vi.mock` of the images barrel):

```ts
/**
 * Tests for the candidate-image fetch wrapper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../images/index.js', () => ({ fetchRandomImages: vi.fn() }));

import { fetchRandomImages } from '../images/index.js';
import { fetchCandidateImages, CANDIDATE_IMAGE_COUNT } from './fetch-candidate-images.js';

function makeResult(n: number) {
    return {
        imageUrl: `https://images.unsplash.com/photo-${n}?w=1080`,
        thumbUrl: `https://images.unsplash.com/photo-${n}?w=400`,
        width: 4000,
        height: 2667,
        photographerName: `Photographer ${n}`,
        photographerUrl: `https://unsplash.com/@p${n}`,
        photoUrl: `https://unsplash.com/photos/${n}`,
        downloadLocation: `https://api.unsplash.com/photos/${n}/download`,
        description: `photo ${n}`,
    };
}

describe('fetchCandidateImages', () => {
    beforeEach(() => {
        vi.mocked(fetchRandomImages).mockReset();
    });

    it('maps results into candidates with 1080-scaled display size', async () => {
        vi.mocked(fetchRandomImages).mockResolvedValue([makeResult(1), makeResult(2)]);

        const candidates = await fetchCandidateImages('key', 'nature', false, 'landscape');

        expect(candidates).toHaveLength(2);
        expect(candidates![0]).toEqual({
            imageUrl: 'https://images.unsplash.com/photo-1?w=1080',
            thumbUrl: 'https://images.unsplash.com/photo-1?w=400',
            imageSize: { width: 1080, height: Math.round(1080 * (2667 / 4000)) },
            attribution: {
                photographerName: 'Photographer 1',
                photographerUrl: 'https://unsplash.com/@p1',
                photoUrl: 'https://unsplash.com/photos/1',
            },
            downloadLocation: 'https://api.unsplash.com/photos/1/download',
            description: 'photo 1',
        });
    });

    it('passes the category query, count, and orientation through', async () => {
        vi.mocked(fetchRandomImages).mockResolvedValue([makeResult(1)]);

        await fetchCandidateImages('key', 'nature', true, 'portrait');

        expect(fetchRandomImages).toHaveBeenCalledWith(
            'key',
            CANDIDATE_IMAGE_COUNT,
            fetch,
            'nature landscape vibrant colorful',
            'portrait',
        );
    });

    it('returns null when the fetch yields nothing', async () => {
        vi.mocked(fetchRandomImages).mockResolvedValue(undefined);

        expect(await fetchCandidateImages('key', 'any', false, 'landscape')).toBeNull();
    });

    it('returns null when the fetch returns an empty array', async () => {
        vi.mocked(fetchRandomImages).mockResolvedValue([]);

        expect(await fetchCandidateImages('key', 'any', false, 'landscape')).toBeNull();
    });

    it('returns null and warns when the fetch throws', async () => {
        vi.mocked(fetchRandomImages).mockRejectedValue(new Error('network down'));

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await fetchCandidateImages('key', 'any', false, 'landscape')).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/fetch-candidate-images.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/app/fetch-candidate-images.ts`**

```ts
/**
 * Fetch the candidate photos shown in the new-game dialog's image picker
 * and map them into the picker's shape. Returns `null` when the fetch
 * fails or yields nothing — the picker shows its inline error state and
 * the player can retry via the refresh button, so failures here are
 * logged but not tracked as analytics events.
 */

import { diagnostics } from '../diagnostics.js';
import { fetchRandomImages } from '../images/index.js';
import { findImageCategory, buildImageQuery } from '../game/image-categories.js';
import type { Orientation } from '../model/types.js';
import type { CandidateImage } from '../ui/image-picker.js';

/** How many candidates one picker fetch requests (a single API call). */
export const CANDIDATE_IMAGE_COUNT = 4;

export async function fetchCandidateImages(
    accessKey: string,
    imageCategory: string,
    vibrant: boolean,
    orientation: Orientation,
    fetchFn: typeof fetch = fetch,
): Promise<CandidateImage[] | null> {
    try {
        const category = findImageCategory(imageCategory);
        const query = buildImageQuery(category.query, vibrant);
        const results = await fetchRandomImages(
            accessKey,
            CANDIDATE_IMAGE_COUNT,
            fetchFn,
            query,
            orientation,
        );

        if (!results || results.length === 0) {
            return null;
        }

        return results.map((result) => {
            // Same display-size derivation as resolveUnsplashImage: the
            // "regular" URL delivers 1080px-wide images.
            const aspectRatio = result.height / result.width;
            const displayWidth = 1080;
            const candidate: CandidateImage = {
                imageUrl: result.imageUrl,
                thumbUrl: result.thumbUrl,
                imageSize: {
                    width: displayWidth,
                    height: Math.round(displayWidth * aspectRatio),
                },
                attribution: {
                    photographerName: result.photographerName,
                    photographerUrl: result.photographerUrl,
                    photoUrl: result.photoUrl,
                },
                downloadLocation: result.downloadLocation,
            };
            if (result.description !== undefined) {
                candidate.description = result.description;
            }
            return candidate;
        });
    } catch (error) {
        diagnostics.warn('Failed to fetch candidate images:', error);
        return null;
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/fetch-candidate-images.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/fetch-candidate-images.ts src/app/fetch-candidate-images.test.ts
git commit -m "feat(app): candidate-image fetch wrapper for the picker"
```

---

### Task 5: Dialog restructure — picker starts the game, size becomes a select

**Files:**
- Modify: `src/ui/new-game-dialog.ts`
- Test: `src/ui/new-game-dialog.test.ts`

**Interfaces:**
- Consumes: `createImagePicker`, `CandidateImage`, `NewGameImageChoice`, `ImagePicker` (Task 3).
- Produces (used by Task 7):
  - `NewGameSelection`: `imageSource: string` is REMOVED; `imageChoice: NewGameImageChoice` added. All other fields unchanged.
  - `NewGameDialogOptions`: `savedImageSource` REMOVED; added `fetchImageCandidates?: (imageCategory: string, vibrant: boolean) => Promise<CandidateImage[] | null>`.
  - `getSizeClass` export REMOVED (only the deleted size grid used it).
  - New test id `size-select` on the puzzle-size `<select>`.
  - DOM: settings group = cut style, rotation, fractal/wavy/composable sections, size row, `.image-options-section` (category + vibrant); start group = `.image-picker` only.

- [ ] **Step 1: Rewrite the failing tests**

Edit `src/ui/new-game-dialog.test.ts`:

1. Delete the entire `describe('getSizeClass', ...)` block and remove `getSizeClass` from the import.
2. Add a module-level helper after the imports:

```ts
/** Start the game the way the new dialog does it: click "Surprise me". */
function pickSurprise(container: HTMLElement): void {
    container
        .querySelector<HTMLButtonElement>('[data-testid="image-picker-surprise"]')!
        .click();
}
```

3. Every existing trigger of the form `container.querySelectorAll<...>('.size-picker-option')[N].click()` (and the `sizeButtons[0].click()` / `buttons[3].click()` variants) becomes `pickSurprise(container)`. The two tests that clicked a *specific* size (`buttons[3]` for `'192'`, `sizeButtons[0]` for `'24'`) instead set the select first:

```ts
        const select = container.querySelector<HTMLSelectElement>('[data-testid="size-select"]')!;
        select.value = '192';
        select.dispatchEvent(new Event('change'));
        pickSurprise(container);
```

4. Every full-payload `expect(onSelect).toHaveBeenCalledWith({...})` swaps `imageSource: 'random',` for `imageChoice: { kind: 'surprise' },` (with `wavyConfig: undefined` where already present; the first full-payload test at old line 83 keeps its other fields).
5. Replace the size-button rendering tests (`shows the correct number of size options`, `marks the selected option`, `displays piece count in each button`, `shows approximate piece counts...`, `never renders grid dimensions...`) with select-based equivalents:

```ts
    it('renders one select option per puzzle size', () => {
        createNewGameDialog({ container, selectedSizeId: '48', onSelect: vi.fn() });

        const select = container.querySelector<HTMLSelectElement>('[data-testid="size-select"]')!;
        expect(select.options).toHaveLength(PUZZLE_SIZE_OPTIONS.length);
        expect(select.value).toBe('48');
        expect(select.options[0].textContent).toBe('24 pieces');
        expect(select.options[3].textContent).toBe('192 pieces');
    });

    it('shows approximate piece counts for triangles', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'triangles',
            onSelect: vi.fn(),
        });

        const select = container.querySelector<HTMLSelectElement>('[data-testid="size-select"]')!;
        expect(select.options[0].textContent).toBe('~24 pieces');
        expect(select.options[3].textContent).toBe('~192 pieces');
    });

    it('switches size labels to approximate when the cut style changes to fractal', () => {
        createNewGameDialog({ container, selectedSizeId: '48', onSelect: vi.fn() });

        container.querySelector<HTMLButtonElement>('[data-cut-style-id="fractal"]')!.click();

        const select = container.querySelector<HTMLSelectElement>('[data-testid="size-select"]')!;
        expect(select.options[1].textContent).toBe('~48 pieces');
    });
```

6. Add picker-integration tests in the main describe:

```ts
    it('reports a picked photo through onSelect and dismisses', async () => {
        const onSelect = vi.fn();
        const candidate = {
            imageUrl: 'https://images.unsplash.com/photo-1?w=1080',
            thumbUrl: 'https://images.unsplash.com/photo-1?w=400',
            imageSize: { width: 1080, height: 720 },
            attribution: {
                photographerName: 'P1',
                photographerUrl: 'https://unsplash.com/@p1',
                photoUrl: 'https://unsplash.com/photos/1',
            },
            downloadLocation: 'https://api.unsplash.com/photos/1/download',
        };
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            onSelect,
            fetchImageCandidates: vi.fn().mockResolvedValue([candidate]),
        });
        await Promise.resolve();
        await Promise.resolve();

        container.querySelector<HTMLButtonElement>('[data-testid="image-picker-tile"]')!.click();

        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({ imageChoice: { kind: 'photo', photo: candidate } }),
        );
        expect(container.querySelector('.size-picker-overlay')).toBeNull();
    });

    it('re-fetches candidates when the category or vibrant option changes', () => {
        const fetchImageCandidates = vi.fn().mockResolvedValue(null);
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            onSelect: vi.fn(),
            fetchImageCandidates,
        });
        expect(fetchImageCandidates).toHaveBeenCalledTimes(1);
        expect(fetchImageCandidates).toHaveBeenLastCalledWith('any', false);

        const categorySelect = container.querySelector<HTMLSelectElement>(
            '.image-options-section select',
        )!;
        categorySelect.value = 'nature';
        categorySelect.dispatchEvent(new Event('change'));
        expect(fetchImageCandidates).toHaveBeenCalledTimes(2);
        expect(fetchImageCandidates).toHaveBeenLastCalledWith('nature', false);

        const vibrant = container.querySelector<HTMLInputElement>(
            '.image-options-section input[type="checkbox"]',
        )!;
        vibrant.checked = true;
        vibrant.dispatchEvent(new Event('change'));
        expect(fetchImageCandidates).toHaveBeenCalledTimes(3);
        expect(fetchImageCandidates).toHaveBeenLastCalledWith('nature', true);
    });

    it('hides the candidate grid when no fetchImageCandidates is provided', () => {
        createNewGameDialog({ container, selectedSizeId: '48', onSelect: vi.fn() });

        expect(container.querySelector<HTMLElement>('.image-picker-grid')!.hidden).toBe(true);
    });
```

7. Update the responsive-layout describe: in `places every section inside the scrollable content wrapper` replace `'.image-source-section'` → `'.image-options-section'` and `'.size-picker-grid'` → `'.image-picker'`; in `splits sections into settings and start groups` expect settings to contain `.image-options-section` and `[data-testid="size-select"]`, and start to contain `.image-picker` (and NOT `.image-options-section`); replace the `renders the "Puzzle Size" heading...` test with:

```ts
    it('renders the picker heading inside the start group', () => {
        openDialog();
        const start = container.querySelector('.dialog-group--start')!;
        expect(start.querySelector('.size-picker-subtitle')?.textContent)
            .toBe('Pick an image to start');
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/new-game-dialog.test.ts`
Expected: FAIL — `imageChoice` missing, no `size-select`, no picker.

- [ ] **Step 3: Implement in `src/ui/new-game-dialog.ts`**

1. Update the module doc comment: the dialog is dismissed by picking an image (photo tile, Surprise me, or Blank puzzle), clicking the backdrop, or pressing Escape; image picks fire `onSelect`.
2. Imports: add `import { createImagePicker, type CandidateImage, type ImagePicker, type NewGameImageChoice } from './image-picker.js';`.
3. `NewGameSelection`: replace `imageSource: string;` with `imageChoice: NewGameImageChoice;` (keep `imageCategory`/`vibrant`).
4. `NewGameDialogOptions`: delete `savedImageSource`; add:

```ts
    /**
     * Fetch candidate photos for the image picker, given the currently
     * selected category and vibrant values. Absent when no Unsplash
     * access key is configured — the picker hides its grid.
     */
    fetchImageCandidates?: (
        imageCategory: string,
        vibrant: boolean,
    ) => Promise<CandidateImage[] | null>;
```

5. Delete `getSizeClass`, the `SizeSection` interface, and `buildSizeSection`. Replace with:

```ts
interface SizeSelectRow {
    element: HTMLElement;
    getValue(): string;
    /** Re-render option labels (approximate counts for fractal/triangles). */
    updateLabels(): void;
}

function buildSizeSelectRow(args: {
    selectedSizeId: string;
    getCutStyleId: () => string;
}): SizeSelectRow {
    const row = document.createElement('div');
    row.className = 'dialog-row';

    const label = document.createElement('label');
    label.className = 'dialog-row-label';
    label.textContent = 'Puzzle size';

    const select = document.createElement('select');
    select.className = 'dialog-row-input';
    select.dataset.testid = 'size-select';
    for (const opt of PUZZLE_SIZE_OPTIONS) {
        const el = document.createElement('option');
        el.value = opt.id;
        select.appendChild(el);
    }
    select.value = args.selectedSizeId;

    function updateLabels(): void {
        // Fractal and Triangles piece counts are approximate: fractal scales
        // an internal grid, and the triangle lattice derives its column count
        // from the image aspect ratio (unknown until the photo is fetched).
        // Both therefore show ~N rather than an exact piece count.
        const cutStyleId = args.getCutStyleId();
        const isApproximate = cutStyleId === 'fractal' || cutStyleId === 'triangles';
        const optionEls = select.querySelectorAll('option');
        PUZZLE_SIZE_OPTIONS.forEach((opt, i) => {
            optionEls[i].textContent = isApproximate
                ? `~${opt.pieceCount} pieces`
                : `${opt.pieceCount} pieces`;
        });
    }

    updateLabels();

    row.appendChild(label);
    row.appendChild(select);

    return { element: row, getValue: () => select.value, updateLabels };
}
```

6. Rename `buildImageSourceSection` → `buildImageOptionsSection` (interface `ImageSourceSection` → `ImageOptionsSection`): delete the whole source-select row, the `updateCategoryVisibility` function and its wiring; section class becomes `'image-options-section'`; args become `{ savedImageCategory?, savedVibrant?, onChange: () => void }`; `getValues()` returns `{ imageCategory, vibrant }` only; wire `categorySelect.addEventListener('change', args.onChange)` and `vibrantCheckbox.addEventListener('change', args.onChange)`.
7. In `createNewGameDialog`:
   - Delete `sizeSubtitle`.
   - Declare `let imagePicker: ImagePicker | undefined;` before the sections, then:

```ts
    const imageOptionsSection = buildImageOptionsSection({
        savedImageCategory: options.savedImageCategory,
        savedVibrant: options.savedVibrant,
        onChange: () => imagePicker?.refresh(),
    });

    const sizeRow = buildSizeSelectRow({
        selectedSizeId,
        getCutStyleId: () => currentCutStyleId,
    });
```

   - Replace the whole `buildSizeSection` call + `onPick` block with (after `rotationRow` is created, since it closes over `rotationCheckbox`):

```ts
    imagePicker = createImagePicker({
        fetchCandidates: options.fetchImageCandidates
            ? () => {
                const { imageCategory, vibrant } = imageOptionsSection.getValues();
                return options.fetchImageCandidates!(imageCategory, vibrant);
            }
            : undefined,
        onPick: (imageChoice) => {
            dismiss();
            onSelect({
                sizeId: sizeRow.getValue(),
                cutStyleId: currentCutStyleId,
                composableConfig: currentCutStyleId === 'composable'
                    ? composableSection.getValues()
                    : undefined,
                fractalConfig: currentCutStyleId === 'fractal'
                    ? fractalSection.getValues()
                    : undefined,
                wavyConfig: currentCutStyleId === 'wavy'
                    ? wavySection.getValues()
                    : undefined,
                rotationEnabled: rotationCheckbox.checked,
                imageChoice,
                ...imageOptionsSection.getValues(),
            });
        },
    });
```

   - In `createCutStylePicker`'s `onSelect`, replace `sizeSection.updateLabels()` with `sizeRow.updateLabels()`.
   - Group assembly (update the explanatory comment too — settings/options left, the image picker is the action):

```ts
    settingsGroup.appendChild(cutStyleSection);
    settingsGroup.appendChild(rotationRow);
    settingsGroup.appendChild(fractalSection.element);
    settingsGroup.appendChild(wavySection.element);
    settingsGroup.appendChild(composableSection.element);
    settingsGroup.appendChild(sizeRow.element);
    settingsGroup.appendChild(imageOptionsSection.element);

    const startGroup = document.createElement('div');
    startGroup.className = 'dialog-group dialog-group--start';
    startGroup.appendChild(imagePicker.element);
```

   Note: `createImagePicker` fetches on creation, i.e. on every dialog open — that is the spec's "fetch on open".

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/new-game-dialog.test.ts src/ui/image-picker.test.ts`
Expected: PASS. (`src/main.ts` is now type-broken until Task 7 — that is expected; vitest does not typecheck main.ts here.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/new-game-dialog.ts src/ui/new-game-dialog.test.ts
git commit -m "feat(new-game-dialog): image picks start the game, size grid becomes select"
```

---

### Task 6: CSS for the picker; remove dead size-grid styles

**Files:**
- Modify: `src/style.css`

**Interfaces:**
- Consumes: class names from Task 3.
- Produces: styles only.

- [ ] **Step 1: Remove dead rules**

In `src/style.css` delete these rule blocks (currently `src/style.css:623-677`): `.size-picker-grid`, `.size-picker-option`, `.size-picker-option:hover`, `.size-picker-option:active`, `.size-picker-option--selected`, `.size-picker-option--selected:hover`, `.size-picker-count`, `.size-picker-label`. Keep `.size-picker-subtitle` (reused as the picker heading). Update the two-column media-query comment (`src/style.css:849-855`) to say "settings left, image picker right".

- [ ] **Step 2: Add picker styles**

Insert where the size-grid rules were removed:

```css
/* Image picker (start group of the new-game dialog) */
.image-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.image-picker-header .size-picker-subtitle {
  margin: 0;
}

.image-picker-refresh {
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 1rem;
  line-height: 1;
  color: var(--ui-fg);
  background: var(--ui-overlay-subtle);
  border: 1px solid var(--ui-border-subtle);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.image-picker-refresh:hover {
  background: var(--ui-overlay-hover);
  border-color: var(--ui-border);
}

.image-picker-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 10px;
}

.image-picker-tile {
  aspect-ratio: 16 / 10;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 12px;
  background: var(--ui-overlay-subtle);
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.1s ease;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}

.image-picker-tile:hover {
  border-color: var(--ui-border);
}

.image-picker-tile:active {
  transform: scale(0.97);
}

.image-picker-tile:disabled {
  cursor: default;
  transform: none;
}

.image-picker-tile--loading {
  animation: image-tile-pulse 1.2s ease-in-out infinite;
}

@keyframes image-tile-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

.image-picker-thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-picker-error {
  font-size: 0.75rem;
  color: var(--ui-muted);
  margin: 0 0 10px;
}

.image-picker-actions {
  display: flex;
  gap: 10px;
}

.image-picker-action {
  flex: 1;
  padding: 10px 8px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 10px;
  background: var(--ui-overlay-subtle);
  color: var(--ui-fg);
  font-family: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}

.image-picker-action:hover {
  background: var(--ui-overlay-hover);
  border-color: var(--ui-border);
}

.image-picker-action:active {
  transform: scale(0.97);
}
```

- [ ] **Step 3: Run the style guard tests**

Run: `npx vitest run src/style.test.ts src/ui/palette.test.ts`
Expected: PASS (guards target `.size-picker-dialog` and `.dialog-content`, which are untouched).

- [ ] **Step 4: Commit**

```bash
git add src/style.css
git commit -m "feat(new-game-dialog): image picker styles, drop size-grid styles"
```

---

### Task 7: Wire main.ts — picked photo, download trigger, candidate fetching

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `fetchCandidateImages` (Task 4), `triggerPhotoDownload` (Task 1), `CandidateImage` (Task 3), dialog changes (Task 5), `ResolvedImage.downloadLocation` (Task 2).
- Produces: `startNewGame(..., seed?: number, pickedImage?: CandidateImage)` — new trailing param; existing callers (`__startVennPuzzle`, `__newComposableGame`, boot/first-run) unchanged.

- [ ] **Step 1: Add imports**

Add `triggerPhotoDownload` to the existing import from `./images/index.js` (check the existing import near `getUnsplashAccessKey`, `src/main.ts:127` region), and add:

```ts
import { fetchCandidateImages } from './app/fetch-candidate-images.js';
import type { CandidateImage } from './ui/image-picker.js';
```

- [ ] **Step 2: Extend `startNewGame` (src/main.ts:892)**

Add a trailing parameter after `seed?: number`:

```ts
    pickedImage?: CandidateImage,
```

Update the function doc comment: "Start a new game. Uses the player-picked photo when one is given; otherwise fetches a random Unsplash image if available. Falls back to the default image if the API key is missing or fetch fails."

Replace the image-resolution block (currently `src/main.ts:952-967`, from the `// Try to fetch...` comment through the `if (accessKey) {...}` block) with:

```ts
        // Unsplash access is needed for the random fetch and for the
        // download trigger on a picked photo — but not for blank or the
        // deterministic first-run puzzle (bundled defaults set above).
        const accessKey =
            imageSource !== 'blank' && imageSource !== 'first-run'
                ? getUnsplashAccessKey()
                : null;

        let downloadLocation: string | undefined;

        if (imageSource !== 'blank' && pickedImage) {
            // The player picked a concrete candidate in the dialog — use it
            // directly, no second API call.
            imageUrl = pickedImage.imageUrl;
            imageSize = pickedImage.imageSize;
            attribution = pickedImage.attribution;
            downloadLocation = pickedImage.downloadLocation;
        } else if (accessKey) {
            const resolved = await resolveUnsplashImage(accessKey, imageCategory ?? 'any', vibrant, orientation);
            if (resolved) {
                imageUrl = resolved.imageUrl;
                imageSize = resolved.imageSize;
                attribution = resolved.attribution;
                downloadLocation = resolved.downloadLocation;
            }
        }

        // Unsplash guidelines: report a "download" when a photo is actually
        // used. Fire-and-forget — a failure must never block the game.
        if (accessKey && downloadLocation) {
            triggerPhotoDownload(downloadLocation, accessKey).catch(() => {});
        }
```

- [ ] **Step 3: Rewire the New Game button (src/main.ts:1044-1126)**

In `onNewGame`, remove `const savedImageSource = loadImageSourcePreference();` and the `savedImageSource: savedImageSource,` line. Add to the `createNewGameDialog` options:

```ts
            fetchImageCandidates: (() => {
                const accessKey = getUnsplashAccessKey();
                if (!accessKey) return undefined;
                return (imageCategory: string, vibrant: boolean) =>
                    fetchCandidateImages(
                        accessKey,
                        imageCategory,
                        vibrant,
                        orientationForViewport({
                            width: app.clientWidth || window.innerWidth,
                            height: app.clientHeight || window.innerHeight,
                        }),
                    );
            })(),
```

In `onSelect`, change the destructuring `imageSource` → `imageChoice`, and:
- replace `saveImageSourcePreference(imageSource);` with:

```ts
                // No UI reads this preference anymore, but first-run
                // detection depends on the key existing, and analytics
                // still classifies by it.
                saveImageSourcePreference(imageChoice.kind === 'blank' ? 'blank' : 'random');
```

- replace the `startNewGame(...)` call's `imageSource,` argument with `imageChoice.kind === 'blank' ? 'blank' : 'random',` and append two trailing arguments after `rotationEnabled`:

```ts
                    undefined, // seed — fresh random for every dialog game
                    imageChoice.kind === 'photo' ? imageChoice.photo : undefined,
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean typecheck; all tests PASS.

- [ ] **Step 5: Manual smoke test**

Run `npm run dev`, open the app, click New Game and verify: four thumbnails load; ↻ swaps them; changing Picture Type / Vibrant re-fetches; clicking a thumbnail starts a game with exactly that image; Surprise me starts with a different, unseen image; Blank puzzle starts a white puzzle; size select + cut style still apply. Also verify a dev build **without** `VITE_UNSPLASH_ACCESS_KEY` (comment it out of `.env` if present) hides the grid but Surprise me / Blank still work.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): start games from picked images, trigger Unsplash downloads"
```

---

### Task 8: Info-modal help text

**Files:**
- Modify: `src/ui/info-modal.ts`

**Interfaces:** none.

- [ ] **Step 1: Update the New Game bullet**

The current copy (`src/ui/info-modal.ts:130-136`) says "Start fresh with a random image; pick puzzle size, cut style, image source and picture type in the dialog" — wrong on two counts now (no image-source dropdown; images are tapped to start). Replace that `appendInlineLi(buttons, [...])` call with:

```ts
    appendInlineLi(buttons, [
        '🎮 ',
        ['strong', 'New Game'],
        ' — Choose puzzle size, cut style and picture type, then tap one of the suggested photos to start (↻ swaps them for a new set) — or ',
        ['strong', 'Surprise me'],
        ' for a fresh random photo. Tick ',
        ['strong', 'Vibrant colours'],
        ' for more saturated photos.',
    ]);
```

- [ ] **Step 2: Run the modal tests**

Run: `npx vitest run src/ui/info-modal.test.ts`
Expected: PASS (no test asserts this copy, but confirm).

- [ ] **Step 3: Commit**

```bash
git add src/ui/info-modal.ts
git commit -m "docs(info-modal): describe the image-picker start flow"
```

---

### Task 9: Full verification

**Files:** none new.

- [ ] **Step 1: Full suite + build**

Run: `npm test && npm run build`
Expected: all tests pass; `tsc` + vite build clean.

- [ ] **Step 2: Grep for leftovers**

Run: `grep -rn "getSizeClass\|savedImageSource\|image-source-section\|size-picker-option\|size-picker-grid" src/`
Expected: no hits (the `imageSource` *parameter* of `startNewGame` and the preference module legitimately remain; those names are not in this grep).

- [ ] **Step 3: Commit any stragglers, then hand off**

Branch, push, and PR per repo workflow (rebase-and-merge repo; PR body references the spec).

## Self-Review Notes

- Spec coverage: interaction model (Task 5), size select w/ approximate labels (Task 5), grouping + heading (Task 5/6), fetch-on-open/category-change/refresh (Tasks 3/5), one-request `count=4` (Task 1/4), download trigger at game start with both paths consistent (Tasks 1/2/7), degradation no-key/error (Tasks 3/5/7), persistence semantics (Task 7), help text (Task 8), tests colocated (all).
- `startNewGame` branching tests: covered indirectly via Task 4 (mapping) and manual smoke (Task 7 Step 5) — `main.ts` is a monolith without a test harness; extracting it is out of scope per spec ("where practical").
