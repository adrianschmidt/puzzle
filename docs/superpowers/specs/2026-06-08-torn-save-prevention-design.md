# Torn save prevention (#404)

## Problem

A save can end up with its two localStorage keys describing **two different
puzzles**: `puzzle-game-state` (geometry) from puzzle A and `puzzle-progress`
from puzzle B. On the next fresh load, the seed-mismatch guard in
`loadSavedGame` (`src/persistence/storage.ts`) correctly rejects the pair and
shows the "corrupt save" recovery dialog.

The detection is working as intended. The bug is that the two keys are *allowed
to drift apart in the first place*. This design makes the torn pair impossible
to write; the load-side detection stays exactly as-is as a backstop.

Two routes produce the torn pair:

- **Route 1 — cross-tab autosave race (affects production).** Production
  (`/puzzle/`) and dev-deploy (`/puzzle/dev/`) are the same origin and share one
  localStorage; more generally any user can open two tabs. Tab A starts new
  puzzle Y → writes `geometry=Y` + `progress=Y`. Tab B still holds puzzle X in
  memory; a debounced progress autosave fires → `progress=X`, geometry
  untouched. Net: `geometry=Y`, `progress=X` → seed-mismatch on next load. No
  quota failure or old code required.

- **Route 2 — failed geometry write leaves stale geometry.** `saveNewPuzzle`
  writes geometry then progress unconditionally. If the new puzzle's geometry is
  too large to persist even compressed, `writeWithOverflow` returns `'failed'`
  and leaves the previous value at the key intact; the subsequent small progress
  write for the new puzzle still succeeds → stale geometry + new progress →
  seed-mismatch. Only Composable/Traced geometries are large enough to trigger
  this. Those are currently gated out of production by `isComposableVisible()`,
  **but the traced-tab feature is intended to ship** — so this is a
  soon-to-be-production path, not a permanent dev-only one. Treat it as
  production-relevant.

## Decision

Single save slot semantics: when two tabs hold different puzzles, only one can
own the slot. **The geometry key is the anchor; the tab that last wrote geometry
(new-game / share-load) owns the slot.** A stale progress write that does not
match the current geometry is dropped, not allowed to tear the pair. (Chosen
over the "reclaim by rewriting geometry" alternative because it is least
surprising — the user's most recent new-game wins — has zero cost in the normal
single-tab path, and avoids resurrecting an abandoned puzzle.)

All changes live in `src/persistence/storage.ts` plus its test. No new
localStorage keys, no UI changes.

## Route 1 — drop the stale progress write (anchor wins)

`saveProgress` consults the geometry key's seed before writing. If a geometry
blob is present **and** its seed is known **and** it differs from the seed of the
progress being written, the write is skipped and a new `'skipped'` result is
returned.

### Avoiding per-save decompress cost

The geometry blob can be multiple MB (compressed composable ~2.4 MB). Decoding it
on every 500 ms debounced save would be wasteful. A module-level cache keyed on
the **verbatim raw geometry string** avoids it:

```ts
let cachedGeometryRaw: string | null = null;
let cachedGeometrySeed: number | undefined;

function currentGeometrySeed(): number | undefined {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
        cachedGeometryRaw = null;
        cachedGeometrySeed = undefined;
        return undefined;
    }
    if (raw !== cachedGeometryRaw) {
        cachedGeometryRaw = raw;
        try {
            const parsed = JSON.parse(decompressFromStorage(raw));
            cachedGeometrySeed =
                typeof parsed.seed === 'number' ? parsed.seed : undefined;
        } catch {
            // Unreadable geometry: don't block progress writes.
            cachedGeometrySeed = undefined;
        }
    }
    return cachedGeometrySeed;
}
```

In the normal single-tab case the raw string is stable after new-game, so the
cache hits every save → cost is one `getItem` and no decompress. A cross-tab
geometry write (or a new puzzle in this tab) changes the raw string and
invalidates the cache lazily on the next read.

Correctness comes from the `getItem` — the *actual* stored string is read on
every save, so the cache can never go stale. The cache only skips re-running
`decompress`+`JSON.parse` when the bytes are byte-for-byte identical to the last
read. This matters increasingly once traced tabs ship: large composable
geometries (multi-MB compressed) would otherwise be decompressed on every 500 ms
autosave; with the cache that decode happens at most once per puzzle. The
residual per-save cost is the `getItem` string copy, which is acceptable even for
large production blobs.

### The guard

```ts
export function saveProgress(state, selection?): SaveResult {
    const geomSeed = currentGeometrySeed();
    if (
        geomSeed !== undefined &&
        state.seed !== undefined &&
        geomSeed !== state.seed
    ) {
        diagnostics.warn(
            'Skipping progress save: stored geometry belongs to a different ' +
            'puzzle (cross-tab takeover).',
        );
        return 'skipped';
    }
    return writeWithOverflow(
        PROGRESS_KEY,
        JSON.stringify(serializeProgress(state, selection)),
    );
}
```

Defensive defaults — only skip on a *confirmed* mismatch. Geometry absent,
unreadable, or seedless → write as today.

### `'skipped'` is not `'failed'`

`SaveResult` gains a `'skipped'` member. It must **not** trigger the "too large
to save" toast: `createDebouncedSave`'s flush only calls `onSaveFailed` on
`'failed'`, so `'skipped'` is inert there. `saveNewPuzzle`'s result-combining
treats `'skipped'` as non-failing (it cannot occur on that path anyway, since
geometry for the same seed was just written). Skip events are logged via
`diagnostics.warn`, and the debounced saver surfaces them through a new
`onSaveSkipped` callback so `main.ts` can emit a `track('progress-save-skipped',
{ cutStyle, pieceCount })` analytics event — letting an operator see how often
the cross-tab race actually fires in production (the bug was found from a real
production backup). Added in review follow-up.

## Route 2 — leave the previous puzzle loadable

`saveNewPuzzle` becomes atomic: if `saveGeometry` fails, **do not write the new
progress** and return `'failed'`. The previous puzzle's geometry is still at
`STORAGE_KEY` and its progress is still at `PROGRESS_KEY` (geometry is written
first, so old progress was never overwritten) → the previous puzzle remains a
consistent, loadable pair.

```ts
export function saveNewPuzzle(state, selection?): SaveResult {
    const g = saveGeometry(state);
    if (g === 'failed') {
        // New geometry too large to persist; the previous puzzle's geometry is
        // still at STORAGE_KEY. Don't write the new progress on top of it (that
        // would be a seed-mismatch). Leaving the previous pair intact keeps it
        // loadable; the new puzzle simply won't persist. Route 1's saveProgress
        // seed guard likewise drops subsequent autosaves of the new puzzle, so
        // the previous pair stays consistent.
        return 'failed';
    }
    const p = saveProgress(state, selection);
    if (p === 'failed') return 'failed';
    if (g === 'ok-compressed' || p === 'ok-compressed') return 'ok-compressed';
    return 'ok';
}
```

The "too large to save — your progress won't be kept across reloads" toast still
fires (true for the *new* puzzle). On reload the previous puzzle reappears rather
than an empty board. The two fixes compose: Route 1's guard means every
subsequent autosave of the unsaveable new puzzle is also dropped, so the old pair
can never be torn afterward.

When no previous save existed, both keys stay absent → next load is `empty`
(fresh start). Either way, no torn pair.

## Out of scope

- Option 3: `storage`-event cross-tab coordination / reload prompts. (Also the
  perf optimization of avoiding the per-save geometry read via a `storage`-event
  cache or a companion seed key — **declined**, not merely deferred: every cheap
  alternative trades away a correctness property, and the race-free synchronous
  read's cost is immaterial. We keep the synchronous read.)
- ~~Skip-frequency telemetry.~~ Added in review follow-up — see the
  `'skipped'` section above.
- Help text: no toolbar/gesture/setting changes; this is a correctness fix with
  no visible feature (the only observable change is *fewer* false corrupt-save
  dialogs), so no `info-modal.ts` update is required.

## Testing (TDD)

Extend `src/persistence/storage.test.ts`:

- `saveProgress` skips (returns `'skipped'`, leaves `PROGRESS_KEY` untouched)
  when the stored geometry seed differs from the state's seed.
- `saveProgress` writes when seeds match.
- `saveProgress` writes when geometry is absent / unreadable / seedless (no
  skip on anything but a confirmed mismatch).
- Geometry blob is decompressed at most once across repeated same-geometry saves
  (spy on `decompressFromStorage`), and the cache re-reads after the raw
  geometry string changes.
- `saveNewPuzzle` leaves the previous pair intact and unwritten-over when
  `saveGeometry` fails (simulate quota via a mocked `localStorage.setItem` that
  throws for the large geometry blob); `loadSavedGame` afterwards returns the
  previous puzzle (`status: 'ok'`), not `seed-mismatch`.
- Cross-tab race simulation: write `geometry=Y`+`progress=Y`, then
  `saveProgress` for puzzle X → resulting pair is still `Y`/`Y`
  (`loadSavedGame` → `ok`, no mismatch).
