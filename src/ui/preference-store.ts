/**
 * Generic helpers for persisting small preferences in `localStorage`.
 *
 * Several modules had near-identical preset+localStorage code, with
 * the same `null`/`NaN`/range/JSON-parse/try-catch handling repeated
 * by hand. These factories centralise that logic so each callsite
 * only declares its key, the shape of the value, and a default.
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
 * A store for a JSON-object preference: a typed value persisted as
 * serialised JSON. Missing, unreadable, or rejected-by-`parse` values
 * load as `undefined` (callers decide what to do with that — usually
 * fall back to a hard-coded default).
 */
export interface JsonPreferenceStore<T> {
    save: (value: T) => void;
    load: () => T | undefined;
}

/**
 * Build a JSON-object preference backed by `localStorage`.
 *
 * The `parse` callback validates and coerces the parsed JSON into the
 * target type. Returning `undefined` rejects the saved value.
 */
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

/**
 * A store for a string preference. The optional `allowed` list
 * whitelists valid values; saved values outside it are rejected like
 * a missing entry. The optional `defaultValue` decides what `load()`
 * returns when nothing is saved (or the saved value is rejected):
 * with a default, `load()` always returns a string; without one, it
 * returns `string | undefined`.
 */
export interface StringPreferenceStore<T extends string | undefined> {
    save: (value: string) => void;
    load: () => T;
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
    };
}

/**
 * A store for an id-keyed preset preference: a list of presets carrying
 * stable string ids, plus a persisted id pointing into the list.
 *
 * Reads accept either the new id form or a legacy integer index
 * (translated via `legacyOrder`), so existing saved preferences keep
 * working across the migration. Writes always use the id form, so the
 * legacy form gets overwritten the next time the user changes their
 * preference.
 */
export interface IdPreferenceStore<T extends { id: string }> {
    /** Get the preset whose id matches, or the default preset. */
    getPreset: (id: string) => T;
    /** Persist the preferred id. */
    save: (id: string) => void;
    /** Load the persisted id (always a valid preset id). */
    load: () => string;
}

/**
 * Build an id-keyed preference store backed by `localStorage`.
 *
 * `legacyOrder` captures the pre-migration storage order so a raw
 * value of `'N'` (numeric string) resolves to `legacyOrder[N]`. Drop
 * it in a follow-up release once enough users have loaded the
 * migrated build.
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

                // Legacy integer-index migration.
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
