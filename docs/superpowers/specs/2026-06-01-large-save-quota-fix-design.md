# Large-save quota fix — compress-on-overflow + write guard — design

**Date:** 2026-06-01
**Status:** Approved design, pending implementation plan
**Issue:** #397
**Scope:** Stop large saves (notably a 192-piece Composable + Traced-tab
puzzle) from silently failing to persist. Make `saveState` resilient to
`localStorage` quota overflow without breaking existing saves or the
share-link reproducibility contract.

---

## 1. Problem & measured cause

`saveState` writes `JSON.stringify(serializeState(...))` straight to
`localStorage` with no error handling (`src/persistence/storage.ts:30`).
A 192-piece Composable + Traced puzzle serializes past the origin's
~4.98 MB char quota, so `setItem` throws `QuotaExceededError`. Nothing
catches it (the debounced flush also runs inside a `setTimeout` with no
`try/catch`), so:

1. **The save silently fails** — no persisted state, no user feedback.
2. **On reload the app generates a fresh puzzle**, masking the original
   (this is the mechanism behind the "tabs change on reload" report and
   its interaction with #394).

### Measurement (this exact worst case, on the dev build via Playwright)

Captured the actual JSON the app tried to store (192-piece Composable +
Traced, blank image), then ran the real `lz-string` `compressToUTF16` on it
in-page:

| Metric | Value |
|---|---|
| Raw serialized payload | 5,609,468 chars (**5.35 MB**) — exceeds the ~4.98 MB quota |
| `compressToUTF16` result | 1,150,384 chars (**1.10 MB**) |
| Compression ratio | **4.88×** |
| **% of quota after compression** | **23.1%** |
| `compressToBase64` (for comparison) | 2,875,956 chars — 1.95× only |
| Compress time | ~605 ms (one-off, main thread) |

Conclusion: compression takes the worst case from **113% → 23%** of quota —
a ~4.3× headroom. `compressToUTF16` is the correct encoding because the
quota is counted in UTF-16 code units (chars), and it roughly halves the
char count vs. base64.

### Why not the alternatives

- **Regenerate from seed on load (drop geometry):** structurally ideal
  (save size independent of geometry) but regenerating a 192-piece traced
  puzzle takes ~20 s — an unacceptable load delay.
- **IndexedDB:** larger quota, but writes are async and an async write
  fired from `pagehide`/`visibilitychange→hidden` routinely fails to
  complete before teardown — jeopardizing the most important save (closing
  the tab / backgrounding on mobile). Bigger substrate change, and only
  postpones the scaling waste.
- **Coordinate rounding:** only a constant-factor win; traced geometry keeps
  scaling with piece count, so it merely moves the wall.

Compression keeps `setItem` synchronous (reliable unload flush), keeps full
geometry (no regeneration wait, no new reproducibility fragility), and is a
small, localized change.

---

## 2. Design

Keep the existing save format and full geometry. Make `saveState` resilient,
with **compression as a fallback, not the default**, so normal-sized puzzles
pay nothing and their on-disk format is unchanged.

### 2.1 `saveState` — guarded + compress-on-overflow

`src/persistence/storage.ts`. New return type so callers can react without
the persistence layer importing any UI:

```ts
export type SaveResult = 'ok' | 'ok-compressed' | 'failed';

export function saveState(state: GameState, selection?: Iterable<number>): SaveResult;
```

Logic:

1. `const json = JSON.stringify(serializeState(state, selection));`
2. Try `localStorage.setItem(STORAGE_KEY, json)` → return `'ok'`.
3. On **any** `setItem` throw (treat all as quota-ish; see §3): retry once
   with `localStorage.setItem(STORAGE_KEY, COMPRESSED_MARKER + LZString.compressToUTF16(json))`
   → return `'ok-compressed'`.
4. If the compressed write also throws: do **not** clear or overwrite — the
   prior good save survives because we never `removeItem` first. Log via
   `diagnostics.warn` and return `'failed'`.

### 2.2 Marker-based decompression on load

`src/persistence/storage.ts` (`loadSavedGame`). After reading the raw string:

- If it starts with `COMPRESSED_MARKER`, strip the marker and
  `LZString.decompressFromUTF16(rest)` before `JSON.parse`.
- Otherwise `JSON.parse` directly.

`COMPRESSED_MARKER` is a control-character prefix (e.g. `"\u0001LZ"`) that
**cannot** begin a `JSON.stringify` object output (always `{`), so detection
is unambiguous.

**No `STATE_VERSION` bump.** Detection is by marker, independent of the
schema version. Every existing save (v1–v10, all uncompressed) loads
unchanged; the inner JSON remains the current versioned
`SerializedGameState`. This deliberately sidesteps save-format migration.

### 2.3 Toast wiring (keep persistence UI-free)

- `createDebouncedSave()` gains an optional `onSaveFailed?: () => void`
  callback, invoked when `flushPending`'s `saveState` returns `'failed'`.
- `src/main.ts` passes a callback that calls
  `showToast("This puzzle is too large to save — your progress won't be kept across reloads.")`.
- Dedupe the toast (e.g. suppress if shown within the last few seconds) so a
  debounced save loop cannot spam it.
- Direct `saveState` callers that are not on the debounced path are reviewed;
  any that should surface failure use the returned `SaveResult`.

### 2.4 Dependency

Add `lz-string` (~4 KB, MIT) as a **runtime** dependency (`dependencies`,
not `devDependencies`). Only `compressToUTF16` / `decompressFromUTF16` are
used.

---

## 3. Edge cases & decisions

- **Cross-browser quota detection:** rather than match `QuotaExceededError`
  by name/code (Firefox uses `NS_ERROR_DOM_QUOTA_REACHED` / code 1014;
  others 22), treat **any** `setItem` throw as a trigger for the compressed
  retry. If the compressed write also throws, report `'failed'`. Simpler and
  robust.
- **Never clobber a good save:** the implementation must not `removeItem` or
  write a partial value before a successful `setItem`. A throwing `setItem`
  leaves the previous value intact automatically.
- **Selection field** is serialized inside the same blob, so compression
  covers it; no separate handling.
- **Reproducibility contract is untouched:** full geometry is still stored
  (just compressed), so share links / the PRNG call-count contract are
  unaffected. (This is a key advantage over the regenerate-from-seed
  approach.)
- **Compress cost (~600 ms)** is only ever paid on the overflow path, i.e.
  by oversized traced puzzles that are already slow to generate. Normal play
  never compresses.

---

## 4. Testing (vitest / jsdom — no puzzle generation required)

Use a small synthetic `GameState` (or a saved fixture) and a stubbed
`localStorage`:

- **Plain path:** small state → plain `setItem`, returns `'ok'`, stored value
  has no marker.
- **Overflow path:** stub `setItem` to throw on the large input but accept
  the smaller compressed one → returns `'ok-compressed'`, stored value
  begins with `COMPRESSED_MARKER`.
- **Total failure:** stub `setItem` to always throw → prior stored value
  preserved, returns `'failed'`, `onSaveFailed` fires (via
  `createDebouncedSave`).
- **Round-trip:** a compressed save loads back to an equal `GameState`
  (and selection) through `loadSavedGame`.
- **Backward-compat:** a plain (uncompressed, marker-less) blob still loads.

`lz-string` runs in node, so these need no browser.

---

## 5. Help text

This is a bug fix plus an error-path toast — not a new feature, gesture, cut
style, or setting. Per `CLAUDE.md`'s help-text policy, the info modal does
**not** need updating. (Confirm during implementation rather than assume.)

---

## 6. Out of scope

- The read-side silent discard (#395), config drop on fresh start (#394),
  and #396 are separate issues; this design only addresses the **write-side**
  silent failure (#397).
- No migration of existing saves is needed (marker detection is additive).
