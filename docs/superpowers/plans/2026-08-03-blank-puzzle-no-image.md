# Blank Puzzles: Model "No Image" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A blank puzzle carries `imageUrl: null` and its pieces are painted flat white by the SVG renderer, so the app stops synthesizing, storing and sharing a white PNG — closing [#503](https://github.com/adrianschmidt/puzzle/issues/503) and [#496](https://github.com/adrianschmidt/puzzle/issues/496).

**Architecture:** `GameState.imageUrl` widens from `string` to `string | null`. The renderer branches on `null` and appends a `<path>` filled `#ffffff` instead of an `<image>`. Persistence bumps to `STATE_VERSION` 13, where an absent `imageUrl` means blank, and migrates the `data:` URLs older saves stored. Producers (fresh start, share-link load) emit `null`; `src/app/blank-canvas.ts` and `collapseBlankImageUrl` are deleted; `img-src` drops `data:`.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom for DOM tests), oxlint.

Spec: `docs/superpowers/specs/2026-08-03-blank-puzzle-no-image-design.md`

## Global Constraints

- **The seeded generation call sequence must not change.** Share links and saves replay a puzzle by re-running the PRNG from its seed. Nothing in this plan may add, remove or reorder a call reaching `createNewGameAsync`. `imageUrl` never enters `buildGenerationRequest(gridSize, imageSize, seed, options)` (`src/game/init.ts:166`) — only `imageSize` does, and it is untouched.
- **`src/puzzle/topology/dcel-broad-phase-equivalence.test.ts` must stay green without being re-recorded.** It digests piece paths for 11 generator configurations. A red digest means generated geometry moved. Never run `vitest -u` against it.
- **Comments that this change falsifies are DELETED, not rewritten.** Do not extend a stale comment into an account of what is true now, and never narrate what changed. Where part of a comment survives, cut it to that part. New code gets at most one line of comment where one line is genuinely needed. This is a standing instruction from the repo owner (2026-08-03): the codebase is too comment-heavy.
- **American English** in all identifiers and comments.
- Run `npm test`, `npm run build` and `npm run lint` before the final commit of each task.
- Commit style: conventional commits. Do not push or open the PR until Task 7.

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/model/types.ts` | `GameState.imageUrl: string \| null` | 1 |
| `src/game/init.ts` | Generation entry points accept `string \| null`, store it verbatim | 1 |
| `src/renderer/svg-dom-renderer.ts` | Paint a white path for a blank puzzle, `<image>` otherwise | 1 |
| `src/style.css` | Debug opacity + debug-piece toggle reach the blank fill | 1 |
| `src/app/classify-image-source.ts` | `null` → `'blank'` (analytics label) | 1, 4 |
| `src/sharing/share-link.ts` | Wire `i: 'blank'`; `collapseBlankImageUrl` deleted | 1, 5 |
| `src/persistence/serialization.ts` | v13 format: absent `imageUrl` = blank; `data:` migration | 2 |
| `src/app/start-new-game.ts` | Fresh blank start emits `null` | 3 |
| `src/app/load-shared-puzzle.ts` | `'blank'` sentinel and legacy `data:` both decode to `null` | 3 |
| `src/app/blank-canvas.ts` (+ test) | **Deleted** | 3 |
| `src/sharing/repro-params.ts` | Reads `state.imageUrl` directly | 5 |
| `index.html` | `img-src` drops `data:` | 6 |

---

### Task 1: State model, generation plumbing, and the renderer's blank branch

Widen the type and teach the renderer to paint a blank piece. **No producer emits `null` yet** — this task adds the capability, Task 3 starts using it. Every consumer that stops compiling gets its final fix here except the two whose behavior belongs to a later task (`classifyImageSource` keeps its `data:` sniff until Task 4; serialization gets a minimal compile fix here, completed in Task 2).

**Files:**
- Modify: `src/model/types.ts:191`
- Modify: `src/game/init.ts:95`, `:146`, `:188`
- Modify: `src/renderer/svg-dom-renderer.ts:69`, `:259`, `:308`, `:340-353`
- Modify: `src/style.css:370`, `:390`
- Modify: `src/app/classify-image-source.ts:16-20`, `:44`
- Modify: `src/sharing/share-link.ts:746`
- Modify: `src/persistence/serialization.ts:101`, `:160`, `:243`, `:300`, `:482`, `:571`
- Test: `src/renderer/svg-dom-renderer.test.ts`, `src/app/classify-image-source.test.ts`

**Interfaces:**
- Produces: `GameState.imageUrl: string | null` (`null` = blank puzzle, no image). `createNewGame(imageUrl: string | null, …)` and `createNewGameAsync(imageUrl: string | null, …)`. A blank piece element carries `data-piece-blank="true"` and is a `<path>`, not an `<image>`.
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing renderer tests**

Add to `src/renderer/svg-dom-renderer.test.ts`, inside the top-level `describe('SvgDomRenderer', …)`:

```ts
    describe('blank puzzles', () => {
        function makeBlankState(): GameState {
            const state = make2x2State();
            state.imageUrl = null;
            return state;
        }

        it('paints each piece with a white path instead of an image', () => {
            renderer.init(container);
            renderer.renderState(makeBlankState());

            const pieceEl = container.querySelector('[data-piece-id="0"]')!;
            expect(pieceEl.querySelector('image')).toBeNull();

            const fill = pieceEl.querySelector('[data-piece-blank]')!;
            expect(fill.tagName).toBe('path');
            expect(fill.getAttribute('fill')).toBe('#ffffff');
            expect(fill.getAttribute('fill-rule')).toBe('evenodd');
        });

        it('fills the piece shape, so the silhouette matches the clip path', () => {
            const state = makeBlankState();
            renderer.init(container);
            renderer.renderState(state);

            const pieceEl = container.querySelector('[data-piece-id="0"]')!;
            const fill = pieceEl.querySelector('[data-piece-blank]')!;
            const clipPath = pieceEl.querySelector('clipPath path')!;
            expect(fill.getAttribute('d')).toBe(state.pieces[0].shape);
            expect(fill.getAttribute('d')).toBe(clipPath.getAttribute('d'));
        });

        it('keeps the clip path, hit area and debug overlay', () => {
            renderer.init(container);
            renderer.renderState(makeBlankState());

            const pieceEl = container.querySelector('[data-piece-id="0"]')!;
            expect(pieceEl.querySelector('clipPath')).not.toBeNull();
            expect(pieceEl.querySelector('[data-hit-area]')).not.toBeNull();
            expect(pieceEl.querySelector('[data-piece-fill]')).not.toBeNull();
        });

        it('takes no pointer events, leaving them to the hit area', () => {
            renderer.init(container);
            renderer.renderState(makeBlankState());

            const fill = container.querySelector('[data-piece-blank]')!;
            expect(fill.getAttribute('pointer-events')).toBe('none');
        });

        it('still renders an <image> when the puzzle has one', () => {
            renderer.init(container);
            renderer.renderState(make2x2State());

            const pieceEl = container.querySelector('[data-piece-id="0"]')!;
            expect(pieceEl.querySelector('[data-piece-blank]')).toBeNull();
            expect(pieceEl.querySelector('image')).not.toBeNull();
        });
    });
```

Add to `src/app/classify-image-source.test.ts`:

```ts
    it('classifies a null imageUrl as blank', () => {
        expect(classifyImageSource(null)).toBe('blank');
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/svg-dom-renderer.test.ts src/app/classify-image-source.test.ts`

Expected: FAIL. The renderer tests fail to compile (`Type 'null' is not assignable to type 'string'`) and the classify test fails the same way.

- [ ] **Step 3: Widen `GameState.imageUrl`**

In `src/model/types.ts`, replace the `imageUrl` field and its doc:

```ts
    /**
     * URL of the puzzle image, or `null` for a blank puzzle — one with no
     * photo, whose pieces the renderer paints flat white.
     */
    imageUrl: string | null;
```

- [ ] **Step 4: Widen the generation entry points**

In `src/game/init.ts`, change the `imageUrl` parameter type on all three functions — `createNewGame` (`:95`), `createNewGameAsync` (`:146`) and `assembleGameState` (`:188`) — from `string` to `string | null`. No other change: `imageUrl` is stored verbatim into the returned state and never reaches `buildGenerationRequest`.

Update `createNewGame`'s `@param` line:

```ts
 * @param imageUrl - URL of the puzzle image, or null for a blank puzzle
```

- [ ] **Step 5: Add the renderer's blank branch**

In `src/renderer/svg-dom-renderer.ts`:

Add near `PIECE_PADDING`:

```ts
const BLANK_PIECE_FILL = '#ffffff';
```

Widen three declarations to `string | null`: the `currentImageUrl` field (`:69`, keep its `''` initial value), `renderGroup`'s `imageUrl` parameter (`:259`) and `createPieceSvg`'s `imageUrl` parameter (`:308`).

Replace the `<image>` block (`:340-353`) with a branch. The `else` arm is the existing code verbatim, including its comment:

```ts
        if (imageUrl === null) {
            const fill = document.createElementNS(svgNS, 'path');
            fill.setAttribute('d', piece.shape);
            fill.setAttribute('fill', BLANK_PIECE_FILL);
            fill.setAttribute('fill-rule', 'evenodd');
            fill.setAttribute('pointer-events', 'none');
            fill.dataset.pieceBlank = 'true';
            svg.appendChild(fill);
        } else {
            // Image element clipped to the piece shape. `slice` makes the
            // raster cover the puzzle rect with excess cropped, so when the
            // puzzle's aspect ratio doesn't match the image file's aspect
            // ratio (fractal tile grid), the image is uniformly cropped to
            // fit rather than stretched — arcs stay circular.
            const image = document.createElementNS(svgNS, 'image');
            image.setAttributeNS(xlinkNS, 'href', imageUrl);
            image.setAttribute('width', String(this.imageSize.width));
            image.setAttribute('height', String(this.imageSize.height));
            image.setAttribute('x', String(piece.imageOffset.x));
            image.setAttribute('y', String(piece.imageOffset.y));
            image.setAttribute('preserveAspectRatio', 'xMidYMid slice');
            image.setAttribute('clip-path', `url(#clip-piece-${piece.id})`);
            image.setAttribute('draggable', 'false');
            image.setAttribute('pointer-events', 'none');
            svg.appendChild(image);
        }
```

The fill needs no `clip-path`: filling the shape path *is* the clipped result. Do not add a comment saying so — the two arms read side by side.

- [ ] **Step 6: Make the two consumers that would stop compiling compile**

`src/app/classify-image-source.ts` — widen both signatures and add the `null` arm **above** the existing `data:` check. Leave the `data:` check in place; Task 4 removes it, once no producer can emit one.

```ts
export function classifyImageSource(
    imageUrl: string | null,
): 'unsplash' | 'blank' | 'bundled' | 'fallback' {
    if (imageUrl === null) {
        return 'blank';
    }
    if (imageUrl.startsWith('data:')) {
        return 'blank';
    }
```

and

```ts
export function resolveNewGameImageSource(
    imageSource: string | undefined,
    imageUrl: string | null,
): 'first-run' | ReturnType<typeof classifyImageSource> {
```

`src/sharing/share-link.ts:746` — in `gameStateToPayload`, **delete** the two-line comment above the `i:` field and emit the sentinel:

```ts
        i: state.imageUrl ?? 'blank',
```

- [ ] **Step 7: Make serialization compile (completed in Task 2)**

In `src/persistence/serialization.ts`, make the two blob fields optional and stop writing them when null. This is the type-level half only; Task 2 adds the version bump, the migration and the validation change.

`SerializedGameState` (`:101`) and `SerializedStaticState` (`:160`): `imageUrl?: string;`

In `serializeState` (`:243`) and `serializeStatic` (`:300`), remove `imageUrl` from the object literal and add, alongside the other conditional writes:

```ts
    if (state.imageUrl !== null) {
        serialized.imageUrl = state.imageUrl;
    }
```

(In `serializeStatic` the local is named `s`, not `serialized`.)

In `deserializeState` (`:482`) and `recombine` (`:571`), read through a nullish default for now:

```ts
        imageUrl: data.imageUrl ?? null,
```

```ts
        imageUrl: staticData.imageUrl ?? null,
```

In `deriveImageSize`'s synthetic temp state (`:741`), change `imageUrl: ''` to `imageUrl: null`.

- [ ] **Step 8: Update the CSS selectors**

In `src/style.css`, the debug opacity rule (`:370`) and the debug-piece-view rule (`:390`) both target `image` and must reach the blank fill:

```css
[data-piece-id] image,
[data-piece-blank] {
  opacity: var(--piece-opacity);
}
```

```css
.show-debug-pieces [data-piece-id] image,
.show-debug-pieces [data-piece-blank] {
  display: none;
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/svg-dom-renderer.test.ts src/app/classify-image-source.test.ts`
Expected: PASS.

- [ ] **Step 10: Run the full suite, build and lint**

Run: `npm test && npm run build && npm run lint`
Expected: all green. `dcel-broad-phase-equivalence.test.ts` must pass untouched.

- [ ] **Step 11: Commit**

```bash
git add src/model/types.ts src/game/init.ts src/renderer/svg-dom-renderer.ts \
        src/renderer/svg-dom-renderer.test.ts src/style.css \
        src/app/classify-image-source.ts src/app/classify-image-source.test.ts \
        src/sharing/share-link.ts src/persistence/serialization.ts
git commit -m "feat: let a puzzle carry no image and paint its pieces white"
```

---

### Task 2: Persistence — `STATE_VERSION` 13

An absent `imageUrl` means blank. Saves written before this migrate: the synthesized white PNG they stored is a `data:` URL, and that reading now lives here and nowhere else.

**Files:**
- Modify: `src/persistence/serialization.ts:29-64` (version + doc), `:482`, `:554`, `:571`, `:852`
- Test: `src/persistence/serialization.test.ts`

**Interfaces:**
- Consumes: `GameState.imageUrl: string | null` from Task 1; `SerializedGameState.imageUrl?: string` and `SerializedStaticState.imageUrl?: string` from Task 1 Step 7.
- Produces: `STATE_VERSION === 13`. A v13 blob omits `imageUrl` for a blank puzzle. `deserializeState` (full blob) and `recombine(staticData, progress)` (split blobs) both return `imageUrl: null` when the key is absent **or** holds a `data:` URL.

- [ ] **Step 1: Write the failing tests**

Add to `src/persistence/serialization.test.ts`. `makeGameState` here is the file's local helper (`:63`), which takes `Partial<GameState>` overrides.

```ts
describe('blank puzzles', () => {
    it('omits imageUrl when the puzzle has no image', () => {
        const serialized = serializeState(makeGameState({ imageUrl: null }));
        expect(serialized).not.toHaveProperty('imageUrl');
    });

    it('omits imageUrl from the static blob too', () => {
        const s = serializeStatic(makeGameState({ imageUrl: null }));
        expect(s).not.toHaveProperty('imageUrl');
    });

    it('round-trips a blank puzzle back to null', () => {
        const state = makeGameState({ imageUrl: null });
        expect(deserializeState(serializeState(state)).imageUrl).toBeNull();
    });

    it('round-trips a blank puzzle through the split blobs', () => {
        const state = makeGameState({ imageUrl: null });
        const restored = recombine(
            serializeStatic(state),
            serializeProgress(state),
        );
        expect(restored.imageUrl).toBeNull();
    });

    it('migrates a v12 synthesized white PNG to null', () => {
        const serialized = serializeState(makeGameState());
        serialized.version = 12;
        serialized.imageUrl = 'data:image/png;base64,' + 'A'.repeat(64);

        expect(deserializeState(serialized).imageUrl).toBeNull();
    });

    it('migrates a v12 synthesized white PNG in the static blob too', () => {
        const state = makeGameState();
        const s = serializeStatic(state);
        s.version = 12;
        s.imageUrl = 'data:image/png;base64,' + 'A'.repeat(64);

        expect(recombine(s, serializeProgress(state)).imageUrl).toBeNull();
    });

    it('leaves a real image URL on an old save alone', () => {
        const serialized = serializeState(makeGameState());
        serialized.version = 12;
        serialized.imageUrl = 'https://images.unsplash.com/photo-1?w=1080';

        expect(deserializeState(serialized).imageUrl).toBe(
            'https://images.unsplash.com/photo-1?w=1080',
        );
    });

    it('rejects a v12 blob with no imageUrl at all', () => {
        const serialized = serializeState(makeGameState());
        serialized.version = 12;
        delete serialized.imageUrl;

        expect(() => deserializeState(serialized)).toThrow(
            'imageUrl must be a non-empty string',
        );
    });

    it('rejects an empty-string imageUrl on a v13 blob', () => {
        const serialized = serializeState(makeGameState());
        serialized.imageUrl = '';

        expect(() => deserializeState(serialized)).toThrow(
            'imageUrl must be a non-empty string',
        );
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/persistence/serialization.test.ts`
Expected: FAIL — the migration tests return the `data:` string rather than `null`, and `rejects a v12 blob with no imageUrl` does not throw (Task 1's `?? null` swallowed it).

- [ ] **Step 3: Bump the version**

In `src/persistence/serialization.ts`:

```ts
export const STATE_VERSION = 13;
```

Add one line to the version ledger comment, after the v12 entry, and add `13` to `SUPPORTED_VERSIONS`:

```ts
 * - v13: `imageUrl` is optional; absent means a blank puzzle with no image.
 *        v≤12 blobs stored a synthesized white PNG as a `data:` URL and
 *        migrate to absent on load.
```

```ts
const SUPPORTED_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
```

- [ ] **Step 4: Add the read helper and the validator**

Add both near `deriveImageSize`:

```ts
/** A `data:` URL is the synthesized white PNG a v≤12 blank puzzle stored. */
function readImageUrl(imageUrl: string | undefined): string | null {
    return imageUrl === undefined || imageUrl.startsWith('data:')
        ? null
        : imageUrl;
}

function validateImageUrl(imageUrl: unknown, version: number): void {
    if (version >= 13 && imageUrl === undefined) return;
    if (typeof imageUrl !== 'string' || imageUrl.length === 0) {
        throw new Error('Invalid state: imageUrl must be a non-empty string');
    }
}
```

- [ ] **Step 5: Wire them in**

Replace `imageUrl: data.imageUrl ?? null` (`:482`) with `imageUrl: readImageUrl(data.imageUrl)`, and `imageUrl: staticData.imageUrl ?? null` (`:571`) with `imageUrl: readImageUrl(staticData.imageUrl)`.

Replace the inline check in `validateSerializedState` (`:852`):

```ts
    validateImageUrl(data.imageUrl, data.version);
```

Replace the inline check in the split path (`:554`):

```ts
    validateImageUrl(staticData.imageUrl, staticData.version);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/persistence/serialization.test.ts src/persistence/storage.test.ts`
Expected: PASS. If a pre-existing test asserts an exact serialized object with `toEqual`, note that `imageUrl` now sits after `completed` in key order — `toEqual` is order-independent, so this should not bite, but a snapshot would.

- [ ] **Step 7: Full suite, build, lint, then commit**

Run: `npm test && npm run build && npm run lint`

```bash
git add src/persistence/serialization.ts src/persistence/serialization.test.ts
git commit -m "feat(persistence): v13 stores a blank puzzle as an absent imageUrl"
```

---

### Task 3: Stop synthesizing the PNG

The two producers emit `null`, and `src/app/blank-canvas.ts` is deleted. This is the task where the behavior actually changes for players.

**Files:**
- Modify: `src/app/start-new-game.ts:57`, `:232-238`
- Modify: `src/app/load-shared-puzzle.ts:5`, `:47`, `:130-133`
- Modify: `src/app/orientation.ts:37-41`
- Modify: `src/app/dev-hooks.ts:227`
- Delete: `src/app/blank-canvas.ts`, `src/app/blank-canvas.test.ts`
- Test: `src/app/start-new-game.test.ts`, `src/app/load-shared-puzzle.test.ts`

**Interfaces:**
- Consumes: `GameState.imageUrl: string | null` (Task 1); v13 persistence (Task 2).
- Produces: a blank start and a `'blank'`/legacy-`data:` share payload both install a state with `imageUrl === null`. `createBlankImageDataUrl` no longer exists.

- [ ] **Step 1: Write the failing tests**

In `src/app/start-new-game.test.ts`, **delete** the `vi.mock('./blank-canvas.js', …)` block and its explanatory comment (`:19-26`). Note that this file's `noTracedTabsOptions()` helper (`:76`) already defaults to `imageSource: 'blank'`, so most tests here run the blank path — deleting the mock is not optional, the real module throws in jsdom.

Add, inside `describe('startNewGame', …)`:

```ts
    it('installs a blank puzzle with no image', async () => {
        await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions(), deps);

        const state = install.mock.calls.at(-1)![0];
        expect(state.imageUrl).toBeNull();
        expect(state.imageSize.width).toBeGreaterThan(0);
        expect(state.imageSize.height).toBeGreaterThan(0);
    });
```

In `src/app/load-shared-puzzle.test.ts`, **delete** the `vi.mock('./blank-canvas.js', …)` block with its comment (`:30-35`), the `createBlankImageDataUrl` import (`:50`), and any assertion referencing it. Add, inside `describe('loadSharedPuzzle', …)`:

```ts
    it('loads the blank sentinel as a puzzle with no image', async () => {
        await loadSharedPuzzle(payload({ i: 'blank' }), false, deps);

        expect(install.mock.calls.at(-1)![0].imageUrl).toBeNull();
    });

    it('loads a legacy data: URL as a puzzle with no image', async () => {
        const legacy = 'data:image/png;base64,' + 'A'.repeat(64);
        await loadSharedPuzzle(payload({ i: legacy }), false, deps);

        expect(install.mock.calls.at(-1)![0].imageUrl).toBeNull();
    });
```

`payload()` (`:72`) and the `install` mock (`:109`) are this file's existing helpers.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/start-new-game.test.ts src/app/load-shared-puzzle.test.ts`
Expected: FAIL — `imageUrl` is a `data:` string, not `null`. (With the mocks deleted, the real `createBlankImageDataUrl` throws in jsdom, which is also a failure — either way, red.)

- [ ] **Step 3: Fresh blank start emits null**

In `src/app/start-new-game.ts`, delete the `createBlankImageDataUrl` import (`:57`) and rewrite the blank branch:

```ts
        let imageUrl: string | null = bundled.url;
```

```ts
        // Blank puzzle: no photo. Match the puzzle orientation so a portrait
        // screen gets a portrait blank.
        if (imageSource === 'blank') {
            imageUrl = null;
            imageSize = blankSizeForOrientation(orientation);
            attribution = undefined;
        }
```

- [ ] **Step 4: Share-link load emits null**

In `src/app/load-shared-puzzle.ts`, delete the `createBlankImageDataUrl` import (`:47`) and replace the sentinel block (`:130-133`):

```ts
        // Legacy links carry the synthesized white PNG; both mean no image.
        const imageUrl = payload.i === 'blank' || payload.i.startsWith('data:')
            ? null
            : payload.i;
```

In the module doc (`:5`), cut `or a locally-regenerated blank canvas for the `'blank'` sentinel` down to `or none for a blank puzzle`.

- [ ] **Step 5: Delete the canvas module**

```bash
git rm src/app/blank-canvas.ts src/app/blank-canvas.test.ts
```

Confirm nothing still references it: `grep -rn "blank-canvas\|createBlankImageDataUrl" src` must return nothing.

- [ ] **Step 6: Delete the comment references that name the canvas**

`src/app/orientation.ts:37-41` — `blankSizeForOrientation`'s doc says "blank-canvas puzzle" and "portrait blank canvas". Drop the word "canvas" in both places; the function is about a blank *puzzle*'s dimensions.

`src/app/dev-hooks.ts:227` — "renders on the blank canvas at the recorded dimensions" → "renders as a blank puzzle at the recorded dimensions".

`src/app/start-new-game.test.ts:449-452` — the `never reports the image URL on the mismatch event` test explains why it uses a picked photo: *"The blank-canvas harness the other tests here use would make the assertion below unfailable: its image URL is a `data:` URI, so 'carries no http' holds whether or not the URL is redacted."* The reason survives, the mechanism does not. Cut to:

```ts
        // A player-picked photo, so the state carries a real `https://` URL.
        // A blank puzzle carries no URL at all, which would make the
        // redaction assertion below unfailable.
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/app/`
Expected: PASS.

- [ ] **Step 8: Full suite, build, lint, then commit**

Run: `npm test && npm run build && npm run lint`

```bash
git add -A src/app
git commit -m "feat: stop synthesizing a white PNG for blank puzzles"
```

---

### Task 4: Drop the `data:` prefix sniff from analytics classification (#496)

With Task 3 in place, no path can put a `data:` URL into `GameState.imageUrl`: fresh blanks never produce one, old saves migrate at deserialize, and old links collapse at load. The sniff is dead code.

**Files:**
- Modify: `src/app/classify-image-source.ts`
- Test: `src/app/classify-image-source.test.ts:13`, `:56`

- [ ] **Step 1: Update the tests first**

In `src/app/classify-image-source.test.ts`, **delete** the `classifies data URLs as blank` test (`:13-15`) and change the `resolveNewGameImageSource` case at `:56` to pass `null`:

```ts
        expect(resolveNewGameImageSource('blank', null)).toBe('blank');
```

Then add a case pinning where the sniff went:

```ts
    it('classifies a data: URL as fallback, not blank', () => {
        // Nothing produces one any more — deserialize and the share-link
        // load path both map it to null.
        expect(classifyImageSource('data:image/png;base64,AAAA')).toBe('fallback');
    });
```

- [ ] **Step 2: Run to verify the new case fails**

Run: `npx vitest run src/app/classify-image-source.test.ts`
Expected: FAIL on `classifies a data: URL as fallback, not blank` — it still returns `'blank'`.

- [ ] **Step 3: Delete the sniff**

In `src/app/classify-image-source.ts`, delete:

```ts
    if (imageUrl.startsWith('data:')) {
        return 'blank';
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/classify-image-source.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/classify-image-source.ts src/app/classify-image-source.test.ts
git commit -m "refactor: classify blank puzzles by state, not by URL prefix"
```

---

### Task 5: Delete `collapseBlankImageUrl` and trim the comments it anchored

**Files:**
- Modify: `src/sharing/share-link.ts:24-29`, `:136-157`, `:286-292`, `:400-404`
- Modify: `src/sharing/repro-params.ts:9`, `:18`, `:47`
- Modify: `src/sharing/safe-url.ts:25-62`, `:74-81`
- Test: `src/sharing/share-link.test.ts:911-932`, `:944-953`; `src/sharing/repro-params.test.ts:38-48`

**Interfaces:**
- Consumes: `gameStateToPayload` emitting `i: state.imageUrl ?? 'blank'` (Task 1 Step 6).
- Produces: `collapseBlankImageUrl` no longer exported from `src/sharing/share-link.ts`.

- [ ] **Step 1: Update the tests**

In `src/sharing/share-link.test.ts`: delete the whole `describe('collapseBlankImageUrl', …)` block (`:911-932`) and the `collapseBlankImageUrl` import (`:10`). Replace the `emits a blank puzzle data: URL verbatim, without collapsing it` test (`:944-953`) with:

```ts
    it('emits the blank sentinel for a puzzle with no image', () => {
        const payload = gameStateToPayload(buildState({ imageUrl: null }), {
            includeProgress: false,
        });
        expect(payload.i).toBe('blank');
    });
```

Keep the `it.each` acceptance case for `'a blank-canvas data: PNG'` (`:117`) — legacy links must still pass `isValidPayload`. Rename the label to `'a legacy data: PNG'`.

In `src/sharing/repro-params.test.ts`, replace the `collapses a blank canvas data URL to the blank sentinel` test (`:38-48`) with:

```ts
    it('omits imageUrl for a puzzle with no image', () => {
        const state = classicTracedState();
        state.imageUrl = null;
        expect(buildReproParams(state)).not.toHaveProperty('imageUrl');
    });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/sharing/`
Expected: FAIL — `collapseBlankImageUrl` is still exported and imported.

- [ ] **Step 3: Delete the function and its doc**

In `src/sharing/share-link.ts`, delete `collapseBlankImageUrl` (`:136-157`) — the 20-line doc comment goes with it.

- [ ] **Step 4: Update `repro-params.ts`**

Drop `collapseBlankImageUrl` from the import block (`:18`) and simplify the call (`:47`):

```ts
    if (state.imageUrl) params.imageUrl = state.imageUrl;
```

In the module doc (`:9`), delete the sentence `` `imageUrl` makes the repro visually exact, via `collapseBlankImageUrl` — which owns the one image URL that would drown the printed block, and documents that rule next to the wire field it targets.`` — its subject is gone.

- [ ] **Step 5: Cut the comments that assert the fabricated PNG**

Deletion, not rewriting. Each of these keeps only the half a reader would otherwise get wrong:

`src/sharing/share-link.ts:24-29` — `SharePayload.i`, cut to one line:

```ts
    /** Image URL, or the sentinel `'blank'` for a puzzle with no image. */
    i: string;
```

`src/sharing/share-link.ts:286-292` — the `clampDim(is)` comment. Delete the canvas-allocation sentence and the "a crafted `is:[1e9,1e9]` is capped" line (which restates `clampDim(…, MAX_IMAGE_DIM)`). Keep only:

```ts
        // A *fractional* `is` is not adversarial: fractal/wavy links inscribe
        // the image to the grid aspect (cut-style-strategies.ts), so 607.5 is
        // a normal product of that path and the floor only snaps it sub-pixel.
```

`src/sharing/share-link.ts:400-404` — delete the parenthetical sizing the canvas PNG; the ordering rationale stays:

```ts
    // After the cheap field checks: `i` is the one unbounded field on the wire
    // and parsing it is the most expensive check here. No reason to pay that
    // for a payload a 3-byte `c` would have rejected.
```

`src/sharing/safe-url.ts` — cut the `data:image/*` bullet (`:36-41`) to one line, and delete the `collapseBlankImageUrl` cross-reference:

```
 *  - `data:image/*` — legacy blank-puzzle links carry a painted canvas PNG.
 *    Restricted to `image/` subtypes: `data:text/html` has no business in an
 *    image href even though an `<image>` would not execute it.
```

`src/sharing/safe-url.ts:74-81` — keep the guidance to read the MIME off `pathname`, delete the 6–20 KB sizing that justified it:

```ts
    // Read the MIME type off `pathname`, not off a lowercased whole `href`:
    // copying a long URL to test an 11-character prefix is a real allocation
    // on the boot path. `protocol` is already lowercased by the parser, which
    // is what makes slicing safe; `pathname` is not, so `data:IMAGE/png,x`
    // still needs the case fold.
```

Do **not** change `isSafeImageUrl`'s behavior. It must keep accepting `data:image/*`: validation runs in `decodePayload`, upstream of the collapse in Task 3, so rejecting it there would make every previously-shared blank link fail to load outright.

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run src/sharing/`
Expected: PASS.

- [ ] **Step 7: Full suite, build, lint, then commit**

Run: `npm test && npm run build && npm run lint`

```bash
git add src/sharing
git commit -m "refactor(sharing): drop collapseBlankImageUrl, emit the blank sentinel"
```

---

### Task 6: Drop `data:` from `img-src`

Nothing renders a `data:` image any more, so the CSP source and the comment justifying it both go.

**Files:**
- Modify: `index.html:15-16`, `:30`
- Modify: `src/analytics/umami.ts:473`, `:674`
- Test: `src/index-html.test.ts:53-63`, `:75-80`

- [ ] **Step 1: Update the tests**

In `src/index-html.test.ts`, change the equality assertion (`:57-62`):

```ts
        expect(directiveSources('img-src')).toEqual([
            "'self'",
            'https://*.unsplash.com',
        ]);
```

**Delete** the `allows data: for the blank puzzle canvas` test (`:75-80`) — it asserts a rationale that no longer holds. Replace it with the inverse:

```ts
    it('does not allow data: URLs', () => {
        expect(directiveSources('img-src')).not.toContain('data:');
    });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/index-html.test.ts`
Expected: FAIL — the policy still lists `data:`.

- [ ] **Step 3: Tighten the policy**

In `index.html`, delete the two-line sentence in the comment that justifies `data:` (`` `data:` is required — a blank puzzle's share link carries the painted canvas as a PNG. ``) and drop the source:

```html
    <meta http-equiv="Content-Security-Policy"
          content="img-src 'self' https://*.unsplash.com" />
```

- [ ] **Step 4: Cut the two umami comments**

`src/analytics/umami.ts:473` — delete only the blank-canvas half of the `blockedUri` redaction argument. The argument itself is unchanged:

```
 * — it can carry neither a full image URL nor an Unsplash photo ID, which is
 * the rule {@link PieceCountMismatchData} states for image URLs.
```

Add **no** new operator note about `blockedUri: 'data'` now meaning an escaped legacy puzzle.

`src/analytics/umami.ts:674` — `defaults a missing image to the blank canvas` → `defaults a missing image to a blank puzzle`.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/index-html.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite, build, lint, then commit**

Run: `npm test && npm run build && npm run lint`

```bash
git add index.html src/index-html.test.ts src/analytics/umami.ts
git commit -m "feat: drop data: from img-src now that no image is synthesized"
```

---

### Task 7: End-to-end verification and PR

**Files:** none modified unless verification turns something up.

- [ ] **Step 1: Confirm the canvas is gone**

Run: `grep -rn "getContext\|toDataURL\|createBlankImageDataUrl\|collapseBlankImageUrl" src index.html`
Expected: no matches.

- [ ] **Step 2: Confirm no stale references survive**

Run: `grep -rni "blank canvas\|blank-canvas\|painted canvas" src index.html`
Expected: only `src/sharing/safe-url.ts`'s legacy-link bullet, which is about links written by older builds and is still true.

- [ ] **Step 3: Full gate**

Run: `npm test && npm run build && npm run lint`
Expected: all green, `dcel-broad-phase-equivalence.test.ts` included and un-re-recorded.

- [ ] **Step 4: Manual check in the browser**

Run `npm run dev`, then:
1. New Game → image source **Blank** → pieces render white, drag/merge/select all behave; the selection glow and piece outline modes look identical to a photo puzzle.
2. Open the info modal → Piece outline → try each mode and an outline color; confirm the blank pieces take the outline.
3. Reload → the save restores, still white.
4. Share → copy the link → open it in a new tab → white puzzle, and the link is short (no base64 blob).
5. DevTools console: no CSP violation reported.
6. Before-and-after on an existing save: with a blank puzzle saved by `main`, check out this branch, reload, and confirm the puzzle still renders white rather than blank-transparent. This is the migration path.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feat/blank-puzzle-no-image
```

PR body must open with both closing keywords on their own lines:

```
Closes #503
Closes #496
```

Then a summary covering: `imageUrl: string | null`; the renderer's white-fill branch; `STATE_VERSION` 13 and the `data:` migration; the share wire now emitting `'blank'` (shorter links, decoder unchanged); `img-src` dropping `data:`; and the deletion of `blank-canvas.ts` and `collapseBlankImageUrl`.

---

## Notes for the implementer

- **Line numbers are from `main` at 29e40b80** and drift as you go. Treat them as pointers, not addresses — grep for the surrounding code.
- **Do not restore any comment you deleted** because a reviewer asks "why?". The answer belongs in the PR conversation, not in the file.
- **`docs/superpowers/` is historical.** Do not update the spec or this plan as the work diverges from them. Drift is the expected end state.
- **The info modal needs no change.** Blank puzzles look identical to the player and no feature is added or removed.
