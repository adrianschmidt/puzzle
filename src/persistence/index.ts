export {
    serializeState,
    deserializeState,
    readSelection,
    STATE_VERSION,
} from './serialization.js';
export type {
    SerializedGameState,
    SerializedPieceGroup,
} from './serialization.js';

export {
    saveState,
    loadState,
    loadSelection,
    clearSavedState,
    createDebouncedSave,
    STORAGE_KEY,
    SAVE_DEBOUNCE_MS,
} from './storage.js';
