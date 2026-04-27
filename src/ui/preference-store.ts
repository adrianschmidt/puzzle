/**
 * Generic helpers for persisting small preferences in `localStorage`.
 *
 * Several modules (background colour, merge tolerance, offset drag, …)
 * had near-identical preset+localStorage code, with the same
 * `null`/`NaN`/range/try-catch handling repeated by hand. These
 * factories centralise that logic so each callsite only declares its
 * key, presets, and default.
 */

/**
 * A store for an indexed preset preference: a list of presets plus a
 * persisted index pointing into it. Out-of-range, non-numeric, missing,
 * or unreadable values fall back to `defaultIndex`.
 */
export interface IndexedPreferenceStore<T> {
    /** Get the preset at `index`, or the default if out of range. */
    getPreset: (index: number) => T;
    /** Persist the preferred index. */
    save: (index: number) => void;
    /** Load the persisted index, or the default if missing/invalid. */
    load: () => number;
}

/**
 * Build an indexed preference store backed by `localStorage`.
 */
export function createIndexedPreferenceStore<T>(opts: {
    key: string;
    presets: readonly T[];
    defaultIndex: number;
}): IndexedPreferenceStore<T> {
    const { key, presets, defaultIndex } = opts;

    function isInRange(index: number): boolean {
        return index >= 0 && index < presets.length;
    }

    return {
        getPreset(index) {
            return isInRange(index) ? presets[index] : presets[defaultIndex];
        },
        save(index) {
            localStorage.setItem(key, String(index));
        },
        load() {
            try {
                const raw = localStorage.getItem(key);
                if (raw === null) {
                    return defaultIndex;
                }

                const index = parseInt(raw, 10);
                if (Number.isNaN(index) || !isInRange(index)) {
                    return defaultIndex;
                }

                return index;
            } catch {
                return defaultIndex;
            }
        },
    };
}

/**
 * A store for a boolean preference. Missing or unreadable values fall
 * back to `defaultValue`; otherwise the saved string is parsed
 * strictly as `'true'` → `true`, anything else → `false`.
 */
export interface BooleanPreferenceStore {
    load: () => boolean;
    save: (value: boolean) => void;
}

/**
 * Build a boolean preference backed by `localStorage`.
 */
export function createBooleanPreference(opts: {
    key: string;
    defaultValue: boolean;
}): BooleanPreferenceStore {
    const { key, defaultValue } = opts;

    return {
        load() {
            try {
                const raw = localStorage.getItem(key);
                if (raw === null) {
                    return defaultValue;
                }

                return raw === 'true';
            } catch {
                return defaultValue;
            }
        },
        save(value) {
            localStorage.setItem(key, String(value));
        },
    };
}
