export { initAnalytics, track } from './umami.js';
export { initErrorTracking } from './error-tracking.js';
export { sanitizeErrorReason } from './sanitize-error-reason.js';
export type {
    NewGameData,
    PuzzleCompletedData,
    PuzzleSharedData,
    TracedChunkPreloadStartedData,
    TracedChunkLoadedData,
    TracedChunkLoadFailedData,
    UnhandledErrorData,
} from './umami.js';
