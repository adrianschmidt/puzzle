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
 * Data attached to `traced-chunk-loaded`.
 *
 * `durationMs` is the wall-clock time between the first
 * `preloadTracedTabGenerator()` call and the dynamic import settling —
 * i.e. real-user preload latency. Coarse-grained on purpose (rounded
 * integer ms) since sub-ms resolution is not meaningful here.
 */
export interface TracedChunkLoadedData {
    durationMs: number;
}

/**
 * Data attached to `traced-chunk-load-failed`.
 *
 * `reason` is the rejection's message, truncated to a short string so
 * Umami stays under its per-property size limit and so we don't ship
 * arbitrary chunk URLs into analytics.
 */
export interface TracedChunkLoadFailedData {
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
 * Drops the call silently when `window` is undefined (e.g. node-based
 * unit tests of layers that now call `track()` from non-jsdom suites)
 * or when `window.umami` is undefined (script hasn't loaded, is
 * blocked, or analytics aren't configured for this build). Never
 * throws.
 */
export function track(name: 'new-game-started', data: NewGameData): void;
export function track(name: 'puzzle-completed', data: PuzzleCompletedData): void;
export function track(name: 'puzzle-shared', data: PuzzleSharedData): void;
export function track(name: 'traced-chunk-loaded', data: TracedChunkLoadedData): void;
export function track(name: 'traced-chunk-load-failed', data: TracedChunkLoadFailedData): void;
export function track(name: string, data: object): void {
    if (typeof window === 'undefined') return;
    window.umami?.track(name, data as Record<string, unknown>);
}
