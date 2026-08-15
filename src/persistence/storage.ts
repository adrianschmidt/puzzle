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
 * Seed of the geometry currently at {@link STORAGE_KEY}, as a decimal string.
 * Purely derived (not part of the save format, no migration): absent/non-numeric
 * falls back to decoding the blob. It exists so the per-flush cross-tab check in
 * {@link saveProgress} reads ~10 bytes instead of a ~5.8MB blob (#490).
 *
 * Invariant: the token exists only while we believe it matches the geometry;
 * anyone with evidence otherwise deletes it and the next reader re-derives it.
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
 * Raw, undecoded save blobs as they sat in localStorage, captured when a save
 * is unreadable so the UI can offer them for download before startup overwrites
 * the keys. `null` for an absent key; values verbatim (possibly compressed/corrupt).
 */
export interface CorruptSaveData {
    geometry: string | null;
    progress: string | null;
}

/**
 * Why a present save could not be restored (low-cardinality, usable as an
 * analytics dimension).
 * - `parse-error`   — JSON/decompress/deserialize threw (corruption or bad version).
 * - `seed-mismatch` — geometry and progress blobs are from different puzzles.
 * - `torn-write`    — geometry present but no usable progress (interrupted save).
 */
export type UnreadableReason = 'parse-error' | 'seed-mismatch' | 'torn-write';

/**
 * - `ok`         — a playable state was restored.
 * - `empty`      — no save present (geometry key absent).
 * - `unreadable` — save present but unrestorable; carries `reason` (telemetry)
 *                  and the verbatim raw blobs so the caller can offer them for
 *                  download instead of destroying the data.
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

// Memo the fallback seed parse: the token path normally avoids it, but a
// seedless / failed-token / bfcache-restore path would otherwise re-parse a
// ~5.8MB blob on every flush.
let cachedGeometryRaw: string | null = null;
let cachedGeometrySeed: number | undefined;

/**
 * A failed write must not leave a stale token — it would claim the slot for the
 * wrong puzzle and make this tab skip every save for the one it owns. So a throw
 * falls back to removing the key, putting the next read on the (slower but
 * correct) decode path; if the removal also throws there is no in-process remedy.
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
 * Install the watchers that keep the token invariant true: drop
 * {@link GEOMETRY_SEED_KEY} the moment we can't vouch for it. Call once.
 *
 * A token is only correct while every writer of {@link STORAGE_KEY} maintains
 * it, but two tabs on one origin need not run the same build — `/puzzle/` and
 * `/puzzle/dev/` share a localStorage (keyed by origin, not path), as does a
 * tab left open across a deploy. A `storage` event fires regardless of the
 * writing tab's build, so it's the backstop against the #404 takeover.
 * `pageshow` covers a bfcached document, which receives no storage events while
 * frozen: on restore we may have missed a write, so distrust the token.
 */
export function installGeometryTokenInvalidation(): void {
    // Module-scope function references, not inline arrows, so addEventListener
    // dedups them (DOM appends only if no entry has the same type+callback+capture).
    // A second call is a no-op, needing no `installed` flag or teardown handle.
    window.addEventListener('storage', onForeignGeometryWrite);
    window.addEventListener('pageshow', onPageShow);
}

/** Another tab wrote (or cleared) the geometry key: stop vouching for the token. */
function onForeignGeometryWrite(event: StorageEvent): void {
    // Exclude sessionStorage rather than require `=== localStorage`: requiring
    // it would fail *open* if the identity ever broke, silently switching this
    // mechanism off. Excluding fails safe — at worst a redundant decode.
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
 * Seed of the geometry in localStorage, or `undefined` if none/undecodable/seedless.
 * Never throws. Answers from {@link GEOMETRY_SEED_KEY} when present (~10-byte read;
 * {@link saveProgress} calls this on every flush, #490), else decodes the blob
 * and backfills the token so that cost is paid once.
 */
function currentGeometrySeed(): number | undefined {
    const token = localStorage.getItem(GEOMETRY_SEED_KEY);
    if (token !== null) {
        const seed = Number(token);
        // Only trust a token we could have written: `Number.isFinite` alone is
        // too permissive (`''`/`'   '` read as seed 0, skipping every save), so
        // require round-trip through `String(seed)`. isFinite still needed —
        // `'NaN'`/`'Infinity'` round-trip.
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
    // Backfill so the next flush takes the fast path. A seedless/unreadable blob
    // records nothing (no seed to claim; leaving the token absent keeps
    // re-derivation honest), so it keeps paying the multi-MB read every flush —
    // a sentinel would restore the fast path but blind the takeover check.
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
    // Positive check on purpose: `!== 'failed'` would claim ownership of a
    // future `'skipped'` write that never happened.
    if (result === 'ok' || result === 'ok-compressed') recordGeometrySeed(state.seed);
    return result;
}

/**
 * Refuses (`'skipped'`) when the stored geometry belongs to a *different*
 * puzzle than `state` — e.g. another tab started a new puzzle. Writing would
 * tear the geometry/progress pair into a seed-mismatch the next load rejects as
 * a false "corrupt save" (#404). Only a confirmed mismatch skips; absent /
 * unreadable / seedless geometry with no token writes as before.
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
                'not overwriting it. Two causes are indistinguishable here: another ' +
                'tab started a puzzle over this one, or a geometry write from this ' +
                'tab failed on quota so the previous puzzle still owns the slot. See ' +
                '`ProgressSaveSkippedData` in analytics/umami.ts for how to tell them ' +
                'apart. Since #490 the deciding read is the token, not the blob.',
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
        // New geometry too large even compressed; the previous puzzle's geometry
        // is still at STORAGE_KEY. Writing new progress on top would be a
        // seed-mismatch (#404), so leave the previous pair loadable — the new
        // puzzle just won't persist (caller shows a "too large" toast).
        return 'failed';
    }
    const p = saveProgress(state, selection, viewport);
    if (p === 'failed') return 'failed';
    if (g === 'ok-compressed' || p === 'ok-compressed') return 'ok-compressed';
    return 'ok';
}

/**
 * Recombine the STATIC + PROGRESS blobs into a GameState, falling back to the
 * legacy single-key full blob when no progress key exists. A seed-mismatched
 * pair, or a v11 static blob with no progress, is present-but-unreadable.
 *
 * Never throws: an absent geometry key yields `empty`; any other failure yields
 * `unreadable` carrying the raw blobs (see {@link CorruptSaveData}) for download.
 * Re-anchors {@link GEOMETRY_SEED_KEY} as a side effect (the one write here).
 */
export function loadSavedGame(): LoadOutcome {
    const staticRaw = localStorage.getItem(STORAGE_KEY);

    // Re-anchor the ownership token to whatever is in the slot *now*.
    // A geometry write by a build that doesn't maintain the token (pre-#490
    // `/puzzle/` sharing `/puzzle/dev/`'s storage, a rollback, a stale PWA
    // client) made while this tab was closed reaches no listener, and the token
    // path never consults the blob — so a stale token would be trusted all
    // session (#404). Load is the free moment to fix it: the blob is decoded
    // below anyway. Dropped here, re-recorded only after a successful decode, so
    // every exit leaves the token correct or absent (absent is always safe).
    recordGeometrySeed(undefined);

    if (staticRaw === null) {
        // No geometry anchor = no recognizable save. (A stray progress key is a
        // harmless torn-write artifact the next save overwrites.)
        return { status: 'empty' };
    }

    // A save is present. Read both raw blobs up front so every unreadable
    // branch — including the catch, where a parse can throw before progress is
    // decoded — can attach verbatim data without a second large-blob read.
    const progressRaw = localStorage.getItem(PROGRESS_KEY);
    const raw: CorruptSaveData = { geometry: staticRaw, progress: progressRaw };

    try {
        const staticData: SerializedStaticState & SerializedGameState = JSON.parse(
            decompressFromStorage(staticRaw),
        );

        // Other half of the re-anchor: the geometry is readable and names its
        // puzzle, so record it. Before the outcome branches on purpose — the
        // token describes the geometry blob, not the pair, so a seed mismatch or
        // torn write below still leaves it correct.
        recordGeometrySeed(typeof staticData.seed === 'number' ? staticData.seed : undefined);

        if (progressRaw !== null) {
            const progress: SerializedProgress = JSON.parse(decompressFromStorage(progressRaw));
            // Guard fires only when both seeds are present — safe because every
            // createNewGame puzzle has a seed; seedless blobs are pre-v4 legacy
            // saves with no progress key (single-key path below).
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
                // Viewport field present but malformed. The save still loads
                // (default view), but unlike a pre-feature save with no viewport
                // this is corrupt, so make the silent zoom loss observable.
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
 * The save is left untouched; an unreadable save reads as "no state" and its
 * recovery blobs are discarded (only startup surfaces them). The derived
 * {@link GEOMETRY_SEED_KEY} token is re-anchored, as on every load.
 */
export function loadState(): GameState | undefined {
    const outcome = loadSavedGame();
    return outcome.status === 'ok' ? outcome.state : undefined;
}

/**
 * Optional callbacks report a flushed save that did not persist:
 * - `onSaveFailed`  — write failed (quota even after compression).
 * - `onSaveSkipped` — write refused because the slot belongs to a different
 *   puzzle (see {@link saveProgress}); not a failure, record for telemetry.
 *
 * Each callback receives the state whose save failed/skipped; attribute
 * telemetry to that state.
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
    // `null` = no pending save; `[]` = save with an empty selection.
    let pendingSelection: number[] | null = null;
    let pendingViewport: SerializedViewport | undefined;

    function flushPending(): void {
        if (pendingState !== null) {
            // Captured before the reset so callbacks attribute the outcome to
            // the puzzle actually being saved.
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
