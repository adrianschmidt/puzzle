# Backup image pool — insurance against Unsplash rate-limit exhaustion

## Problem

Puzzle images come from Unsplash via the Cloudflare Worker proxy (`/random`).
Unsplash's rate limit applies to every `api.unsplash.com` JSON call (the
production hourly quota — 5000 req/hr at the standard tier; confirm the app's
own number on the Unsplash dashboard). The image CDN (`images.unsplash.com`)
is **not** rate-limited: once a photo's URLs are known, the image loads free of
quota forever.

Today, when a `/random` fetch fails for any reason, the app falls back to a
**single** bundled image (`first-puzzle.jpg` / `first-puzzle-portrait.jpg`). If
the quota is ever exhausted (or the API errors for a stretch), every new
non-blank puzzle collapses to that one image until quota resets.

## Goal

Replace the single-image *rate-limit* fallback with a small, curatable pool of
pre-harvested Unsplash images (~a dozen per category/orientation/vibrant
bucket). The pool serves puzzle images with **zero API calls**: it stores only
image *metadata* (CDN URLs + attribution + download location), and the CDN is
unmetered.

## Scope

**In:**
- A committed catalog of Unsplash image metadata records.
- Random selection from the catalog, matched to the requested
  category / vibrant / orientation.
- Serving pool images on the *rate-limited / API-error* tier only.
- A harvest script to (re)generate the catalog.
- Adoption/coverage analytics.

**Out (deferred or separate):**
- **#450 silhouette curation.** A different, larger feature (authored per-image
  outline polygons + bespoke tab-less cuts). It will *reuse this catalog's
  record shape* as its image substrate, but its cut machinery is its own spec
  (mostly already written on the `feat/silhouette-cut-generator` branch). Not
  built here.
- **Backing the 4-up picker grid** (the "full coverage" option). The pool backs
  only single-image paths — "Surprise me" and the fetch-failed fallback — for
  v1. The grid stays hidden on API failure, as today. Door left open for a
  follow-up.
- **Cost-saver-by-default.** The pool is a *fallback*, never the primary source;
  a successful API call always wins.
- **Scheduled catalog refresh.** Harvest is manual; a cron would clobber
  curation.
- **Offline behavior change.** When the device is offline the bundled *local*
  image remains the fallback — a CDN pool image cannot load offline.

## Key constraints

### Reproducibility — two guarantees

Share links and saves re-run `generateProceduralPuzzle` from a seed to
reproduce *cut geometry*; the image is carried as a concrete URL, not
regenerated.

1. **Snapshot, never reference.** A pool image is copied into game state exactly
   as a picked / "Surprise me" image is — `imageUrl` (CDN), size, attribution,
   `downloadLocation`. Nothing in a save or share link references the pool by
   index or id. Shipping a new or updated catalog therefore **cannot** affect
   any existing link or save.
2. **Select outside the seed.** Pool selection happens in `resolve-image.ts` /
   the new-game flow, *before* generation, using ordinary `Math.random` — never
   inside the seeded generation path. It does not perturb the PRNG call
   count/order.

Together: **zero new reproducibility surface.** This mirrors how API image
selection already works (the chosen URL is baked into the link; the selection
randomness is not reproducible and does not need to be).

### Offline vs. rate-limited

The two failure modes are already distinct inside `resolve-image.ts` — they are
just both collapsed to `null` today:

- `fetchRandomImage` resolves **`undefined`** on an HTTP error response (403
  rate-limited, 5xx, …) → *the network is reachable, the API refused*. CDN pool
  images will load. → **serve from the pool.**
- The fetch **throws** (offline / unreachable) → a CDN pool image is useless.
  → **`null` → bundled local image** (unchanged).
- An aborted start still throws `GenerationCanceledError` (unchanged).

### Unsplash compliance

Hotlinking cached CDN URLs + attribution + firing `download_location` on use is
Unsplash's intended pattern (we never re-host pixels). The existing best-effort
`triggerPhotoDownload` fires for pool images too; it harmlessly 403s if we truly
are rate-limited.

## Design

### Catalog data — `src/images/backup-pool.json`

Array of records:

```
{
  id: string,                 // Unsplash photo id — for curation & #450 reuse; unused by the live path
  category: ImageCategoryId,  // one of the 9 non-'any' categories
  vibrant: boolean,
  orientation: 'landscape' | 'portrait',
  imageUrl: string, width: number, height: number,
  photographerName: string, photographerUrl: string, photoUrl: string,
  thumbUrl: string, downloadLocation: string,
  description?: string
}
```

That is a `UnsplashImageResult` plus `{ id, category, vibrant, orientation }`.
`thumbUrl` is unused on the single-image path but keeps the record a complete
`UnsplashImageResult` (so `toDisplayImage` takes it directly) and leaves the
deferred 4-up-grid follow-up cheap.

Buckets = 9 categories (`nature`, `animals`, `architecture`, `space`,
`abstract`, `food`, `travel`, `people`, `face` — **excluding `any`**)
× {normal, vibrant} × {landscape, portrait} = **36 buckets**, ~12 records each
≈ **~432 records** (~250 KB; metadata only — pixels stay on the CDN).

`any` has **no** bucket: it selects across all categories (below).

### Selection — `src/images/backup-pool.ts`

```
resolveFromPool(
  category: ImageCategoryId,
  vibrant: boolean,
  orientation: Orientation,
): DisplayImage | null
```

- Filter records by `orientation` **and** `vibrant`.
- If `category !== 'any'`, additionally filter by `category`. (`any` → union
  across all categories, still respecting vibrant + orientation.)
- Pick one uniformly at random (`Math.random`).
- Map via the existing `toDisplayImage`; return it, or `null` if the filtered
  set is empty.

**Lazy-loaded.** `backup-pool.ts` statically imports the JSON, and
`resolve-image.ts` reaches it via `await import('../images/backup-pool.js')`, so
the ~250 KB rides a lazy chunk that never loads unless a fallback fires.

### The hook — `src/app/resolve-image.ts`

`resolveUnsplashImage` currently returns `null` in both failure branches.
Change:

- **HTTP-error branch** (`if (!result)`): return the pool result —
  `resolveFromPool(category.id, vibrant, orientation)` (via the lazy import) —
  which is a `DisplayImage`, or `null` if the bucket is empty (→ caller's
  bundled default).
- **`catch` (thrown) branch:** unchanged `return null` (→ bundled). Cancellation
  rethrow unchanged.
- Emit `track('image-pool-fallback', { category, vibrant, orientation, hit })`
  where `hit` = a record was served (miss = empty bucket → bundled). Adoption +
  coverage-gap signal.
- Update the module doc comment to the new contract (category 5/6):
  HTTP-error → pool, thrown → bundled.

### Orchestrator — `src/app/start-new-game.ts`: unchanged

A pool `DisplayImage` flows through the existing
`if (resolved) { … } else { bundled }` path. The download trigger fires
best-effort for it. The bundled image remains the terminal fallback (offline, or
an empty bucket).

### Harvest — `scripts/harvest-backup-pool.ts` (`npm run harvest-backup-pool`)

- Read `VITE_IMAGE_PROXY_URL` (the public Worker URL) from env / `.env.local`.
- For each of the 36 buckets, GET
  `${proxy}/random?query=${buildImageQuery(category.query, vibrant)}&orientation=${orientation}&count=12`.
  **Reuse `buildImageQuery` and `IMAGE_CATEGORY_OPTIONS`** so pool queries match
  the app's live query semantics exactly.
- Parse each item with the shared `parseUnsplashResponse`; capture `id` from the
  raw item; tag with `{ category, vibrant, orientation }`.
- Dedupe by `id` across the whole catalog (keep first) so a photo returned for
  more than one category search isn't over-weighted under `any`.
- Write stable-sorted JSON (by category, vibrant, orientation, id) for clean
  diffs.
- **No secret:** the request goes through the Worker, which holds the *current*
  prod key. 36 requests total, seconds to run.
- **Manual, not scheduled.** Re-run a single bucket or hand-edit the JSON to
  curate. (The stale GitHub `VITE_UNSPLASH_ACCESS_KEY` secret is the *old*,
  pending-deletion app key — deliberately not used.)

### Tests

- `src/images/backup-pool.test.ts`: bucket filtering (category / vibrant /
  orientation); `any` unions across categories while respecting vibrant +
  orientation; empty bucket → `null`; mapping to `DisplayImage`; a **coverage
  guard** asserting every bucket has ≥1 record so a broken harvest fails CI.
- Extend `src/app/resolve-image.test.ts`: HTTP-error (`undefined`) → serves a
  pool image; thrown → `null` (bundled); cancellation still throws. Pins the
  tier split — the crux of the change.

### Help text

**No change.** The fallback is invisible by design — no new button, option, or
setting — so the info modal stays as-is.

## Reuse note (#450)

The catalog record shape (id + image identity + tags) is exactly the image
substrate #450's curated silhouette library needs; #450 attaches authored
outline polygons and keys puzzles by id. Building it cleanly here is the only
concession to that future feature; nothing else about #450 is in scope.

## Resolved decisions

- **No `any` bucket** — `any` unions the category buckets, filtered by vibrant +
  orientation.
- **Empty bucket → bundled image** (no vibrant→normal relaxation).
- **Both orientations** harvested, ~a dozen each (≈432 records total).
- **Pool backs single-image paths only**; the 4-up grid is a deferred follow-up.
