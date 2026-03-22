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
    PUZZLE_SIZE_OPTIONS,
    DEFAULT_SIZE_INDEX,
    SIZE_PREFERENCE_KEY,
    getSizeOption,
    toGridSize,
    findSizeIndex,
    saveSizePreference,
    loadSizePreference,
} from './puzzle-sizes.js';
export type { PuzzleSizeOption } from './puzzle-sizes.js';

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

export {
    computeGatheredPositions,
    applyGatheredPositions,
    getGroupOffsetBounds,
    GATHER_PADDING,
} from './gather.js';
export type { WorldRect } from './gather.js';
