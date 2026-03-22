export {
    createNewGame,
    createInitialGroups,
    randomizePositions,
    DEFAULT_COLS,
    DEFAULT_ROWS,
    VIEWPORT_MARGIN,
} from './init.js';
export type { InitOptions } from './init.js';

export {
    detectMerges,
    checkEdgeAlignment,
    getWorldPosition,
    MERGE_TOLERANCE_PX,
} from './merge-detection.js';
export type { MergeCandidate } from './merge-detection.js';

export {
    mergeGroups,
    selectBestCandidate,
    processDrop,
} from './group-merging.js';
export type { MergeResult } from './group-merging.js';

export { checkWin, checkAndMarkWin } from './win-detection.js';

export {
    shouldSuppressMerge,
    getGroupBounds,
    rectsOverlap,
    padRect,
    PILE_OVERLAP_THRESHOLD,
    OVERLAP_PADDING_PX,
} from './pile-detection.js';
export type { BoundingRect } from './pile-detection.js';
