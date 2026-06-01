# Split save storage: static geometry vs. mutable progress — design

**Date:** 2026-06-01
**Status:** Approved design, pending implementation plan
**Follows:** PR #399 (large-save quota fix via compress-on-overflow)
**Scope:** Eliminate the per-interaction main-thread freeze caused by
re-serializing and re-compressing the entire ~5.4 MB puzzle on every
debounced auto-save, by persisting the static geometry once and writing only
the small mutable progress on each save.

---

## 1. Problem & measured cause

After PR #399, a 192-piece traced puzzle saves correctly, but **every
debounced auto-save re-serializes and re-compresses the whole ~5.4 MB blob**
on the main thread. On a Pixel 9a this freezes the UI for hundreds of ms to
seconds after every move, making the puzzle unusable.

Root cause (verified in code):

- `autoSave()` fires on every interaction — drop, merge, rotate, gather,
  select (`main.ts` lines 280, 762, 778, 951, 1067, 1101, 1135, 1267) — and
  the debounced flush calls `saveState` **synchronously**.
- The expensive payload is **immutable during play**. `GameState.pieces`
  (with `shape`, `edges[].path`, `edges[].curvePoints`, `imageOffset`) is
  "immutable after generation" (per the type doc) — a grep for any mutation
  of `pieces`/`shape`/`edges`/`curvePoints`/`imageOffset` returns nothing.
  Only `groups[]` (membership, position, rotation), `selection`, and
  `completed` change.

So we recompress ~99.7% static data to persist a ~10 KB change, every 500 ms.

### Why "split" over worker/async

Moving serialize+compress to a Web Worker only *relocates* the repeated work
(and `postMessage` still structured-clones ~5.4 MB on the main thread each
save). Splitting *removes* it: per-save work becomes proportional to what
changed (tiny), so saves stay **synchronous and cheap** — no worker, no async
write path, no special close-flush handling needed.

---

## 2. Design

Persist the puzzle as **two localStorage keys**:

| Key | Contents | Written | Size |
|---|---|---|---|
| `puzzle-game-state` (STATIC) | geometry + immutable metadata: `pieces`, `imageUrl`, `imageSize`, `gridSize`, `seed`, `cutStyle`, `rotationMode`, `composableConfig`, `fractalConfig`, `attribution` | once per puzzle (new game / share-link load) | ~1.1 MB compressed |
| `puzzle-progress` (PROGRESS, new key) | mutable state: `groups`, `selection`, `completed` (+ `seed` for pairing) | every debounced save | ~10 KB, uncompressed |

The STATIC key keeps the existing key name and the PR #399
compress-on-overflow write. The PROGRESS key is small, written with a plain
synchronous `setItem` (with the same compress-on-overflow guard for safety,
though it will never trigger in practice).

### 2.1 Serialization (`src/persistence/serialization.ts`)

- Bump `STATE_VERSION` to **11**. The v11 STATIC blob **omits**
  `groups`/`selection`/`completed`.
- Add `SerializedStaticState` (geometry + metadata, no groups) and
  `SerializedProgress` (`{ version, seed?, groups, selection?, completed }`).
- Add:
  - `serializeStatic(state): SerializedStaticState`
  - `serializeProgress(state, selection): SerializedProgress`
  - `deserializeStatic(data): <geometry+metadata fields of GameState>` —
    reuses the existing `resolveComposableConfig` / `resolveFractalConfig`
    helpers; tolerates a legacy v≤10 blob by ignoring any `groups` it carries.
  - `recombine(staticState, progress): GameState` — builds the full
    `GameState` from static geometry + progress groups/selection/completed,
    rebuilding `piecesById` / `groupsById` / `pieceToGroup`, and resolving
    `rotationMode` (stored value, falling back to inference from the
    **progress** groups).
- Keep the existing `deserializeState` (full v≤10 blob with inline groups)
  for the legacy single-key path. **Do not delete old-version migration
  code** (per repo convention).

### 2.2 Storage (`src/persistence/storage.ts`)

- `STORAGE_KEY = 'puzzle-game-state'` (unchanged), `PROGRESS_KEY = 'puzzle-progress'`.
- `saveGeometry(state): SaveResult` — write the v11 STATIC blob with
  compress-on-overflow (the existing logic).
- `saveProgress(state, selection): SaveResult` — write the v11 PROGRESS blob;
  plain `setItem`, retry compressed on throw, `'failed'` if both fail (reuses
  the compress-on-overflow guard).
- `saveNewPuzzle(state, selection): SaveResult` — `saveGeometry` then
  `saveProgress`; used when a puzzle is created. Worst result wins.
- `createDebouncedSave(onSaveFailed?)` — its flush now calls **`saveProgress`**
  (not the whole blob). Routine saves never touch the STATIC key.
- `clearSavedState()` — remove **both** keys.
- `loadSavedGame()` / `loadState()` — load logic in §2.3.
- Remove the standalone `saveState` export (its only production caller was the
  debounced flush). Update tests accordingly.

### 2.3 Load logic (with migration & torn-write safety)

```
staticRaw = getItem(STATIC_KEY)
if staticRaw == null: return undefined                 // no save
staticState = JSON.parse(decompressFromStorage(staticRaw))   // (try/catch → undefined)
progressRaw = getItem(PROGRESS_KEY)

if progressRaw != null:
    progress = JSON.parse(decompressFromStorage(progressRaw))
    if staticState.seed != null && progress.seed != null
       && staticState.seed !== progress.seed:
        return undefined                               // torn / cross-puzzle pair → discard
    return recombine(staticState, progress)            // NEW or migrated puzzle

// no progress key:
if staticState has a non-empty `groups`:               // legacy single-key save
    return deserializeState(staticState) + readSelection(staticState)   // existing path
return undefined                                       // v11 static without progress = torn → discard
```

- **Migration is lazy and automatic.** A legacy save (groups inline, no
  progress key) loads via the legacy path on first run. The first interaction
  writes the PROGRESS key; thereafter the split path is used (the legacy
  blob's now-stale inline groups are simply ignored). The STATIC key is
  rewritten to the clean v11 shape only when a *new* puzzle is created — no
  forced startup recompress.
- **Forward compat:** an old build reading a v11 STATIC blob hits
  `Unsupported state version` → caught → "no save" → fresh puzzle (same safe
  degradation #399 already accepts).

### 2.4 App wiring (`src/main.ts`)

- New game (line ~951) and share-link load (line ~1267): replace `autoSave()`
  with `saveNewPuzzle(gameState, selectionManager.selectedGroupIds)` so the
  geometry is persisted once (the ~600 ms compress is hidden behind the
  generation overlay).
- All other `autoSave()` call sites are unchanged — they debounce a
  `saveProgress`.
- Restore-from-save path (line ~1334): unchanged (no write on restore;
  migration happens via the load logic + the next progress save).
- The existing `notifySaveFailed` toast wiring is unchanged.

---

## 3. Edge cases & decisions

- **Two-key consistency:** routine play writes only PROGRESS (STATIC already
  present), so tearing is essentially limited to the new-game double write —
  if interrupted there, the brand-new puzzle (no progress yet) is lost, which
  is negligible. The `seed` pairing guard and the "static-without-progress →
  discard" rule keep a torn pair from loading a wrong/partial puzzle.
- **`pieces` immutability** is the load-bearing assumption; documented on the
  type and verified by grep. If a future feature mutates pieces mid-game, it
  must also trigger a `saveGeometry`.
- **`rotationMode`** is static (chosen at new game); stored in the STATIC blob
  and always written for v11. Recombine falls back to inferring it from
  progress groups for legacy pairings that lack it.
- **Reproducibility contract** remains untouched — full geometry is still
  stored (compressed), generation is not invoked on load.
- **Quota** is per-origin across all keys; geometry (~1.1 MB) + progress
  (~10 KB) stays far under the ~4.75 MB ceiling.

---

## 4. Testing

Unit (vitest/jsdom, synthetic `GameState`):
- `saveProgress` round-trips groups/selection/completed; writes only
  PROGRESS_KEY and leaves STATIC_KEY untouched.
- `saveGeometry` writes a v11 STATIC blob with no `groups`.
- `saveNewPuzzle` writes both keys; `loadSavedGame` recombines them to an
  equal `GameState` (+ selection).
- **Backward-compat:** a legacy single-key v10 blob (groups inline, no
  progress key) still loads via the legacy path.
- **Migration:** legacy STATIC blob + a PROGRESS key → groups come from
  PROGRESS, static's stale groups ignored.
- **Torn/mismatch:** v11 STATIC without PROGRESS → no save; seed mismatch →
  no save.
- `clearSavedState` removes both keys.
- Debounced flush writes only PROGRESS (assert STATIC_KEY unchanged across a
  routine save) and fires `onSaveFailed` only on failure.

End-to-end (Playwright, the real freeze): create a 192-piece traced puzzle,
then move pieces and confirm each debounced save writes only the small
PROGRESS key (STATIC unchanged), with per-save main-thread time in the
low-single-digit ms range — i.e. no recompression on interaction.

---

## 5. Help text

No info-modal change: internal persistence/perf refactor with no visible
feature, gesture, or setting change.

---

## 6. Out of scope

- Web Worker / async writes (made unnecessary by the split).
- Regenerate-from-seed saves (rejected: ~20 s load).
- #394 / #395 / #396.
