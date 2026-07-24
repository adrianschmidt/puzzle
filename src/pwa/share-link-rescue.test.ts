import { describe, it, expect } from 'vitest';
import {
    wasRescueAttempted,
    recordRescueAttempt,
    clearRescueAttempt,
} from './share-link-rescue.js';

/** Minimal in-memory Storage stand-in. */
function fakeStorage(): Storage {
    const map = new Map<string, string>();
    return {
        get length() { return map.size; },
        clear: () => map.clear(),
        getItem: (k: string) => map.get(k) ?? null,
        key: (i: number) => [...map.keys()][i] ?? null,
        removeItem: (k: string) => { map.delete(k); },
        setItem: (k: string, v: string) => { map.set(k, v); },
    };
}

/** Storage whose writes throw (private mode / quota). */
function throwingStorage(): Storage {
    const base = fakeStorage();
    return {
        ...base,
        setItem: () => { throw new Error('quota'); },
        getItem: () => { throw new Error('quota'); },
    };
}

describe('share-link rescue guard', () => {
    it('reports no attempt for a link never recorded', () => {
        expect(wasRescueAttempted('abc', fakeStorage())).toBe(false);
    });

    it('reports an attempt only for the exact recorded link', () => {
        const storage = fakeStorage();
        expect(recordRescueAttempt('abc', storage)).toBe(true);
        expect(wasRescueAttempted('abc', storage)).toBe(true);
        // A different link gets its own fresh attempt.
        expect(wasRescueAttempted('other', storage)).toBe(false);
    });

    it('recording a new link replaces the previous guard entry', () => {
        const storage = fakeStorage();
        recordRescueAttempt('abc', storage);
        recordRescueAttempt('other', storage);
        expect(wasRescueAttempted('abc', storage)).toBe(false);
        expect(wasRescueAttempted('other', storage)).toBe(true);
    });

    it('clearRescueAttempt removes the guard entry', () => {
        const storage = fakeStorage();
        recordRescueAttempt('abc', storage);
        clearRescueAttempt(storage);
        expect(wasRescueAttempted('abc', storage)).toBe(false);
    });

    it('returns false from recordRescueAttempt when storage throws (loop-proofing)', () => {
        // If the guard cannot be persisted, the caller must NOT rescue:
        // an unpersisted guard would let a still-invalid link reload forever.
        expect(recordRescueAttempt('abc', throwingStorage())).toBe(false);
    });

    it('treats a throwing storage as "not attempted" without throwing', () => {
        expect(wasRescueAttempted('abc', throwingStorage())).toBe(false);
        expect(() => clearRescueAttempt(throwingStorage())).not.toThrow();
    });
});
