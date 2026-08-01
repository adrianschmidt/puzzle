export { initAnalytics, track } from './umami.js';
export { initErrorTracking } from './error-tracking.js';
export { sanitizeErrorReason } from './sanitize-error-reason.js';
export type {
    NewGameData,
    PuzzleCompletedData,
    PuzzleSharedData,
    BackgroundColorChangedData,
    TracedChunkPreloadStartedData,
    TracedChunkLoadedData,
    TracedChunkLoadFailedData,
    UnhandledErrorData,
    SharedLoadFailedData,
    ImageFetchFailedData,
    NewGameFailedData,
    PieceCountMismatchData,
    ShareFailedData,
    PwaUpdateDetectedData,
    PwaUpdateCheckFailedData,
    PwaUpdateAppliedData,
    PwaUpdateFallbackReloadData,
    PwaUpdateApplyFailedData,
    PwaRegisterFailedData,
    ShareLinkRescueAttemptedData,
    ShareLinkRescueResultData,
    GenerationCancelledData,
} from './umami.js';
