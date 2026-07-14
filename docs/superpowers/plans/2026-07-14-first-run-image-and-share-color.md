# First-Run Image & Share-Link Background Colour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A brand-new visitor's first puzzle uses a hand-picked bundled image instead of a random Unsplash photo, and share links carry the sharer's background colour so colour-preference-less recipients see the intended image/background pairing — plus analytics for both and for background-colour switching.

**Architecture:** A new `src/app/bundled-image.ts` constants module owns the bundled asset's URL/size/attribution; `startNewGame` gains a `'first-run'` image-source sentinel gated by "empty save + no image preferences" at boot. The share codec gains an optional `bgc` field (no version bump) and `background-color.ts` gains an `adoptSharedBackgroundColor` helper that only fires for recipients with no stored colour preference.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom for DOM-touching tests). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-14-first-run-image-and-share-color-design.md`

## Global Constraints

- American English in all identifiers/comments (`color`, not `colour`) — prose in docs/commits may be British.
- `public/puzzle-image.jpg` must NOT be modified or deleted — old saves/share links reference it with 800×600 geometry.
- No new `random()` calls on the outer PRNG stream anywhere (this plan needs none; do not add any).
- Share payload stays `v: 1`; `bgc` is optional so old links and old clients both keep working.
- Test files live next to the source they test.
- Run tests with `npm test` (vitest run), typecheck with `npx tsc --noEmit`.
- Every commit message ends with the two trailer lines:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01AtPUje14CAshHjzF5NVcTR
  ```

---

### Task 1: Bundled-image asset + constants module

**Files:**
- Create: `public/first-puzzle.jpg` (copy from scratchpad, see Step 1)
- Create: `src/app/bundled-image.ts`

**Interfaces:**
- Produces: `BUNDLED_IMAGE_URL: string` (`'first-puzzle.jpg'`), `BUNDLED_IMAGE_SIZE: { width: 1080, height: 722 }`, `BUNDLED_IMAGE_ATTRIBUTION: ImageAttribution` — consumed by Tasks 2 and 3.

- [ ] **Step 1: Copy the asset into public/**

The reviewed image (Barney Goodman, Unsplash `BS-bOYlt_Lg`, 1080×722, ~290 KB) is already downloaded:

```bash
cp "/private/tmp/claude-503/-Users-bot-src-puzzle/db0ac9ec-1b2b-452d-b4f8-5b900933a552/scratchpad/first-puzzle-v2.jpg" /Users/bot/src/puzzle/public/first-puzzle.jpg
sips -g pixelWidth -g pixelHeight /Users/bot/src/puzzle/public/first-puzzle.jpg
```

Expected: `pixelWidth: 1080`, `pixelHeight: 722`. If the scratchpad file is missing, re-download: `curl -sL "https://images.unsplash.com/photo-1782754569620-67bac3fc8d4e?w=1080&q=80&fit=max" -o public/first-puzzle.jpg` and re-verify dimensions.

- [ ] **Step 2: Create the constants module**

Create `src/app/bundled-image.ts`:

```ts
/**
 * The image bundled with the app (`public/first-puzzle.jpg`). It plays
 * two roles: the pre-determined image for a brand-new visitor's first
 * puzzle (chosen to contrast well with the default background), and
 * the fallback when the Unsplash fetch fails.
 *
 * The previous fallback asset `public/puzzle-image.jpg` must stay in
 * the deploy untouched: old saves and share links reference that URL
 * with 800×600 geometry.
 */

import type { ImageAttribution } from '../model/types.js';

/** Relative URL — resolves against the app origin, like all bundled assets. */
export const BUNDLED_IMAGE_URL = 'first-puzzle.jpg';

export const BUNDLED_IMAGE_SIZE = { width: 1080, height: 722 };

export const BUNDLED_IMAGE_ATTRIBUTION: ImageAttribution = {
    photographerName: 'Barney Goodman',
    photographerUrl:
        'https://unsplash.com/@bgoodpic?utm_source=puzzle&utm_medium=referral',
    photoUrl:
        'https://unsplash.com/photos/BS-bOYlt_Lg?utm_source=puzzle&utm_medium=referral',
};
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add public/first-puzzle.jpg src/app/bundled-image.ts
git commit -m "feat(first-run): bundle the hand-picked first-puzzle image

The Barney Goodman Norwich photo (Unsplash BS-bOYlt_Lg, 1080x722)
will serve as both the deterministic first-run puzzle image and the
Unsplash-failure fallback. The old public/puzzle-image.jpg stays:
existing saves and share links reference it with 800x600 geometry."
```

(Append the two trailer lines from Global Constraints to this and every commit.)

---

### Task 2: Extract `classifyImageSource` with a `'bundled'` class

**Files:**
- Create: `src/app/classify-image-source.ts`
- Create: `src/app/classify-image-source.test.ts`
- Modify: `src/main.ts:204-223` (delete local function, import instead)

**Interfaces:**
- Consumes: `BUNDLED_IMAGE_URL` from Task 1.
- Produces: `classifyImageSource(imageUrl: string): 'unsplash' | 'blank' | 'bundled' | 'fallback'` — consumed by Task 3 and by existing call sites in `main.ts` (lines 240, 1019, 1355).

- [ ] **Step 1: Write the failing test**

Create `src/app/classify-image-source.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { classifyImageSource } from './classify-image-source.js';
import { BUNDLED_IMAGE_URL } from './bundled-image.js';

describe('classifyImageSource', () => {
    it('classifies data URLs as blank', () => {
        expect(classifyImageSource('data:image/png;base64,AAAA')).toBe('blank');
    });

    it('classifies the bundled image as bundled', () => {
        expect(classifyImageSource(BUNDLED_IMAGE_URL)).toBe('bundled');
    });

    it('classifies Unsplash URLs as unsplash', () => {
        expect(
            classifyImageSource('https://images.unsplash.com/photo-123?w=1080'),
        ).toBe('unsplash');
    });

    it('classifies the legacy fallback image as fallback', () => {
        expect(classifyImageSource('puzzle-image.jpg')).toBe('fallback');
    });

    it('classifies other hosts and malformed URLs as fallback', () => {
        expect(classifyImageSource('https://example.com/x.jpg')).toBe('fallback');
        expect(classifyImageSource('http://[malformed')).toBe('fallback');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/classify-image-source.test.ts`
Expected: FAIL — cannot resolve `./classify-image-source.js`.

- [ ] **Step 3: Create the module**

Create `src/app/classify-image-source.ts` (body moved from `main.ts:204-223`, plus the bundled check):

```ts
import { BUNDLED_IMAGE_URL } from './bundled-image.js';

/**
 * Heuristically classify a puzzle image URL into one of the sources we
 * care about for analytics. Used when the puzzle origin (a share
 * payload, or a resumed save) only carries the URL — not the choice
 * that produced it.
 *
 * `'bundled'` is the shipped image (first-run puzzles and
 * Unsplash-failure fallbacks — the fresh-game path distinguishes the
 * two itself); `'fallback'` covers the legacy `puzzle-image.jpg` from
 * old saves/links plus anything unrecognized.
 */
export function classifyImageSource(
    imageUrl: string,
): 'unsplash' | 'blank' | 'bundled' | 'fallback' {
    if (imageUrl.startsWith('data:')) {
        return 'blank';
    }
    if (imageUrl === BUNDLED_IMAGE_URL) {
        return 'bundled';
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

In `src/main.ts`: delete the local `classifyImageSource` function (lines 204-223 including its doc comment) and add to the imports near the other `./app/` imports (around line 118):

```ts
import { classifyImageSource } from './app/classify-image-source.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/classify-image-source.test.ts && npx tsc --noEmit`
Expected: 5 tests PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/classify-image-source.ts src/app/classify-image-source.test.ts src/main.ts
git commit -m "refactor(analytics): extract classifyImageSource, add bundled class

The bundled first-puzzle image needs its own analytics class so it
is not misreported as 'fallback'. Extracting the helper from main.ts
makes the classification unit-testable."
```

---

### Task 3: `'first-run'` sentinel in `startNewGame` + bundled fallback constants

**Files:**
- Modify: `src/main.ts:123-125` (fallback constants), `src/main.ts:939-966` (startNewGame image selection), `src/main.ts:1012-1030` (fresh-game analytics)

**Interfaces:**
- Consumes: `BUNDLED_IMAGE_URL`, `BUNDLED_IMAGE_SIZE`, `BUNDLED_IMAGE_ATTRIBUTION` (Task 1); `classifyImageSource` (Task 2).
- Produces: `startNewGame(..., imageSource?: string, ...)` now honors `imageSource === 'first-run'`: bundled image + attribution, no Unsplash fetch, analytics `imageSource: 'first-run'`. Task 4 passes the sentinel.

No unit test — `main.ts` is the untested composition root; behavior is covered by typecheck, the full suite, and the manual verification in Task 9.

- [ ] **Step 1: Replace the fallback constants**

In `src/main.ts`, delete lines 123-125:

```ts
/** Fallback image used when Unsplash is unavailable. */
const FALLBACK_IMAGE_URL = 'puzzle-image.jpg';
const FALLBACK_IMAGE_SIZE = { width: 800, height: 600 };
```

and add to the `./app/` imports instead:

```ts
import {
    BUNDLED_IMAGE_URL,
    BUNDLED_IMAGE_SIZE,
    BUNDLED_IMAGE_ATTRIBUTION,
} from './app/bundled-image.js';
```

- [ ] **Step 2: Rework image selection in `startNewGame`**

Replace `src/main.ts:939-966` (from `let imageUrl = FALLBACK_IMAGE_URL;` through the `if (accessKey) {...}` block) with:

```ts
        let imageUrl: string = BUNDLED_IMAGE_URL;
        let imageSize = BUNDLED_IMAGE_SIZE;
        let attribution: GameState['attribution'] = BUNDLED_IMAGE_ATTRIBUTION;

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

        // Try to fetch a random Unsplash image — unless the user picked a
        // blank puzzle, or this is the deterministic first-run puzzle
        // (which uses the bundled defaults set above).
        const accessKey =
            imageSource !== 'blank' && imageSource !== 'first-run'
                ? getUnsplashAccessKey()
                : null;

        if (accessKey) {
            const resolved = await resolveUnsplashImage(accessKey, imageCategory ?? 'any', vibrant);
            if (resolved) {
                imageUrl = resolved.imageUrl;
                imageSize = resolved.imageSize;
                attribution = resolved.attribution;
            }
        }
```

(The only changes from the current code: `FALLBACK_*` → `BUNDLED_*`, the `attribution` initializer + `attribution = undefined` in the blank branch, and the `'first-run'` exclusion for `accessKey`. Everything else is verbatim.)

- [ ] **Step 3: Report `'first-run'` in the fresh-game analytics**

In the `NewGameData` block at `src/main.ts:1012-1020`, change:

```ts
            imageSource: classifyImageSource(state.imageUrl),
```

to:

```ts
            // classifyImageSource can't tell a first-run start from a
            // fallback-after-failed-fetch (same bundled URL) — the sentinel can.
            imageSource: imageSource === 'first-run'
                ? 'first-run'
                : classifyImageSource(state.imageUrl),
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(first-run): serve the bundled image via a first-run sentinel

startNewGame('first-run') skips the Unsplash fetch and uses the
bundled image with proper photographer attribution — which now also
flows to the Unsplash-failure fallback path. Analytics report
'first-run' only when the sentinel fired; 'bundled' from URL
classification means fallback-after-failed-fetch."
```

---

### Task 4: First-run gate at boot (`exists()` on string preferences)

**Files:**
- Modify: `src/ui/preference-store.ts:115-157` (add `exists` to string stores)
- Modify: `src/ui/preference-store.test.ts` (if present — check; otherwise tests go next to the store)
- Modify: `src/game/image-source.ts`, `src/game/image-categories.ts` (export existence checks)
- Modify: `src/main.ts:1460-1485` (boot fresh-start branch)

**Interfaces:**
- Consumes: `startNewGame` `'first-run'` sentinel (Task 3).
- Produces: `StringPreferenceStore.exists: () => boolean`; `imageSourcePreferenceExists(): boolean` from `src/game/image-source.ts`; `imageCategoryPreferenceExists(): boolean` from `src/game/image-categories.ts`.

Why raw-key existence: `loadImageCategoryPreference()` returns its default `'any'` when unset, and `loadColorPreference()` returns the default swatch — neither can distinguish "never chose" from "chose the default". First-run detection needs the raw key check.

- [ ] **Step 1: Write the failing test**

Locate the preference-store tests: `ls src/ui/preference-store.test.ts`. Add to the string-preference describe block (create the block if the file organizes differently — follow its existing structure):

```ts
describe('createStringPreference exists()', () => {
    beforeEach(() => localStorage.clear());

    it('is false when nothing is saved', () => {
        const store = createStringPreference({ key: 'test-exists' });
        expect(store.exists()).toBe(false);
    });

    it('is true after a save', () => {
        const store = createStringPreference({ key: 'test-exists' });
        store.save('anything');
        expect(store.exists()).toBe(true);
    });

    it('is true even when the stored value is outside the allowed list', () => {
        // exists() reports raw key presence — a returning user with a
        // stale/invalid value is still a returning user.
        localStorage.setItem('test-exists', 'not-allowed');
        const store = createStringPreference({
            key: 'test-exists',
            allowed: ['a', 'b'],
            defaultValue: 'a',
        });
        expect(store.exists()).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/preference-store.test.ts`
Expected: FAIL — `store.exists is not a function`.

- [ ] **Step 3: Implement `exists`**

In `src/ui/preference-store.ts`, extend the interface (line 115-118):

```ts
export interface StringPreferenceStore<T extends string | undefined> {
    save: (value: string) => void;
    load: () => T;
    /**
     * True when a raw value exists under the key — valid or not.
     * Distinguishes "never chose" from "chose the default", which
     * `load()` cannot (it returns the default either way).
     */
    exists: () => boolean;
}
```

and add to the returned object in `createStringPreference` (after `load()`):

```ts
        exists() {
            try {
                return localStorage.getItem(key) !== null;
            } catch {
                return false;
            }
        },
```

- [ ] **Step 4: Export the two existence checks**

`src/game/image-source.ts` (after line 26):

```ts
/**
 * Whether any image-source preference is stored — used with the
 * category check to detect a first-run visitor.
 */
export const imageSourcePreferenceExists = store.exists;
```

`src/game/image-categories.ts` (next to `loadImageCategoryPreference`, line 157):

```ts
/**
 * Whether any image-category preference is stored — used with the
 * source check to detect a first-run visitor.
 */
export const imageCategoryPreferenceExists = categoryStore.exists;
```

- [ ] **Step 5: Wire the gate into the boot fresh-start branch**

In `src/main.ts`, import the two new functions alongside the existing imports of `loadImageSourcePreference` / `loadImageCategoryPreference`. Then in the boot IIFE (current lines 1460-1485), before the `await startNewGame(...)` call, add:

```ts
        // A brand-new visitor (no save at all, never touched an image
        // preference) gets the hand-picked bundled image instead of a
        // random one, so the first impression works against the default
        // background. An unreadable save means a returning user — they
        // keep today's random-image behavior.
        const firstRun = saved.status === 'empty'
            && !imageSourcePreferenceExists()
            && !imageCategoryPreferenceExists();
```

and change the `startNewGame` call's image-source argument (line 1479) from:

```ts
            loadImageSourcePreference(),
```

to:

```ts
            firstRun ? 'first-run' : loadImageSourcePreference(),
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run src/ui/preference-store.test.ts && npx tsc --noEmit && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/ui/preference-store.ts src/ui/preference-store.test.ts src/game/image-source.ts src/game/image-categories.ts src/main.ts
git commit -m "feat(first-run): gate the bundled first puzzle on empty save + untouched image prefs"
```

---

### Task 5: `bgc` field in the share-link codec

**Files:**
- Modify: `src/sharing/share-link.ts` (SharePayload, EncodeOptions, gameStateToPayload, isValidPayload)
- Modify: `src/sharing/share-link.test.ts`
- Modify: `src/ui/share-section.ts:91-96`, `src/ui/completion-overlay.ts:73`

**Interfaces:**
- Produces: `SharePayload.bgc?: string`; `EncodeOptions.backgroundColorId?: string`; both share-UI call sites pass `backgroundColorId: loadColorPreference()`. Task 7 consumes `payload.bgc` on the receiving side.

- [ ] **Step 1: Write the failing tests**

Add to `src/sharing/share-link.test.ts` (new describe at the end; `makeGameState` fixture is already imported):

```ts
describe('share-link background color (bgc)', () => {
    it('round-trips a payload with bgc', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [1080, 722], g: [8, 6],
            c: 'classic', s: 42, r: 'none',
            bgc: 'indigo-darker',
        };
        const decoded = decodePayload(encodePayload(payload));
        expect(decoded?.bgc).toBe('indigo-darker');
    });

    it('tolerates an absent bgc (pre-feature links)', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [1080, 722], g: [8, 6],
            c: 'classic', s: 42, r: 'none',
        };
        const decoded = decodePayload(encodePayload(payload));
        expect(decoded).not.toBeNull();
        expect(decoded?.bgc).toBeUndefined();
    });

    it('rejects a non-string bgc', () => {
        const payload = {
            v: 1, i: 'x', is: [1080, 722], g: [8, 6],
            c: 'classic', s: 42, r: 'none',
            bgc: 7,
        } as unknown as SharePayload;
        expect(decodePayload(encodePayload(payload))).toBeNull();
    });

    it('gameStateToPayload writes bgc from options and omits it otherwise', () => {
        const state = makeGameState({ cutStyle: 'classic', seed: 7 });
        const withColor = gameStateToPayload(state, {
            includeProgress: false,
            backgroundColorId: 'green-darker',
        });
        expect(withColor.bgc).toBe('green-darker');

        const without = gameStateToPayload(state, { includeProgress: false });
        expect(without.bgc).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sharing/share-link.test.ts`
Expected: the new tests FAIL (type error on `bgc` / missing field). The existing tests still pass.

- [ ] **Step 3: Implement the codec change**

In `src/sharing/share-link.ts`:

1. Add to `SharePayload` (after the `r` field, line 36):

```ts
    /**
     * Sharer's background color (palette swatch id). Optional and
     * additive — old links lack it, old clients ignore it. The receiver
     * adopts it only when it has no color preference of its own.
     */
    bgc?: string;
```

2. Extend `EncodeOptions` (line 405):

```ts
export interface EncodeOptions {
    includeProgress: boolean;
    /** When set, written to `bgc` so the link carries the sharer's background. */
    backgroundColorId?: string;
}
```

3. In `gameStateToPayload`, after the `payload` literal is built (line 424), add:

```ts
    if (options.backgroundColorId !== undefined) {
        payload.bgc = options.backgroundColorId;
    }
```

4. In `isValidPayload` (line 279-293), before `return true;`:

```ts
    if (p.bgc !== undefined && typeof p.bgc !== 'string') return false;
```

- [ ] **Step 4: Pass the sharer's colour from both share UIs**

`src/ui/share-section.ts` — add to imports: `import { loadColorPreference } from './background-color.js';` and change `currentUrl()` (lines 91-96) to:

```ts
    function currentUrl(): string {
        const payload = gameStateToPayload(state, {
            includeProgress: checkbox.checked && !checkbox.disabled,
            backgroundColorId: loadColorPreference(),
        });
        return buildShareUrl(baseUrl, payload);
    }
```

`src/ui/completion-overlay.ts` — add the same import and change line 73 to:

```ts
        const payload = gameStateToPayload(state, {
            includeProgress: false,
            backgroundColorId: loadColorPreference(),
        });
```

(`loadColorPreference()` returns the applied colour: the picker saves on every select, and a never-touched preference returns the default id — which is also the applied colour.)

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/sharing/share-link.test.ts && npx tsc --noEmit && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/sharing/share-link.ts src/sharing/share-link.test.ts src/ui/share-section.ts src/ui/completion-overlay.ts
git commit -m "feat(sharing): carry the sharer's background color in share links

New optional bgc field (palette swatch id) in the v1 payload — no
version bump, so old links and old clients are unaffected in either
direction."
```

---

### Task 6: `adoptSharedBackgroundColor` helper

**Files:**
- Modify: `src/ui/background-color.ts`
- Modify: `src/ui/background-color.test.ts`

**Interfaces:**
- Produces: `adoptSharedBackgroundColor(id: string): SharedColorOutcome` and `type SharedColorOutcome = 'adopted' | 'kept-own' | 'invalid'` — consumed by Task 7.

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/background-color.test.ts` (jsdom env already set; import `adoptSharedBackgroundColor` and `CSS_CUSTOM_PROPERTY` from `./background-color.js`):

```ts
describe('adoptSharedBackgroundColor', () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.style.removeProperty(CSS_CUSTOM_PROPERTY);
    });

    it('adopts and persists when no preference exists', () => {
        const outcome = adoptSharedBackgroundColor('green-darker');
        expect(outcome).toBe('adopted');
        expect(localStorage.getItem(COLOR_PREFERENCE_KEY)).toBe('green-darker');
        expect(
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY),
        ).toBe('var(--color-green-darker)');
    });

    it('keeps an existing preference untouched', () => {
        saveColorPreference('blue-default');
        expect(adoptSharedBackgroundColor('green-darker')).toBe('kept-own');
        expect(localStorage.getItem(COLOR_PREFERENCE_KEY)).toBe('blue-default');
    });

    it('treats a legacy British-spelling key as an existing preference', () => {
        localStorage.setItem('puzzle-background-colour', 'midnight');
        expect(adoptSharedBackgroundColor('green-darker')).toBe('kept-own');
        expect(localStorage.getItem('puzzle-background-colour')).toBe('midnight');
        expect(localStorage.getItem(COLOR_PREFERENCE_KEY)).toBeNull();
    });

    it('rejects an unknown swatch id without storing anything', () => {
        expect(adoptSharedBackgroundColor('hotdog-stand')).toBe('invalid');
        expect(localStorage.getItem(COLOR_PREFERENCE_KEY)).toBeNull();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/background-color.test.ts`
Expected: FAIL — `adoptSharedBackgroundColor` is not exported.

- [ ] **Step 3: Implement the helper**

Add to `src/ui/background-color.ts` (after `loadColorPreference`):

```ts
/** Outcome of offering a share link's background color to this client. */
export type SharedColorOutcome = 'adopted' | 'kept-own' | 'invalid';

/**
 * Adopt a background color carried by a share link — but only for a
 * recipient who has never chosen one (neither the current key nor the
 * legacy British-spelling key exists). Adoption persists the color as
 * the normal preference, so it survives reloads; a recipient with a
 * preference keeps it untouched. Raw key existence is the test:
 * `loadColorPreference()` returns the default either way.
 */
export function adoptSharedBackgroundColor(id: string): SharedColorOutcome {
    if (!ALLOWED_IDS.includes(id)) {
        return 'invalid';
    }
    try {
        if (localStorage.getItem(COLOR_PREFERENCE_KEY) !== null
            || localStorage.getItem(LEGACY_COLOR_PREFERENCE_KEY) !== null) {
            return 'kept-own';
        }
    } catch {
        // Can't inspect (or later persist) the preference; leave it be.
        return 'kept-own';
    }
    saveColorPreference(id);
    applyBackgroundColor(id);
    return 'adopted';
}
```

Note: `saveColorPreference`/`applyBackgroundColor` are defined via `const store = ...` and `export function` in the same module — no forward-reference problem at call time.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/background-color.test.ts && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/background-color.ts src/ui/background-color.test.ts
git commit -m "feat(sharing): add adoptSharedBackgroundColor for color-preference-less recipients"
```

---

### Task 7: Swatch-picker `setSelected` + wire adoption into the share-link load

**Files:**
- Modify: `src/ui/swatch-picker.ts:108-176`, `src/ui/swatch-picker.test.ts`
- Modify: `src/ui/background-color-picker.ts`, `src/ui/background-color-picker.test.ts`
- Modify: `src/ui/piece-outline-color-picker.ts:30`
- Modify: `src/ui/index.ts` (export the handle type)
- Modify: `src/analytics/umami.ts:30-50` (NewGameData.sharedColor), `src/main.ts` (loadSharedPuzzle + picker wiring)

**Interfaces:**
- Consumes: `adoptSharedBackgroundColor`, `SharedColorOutcome` (Task 6); `SharePayload.bgc` (Task 5).
- Produces: `SwatchPickerHandle { setSelected(id: string): void; dispose(): void }` returned by `createSwatchPicker` and `createBackgroundColorPicker`; `NewGameData.sharedColor?: 'adopted' | 'kept-own' | 'none'`.

Why the picker change: the picker snapshots its selected id at creation; adopting a colour later (share-link load, hashchange) would leave the swatch highlight stale until reload. `setSelected` keeps it honest.

- [ ] **Step 1: Write the failing picker test**

Add to `src/ui/swatch-picker.test.ts` (follow the file's existing setup helpers for creating a picker and opening the panel):

```ts
describe('setSelected', () => {
    it('marks the externally-set swatch as selected on the next open', () => {
        const onSelect = vi.fn();
        const picker = createSwatchPicker({
            container: document.body,
            button: { icon: 'X', title: 'Pick', className: 'pick-btn' },
            ariaLabel: 'Pick',
            swatches: [
                { id: 'a', label: 'A', color: '#aaa' },
                { id: 'b', label: 'B', color: '#bbb' },
            ],
            selectedId: 'a',
            onSelect,
        });

        picker.setSelected('b');

        document.querySelector<HTMLButtonElement>('.pick-btn')!.click();
        const selected = document.querySelector('[aria-checked="true"]');
        expect(selected?.getAttribute('data-swatch-id') ?? selected?.textContent)
            .toContain('b');
        expect(onSelect).not.toHaveBeenCalled();
        picker.dispose();
    });

    it('dismisses an open panel so a stale highlight cannot linger', () => {
        const picker = createSwatchPicker({
            container: document.body,
            button: { icon: 'X', title: 'Pick', className: 'pick-btn' },
            ariaLabel: 'Pick',
            swatches: [{ id: 'a', label: 'A', color: '#aaa' }],
            selectedId: 'a',
            onSelect: () => {},
        });
        document.querySelector<HTMLButtonElement>('.pick-btn')!.click();
        picker.setSelected('b');
        expect(document.querySelector('[role="radiogroup"], .swatch-grid')).toBeNull();
        picker.dispose();
    });
});
```

**Adapt the selectors** (`aria-checked`, `data-swatch-id`, `.swatch-grid`, radiogroup role) to what `createSwatchGrid`/the existing tests actually use — read `swatch-picker.ts:60-105` and the existing test file first; the assertions above describe intent, the selectors must match reality.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/swatch-picker.test.ts`
Expected: FAIL — `picker.setSelected is not a function` (return value is currently a bare cleanup function).

- [ ] **Step 3: Change `createSwatchPicker` to return a handle**

In `src/ui/swatch-picker.ts`, add above `createSwatchPicker`:

```ts
/** Handle returned by {@link createSwatchPicker}. */
export interface SwatchPickerHandle {
    /**
     * Update the highlighted swatch when the selection changed outside
     * the picker (e.g. a share link adopted a background color). Does
     * not fire `onSelect`. Dismisses an open panel; the grid is rebuilt
     * from the current id on the next open.
     */
    setSelected: (id: string) => void;
    /** Remove the picker (button + any open panel) from the DOM. */
    dispose: () => void;
}
```

Change the signature to `export function createSwatchPicker(options: SwatchPickerOptions): SwatchPickerHandle` and replace the return statement (lines 172-175) with:

```ts
    return {
        setSelected(id) {
            if (id === currentId) return;
            currentId = id;
            dismissPanel();
        },
        dispose() {
            dismissPanel();
            button.remove();
        },
    };
```

Update the function's doc comment ("Returns a cleanup function" → "Returns a handle with `setSelected` and `dispose`").

- [ ] **Step 4: Update the two wrapper pickers and their consumers**

`src/ui/background-color-picker.ts` — return the handle:

```ts
import { createSwatchPicker, type SwatchPickerHandle } from './swatch-picker.js';

export function createBackgroundColorPicker(
    options: BackgroundColorPickerOptions,
): SwatchPickerHandle {
    return createSwatchPicker({ /* unchanged options object */ });
}
```

(Update its doc comment accordingly.)

`src/ui/piece-outline-color-picker.ts` — keep its `() => void` contract:

```ts
    const picker = createSwatchPicker({ /* unchanged options object */ });
    return () => picker.dispose();
```

`src/ui/index.ts` — add `SwatchPickerHandle` to the swatch-picker type exports (around line 123).

Update any existing tests in `swatch-picker.test.ts` / `background-color-picker.test.ts` that call the old return value as a function: `const cleanup = create…(…); cleanup();` becomes `const picker = create…(…); picker.dispose();` (grep the two test files for the pattern).

- [ ] **Step 5: Add `sharedColor` to `NewGameData`**

In `src/analytics/umami.ts`, add to `NewGameData` (after `recipientHadSavedState`, line 49):

```ts
    /**
     * Share-link background color outcome: 'adopted' (recipient had no
     * color preference; the link's color was applied and saved),
     * 'kept-own' (link carried a color, recipient has their own), or
     * 'none' (link predates the feature or carried an invalid id).
     * Only present when source === 'shared'.
     */
    sharedColor?: 'adopted' | 'kept-own' | 'none';
```

- [ ] **Step 6: Wire adoption into `loadSharedPuzzle`**

In `src/main.ts`:

1. Import `adoptSharedBackgroundColor` alongside the other background-color imports (line 29-30 area).
2. Capture the picker handle — change lines 1249-1257 to:

```ts
const backgroundColorPicker = createBackgroundColorPicker({
    container: app,
    selectedId: currentColorId,
    onSelect: (id) => {
        currentColorId = id;
        saveColorPreference(id);
        applyBackgroundColor(id);
    },
});
```

3. In `loadSharedPuzzle`, after `persistNewPuzzle();` (line 1346) and before the `NewGameData` block, add:

```ts
        // Offer the sharer's background color to a recipient who has
        // never picked one. Adoption persists it as their preference and
        // must be reflected in the picker + the OS-theme re-apply state.
        let sharedColor: NonNullable<NewGameData['sharedColor']> = 'none';
        if (payload.bgc !== undefined) {
            const outcome = adoptSharedBackgroundColor(payload.bgc);
            if (outcome === 'adopted') {
                currentColorId = payload.bgc;
                backgroundColorPicker.setSelected(payload.bgc);
            }
            if (outcome !== 'invalid') {
                sharedColor = outcome;
            }
        }
```

4. Add to the `NewGameData` literal (line 1348-1358):

```ts
            sharedColor,
```

Note: `loadSharedPuzzle` is defined before `backgroundColorPicker`/`currentColorId` are initialized in source order, but it only runs from the boot IIFE / hashchange handler, both after module evaluation — same pattern the function already uses for other module-level state. If `tsc` complains about use-before-assign, declare the picker with `let backgroundColorPicker: SwatchPickerHandle` near `currentColorId` and assign at the current creation site.

- [ ] **Step 7: Run everything**

Run: `npx tsc --noEmit && npm test`
Expected: all pass (including the updated picker tests).

- [ ] **Step 8: Commit**

```bash
git add src/ui/swatch-picker.ts src/ui/swatch-picker.test.ts src/ui/background-color-picker.ts src/ui/background-color-picker.test.ts src/ui/piece-outline-color-picker.ts src/ui/index.ts src/analytics/umami.ts src/main.ts
git commit -m "feat(sharing): adopt the shared background color on link load

Recipients with no stored color preference get the sharer's color,
persisted as their preference. The swatch picker gains setSelected so
its highlight follows the adoption. new-game-started (source:
'shared') reports the outcome as sharedColor."
```

---

### Task 8: `background-color-changed` analytics (own commit, per request)

**Files:**
- Modify: `src/analytics/umami.ts` (data type + track overload), `src/analytics/index.ts` (type re-export)
- Modify: `src/main.ts:1249-1257` (picker onSelect)

**Interfaces:**
- Consumes: the `backgroundColorPicker` wiring from Task 7.
- Produces: `track('background-color-changed', { from, to })` with `BackgroundColorChangedData { from: string; to: string }`.

- [ ] **Step 1: Add the event type and overload**

`src/analytics/umami.ts` — after `PuzzleSharedData` (line 69):

```ts
/** Data attached to `background-color-changed`. */
export interface BackgroundColorChangedData {
    /** Swatch id before the switch. */
    from: string;
    /** Swatch id after the switch. */
    to: string;
}
```

and add the overload next to the others (line 396+):

```ts
export function track(name: 'background-color-changed', data: BackgroundColorChangedData): void;
```

`src/analytics/index.ts` — add `BackgroundColorChangedData` to the type re-exports.

- [ ] **Step 2: Fire it from the picker**

In `src/main.ts`, the `onSelect` from Task 7 becomes:

```ts
    onSelect: (id) => {
        // Re-selecting the current swatch is a no-op, not a switch.
        if (id !== currentColorId) {
            track('background-color-changed', { from: currentColorId, to: id });
        }
        currentColorId = id;
        saveColorPreference(id);
        applyBackgroundColor(id);
    },
```

- [ ] **Step 3: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/analytics/umami.ts src/analytics/index.ts src/main.ts
git commit -m "feat(analytics): track background color switches with from/to swatch ids"
```

---

### Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite, typecheck, build**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds (both tsconfigs + vite).

- [ ] **Step 2: Manual browser verification (dev server)**

Run `npm run dev`, then in the browser (Playwright or Chrome tools are fine):

1. **First run:** open the app with cleared localStorage (fresh profile / `localStorage.clear()` + reload). Expect the Norwich pink-building image as the puzzle, on indigo-darker, with "Barney Goodman" attribution visible. `new-game-started` (console/network if verifiable) carries `imageSource: 'first-run'`.
2. **Returning user:** set any image-category preference (pick a category in the New Game dialog), clear only the save keys (`puzzle-game-state`, `puzzle-progress`), reload. Expect a random Unsplash image, not the bundled one.
3. **Share-link colour, new user:** with a non-default colour selected, copy a share link from the info modal. Clear all localStorage, open the link. Expect the shared puzzle on the sharer's colour, the colour persisted (survives reload), and the picker highlighting it.
4. **Share-link colour, existing user:** set a colour preference, open the same link. Expect your own colour kept.
5. **Colour switch event:** change the background colour; verify a `background-color-changed` event with `from`/`to` fires (network tab → Umami request, or dev console hook).

- [ ] **Step 3: Report results**

Summarize outcomes of all five checks; screenshots of check 1 and 3 are worth attaching to the PR.

---

## Self-Review Notes

- Spec coverage: asset+constants (T1), analytics classification (T2, T3), first-run sentinel+attribution (T3), boot gate (T4), `bgc` codec+senders (T5), adopt helper (T6), receiver wiring+`sharedColor` (T7), colour-switch event (T8), manual checks incl. info-modal no-op (T9). Portrait support intentionally absent (out of scope).
- The `'first-run'` sentinel never collides with real preference values: `puzzle-image-source` only ever stores `'unsplash'`/`'blank'` (and the gate only fires when the key is absent anyway).
- No outer-PRNG calls added anywhere; seed handling untouched.
