import { diagnostics } from '../diagnostics.js';
import type { GameState } from '../model/types.js';
import {
    serializeStatic,
    serializeProgress,
    deserializeState,
    recombine,
    readSelection,
    readViewport,
    type SerializedStaticState,
    type SerializedProgress,
    type SerializedGameState,
    type SerializedViewport,
} from './serialization.js';
import { compressForStorage, decompressFromStorage } from './compression.js';

/** localStorage key for the static geometry + metadata blob. */
export const STORAGE_KEY = 'puzzle-game-state';

/** localStorage key for the small mutable progress blob (groups/selection/completed). */
export const PROGRESS_KEY = 'puzzle-progress';

/**
 * localStorage key holding the seed of the geometry currently at
 * {@link STORAGE_KEY}, as a decimal string.
 *
 * Purely derived data — everything it holds is already inside the geometry
 * blob — so it is not part of the save format and needs no migration: absent,
 * non-numeric, or invalidated all fall back to decoding the blob (see
 * {@link currentGeometrySeed}). It exists so the per-flush cross-tab check in
 * {@link saveProgress} can read ~10 bytes instead of a blob that reaches
 * ~5.8 MB on a 16×12 composable puzzle (#490).
 *
 * The invariant: **the token exists only while we believe it matches the
 * geometry.** Anyone with evidence otherwise deletes it, and the next reader
 * re-derives it.
 */
export const GEOMETRY_SEED_KEY = 'puzzle-geometry-seed';

export const SAVE_DEBOUNCE_MS = 500;

/**
 * - `'ok'` / `'ok-compressed'` — written (compressed on quota overflow).
 * - `'failed'`  — could not be written (quota even after compression).
 * - `'skipped'` — intentionally not written; see {@link saveProgress}.
 */
export type SaveResult = 'ok' | 'ok-compressed' | 'failed' | 'skipped';

/**
 * Raw, undecoded copy of the save blobs as they sat in localStorage.
 *
 * Captured when a save is found to be unreadable so the UI can offer it for
 * download before startup overwrites the keys with a fresh puzzle. `null`
 * for a key that was absent. Values are verbatim — possibly compressed,
 * possibly corrupt — which is exactly what a recovery/bug-report copy wants.
 */
export interface CorruptSaveData {
    geometry: string | null;
    progress: string | null;
}

/**
 * Why a present save could not be restored. Low-cardinality, suitable as an
 * analytics dimension.
 *
 * - `parse-error`   — JSON/decompress/deserialize threw (corruption or an
 *                     unsupported version).
 * - `seed-mismatch` — geometry and progress blobs are from different puzzles.
 * - `torn-write`    — geometry present but no usable progress (interrupted save).
 */
export type UnreadableReason = 'parse-error' | 'seed-mismatch' | 'torn-write';

/**
 * - `ok`         — a playable state was restored.
 * - `empty`      — no save is present (the geometry key is absent).
 * - `unreadable` — a save was present but could not be turned into a playable
 *                  state. Carries `reason` (for telemetry) and the verbatim raw
 *                  blobs so the caller can offer them for download before they
 *                  are overwritten, rather than silently destroying the data.
 */
export type LoadOutcome =
    | { status: 'ok'; state: GameState; selection: number[]; viewport?: SerializedViewport }
    | { status: 'empty' }
    | { status: 'unreadable'; reason: UnreadableReason; raw: CorruptSaveData };

/**
 * Tries a plain write; on any throw (quota on most browsers) retries once with
 * an lz-string-compressed payload. If both throw, the previous value at `key`
 * is left intact (we never clear it first) and `'failed'` is returned.
 */
function writeWithOverflow(key: string, json: string): SaveResult {
    try {
        localStorage.setItem(key, json);
        return 'ok';
    } catch {
        try {
            localStorage.setItem(key, compressForStorage(json));
            return 'ok-compressed';
        } catch (error) {
            diagnostics.warn(
                `Failed to save "${key}" (quota or other storage error, even after compression):`,
                error,
            );
            return 'failed';
        }
    }
}

// Memo for the fallback path in `currentGeometrySeed`, keyed on the verbatim
// raw geometry string. The token path never decodes, so this is only reached
// when the token is missing or unusable, and the fallback backfills the token
// whenever the decode yields a seed. A second hit on this memo therefore means
// one of three things:
//   1. the blob is seedless or unreadable, so there was nothing to record;
//   2. the token write itself keeps failing (see `recordGeometrySeed`);
//   3. the token was dropped again while the blob stayed byte-identical —
//      a repeat bfcache restore is the production case, and another tab
//      rewriting the geometry key with the same bytes is another.
// The first two never leave a usable token behind, so without the memo every
// flush for the rest of the session would re-parse a blob that reaches ~5.8 MB.
// The third re-parses only once per invalidation, but nothing bounds how often
// those happen; the memo makes every repeat over unchanged bytes free. Either
// way it earns its keep.
let cachedGeometryRaw: string | null = null;
let cachedGeometrySeed: number | undefined;

/**
 * A failed write must not leave a stale token behind — that would claim the
 * slot belongs to a puzzle it doesn't, and this tab would then skip every
 * progress save for a puzzle it legitimately owns. So a throw falls back to
 * removing the key, which puts the next read on the decode path: slower, but
 * correct. If the removal throws too there is no in-process remedy, so say so.
 *
 * Both failures warn, and neither message may name a consequence that only
 * holds at some call sites: this runs from `saveGeometry`, from the
 * `currentGeometrySeed` backfill, from the invalidation listeners and from
 * `loadSavedGame`, and those differ in both direction and remedy. What is
 * common to all of them: a *record* that ends with the key absent is slow but
 * correct, and the backfill re-attempts the identical write on every subsequent
 * flush that decodes, so it heals as soon as storage does; a *removal* that
 * fails leaves a token we already know not to trust, and nothing re-derives —
 * the token path answers from it without ever opening the blob — so it heals
 * only when some later write or removal succeeds. Which of the two the outer
 * catch is reporting is not known until the fallback `removeItem` below has
 * been tried, which is why the outer warning states both and the inner one
 * states the outcome.
 */
function recordGeometrySeed(seed: number | undefined): void {
    try {
        if (seed === undefined) {
            localStorage.removeItem(GEOMETRY_SEED_KEY);
        } else {
            localStorage.setItem(GEOMETRY_SEED_KEY, String(seed));
        }
    } catch (error) {
        diagnostics.warn(
            `Could not ${seed === undefined ? 'clear' : 'update'} "${GEOMETRY_SEED_KEY}" ` +
                '(a storage problem, usually quota — look there, not at the puzzle ' +
                'state). Falling back to removing the key below. If that succeeds the ' +
                'cross-tab guard re-reads the whole geometry blob on every progress ' +
                'save — slow but correct, and it re-attempts this write each time it ' +
                'decodes, so it clears itself as soon as storage recovers. If the ' +
                'removal throws too, the next warning says what is left behind:',
            error,
        );
        try {
            localStorage.removeItem(GEOMETRY_SEED_KEY);
        } catch (removeError) {
            diagnostics.warn(
                `Could not clear "${GEOMETRY_SEED_KEY}" either, so a token we already ` +
                    'know not to trust is still in place. Either way it is wrong is ' +
                    'damaging: naming another puzzle, every progress save for this one ' +
                    'is skipped; naming this puzzle while another tab\'s geometry sits ' +
                    'in the slot, saves go through and tear the pair (#404):',
                removeError,
            );
        }
    }
}

/**
 * Install the watchers that keep the ownership-token invariant true while the
 * app runs: drop {@link GEOMETRY_SEED_KEY} the moment we stop being able to
 * vouch for it. Call once, from the composition root.
 *
 * Named for that invariant rather than for a trigger, because the triggers are
 * already of two different kinds — another tab wrote the geometry, and this
 * tab may have missed such a write while bfcached — and more may accrue.
 *
 * A token is only correct while every writer of {@link STORAGE_KEY} maintains
 * it, and two tabs on one origin need not be running the same build —
 * `/puzzle/` and `/puzzle/dev/` share a localStorage (it is keyed by origin,
 * not path), as does a tab left open across a deploy. A tab on older JS writes
 * the geometry without touching the token, and the #404 takeover would go
 * undetected. The `storage` event fires regardless of what that tab's JS
 * knows, so it is the backstop: drop the token and let the next reader
 * re-derive it from the blob.
 *
 * Storage events never fire in the window that made the change, so anything we
 * receive is by definition another tab — no self-filtering needed, and our own
 * removal cannot re-trigger us. That removal does fire an event in other tabs,
 * but they ignore keys other than the geometry key, so there is no cascade.
 *
 * `pageshow` covers the hole in that: a bfcached document is not "fully
 * active", so storage events are neither delivered to it nor replayed on
 * restore. Coming back from the back/forward cache therefore means "I may have
 * missed a geometry write", and the honest answer is to distrust the token.
 * It costs one decode on the next flush — `loadSavedGame` re-anchors on a real
 * load, so `persisted` is the only case that needs this.
 */
export function installGeometryTokenInvalidation(): void {
    // Module-scope function references, not inline arrows, so that
    // `addEventListener` deduplicates them: the DOM spec appends a listener
    // only if the list holds no entry with the same type, callback and
    // capture flag. A second call is therefore a no-op, with no `installed`
    // flag to reset and no teardown handle to thread through the composition
    // root. It also survives a test that removes the listeners and boots
    // again — removal deletes the entry, so the next call re-adds it.
    window.addEventListener('storage', onForeignGeometryWrite);
    window.addEventListener('pageshow', onPageShow);
}

/** Another tab wrote (or cleared) the geometry key: stop vouching for the token. */
function onForeignGeometryWrite(event: StorageEvent): void {
    // Only localStorage owns our keys; a sessionStorage event — notably a
    // null-key clear() — must not drop the token. Written as an exclusion
    // of sessionStorage rather than a requirement of `=== localStorage`
    // deliberately: the identity is spec-mandated and holds everywhere we
    // run, but if it ever didn't, requiring it would fail *open* and
    // silently switch this whole mechanism off. Excluding fails safe —
    // the worst an unrecognized area can cost is a redundant decode,
    // which is the same trade every other decision here makes.
    if (event.storageArea === sessionStorage) return;
    // `key === null` is how the spec reports another tab's localStorage.clear().
    if (event.key === STORAGE_KEY || event.key === null) {
        recordGeometrySeed(undefined);
    }
}

/** Back/forward-cache restore: we may have missed a geometry write while frozen. */
function onPageShow(event: PageTransitionEvent): void {
    if (event.persisted) recordGeometrySeed(undefined);
}

/**
 * Seed of the geometry currently in localStorage, or `undefined` if there is no
 * geometry, it cannot be decoded, or it carries no seed. Never throws.
 *
 * Answers from {@link GEOMETRY_SEED_KEY} when it is present — a ~10-byte read,
 * which matters because {@link saveProgress} calls this on every debounced
 * flush (#490). Otherwise decodes the blob and backfills the token, so a save
 * written before the token existed pays that cost once rather than on every
 * flush for the rest of the session.
 */
function currentGeometrySeed(): number | undefined {
    const token = localStorage.getItem(GEOMETRY_SEED_KEY);
    if (token !== null) {
        const seed = Number(token);
        // Anything we did not write is corruption, not an answer: fall through
        // and re-derive rather than trusting it. `Number.isFinite` alone is too
        // permissive — `''` and `'   '` read as seed 0, which would skip every
        // save — so require the value to round-trip through `String(seed)`,
        // which is exactly what `recordGeometrySeed` produces. (`Number.isFinite`
        // is still needed: `'NaN'` and `'Infinity'` round-trip.)
        if (Number.isFinite(seed) && String(seed) === token) return seed;
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
        cachedGeometryRaw = null;
        cachedGeometrySeed = undefined;
        return undefined;
    }
    if (raw !== cachedGeometryRaw) {
        cachedGeometryRaw = raw;
        try {
            const parsed = JSON.parse(decompressFromStorage(raw)) as { seed?: unknown };
            cachedGeometrySeed = typeof parsed.seed === 'number' ? parsed.seed : undefined;
        } catch {
            // Unreadable geometry: don't block progress writes on it.
            cachedGeometrySeed = undefined;
        }
    }
    // Backfill so the next flush takes the fast path. A seedless or unreadable
    // blob records nothing — there is no seed to claim, and leaving the token
    // absent keeps re-derivation honest if that blob is later replaced. The
    // price is that such a blob keeps paying the multi-MB `getItem` and
    // full-length compare above on *every* flush, permanently: the pre-#490
    // cost, for a case only a pre-v4 legacy save (no seed) or a corrupt blob
    // can reach. A sentinel would buy the fast path back at the cost of
    // blinding the takeover check, which is the wrong trade.
    if (cachedGeometrySeed !== undefined) recordGeometrySeed(cachedGeometrySeed);
    return cachedGeometrySeed;
}

/**
 * Records the new owner in {@link GEOMETRY_SEED_KEY} only on a successful
 * write: when the write fails the *previous* puzzle's geometry is still in the
 * slot, and the existing token still describes it correctly.
 */
export function saveGeometry(state: GameState): SaveResult {
    const result = writeWithOverflow(STORAGE_KEY, JSON.stringify(serializeStatic(state)));
    // Positive check on purpose: `writeWithOverflow` cannot return `'skipped'`
    // today, but `SaveResult` allows it, and `!== 'failed'` would silently
    // start claiming ownership of a write that never happened if it ever did.
    if (result === 'ok' || result === 'ok-compressed') recordGeometrySeed(state.seed);
    return result;
}

/**
 * Refuses to write (returns `'skipped'`) when the geometry currently in
 * localStorage belongs to a *different* puzzle than `state` — e.g. another tab
 * on the same origin started a new puzzle while this tab still holds the old
 * one. Writing here would tear the geometry/progress pair into a seed-mismatch
 * that the next load rejects as a false "corrupt save" (#404). The geometry key
 * is the anchor; the tab that last wrote it owns the single save slot. Only a
 * confirmed seed mismatch skips — a geometry that is absent, unreadable or
 * seedless *and* has no {@link GEOMETRY_SEED_KEY} token naming its owner writes
 * as before. (With a token present the answer comes from it, without opening
 * the blob; the token is dropped whenever anything suggests it no longer
 * describes what is in the slot.)
 */
export function saveProgress(
    state: GameState,
    selection?: Iterable<number>,
    viewport?: SerializedViewport,
): SaveResult {
    const geometrySeed = currentGeometrySeed();
    if (
        geometrySeed !== undefined &&
        state.seed !== undefined &&
        geometrySeed !== state.seed
    ) {
        diagnostics.warn(
            `Skipping progress save: the recorded owner of the save slot (seed ` +
                `${geometrySeed}) is not the puzzle being saved (seed ${state.seed}); ` +
                'not overwriting it. Three causes are indistinguishable here: another ' +
                'tab started a puzzle over this one, a geometry write from this tab ' +
                'failed on quota so the previous puzzle still owns the slot, or a ' +
                'debounced save queued for the outgoing puzzle flushed after a new ' +
                'game replaced it (which a new game started with an active selection ' +
                'hits every time). See `ProgressSaveSkippedData` in analytics/umami.ts ' +
                'for how to tell them apart. Since #490 the deciding read is the ' +
                'token, not the blob.',
        );
        return 'skipped';
    }
    return writeWithOverflow(
        PROGRESS_KEY,
        JSON.stringify(serializeProgress(state, selection, viewport)),
    );
}

/** Worst sub-result wins. */
export function saveNewPuzzle(
    state: GameState,
    selection?: Iterable<number>,
    viewport?: SerializedViewport,
): SaveResult {
    const g = saveGeometry(state);
    if (g === 'failed') {
        // The new geometry was too large to persist even compressed; the previous
        // puzzle's geometry is still at STORAGE_KEY. Don't write the new progress
        // on top of it — that would be a seed-mismatch (#404). Leaving the
        // previous pair untouched keeps it loadable; the new puzzle simply won't
        // persist (the caller surfaces a "too large to save" toast). The
        // saveProgress seed-guard likewise drops later autosaves of the new
        // puzzle, so the previous pair stays consistent.
        return 'failed';
    }
    const p = saveProgress(state, selection, viewport);
    if (p === 'failed') return 'failed';
    if (g === 'ok-compressed' || p === 'ok-compressed') return 'ok-compressed';
    return 'ok';
}

/**
 * Split format: a STATIC blob (geometry + metadata) plus a PROGRESS blob
 * (groups/selection/completed) recombined into a GameState. Falls back to the
 * legacy single-key full blob (groups inline) when no progress key exists.
 * A geometry/progress pair with mismatched seeds, or a v11 static blob with no
 * progress, is treated as a present-but-unreadable save.
 *
 * Never throws. The geometry key being absent yields `empty`; any other
 * failure to restore yields `unreadable` carrying the raw blobs (see
 * {@link CorruptSaveData}) so the caller can offer them for download instead
 * of silently destroying the data.
 *
 * Re-anchors {@link GEOMETRY_SEED_KEY} as a side effect — the one write on
 * this path. See the comment at the top of the body.
 */
export function loadSavedGame(): LoadOutcome {
    const staticRaw = localStorage.getItem(STORAGE_KEY);

    // Re-anchor the ownership token to whatever is in the slot *now*.
    //
    // `installGeometryTokenInvalidation` only sees writes made while this document
    // is running and fully active. A geometry write by a build that does not
    // maintain the token — the pre-#490 build at `/puzzle/` while `/puzzle/dev/`
    // shares its localStorage, a rollback, a PWA client still on the old
    // service worker — made while this tab was closed reaches no listener at
    // all, and nothing else re-derives: the token path in
    // `currentGeometrySeed` answers without consulting the blob, and the
    // backfill that would correct it runs only when the token is absent. The
    // stale token would then be trusted for the whole next session, in either
    // direction: naming the previous puzzle, every progress save is skipped
    // and the player silently loses the session; naming this tab's puzzle
    // while the slot holds another, we write the torn pair the guard exists to
    // prevent (#404).
    //
    // Load is the moment we hold the truth for free: the blob is decoded below
    // anyway. Dropped here and re-recorded only after a successful decode, so
    // every exit below leaves the token either correct or absent — and absent
    // is always safe, since the next reader re-derives it.
    recordGeometrySeed(undefined);

    if (staticRaw === null) {
        // No geometry anchor = no save the player would recognize. (A stray
        // progress key, if any, is a harmless torn-write artifact that the
        // next save overwrites.)
        return { status: 'empty' };
    }

    // From here a save is present. Any path that fails to produce a playable
    // state reports `unreadable` with the raw blobs attached, so startup can
    // warn the user and offer the data for download instead of silently
    // regenerating over a lost puzzle.
    //
    // Read both raw blobs up front (one read each) so every unreadable branch —
    // including the catch, where a parse can throw before the progress key is
    // decoded — can attach the verbatim data without a second large-blob read.
    const progressRaw = localStorage.getItem(PROGRESS_KEY);
    const raw: CorruptSaveData = { geometry: staticRaw, progress: progressRaw };

    try {
        const staticData: SerializedStaticState & SerializedGameState = JSON.parse(
            decompressFromStorage(staticRaw),
        );

        // The other half of the re-anchor above: the geometry in the slot is
        // readable and names its puzzle, so put that back in the token. Placed
        // before the outcome branches on purpose — the token describes the
        // geometry blob, not the geometry/progress *pair*, so a seed mismatch
        // or a torn write below still leaves it correct.
        recordGeometrySeed(typeof staticData.seed === 'number' ? staticData.seed : undefined);

        if (progressRaw !== null) {
            const progress: SerializedProgress = JSON.parse(decompressFromStorage(progressRaw));
            // The guard only fires when both seeds are present. That is safe:
            // every puzzle created by `createNewGame` is assigned a seed, so both
            // blobs always carry one; the only seedless blobs are pre-v4 legacy
            // saves, which have no progress key and take the single-key path
            // below. Two seedless blobs from different puzzles is unreachable.
            if (
                staticData.seed !== undefined &&
                progress.seed !== undefined &&
                staticData.seed !== progress.seed
            ) {
                diagnostics.warn(
                    'Discarding saved game: geometry/progress seeds do not match (torn or cross-puzzle write).',
                );
                return { status: 'unreadable', reason: 'seed-mismatch', raw };
            }
            const viewport = readViewport(progress);
            if (viewport === undefined && progress.viewport !== undefined) {
                // A viewport field was present but malformed (non-finite scale,
                // missing offset, etc.). The save still loads — the player just
                // falls back to the default view — but unlike the normal
                // "no viewport on a pre-feature save" case this is a corrupt
                // blob, so make the silent zoom loss observable in diagnostics.
                diagnostics.warn(
                    'Saved game has a malformed viewport; restoring the default view.',
                );
            }
            return {
                status: 'ok',
                state: recombine(staticData, progress),
                selection: readSelection(progress),
                viewport,
            };
        }

        // No progress key: a legacy single-key blob has groups inline.
        if (Array.isArray(staticData.groups) && staticData.groups.length > 0) {
            return {
                status: 'ok',
                state: deserializeState(staticData),
                selection: readSelection(staticData),
            };
        }

        // v11 static blob with no progress = torn write — nothing to restore.
        diagnostics.warn(
            'Discarding saved game: geometry present but no progress (torn write).',
        );
        return { status: 'unreadable', reason: 'torn-write', raw };
    } catch (error) {
        diagnostics.warn('Failed to restore saved game state:', error);
        return { status: 'unreadable', reason: 'parse-error', raw };
    }
}

/**
 * The *save* is left untouched; an
 * unreadable save reads as "no state" here and its recovery blobs are
 * discarded — only the startup path surfaces them for download. (The derived
 * {@link GEOMETRY_SEED_KEY} token is re-anchored, as on every load.)
 */
export function loadState(): GameState | undefined {
    const outcome = loadSavedGame();
    return outcome.status === 'ok' ? outcome.state : undefined;
}

/**
 * Optional callbacks report a flushed save that did not persist:
 * - `onSaveFailed` — the write could not be persisted (quota exceeded even after
 *   compression), so the caller can warn the user their progress was not saved.
 * - `onSaveSkipped` — the write was intentionally refused because the save slot
 *   is recorded as belonging to a different puzzle (see {@link saveProgress}).
 *   A cross-tab takeover is one way that happens and the one the guard was
 *   built for, but not the only one: a geometry write that failed on quota, and
 *   the straddle described below, produce the same mismatch from a single tab.
 *   Not a failure — the caller can record it for telemetry.
 *
 * Each callback receives the state whose save failed or was skipped. Callers
 * must attribute telemetry to *that* state rather than to whatever puzzle is
 * current at flush time: the debounce window can straddle a new game, so the
 * two are not always the same puzzle.
 */
export function createDebouncedSave(
    {
        onSaveFailed,
        onSaveSkipped,
    }: {
        onSaveFailed?: (state: GameState) => void;
        onSaveSkipped?: (state: GameState) => void;
    } = {},
): {
    save: (state: GameState, selection?: Iterable<number>, viewport?: SerializedViewport) => void;
    flush: () => void;
    cancel: () => void;
} {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingState: GameState | null = null;
    // `null` means "no pending save"; an empty array means "save with an
    // empty selection".
    let pendingSelection: number[] | null = null;
    let pendingViewport: SerializedViewport | undefined;

    function flushPending(): void {
        if (pendingState !== null) {
            // Captured before the reset below so the callbacks can attribute the
            // outcome to the puzzle that was actually being saved.
            const savedState = pendingState;
            const result = saveProgress(pendingState, pendingSelection ?? [], pendingViewport);
            pendingState = null;
            pendingSelection = null;
            pendingViewport = undefined;
            if (result === 'failed') {
                onSaveFailed?.(savedState);
            } else if (result === 'skipped') {
                onSaveSkipped?.(savedState);
            }
        }
    }

    function save(
        state: GameState,
        selection?: Iterable<number>,
        viewport?: SerializedViewport,
    ): void {
        pendingState = state;
        pendingSelection = selection === undefined ? [] : [...selection];
        pendingViewport = viewport;

        if (timer !== null) {
            clearTimeout(timer);
        }

        timer = setTimeout(() => {
            flushPending();
            timer = null;
        }, SAVE_DEBOUNCE_MS);
    }

    function flush(): void {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }

        flushPending();
    }

    function cancel(): void {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }

        pendingState = null;
        pendingSelection = null;
        pendingViewport = undefined;
    }

    return { save, flush, cancel };
}
