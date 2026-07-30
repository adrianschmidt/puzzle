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

### `currentGeometrySeed()` — two paths

| Situation | Work done |
|---|---|
| Token present (steady play) | one ~10-byte `getItem` |
| Token absent — save predates this change, or was invalidated | full decode **once**, then backfill the token |

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

A blob that is **seedless or unreadable** has nothing to backfill, so it
keeps paying the pre-#490 cost — the multi-MB `getItem` and full-length
compare — on every flush, permanently. That is parity with today rather than
a regression, and only a pre-v4 legacy save (which predates traced tabs, so
it is nowhere near the 5.8 MB regime) or a corrupt blob can reach it. A
sentinel would buy the fast path back at the cost of blinding the takeover
check, which is the wrong trade. `cachedGeometryRaw` is what keeps that case
to a compare rather than a re-parse, and it is the only case where that memo
still earns its keep.

A token that does not round-trip through `String(Number(token))`, or parses
to a non-finite number, is treated as absent. `Number.isFinite` alone is too
loose: `''` and `'   '` read as seed `0`, which no writer produces and which
would make every save look like a mismatch.

### Trust invalidation — the `storage` event

A token is only correct while every writer of `STORAGE_KEY` maintains it.
Within one build they all go through `saveGeometry`, but two tabs on the
same origin need not be running the same build: a tab open from before a
deploy, or `/puzzle/` and `/puzzle/dev/`, which share one `localStorage`
(keyed by origin, not path). A tab running older JS writes geometry and
leaves the token pointing at the previous puzzle — and the takeover the
guard exists to catch goes undetected, reintroducing #404's false "corrupt
save".

So a `storage` listener **removes the token key** when the event did not
come from `sessionStorage` (whose null-key `clear()` says nothing about our
geometry) and:

- `event.key === STORAGE_KEY` — someone else wrote or removed the geometry;
- `event.key === null` — someone else called `localStorage.clear()`, which
  the spec reports as a single null-key event.

Deleting the key rather than flipping an in-memory "untrusted" flag is what
makes this simple to reason about, because it collapses the whole mechanism
to one invariant:

> The token key exists only while we believe it describes the geometry at
> `STORAGE_KEY`. Anyone who sees evidence otherwise deletes it, and the next
> reader re-derives it from the blob.

There is then no second source of truth to keep in sync, no in-memory state
that outlives a `localStorage.clear()`, and the invalidation path is the
same one an old save already exercises. Deleting a token the other tab had
just written correctly costs one redundant decode, never a wrong answer.

That asymmetry is also why the `sessionStorage` test is written as an
exclusion rather than as `event.storageArea === localStorage`. The identity
is spec-mandated and holds in every engine and in jsdom, so the two are the
same test today — but they fail in opposite directions. Requiring the
identity fails *open*: anywhere it did not hold, cross-tab invalidation
would silently switch off entirely and the mixed-build takeover would go
undetected until the next load. Excluding `sessionStorage` fails safe, at
a ceiling of one redundant decode. Every other decision here deletes when
in doubt; this one should too.

Storage events never fire in the window that made the change (confirmed
against jsdom as well as the spec), so any event we receive *is* another
tab; no self-filtering is needed, and our own removal cannot re-trigger us.
The removal does fire an event in *other* tabs, but their handlers ignore
any key that isn't the geometry key, so there is no cascade. The listener
is installed by an exported `installGeometryTokenInvalidation()` — named for
the invariant rather than for either of its two triggers — wired from
`bootstrap.ts` with a test, per the repo's composition-root convention —
the same way the equally load-bearing `pagehide` flush and
`installErrorTracking` are wired. (An earlier draft registered it at module
scope on the grounds that a correctness mechanism shouldn't degrade when a
caller forgets it; the convention plus a `bootstrap.test.ts` assertion that
the app actually *has* cross-tab invalidation covers that better, and keeps
the listener out of every test that merely imports `storage.ts`.)

The two mechanisms **do not** fully cover each other's gaps. Their
intersection — a writer that doesn't maintain the token *and* a reader that
never receives the event — is real, and it is what the load-time re-anchor
below exists for:

- The event has a **delivery-latency window**. Per the HTML spec the stored
  value is updated at write time while the event is delivered as a queued
  global task, so there is at least one task turn (longer if this tab is
  busy mid-drag) in which we can see new geometry with a stale token. In
  practice Chrome and WebKit apply the value and dispatch the event from the
  same IPC, which collapses the window to zero, and the owning tab's next
  autosave self-heals it — but it is not a guarantee the spec gives.
- The event is **not delivered at all** to a document that is not fully
  active. A bfcached tab misses storage events and gets no replay on
  restore; a tab that was *closed* when the write happened never had a
  listener. The claim that "the tab that wrote the geometry updated the
  token before freezing us out" assumes the writer maintains the token —
  the one assumption the mixed-build case above establishes we cannot make.

### Re-anchoring on load, and on bfcache restore

Two cheap backstops close that intersection:

- **`loadSavedGame` re-anchors the token.** It drops the token up front and
  re-records it from `staticData.seed` after the decode it performs anyway,
  so every exit leaves the token either correct or absent (absent is always
  safe — the next reader re-derives). No extra decode, and it makes the
  fails-closed direction — a token naming the *previous* puzzle, so this tab
  skips every progress save for a session and the player silently loses the
  lot — unreachable across a reload rather than sticky for the session. Note
  this is placed before the outcome branches: the token describes the
  geometry blob, not the geometry/progress pair, so a seed-mismatch or
  torn-write outcome still leaves it correct.

  "Correct" there is relative to a read that may already be stale. A
  multi-MB decode sits between the `getItem(STORAGE_KEY)` and the
  re-record, so another tab that runs `clearSavedState()` +
  `saveNewPuzzle(B)` inside that window has the loading tab write a token
  naming A over the right answer. Left as-is deliberately: it fails closed
  (the wrong direction is "skip saves", never "tear the pair"), and it
  self-heals within one task turn — the loading tab is fully active, so it
  receives the queued `STORAGE_KEY` event, drops the token, and B's next
  flush backfills the truth. A verify-after-write (`getItem(STORAGE_KEY)
  === staticRaw`, else drop) would narrow it to nothing for one more
  ~10-byte read per load, if this ever proves reachable in practice.
- **`pageshow` with `event.persisted` drops the token.** That is exactly the
  bfcache restore, i.e. "I may have missed events". One decode on the next
  flush; the fails-open direction (writing our progress over another
  puzzle's geometry — #404 again) closes with it.

### Write side — `saveGeometry`

Record the token **only after the geometry write succeeded** (`'ok'` or
`'ok-compressed'`). On `'failed'` the previous puzzle's geometry is still
in the slot and the existing token still describes it correctly; writing
the new seed there would make this tab skip every subsequent progress save
for a puzzle it legitimately owns.

If the token write itself throws (storage full — largely theoretical from
`saveGeometry`, since the geometry write ahead of it just succeeded, but the
backfill call site runs inside `saveProgress` with no such precedent),
remove the key so the next check falls back to decoding. Degrading to
slow-but-correct beats recording a lie.

**Both** failures warn through `diagnostics`, like every other failed write
in the module. Neither message may name a consequence that only holds at
*some* call sites — `recordGeometrySeed` runs from `saveGeometry`, from the
backfill, from the two invalidation listeners and from `loadSavedGame`, and
the direction of the damage differs between them. What is common:

- A failed **record** leaves the token absent. Slow but correct: this tab
  reverts to the pre-#490 multi-MB read per flush. It is not stuck there —
  the backfill re-attempts the identical write every time it decodes, so the
  condition clears itself the moment the underlying storage pressure does.
  The message should point at quota, not at the puzzle state, and must not
  claim nothing retries.
- A failed **removal** leaves a token we already know not to trust. Which
  way it hurts depends on which puzzle it names: naming another puzzle, this
  tab skips every progress save; naming this tab's puzzle while another
  tab's geometry sits in the slot, saves go through and tear the pair
  (#404). Naming only the first points a reader at the wrong — and less
  damaging — failure.

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

Because no invalidation state lives outside `localStorage`, the existing
`localStorage.clear()` in each suite's `beforeEach` fully resets the new
behavior; the decode-count assertions below are order-independent.

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
- **`CorruptSaveData` / the corrupt-save download:** unchanged. The token
  holds no information not already in the geometry blob, so there is
  nothing to recover from it — and with the load-time re-anchor above, the
  token a corrupt-save dialog could report is one this same load just
  rewrote, not the one that caused the tear (that was a previous session).
  It would be a field with no diagnostic power.
- **Help text:** none. No player-visible behavior change — the same saves
  are written and skipped in the same situations, just cheaper.
- **Analytics:** no new events. `onSaveSkipped` telemetry keeps its
  meaning.
