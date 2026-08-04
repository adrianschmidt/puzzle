# People & Face Image Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `people` and `face` to the new-game dialog's **Picture Type** dropdown, so players can get puzzles of people and close-up faces.

**Architecture:** The dropdown is driven entirely by one exported array, `IMAGE_CATEGORY_OPTIONS` in `src/game/image-categories.ts`. Each entry maps an id to a free-text search string sent to Unsplash's `/photos/random` as the `query` parameter. Every consumer — the dropdown, the localStorage preference allowlist, the fetch path, analytics — reads that array generically, so adding a category means adding an array entry and a union member. No other production file changes.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom environment for these tests), oxlint.

**Spec:** `docs/superpowers/specs/2026-08-04-people-face-image-categories-design.md`

## Global Constraints

- **Queries are single tag words**: `'people'` and `'face'`, verbatim. These are the Unsplash tag terms the feature exists to expose. Do not expand them into multi-word phrases.
- **Do not modify the seven existing category entries.** Their `query` strings are what players who already saved a preference get today; changing one changes their results.
- **Do not add `content_filter`** to `buildRandomPhotoUrl` or anywhere else. This was considered and declined; see the spec's `content_filter` section.
- **Append the new entries after `travel`**, at the end of the array, so no existing option's position in the dropdown moves.
- **American English in all code and comments** (`color`, not `colour`) per `CLAUDE.md`. Note the existing UI copy string `'Vibrant colours'` is user-facing prose and is not being touched.
- **Do not touch `src/ui/info-modal.ts`.** It describes that a picture-type dropdown exists but does not enumerate categories, so no help text becomes wrong.

---

### Task 1: Add the `people` and `face` categories

**Files:**
- Modify: `src/game/image-categories.ts:16-24` (the `ImageCategoryId` union) and `src/game/image-categories.ts:46-95` (the `IMAGE_CATEGORY_OPTIONS` array)
- Test: `src/game/image-categories.test.ts:47-63` (the existing `findImageCategory` describe block)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: two new members of the exported `ImageCategoryId` union — `'people'` and `'face'` — and two new elements at the end of the exported `readonly ImageCategoryOption[]` named `IMAGE_CATEGORY_OPTIONS`. `ImageCategoryOption` is unchanged: `{ id: ImageCategoryId; label: string; query: string | undefined; description: string }`.

- [ ] **Step 1: Write the failing tests**

Add these two cases inside the existing `describe('findImageCategory', ...)` block in `src/game/image-categories.test.ts`, after the `'finds a known category by id'` case:

```ts
    it('finds the people category with the bare tag query', () => {
        const result = findImageCategory('people');
        expect(result.id).toBe('people');
        expect(result.query).toBe('people');
    });

    it('finds the face category with the bare tag query', () => {
        const result = findImageCategory('face');
        expect(result.id).toBe('face');
        expect(result.query).toBe('face');
    });
```

These pin the single-word convention. They are the assertion that catches someone later "improving" the queries into multi-word phrases and diverging from the Unsplash tag terms.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/image-categories.test.ts`

Expected: FAIL, both new cases. `findImageCategory` falls back to `IMAGE_CATEGORY_OPTIONS[0]` for an unknown id, so the failure reads `expected 'any' to be 'people'` (and `expected undefined to be 'face'`).

- [ ] **Step 3: Add the two entries**

In `src/game/image-categories.ts`, extend the `ImageCategoryId` union:

```ts
export type ImageCategoryId =
    | 'any'
    | 'nature'
    | 'animals'
    | 'architecture'
    | 'space'
    | 'abstract'
    | 'food'
    | 'travel'
    | 'people'
    | 'face';
```

Then append two entries to `IMAGE_CATEGORY_OPTIONS`, after the `travel` entry and before the closing `] as const;`:

```ts
    {
        id: 'people',
        label: 'People',
        query: 'people',
        description: 'People & portraits',
    },
    {
        id: 'face',
        label: 'Faces',
        query: 'face',
        description: 'Close-up faces',
    },
```

Note the deliberate asymmetry: the id is `face` (the Unsplash tag term, which is also what `query` must be) while the label is the plural `Faces`, which reads better in the dropdown beside Animals and Nature.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/game/image-categories.test.ts`

Expected: PASS, all cases. The file's pre-existing invariant tests now also cover the new entries with no change to them — `'all options have unique ids'` and `'all non-any options have a query string'` both iterate the whole array.

- [ ] **Step 5: Run the full check gate**

Run: `npm run lint && npm run build && npm test`

Expected: all three pass. `npm run build` is the one that proves the widened `ImageCategoryId` union still type-checks against every consumer.

If `src/puzzle/topology/dcel-broad-phase-equivalence.test.ts` fails, stop and investigate rather than re-recording it — it is a geometry tripwire and nothing in this task can legitimately move generated geometry. Do **not** run `vitest -u`.

- [ ] **Step 6: Commit**

```bash
git add src/game/image-categories.ts src/game/image-categories.test.ts
git commit -F - <<'EOF'
feat(images): add people and face picture-type categories

Both use the bare Unsplash tag term as the search query, matching the tag
chips on an Unsplash photo page — which link to search, not to topics. The
seven existing categories keep their multi-word phrases: rewording them
would change the results for players who already saved that preference.

Closes #529
EOF
```

---

### Task 2: Cover the category dropdown's option rendering

The dialog builds the category `<select>` by iterating `IMAGE_CATEGORY_OPTIONS` (`src/ui/new-game-dialog.ts:220-225`). There is a test asserting one `<option>` per puzzle size, but no equivalent for categories — so a future category could reach the array without reaching the UI and nothing would fail. This task closes that gap. It is independent of Task 1: the assertion holds both before and after those entries exist.

**Files:**
- Test: `src/ui/new-game-dialog.test.ts` (add one case; the file's final `it` block ends at line 443)
- Modify: nothing in production code.

**Interfaces:**
- Consumes: `IMAGE_CATEGORY_OPTIONS` from Task 1's file, imported into the test.
- Produces: nothing.

- [ ] **Step 1: Add the import**

At the top of `src/ui/new-game-dialog.test.ts`, beside the existing `PUZZLE_SIZE_OPTIONS` import on line 11:

```ts
import { IMAGE_CATEGORY_OPTIONS } from '../game/image-categories.js';
```

- [ ] **Step 2: Write the test**

Add this case at the end of the `describe('createNewGameDialog', ...)` block, after `'hides the candidate grid when no fetchImageCandidates is provided'`:

```ts
    it('renders one select option per image category', () => {
        createNewGameDialog({ container, selectedSizeId: '48', onSelect: vi.fn() });

        const categorySelect = container.querySelector<HTMLSelectElement>(
            '.image-options-section select',
        )!;
        expect(categorySelect.options).toHaveLength(IMAGE_CATEGORY_OPTIONS.length);
        expect([...categorySelect.options].map((o) => o.value)).toEqual(
            IMAGE_CATEGORY_OPTIONS.map((c) => c.id),
        );
    });
```

The `.image-options-section select` selector is the one the existing `'re-fetches candidates when the category or vibrant option changes'` case already uses (line 422) — the category `<select>` has no `data-testid`. The second assertion is what makes this more than a count: it pins order and ids, so a filtered or reordered loop fails too.

- [ ] **Step 3: Verify the test passes, then verify it can fail**

Run: `npx vitest run src/ui/new-game-dialog.test.ts`

Expected: PASS.

A test that passes the moment you write it has proved nothing yet. Confirm it bites: temporarily change the loop in `src/ui/new-game-dialog.ts:220` to `for (const cat of IMAGE_CATEGORY_OPTIONS.slice(1))`, re-run, and confirm the new case FAILS on the length assertion. **Then revert that edit** and re-run to confirm PASS again.

- [ ] **Step 4: Run the full check gate**

Run: `npm run lint && npm run build && npm test`

Expected: all three pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/new-game-dialog.test.ts
git commit -F - <<'EOF'
test(new-game-dialog): assert the category select renders every option

The dialog had this coverage for the puzzle-size dropdown but not the
picture-type one, so a category could reach IMAGE_CATEGORY_OPTIONS without
reaching the UI. Asserts ids and order, not just the count.
EOF
```

---

### Task 3: Verify in the running app

Automated tests prove the array and the dropdown agree. They do not prove Unsplash returns sensible photos for `people` and `face` — that is a judgment call about output quality, and it needs eyes.

**Files:** none.

**Interfaces:** none.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Exercise both new categories**

In the new-game dialog:

1. Open **Picture Type** and confirm **People** and **Faces** appear at the end of the list, after Travel.
2. Select **People**. Confirm the candidate thumbnails refresh and show photos of people.
3. Select **Faces**. Confirm the thumbnails refresh and skew toward close-up portraits.
4. With **Faces** still selected, tick **Vibrant colours**. Confirm the thumbnails refresh again — this proves the query composition (`'face vibrant colorful'`) still reaches Unsplash.
5. Start a puzzle from a **Faces** photo, reload the page, and confirm it resumes — this proves the widened preference allowlist persists and reloads.

- [ ] **Step 3: Report the result**

Report what the two categories actually returned. Whether the photo quality is good enough to ship is Adrian's call, not the implementer's — if the results look poor, say so plainly rather than adjusting the query strings, which are fixed by the Global Constraints above.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Two entries appended after `travel`, single-word queries | Task 1, Step 3 |
| `ImageCategoryId` union widened | Task 1, Step 3 |
| Label `Faces` / id `face` | Task 1, Step 3 |
| Existing seven left alone | Global Constraints |
| `content_filter` not added | Global Constraints |
| Info modal untouched | Global Constraints |
| Vibrant toggle still composes | Task 3, Step 2.4 |
| `findImageCategory` query assertions | Task 1, Step 1 |
| Existing invariants cover new entries free | Task 1, Step 4 |
| Dialog renders one option per category | Task 2 |
| Preference allowlist widens automatically | Task 3, Step 2.5 |
| Seeded generation untouched | Task 1, Step 5 (geometry tripwire) |

No gaps.

**Placeholder scan:** none — every step carries the literal code or command to run.

**Type consistency:** `ImageCategoryOption` is referenced with the same four fields (`id`, `label`, `query`, `description`) in Task 1's Interfaces block and its Step 3 code. `IMAGE_CATEGORY_OPTIONS` and `findImageCategory` keep their exact exported names across Tasks 1 and 2.
