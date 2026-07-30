# Progress autosave: record the geometry owner instead of re-reading it

**Date:** 2026-07-31
**Status:** Approved (design)

## Summary

`saveProgress` calls `currentGeometrySeed()` on every debounced flush to
detect a cross-tab takeover (#404). That helper reads the whole geometry
blob out of `localStorage` and compares it against the last raw string it
decoded:

```ts
const raw = localStorage.getItem(STORAGE_KEY);   // the whole geometry blob
if (raw !== cachedGeometryRaw) { /* re-parse */ }
```

Only the *parse* is cached. The multi-MB `getItem` and the string compare
run on every flush — up to one per 500 ms `SAVE_DEBOUNCE_MS` window,
synchronously, on the main thread, in the interaction path. The blob is
~1.36 MB at the default 8×6 and ~5.80 MB at the max 16×12 on composable
cut styles (#487), and #486 moved Classic — the default style — into that
regime.

The fix inverts where the answer comes from: the seed of the geometry that
owns the save slot is **recorded when that geometry is written**, in a
small dedicated key. Decoding the blob becomes the fallback path rather
than the norm. Steady-state cost per flush drops from a multi-MB read plus
memcmp to a ~10-byte read.

That is a change to the storage layer's cache-invalidation contract, so
the design below is mostly about the case the guard exists for: detecting
that *another tab* wrote the geometry.

## Design

### The new key

`GEOMETRY_SEED_KEY = 'puzzle-geometry-seed'` — the seed of the geometry
currently at `STORAGE_KEY`, as a decimal string.

It is a **derived cache, not part of the save format**. It carries nothing
that isn't already inside the geometry blob, so every degenerate state
(absent, non-numeric, written by an older client, suspected stale) falls
back to decoding the blob and is then re-recorded. No migration, no
version bump, and a save whose token is missing loads and plays exactly as
before. `clearSavedState()` removes it alongside the other two keys.

### `currentGeometrySeed()` — three paths

| Situation | Work done |
|---|---|
| Token present and trusted (steady play) | one ~10-byte `getItem` |
| Token absent (save predates this change) | full decode **once**, then backfill the token |
| Token untrusted (another tab wrote geometry) | full decode once, token rewritten |

The fallback path is today's implementation, unchanged: read the raw blob,
`decompressFromStorage` + `JSON.parse`, keep `cachedGeometryRaw` /
`cachedGeometrySeed` so a repeat within the same untrusted window doesn't
decode twice. It swallows its own errors exactly as it does now — an
unreadable geometry yields `undefined` and does not block progress writes.

Backfilling on the absent-token path is what stops a returning player's
pre-existing save from paying the old cost for the entire session: without
it, every flush would keep hitting the fallback forever, since nothing else
writes the token until the player starts a new puzzle. The backfill is
derived from the blob that was just decoded, so it cannot invent an
ownership claim that isn't already true.

A token that parses to a non-finite number is treated as absent.

### Trust invalidation — the `storage` event

A token is only correct while every writer of `STORAGE_KEY` maintains it.
Within one build they all go through `saveGeometry`, but two tabs on the
same origin need not be running the same build: a tab open from before a
deploy, or `/puzzle/` and `/puzzle/dev/`, which share one `localStorage`
(keyed by origin, not path). A tab running older JS writes geometry and
leaves the token pointing at the previous puzzle — and the takeover the
guard exists to catch goes undetected, reintroducing #404's false "corrupt
save".

So a module-scope `storage` listener sets `tokenUntrusted = true` when:

- `event.key === STORAGE_KEY` — someone else wrote or removed the geometry;
- `event.key === null` — someone else called `localStorage.clear()`, which
  the spec reports as a single null-key event.

Storage events never fire in the window that made the change, so any event
we receive *is* another tab; no self-filtering is needed. The listener is
registered at module scope (guarded on `typeof window`), not wired from
`bootstrap.ts`: it is a correctness mechanism, and one that silently
degrades if a caller forgets to install it is worse than a module-level
side effect in the module that owns the invariant. It only sets a boolean.

This is the belt to the token's braces, and each covers the other's gap:
the event catches writers that don't maintain the token, and the token
catches events that were never delivered (a bfcached or frozen tab misses
storage events entirely, but the tab that wrote the geometry updated the
token before freezing us out).

`tokenUntrusted` is cleared at the start of the fallback path, before the
read — JavaScript is single-threaded, so an event cannot interleave with
the synchronous decode that follows.

### Write side — `saveGeometry`

Record the token **only after the geometry write succeeded** (`'ok'` or
`'ok-compressed'`). On `'failed'` the previous puzzle's geometry is still
in the slot and the existing token still describes it correctly; writing
the new seed there would make this tab skip every subsequent progress save
for a puzzle it legitimately owns.

If the token write itself throws (storage full — largely theoretical, since
the geometry write ahead of it just succeeded), remove the key so the next
check falls back to decoding, and set `tokenUntrusted` in case the removal
throws too. Degrading to slow-but-correct beats recording a lie.

`saveProgress` and `saveNewPuzzle` keep their current shape; `saveProgress`
calls the same `currentGeometrySeed()` and its skip semantics are
unchanged (only a *confirmed* mismatch skips).

## Testing

The existing `saveProgress cross-tab guard (#404)` suite is the regression
net and stays green, with one correction. `'skips after a cross-tab
geometry change (cache invalidation)'` currently fakes the other tab by
calling `saveGeometry()` in-process — under the new model that *is* a
same-tab write, and it would pass for the wrong reason. It becomes a direct
`localStorage.setItem(STORAGE_KEY, ...)` plus a dispatched `StorageEvent`,
which is what a real other tab looks like from inside this one.

New cases in `src/persistence/storage.test.ts`:

1. **Fast path does no decoding** — after `saveNewPuzzle`, repeated
   `saveProgress` calls for the same puzzle record zero
   `decompressFromStorage` calls (today's equivalent test allows one).
2. **Backfill** — geometry written with the token key removed (a save from
   before this change) decodes exactly once across several flushes, and
   leaves the token populated.
3. **Storage event forces one re-decode** — dispatching a `StorageEvent`
   for `STORAGE_KEY` after a warm token causes exactly one decode on the
   next flush, and none on the flush after that.
4. **Cross-tab takeover is still caught** — other tab's `setItem` +
   `StorageEvent`, this tab's next `saveProgress` returns `'skipped'` and
   leaves the progress key untouched.
5. **`localStorage.clear()` event** (`key: null`) invalidates the same way.
6. **Token write failure** — `setItem` stubbed to throw for the token key
   only; the save still succeeds and the guard still detects a later
   mismatch (falls back rather than skipping saves).
7. **Garbage token** — a non-numeric value is ignored, not trusted.
8. **`clearSavedState` removes all three keys.**

## Non-changes

- **Save format / serialization:** untouched. No version bump; the token is
  derived data, and its absence is a supported state.
- **`loadSavedGame`:** stays read-only. It would be a natural place to
  populate the token, but the "does not modify localStorage" property is
  worth more than saving one decode on the first flush of a session, which
  the backfill covers anyway.
- **`CorruptSaveData` / the corrupt-save download:** unchanged. The token
  holds no information not already in the geometry blob, so there is
  nothing to recover from it.
- **Help text:** none. No player-visible behavior change — the same saves
  are written and skipped in the same situations, just cheaper.
- **Analytics:** no new events. `onSaveSkipped` telemetry keeps its
  meaning.
