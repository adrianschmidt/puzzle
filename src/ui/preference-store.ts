/**
 * Several modules had near-identical preset+localStorage code, with
 * the same `null`/`NaN`/range/JSON-parse/try-catch handling repeated
 * by hand. These factories centralise that logic.
 */

export interface IndexedPreferenceStore<T> {
    getPreset: (index: number) => T;
    save: (index: number) => void;
    load: () => number;
}

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

export interface JsonPreferenceStore<T> {
    save: (value: T) => void;
    load: () => T | undefined;
}

export function createJsonPreference<T>(opts: {
    key: string;
    parse: (raw: unknown) => T | undefined;
}): JsonPreferenceStore<T> {
    const { key, parse } = opts;

    return {
        save(value) {
            localStorage.setItem(key, JSON.stringify(value));
        },
        load() {
            try {
                const raw = localStorage.getItem(key);
                if (raw === null) {
                    return undefined;
                }

                return parse(JSON.parse(raw) as unknown);
            } catch {
                return undefined;
            }
        },
    };
}

export interface StringPreferenceStore<T extends string | undefined> {
    save: (value: string) => void;
    load: () => T;
    /**
     * Distinguishes "never chose" from "chose the default", which
     * `load()` cannot (it returns the default either way).
     */
    exists: () => boolean;
}

export function createStringPreference(opts: {
    key: string;
    allowed?: readonly string[];
}): StringPreferenceStore<string | undefined>;
export function createStringPreference(opts: {
    key: string;
    defaultValue: string;
    allowed?: readonly string[];
}): StringPreferenceStore<string>;
export function createStringPreference(opts: {
    key: string;
    defaultValue?: string;
    allowed?: readonly string[];
}): StringPreferenceStore<string | undefined> {
    const { key, defaultValue, allowed } = opts;

    return {
        save(value) {
            localStorage.setItem(key, value);
        },
        load() {
            try {
                const raw = localStorage.getItem(key);
                if (raw === null) {
                    return defaultValue;
                }

                if (allowed !== undefined && !allowed.includes(raw)) {
                    return defaultValue;
                }

                return raw;
            } catch {
                return defaultValue;
            }
        },
        exists() {
            try {
                return localStorage.getItem(key) !== null;
            } catch {
                return false;
            }
        },
    };
}

/**
 * Reads accept either the new id form or a legacy integer index
 * (translated via `legacyOrder`), so existing saved preferences keep
 * working across the migration. Writes always use the id form, so the
 * legacy form gets overwritten the next time the user changes their
 * preference.
 */
export interface IdPreferenceStore<T extends { id: string }> {
    getPreset: (id: string) => T;
    save: (id: string) => void;
    load: () => string;
}

/**
 * `legacyOrder` captures the pre-migration storage order so a raw
 * value of `'N'` (numeric string) resolves to `legacyOrder[N]`.
 */
export function createIdPreferenceStore<T extends { id: string }>(opts: {
    key: string;
    presets: readonly T[];
    defaultId: string;
    legacyOrder: readonly string[];
}): IdPreferenceStore<T> {
    const { key, presets, defaultId, legacyOrder } = opts;
    const ids = new Set(presets.map((p) => p.id));

    function defaultPreset(): T {
        return presets.find((p) => p.id === defaultId) ?? presets[0];
    }

    return {
        getPreset(id) {
            return presets.find((p) => p.id === id) ?? defaultPreset();
        },
        save(id) {
            localStorage.setItem(key, id);
        },
        load() {
            try {
                const raw = localStorage.getItem(key);
                if (raw === null) {
                    return defaultId;
                }

                if (ids.has(raw)) {
                    return raw;
                }

                if (/^-?\d+$/.test(raw)) {
                    const idx = parseInt(raw, 10);
                    if (idx >= 0 && idx < legacyOrder.length) {
                        const id = legacyOrder[idx];
                        if (ids.has(id)) {
                            return id;
                        }
                    }
                }

                return defaultId;
            } catch {
                return defaultId;
            }
        },
    };
}

export interface BooleanPreferenceStore {
    load: () => boolean;
    save: (value: boolean) => void;
}

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
