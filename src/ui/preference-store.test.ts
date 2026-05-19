/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    createIndexedPreferenceStore,
    createIdPreferenceStore,
    createBooleanPreference,
    createJsonPreference,
    createStringPreference,
} from './preference-store.js';

describe('createIndexedPreferenceStore', () => {
    const PRESETS = ['a', 'b', 'c'] as const;
    const KEY = 'test-indexed-pref';

    function makeStore() {
        return createIndexedPreferenceStore({
            key: KEY,
            presets: PRESETS,
            defaultIndex: 1,
        });
    }

    beforeEach(() => {
        localStorage.clear();
    });

    it('returns the preset at a valid index', () => {
        expect(makeStore().getPreset(0)).toBe('a');
        expect(makeStore().getPreset(2)).toBe('c');
    });

    it('returns the default preset for out-of-range index', () => {
        expect(makeStore().getPreset(99)).toBe('b');
        expect(makeStore().getPreset(-1)).toBe('b');
    });

    it('saves and loads an index', () => {
        const store = makeStore();
        store.save(2);
        expect(store.load()).toBe(2);
    });

    it('returns the default when nothing is saved', () => {
        expect(makeStore().load()).toBe(1);
    });

    it('returns the default for non-numeric saved values', () => {
        localStorage.setItem(KEY, 'garbage');
        expect(makeStore().load()).toBe(1);
    });

    it('returns the default for out-of-range saved values', () => {
        localStorage.setItem(KEY, '99');
        expect(makeStore().load()).toBe(1);
        localStorage.setItem(KEY, '-1');
        expect(makeStore().load()).toBe(1);
    });
});

describe('createBooleanPreference', () => {
    const KEY = 'test-bool-pref';

    beforeEach(() => {
        localStorage.clear();
    });

    it('returns the default when nothing is saved', () => {
        const store = createBooleanPreference({ key: KEY, defaultValue: true });
        expect(store.load()).toBe(true);

        const other = createBooleanPreference({ key: KEY, defaultValue: false });
        expect(other.load()).toBe(false);
    });

    it('saves and loads true', () => {
        const store = createBooleanPreference({ key: KEY, defaultValue: false });
        store.save(true);
        expect(store.load()).toBe(true);
    });

    it('saves and loads false', () => {
        const store = createBooleanPreference({ key: KEY, defaultValue: true });
        store.save(false);
        expect(store.load()).toBe(false);
    });

    it('treats any non-"true" stored value as false', () => {
        const store = createBooleanPreference({ key: KEY, defaultValue: true });
        localStorage.setItem(KEY, 'garbage');
        expect(store.load()).toBe(false);
    });
});

describe('createJsonPreference', () => {
    const KEY = 'test-json-pref';

    interface Sample {
        n: number;
        flag: boolean;
    }

    function parseSample(raw: unknown): Sample | undefined {
        if (typeof raw !== 'object' || raw === null || !('n' in raw)) {
            return undefined;
        }
        const r = raw as Record<string, unknown>;
        return { n: Number(r.n), flag: Boolean(r.flag) };
    }

    function makeStore() {
        return createJsonPreference<Sample>({ key: KEY, parse: parseSample });
    }

    beforeEach(() => {
        localStorage.clear();
    });

    it('returns undefined when nothing is saved', () => {
        expect(makeStore().load()).toBeUndefined();
    });

    it('saves and loads a value', () => {
        const store = makeStore();
        store.save({ n: 7, flag: true });
        expect(store.load()).toEqual({ n: 7, flag: true });
    });

    it('returns undefined for non-JSON saved values', () => {
        localStorage.setItem(KEY, 'not-json');
        expect(makeStore().load()).toBeUndefined();
    });

    it('returns undefined when the parser rejects the value', () => {
        localStorage.setItem(KEY, JSON.stringify({ unrelated: true }));
        expect(makeStore().load()).toBeUndefined();
    });

    it('returns undefined when the parser throws', () => {
        const store = createJsonPreference<Sample>({
            key: KEY,
            parse: () => {
                throw new Error('boom');
            },
        });
        localStorage.setItem(KEY, JSON.stringify({ n: 1 }));
        expect(store.load()).toBeUndefined();
    });
});

describe('createStringPreference', () => {
    const KEY = 'test-string-pref';

    beforeEach(() => {
        localStorage.clear();
    });

    describe('without defaultValue', () => {
        it('returns undefined when nothing is saved', () => {
            const store = createStringPreference({ key: KEY });
            expect(store.load()).toBeUndefined();
        });

        it('saves and loads a string', () => {
            const store = createStringPreference({ key: KEY });
            store.save('hello');
            expect(store.load()).toBe('hello');
        });

        it('returns undefined when saved value is not in allowed list', () => {
            const store = createStringPreference({
                key: KEY,
                allowed: ['a', 'b'],
            });
            localStorage.setItem(KEY, 'c');
            expect(store.load()).toBeUndefined();
        });

        it('returns the saved value when in allowed list', () => {
            const store = createStringPreference({
                key: KEY,
                allowed: ['a', 'b'],
            });
            localStorage.setItem(KEY, 'b');
            expect(store.load()).toBe('b');
        });
    });

    describe('with defaultValue', () => {
        it('returns the default when nothing is saved', () => {
            const store = createStringPreference({
                key: KEY,
                defaultValue: 'fallback',
            });
            expect(store.load()).toBe('fallback');
        });

        it('returns the saved value when present', () => {
            const store = createStringPreference({
                key: KEY,
                defaultValue: 'fallback',
            });
            store.save('actual');
            expect(store.load()).toBe('actual');
        });

        it('returns the default when saved value is rejected by allowed', () => {
            const store = createStringPreference({
                key: KEY,
                defaultValue: 'fallback',
                allowed: ['fallback', 'other'],
            });
            localStorage.setItem(KEY, 'invalid');
            expect(store.load()).toBe('fallback');
        });

        it('returns the saved value when in allowed list', () => {
            const store = createStringPreference({
                key: KEY,
                defaultValue: 'fallback',
                allowed: ['fallback', 'other'],
            });
            localStorage.setItem(KEY, 'other');
            expect(store.load()).toBe('other');
        });
    });
});

describe('createIdPreferenceStore', () => {
    const PRESETS = [
        { id: 'alpha' },
        { id: 'beta' },
        { id: 'gamma' },
    ] as const;
    const KEY = 'test-id-pref';
    const LEGACY_ORDER = ['alpha', 'beta', 'gamma'] as const;

    function makeStore() {
        return createIdPreferenceStore({
            key: KEY,
            presets: PRESETS,
            defaultId: 'beta',
            legacyOrder: LEGACY_ORDER,
        });
    }

    beforeEach(() => {
        localStorage.clear();
    });

    it('returns the preset matching an id', () => {
        expect(makeStore().getPreset('alpha')).toEqual({ id: 'alpha' });
        expect(makeStore().getPreset('gamma')).toEqual({ id: 'gamma' });
    });

    it('returns the default preset for an unknown id', () => {
        expect(makeStore().getPreset('nope')).toEqual({ id: 'beta' });
    });

    it('saves and loads an id', () => {
        const store = makeStore();
        store.save('gamma');
        expect(store.load()).toBe('gamma');
    });

    it('returns the default id when nothing is saved', () => {
        expect(makeStore().load()).toBe('beta');
    });

    it('migrates a legacy integer index to the matching id', () => {
        localStorage.setItem(KEY, '0');
        expect(makeStore().load()).toBe('alpha');
        localStorage.setItem(KEY, '2');
        expect(makeStore().load()).toBe('gamma');
    });

    it('returns the default for an out-of-range legacy integer', () => {
        localStorage.setItem(KEY, '99');
        expect(makeStore().load()).toBe('beta');
        localStorage.setItem(KEY, '-1');
        expect(makeStore().load()).toBe('beta');
    });

    it('returns the default for an unknown saved string', () => {
        localStorage.setItem(KEY, 'not-a-known-id');
        expect(makeStore().load()).toBe('beta');
    });

    it('does NOT rewrite localStorage on load (migration is read-only)', () => {
        localStorage.setItem(KEY, '0');
        makeStore().load();
        expect(localStorage.getItem(KEY)).toBe('0');
    });

    it('overwrites the legacy integer the next time save() is called', () => {
        localStorage.setItem(KEY, '0');
        const store = makeStore();
        expect(store.load()).toBe('alpha');
        store.save('gamma');
        expect(localStorage.getItem(KEY)).toBe('gamma');
    });

    it('survives localStorage errors by returning the default', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage broken');
        });
        expect(makeStore().load()).toBe('beta');
        vi.restoreAllMocks();
    });
});
