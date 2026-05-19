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
    DEFAULT_SIZE_ID,
    SIZE_PREFERENCE_KEY,
    getSizeOption,
    toGridSize,
    findSizeId,
    saveSizePreference,
    loadSizePreference,
} from './puzzle-sizes.js';
export type { PuzzleSizeOption } from './puzzle-sizes.js';

export {
    detectMerges,
    checkEdgeAlignment,
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
    rectsOverlap,
    padRect,
    PILE_OVERLAP_THRESHOLD,
    OVERLAP_PADDING_PX,
} from './pile-detection.js';

export {
    reorderGroupsAfterDrop,
    rectFullyContains,
} from './z-order.js';

export {
    computeGatheredPositions,
    applyGatheredPositions,
    GATHER_PADDING,
} from './gather.js';
export type { WorldRect } from './gather.js';

export {
    getGroupBounds,
    getGroupOffsetBounds,
    getGroupLocalBounds,
    getGroupVisualBounds,
} from './group-bounds.js';
export type { BoundingRect, GroupBoundsOptions } from './group-bounds.js';

export { getPathBounds } from './path-bounds.js';

export {
    CUT_STYLE_OPTIONS,
    DEFAULT_CUT_STYLE_INDEX,
    CUT_STYLE_PREFERENCE_KEY,
    getCutStyleOption,
    findCutStyleIndex,
    saveCutStylePreference,
    loadCutStylePreference,
} from './cut-styles.js';
export type { CutStyle, CutStyleOption } from './cut-styles.js';
