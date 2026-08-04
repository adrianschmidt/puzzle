# Image categories: add `people` and `face`

Date: 2026-08-04
Issue: [#529](https://github.com/adrianschmidt/puzzle/issues/529)

## Problem

The **Picture Type** dropdown in the new-game dialog offers eight options —
`any`, `nature`, `animals`, `architecture`, `space`, `abstract`, `food`,
`travel`. Photos of people are not reachable through any of them. The issue
asks for two more: `people` and `face`.

## What the categories actually are

The feature's original intent was to expose the labels Unsplash shows on a
photo page. Those chips — **Woman, Girl, People, Fashion, Face, Red, …** —
are **tags**, and every one links to a search page (`/s/photos/people`,
`/s/photos/face`), not to a topic page (`/t/<slug>`).

That matters because Unsplash has *both*, and they are different API
mechanisms:

- **Tags** are free text. They reach the API through `query`, which is what
  `buildRandomPhotoUrl` (`src/images/unsplash.ts:79`) already sends.
- **Topics** are a curated, fixed set (`/t/nature`, `/t/people`, …) reached
  through a separate `topics` parameter. The API docs are explicit: *"You
  can't use the collections or topics filtering with query parameters in the
  same request."*

So the existing `query`-based implementation is already the right mechanism —
no `topics` plumbing is needed. This was checked rather than assumed, because
the topic route looked plausible at first and would have been the wrong turn:
`face` has no topic at all, and a topic-based category could not carry the
Vibrant toggle's appended keywords, so that toggle would have silently done
nothing whenever such a category was selected.

## Approach

Add two entries to `IMAGE_CATEGORY_OPTIONS` and two members to
`ImageCategoryId`, both in `src/game/image-categories.ts`. Nothing else
changes.

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

Appended after `travel`, so no existing option's position in the dropdown
moves.

**Single-word queries, matching the tag terms exactly.** The existing seven
use multi-word phrases (`'nature landscape'`, `'space nebula galaxy'`), which
is a drift from the tag convention. They are deliberately left alone:
rewording them would change the results players get for a category they have
already chosen and saved, and nothing in this issue asks for it.

**Label `Faces`, id `face`.** The id matches the Unsplash tag and the issue's
wording; the plural label reads better in a dropdown beside Animals and
Nature.

## Why one file is enough

Every downstream consumer reads the array generically:

- **Dropdown** (`src/ui/new-game-dialog.ts:220`) iterates
  `IMAGE_CATEGORY_OPTIONS`, using only `id` and `label`.
- **Preference store** (`src/game/image-categories.ts:144`) derives its
  `allowed` list from the array, so both new ids become valid saved values
  automatically — including through `loadImageCategoryPreference`'s
  invalid-value fallback.
- **Fetch path** — `findImageCategory` → `buildImageQuery` → the `query`
  parameter. Untouched, in both `resolve-image.ts` and
  `fetch-candidate-images.ts`.
- **Analytics** (`src/analytics/umami.ts:189`) carries `imageCategory` as a
  free string. There is no enumeration to widen, and no dashboard query that
  breaks by gaining two new values.
- **Info modal** describes the dropdown's existence but does not enumerate
  categories, so no help text becomes wrong. (`src/ui/info-modal.ts:117`.)

`ImageCategoryOption.description` is populated for all eight existing options
and read nowhere. The two new entries fill it in for consistency; removing the
field is out of scope.

## Vibrant toggle

Unaffected, and this is the payoff of staying on `query`:
`buildImageQuery('people', true)` returns `'people vibrant colorful'`. No
special-casing, no disabled control, no category that follows different rules
from its neighbours.

## `content_filter`: deliberately not added

Unsplash's `/photos/random` accepts `content_filter` (`low` — the default and
what the app sends today — or `high`). Searching `people` and `face` draws
from a pool that includes artistic nudity and lingerie photography, so
switching to `high` was raised as an option.

**Decision: leave it at the default.** Recorded here so a later reviewer
reading the diff does not re-raise it as an oversight. It was considered and
declined; if it is ever wanted, the right shape is one parameter in
`buildRandomPhotoUrl` applying to every category, not a per-category flag —
a category that quietly filters differently from its neighbours is the worse
design.

## Invariants this must not break

- **Seeded generation.** Nothing here touches the PRNG call sequence. The
  image category selects *which photo* is fetched; it never reaches
  `generateProceduralPuzzle`. Share links and saves are unaffected by
  construction.
- **Saved preferences.** A player with `puzzle-image-category` set to any of
  the existing eight keeps that value; the allowlist only widens.
- **Existing categories' results.** No existing `query` string changes, so no
  existing category returns a different pool of photos than it did before.

## Testing

- **`src/game/image-categories.test.ts`** — two `findImageCategory` cases
  pinning the single-word queries: `findImageCategory('people')` has
  `query === 'people'`, `findImageCategory('face')` has `query === 'face'`.
  This is the assertion that would catch someone "improving" them into
  multi-word phrases and diverging from the tag convention.
- The file's existing invariants cover the new entries with no change: unique
  ids across all options, and every non-`any` option having a truthy query.
- **`src/ui/new-game-dialog.test.ts`** — a new assertion that the category
  `<select>` renders one `<option>` per entry in `IMAGE_CATEGORY_OPTIONS`.
  The dialog has this test for the puzzle-size dropdown but not the category
  one; it is the check that catches a future category reaching the array but
  not the UI.
