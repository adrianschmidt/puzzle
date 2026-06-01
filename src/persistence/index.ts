export {
    serializeState,
    serializeStatic,
    serializeProgress,
    recombine,
    deserializeState,
    readSelection,
    STATE_VERSION,
} from './serialization.js';
export type {
    SerializedGameState,
    SerializedPieceGroup,
    SerializedStaticState,
    SerializedProgress,
} from './serialization.js';

export {
    saveGeometry,
    saveProgress,
    saveNewPuzzle,
    loadState,
    loadSavedGame,
    clearSavedState,
    createDebouncedSave,
    STORAGE_KEY,
    PROGRESS_KEY,
    SAVE_DEBOUNCE_MS,
} from './storage.js';
export type {
    SaveResult,
    LoadOutcome,
    CorruptSaveData,
    UnreadableReason,
} from './storage.js';
