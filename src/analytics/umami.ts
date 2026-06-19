/**
 * Umami analytics wrapper.
 *
 * Injects the Umami tracking script at startup (when configured) and
 * exposes a typed `track()` function for custom events. Both functions
 * are no-ops when:
 * - `VITE_UMAMI_WEBSITE_ID` is unset (e.g. localhost), or
 * - the Umami script hasn't loaded / has been blocked by an ad-blocker.
 *
 * Event schema lives here as the single source of truth.
 */

declare global {
    interface Window {
        umami?: {
            track: (eventName: string, eventData?: Record<string, unknown>) => void;
        };
    }
}

const DEFAULT_SCRIPT_URL = 'https://cloud.umami.is/script.js';

/**
 * Data attached to `new-game-started`.
 *
 * `source` records how the puzzle started (fresh new-game vs. opening a
 * shared link). The image-related fields and the share-recipient fields
 * are conditionally populated — see the spec for details.
 */
export interface NewGameData {
    source: 'fresh' | 'shared';
    cutStyle: string;
    /**
     * Trace-set version backing a Wavy puzzle's tabs. Present only for
     * traced-tab Wavy games (omitted for every other cut style and for
     * legacy classic-tab Wavy links), so analytics can tell traced Wavy from
     * legacy Wavy and follow trace-set versions once a v2 ships.
     */
    traceSetVersion?: number;
    rotationMode: 'none' | 'quarter-turn' | 'free';
    cols: number;
    rows: number;
    pieceCount: number;
    imageSource?: string;
    imageCategory?: string;
    vibrant?: boolean;
    includesProgress?: boolean;
    recipientHadSavedState?: boolean;
}

/**
 * Data attached to `puzzle-completed`.
 *
 * Same field names as `NewGameData`, but every field outside the
 * puzzle-shape core is optional — for resumed-then-completed games we
 * only know the puzzle's geometry, not how it was originally started.
 */
export type PuzzleCompletedData = Pick<
    NewGameData,
    'cutStyle' | 'rotationMode' | 'cols' | 'rows' | 'pieceCount'
> &
    Partial<NewGameData>;

/** Data attached to `puzzle-shared`. */
export interface PuzzleSharedData {
    source: 'completion-overlay' | 'info-modal';
    includesProgress: boolean;
}

/**
 * Data attached to `traced-chunk-preload-started`.
 *
 * Fired once per real import attempt (cached-promise calls don't
 * re-emit), so it's the denominator for the loaded/failed funnel and
 * makes abandonment observable — a started event with no matching
 * settle means the user left mid-fetch. `attempt` matches the counter
 * on the settling event.
 */
export interface TracedChunkPreloadStartedData {
    attempt: number;
}

/**
 * Data attached to `traced-chunk-loaded`.
 *
 * `durationMs` is the wall-clock time between the initiating call that
 * started the in-flight import (not necessarily the very first call —
 * the cache resets per attempt after a failure) and the import
 * settling, i.e. real-user preload latency. Rounded to 0.1 ms so warm
 * sub-millisecond hits don't all collapse to `0`.
 *
 * `cacheState` separates the latency populations so the metric isn't an
 * average across them: `cold` (full network fetch), `warm` (served from
 * cache, no network), and `revalidated` (a 304 round trip — headers
 * only, body from cache). Derived from the chunk's Resource Timing
 * entry; `'unknown'` when no usable entry is available (API absent or
 * the entry was evicted from a full buffer — the two aren't separable).
 *
 * `attempt` is the 1-based attempt counter for this client session, so
 * a retry after a failure is distinguishable from an unrelated cold
 * load.
 */
export interface TracedChunkLoadedData {
    durationMs: number;
    cacheState: 'cold' | 'warm' | 'revalidated' | 'unknown';
    attempt: number;
}

/**
 * Data attached to `traced-chunk-load-failed`.
 *
 * `reason` is the rejection's message with URLs and extension origins
 * redacted (so per-deploy chunk hashes and ad-blocker extension IDs
 * don't ship to analytics) and truncated to a bounded length; empty
 * messages fall back to `'unknown'`.
 *
 * `kind` buckets the failure (network / parse / unknown) so events
 * aggregate cleanly in Umami despite the raw `reason` being
 * high-cardinality.
 *
 * `attempt` is the 1-based attempt counter for this client session.
 */
export interface TracedChunkLoadFailedData {
    reason: string;
    kind: 'network' | 'parse' | 'unknown';
    attempt: number;
}

/**
 * Data attached to `unhandled-error` — the app-wide backstop for async
 * failures that no local `try/catch` handled.
 *
 * `source` is the channel that caught it: a rejected promise or a
 * thrown exception. (Named `source`, not `kind`, to avoid colliding
 * with the failure-class `kind` on {@link TracedChunkLoadFailedData} —
 * the two carry different semantics.)
 *
 * `name` is the low-cardinality bucket for aggregation/alerting: the
 * thrown value's constructor name (`TypeError`, `RangeError`, …), or
 * `'unknown'` when the rejection/error value isn't an `Error`.
 *
 * `reason` is the sanitized message (URLs/extension origins redacted,
 * empty falls back to `'unknown'`, length-capped); see
 * {@link import('./sanitize-error-reason.js').sanitizeErrorReason}.
 */
export interface UnhandledErrorData {
    source: 'rejection' | 'error';
    name: string;
    reason: string;
}

/**
 * Data attached to `save-failed` — a `localStorage` write failed even after
 * the lz-string compression fallback (typically quota exhaustion).
 *
 * On `main` this surfaced incidentally as an `unhandled-error`; the persistence
 * layer now catches it, so this is the explicit replacement signal.
 *
 * `op` distinguishes the per-move progress write from the one-time new-puzzle
 * (geometry) write, so an operator can tell whether a save failed at creation
 * (nothing persisted) or mid-play (only the latest moves were dropped).
 */
export interface SaveFailedData {
    op: 'progress' | 'new-puzzle';
}

/**
 * Data attached to `save-compressed` — a write exceeded the plain-write quota
 * and fell back to the lz-string-compressed payload. Emitted for the one-time
 * geometry write so an operator can see a puzzle crossing into the near-quota
 * regime (one growth step from total failure) before it tips into `save-failed`.
 */
export interface SaveCompressedData {
    cutStyle: string;
    pieceCount: number;
}

/**
 * Data attached to `save-unreadable` — a saved game was present but could not
 * be restored, so the player was offered the recovery dialog instead of having
 * their puzzle silently regenerated over.
 *
 * `reason` distinguishes the failure class (the persistence layer already
 * separates these internally): a parse/deserialize failure, a geometry/progress
 * seed mismatch, or a torn write with no usable progress. Low cardinality, so
 * it groups cleanly in the dashboard.
 */
export interface SaveUnreadableData {
    reason: 'parse-error' | 'seed-mismatch' | 'torn-write';
}

/**
 * Data attached to `progress-save-skipped` — a debounced progress autosave was
 * refused because the geometry in localStorage belongs to a different puzzle
 * than the one being saved (a cross-tab takeover; see `saveProgress`). Lets an
 * operator see how often the cross-tab save race actually fires in the wild —
 * the race that previously produced a torn save and a false "corrupt" dialog.
 * `cutStyle`/`pieceCount` describe the puzzle whose progress was dropped.
 */
export interface ProgressSaveSkippedData {
    cutStyle: string;
    pieceCount: number;
}

/**
 * Data attached to `save-recovery` — emitted once when the player closes the
 * unreadable-save dialog. `downloaded` records whether they took a copy of the
 * raw data before starting over, so an operator can tell whether the recovery
 * affordance is actually used.
 */
export interface SaveRecoveryData {
    downloaded: boolean;
}

/**
 * Data attached to `pwa-update-detected` — a freshly-built service worker is
 * waiting and the persistent "update ready" indicator was shown. This is the
 * funnel denominator: every applied/fallback/failed event below should trace
 * back to one of these. The gap between detected and applied is the
 * stuck-indicator field signal.
 */
export type PwaUpdateDetectedData = Record<string, never>;

/**
 * Data attached to `pwa-update-applied` — a deferred service-worker update was
 * applied (the page committed to reloading into the new version).
 *
 * `trigger` records what caused the apply, so an operator can see the split
 * between the two safe-moment paths: `focus-regain` (auto-applied when the app
 * became visible again with an update pending) and `manual` (the user tapped
 * the persistent indicator). This is the numerator against
 * `pwa-update-detected` — the gap between the two is the stuck-indicator
 * signal (detected but never applied).
 *
 * The pwa update-controller derives its `UpdateApplyTrigger` union from this
 * payload, so the set of triggers has a single source of truth here.
 */
export interface PwaUpdateAppliedData {
    trigger: 'focus-regain' | 'manual';
}

/**
 * Data attached to `pwa-update-fallback-reload` — the service-worker-driven
 * reload did not navigate the page away in time, so the fallback hard reload
 * fired (the #404 shared-origin case, where the new worker was already
 * activated by another tab so skip-waiting is a no-op and no `controlling`
 * event arrives). Tells an operator whether this fallback path is actually
 * load-bearing in the field.
 */
export type PwaUpdateFallbackReloadData = Record<string, never>;

/**
 * Data attached to `pwa-update-apply-failed` — `updateSW(true)` rejected while
 * trying to activate the waiting worker. The scheduled fallback reload still
 * covers recovery; this event makes a consistently-failing apply path visible
 * instead of silent. `reason` is the sanitized rejection message.
 */
export interface PwaUpdateApplyFailedData {
    reason: string;
}

/**
 * Inject the Umami tracking script if a website ID is configured.
 *
 * Call exactly once, early in app startup, before any rendering.
 * Calling more than once would inject duplicate script tags.
 */
export function initAnalytics(): void {
    const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID as string | undefined;
    if (!websiteId) {
        return;
    }

    const scriptUrl =
        (import.meta.env.VITE_UMAMI_SCRIPT_URL as string | undefined) ||
        DEFAULT_SCRIPT_URL;

    const script = document.createElement('script');
    script.defer = true;
    script.src = scriptUrl;
    script.dataset.websiteId = websiteId;
    document.head.appendChild(script);
}

/**
 * Send a typed analytics event.
 *
 * Drops the call silently in non-browser environments where there is
 * no `window` (server-side rendering, node-based unit tests) and when
 * `window.umami` is undefined (the script hasn't loaded, is blocked, or
 * analytics aren't configured for this build). Never throws.
 */
export function track(name: 'new-game-started', data: NewGameData): void;
export function track(name: 'puzzle-completed', data: PuzzleCompletedData): void;
export function track(name: 'puzzle-shared', data: PuzzleSharedData): void;
export function track(name: 'traced-chunk-preload-started', data: TracedChunkPreloadStartedData): void;
export function track(name: 'traced-chunk-loaded', data: TracedChunkLoadedData): void;
export function track(name: 'traced-chunk-load-failed', data: TracedChunkLoadFailedData): void;
export function track(name: 'unhandled-error', data: UnhandledErrorData): void;
export function track(name: 'save-failed', data: SaveFailedData): void;
export function track(name: 'save-compressed', data: SaveCompressedData): void;
export function track(name: 'save-unreadable', data: SaveUnreadableData): void;
export function track(name: 'save-recovery', data: SaveRecoveryData): void;
export function track(name: 'progress-save-skipped', data: ProgressSaveSkippedData): void;
export function track(name: 'pwa-update-detected', data: PwaUpdateDetectedData): void;
export function track(name: 'pwa-update-applied', data: PwaUpdateAppliedData): void;
export function track(name: 'pwa-update-fallback-reload', data: PwaUpdateFallbackReloadData): void;
export function track(name: 'pwa-update-apply-failed', data: PwaUpdateApplyFailedData): void;
export function track(name: string, data: object): void {
    if (typeof window === 'undefined') return;
    window.umami?.track(name, data as Record<string, unknown>);
}
