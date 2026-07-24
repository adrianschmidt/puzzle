import { describe, it, expect, vi } from 'vitest';
import {
    wasRescueAttempted,
    recordRescueAttempt,
    clearRescueAttempt,
    attemptShareLinkRescue,
    type ShareLinkRescueDeps,
    type RescueRegistration,
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

/** Deps harness: manual control over registration, readiness, and the deadline. */
function makeDeps(overrides: Partial<ShareLinkRescueDeps> = {}) {
    const applyUpdate = vi.fn();
    let readyHandler: (() => void) | null = null;
    let fireDeadline: (() => void) | null = null;
    const deps: ShareLinkRescueDeps = {
        getRegistration: () => new Promise<RescueRegistration | null>(() => {}),
        isUpdateReady: () => false,
        onUpdateReady: (handler) => {
            readyHandler = handler;
            return () => { readyHandler = null; };
        },
        applyUpdate,
        schedule: (handler) => {
            fireDeadline = handler;
            return () => { fireDeadline = null; };
        },
        ...overrides,
    };
    return {
        deps,
        applyUpdate,
        fireReady: () => readyHandler?.(),
        fireDeadline: () => fireDeadline?.(),
        isReadySubscribed: () => readyHandler !== null,
        isDeadlineScheduled: () => fireDeadline !== null,
    };
}

function registration(overrides: Partial<RescueRegistration> = {}): RescueRegistration {
    return { update: () => Promise.resolve(), installing: null, waiting: null, ...overrides };
}

describe('attemptShareLinkRescue', () => {
    it('applies immediately when an update is already waiting', async () => {
        const h = makeDeps({ isUpdateReady: () => true });
        await expect(attemptShareLinkRescue(h.deps)).resolves.toBe('updated');
        expect(h.applyUpdate).toHaveBeenCalledTimes(1);
    });

    it('resolves no-update when the check completes with no new worker', async () => {
        const h = makeDeps({ getRegistration: () => Promise.resolve(registration()) });
        await expect(attemptShareLinkRescue(h.deps)).resolves.toBe('no-update');
        expect(h.applyUpdate).not.toHaveBeenCalled();
    });

    it('applies when the update check finds a new worker that becomes ready', async () => {
        const h = makeDeps({
            getRegistration: () => Promise.resolve(registration({ installing: {} })),
        });
        const outcome = attemptShareLinkRescue(h.deps);
        // Let getRegistration + update() settle, then simulate onNeedRefresh.
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        h.fireReady();
        await expect(outcome).resolves.toBe('updated');
        expect(h.applyUpdate).toHaveBeenCalledTimes(1);
    });

    it('resolves unavailable when there is no registration', async () => {
        const h = makeDeps({ getRegistration: () => Promise.resolve(null) });
        await expect(attemptShareLinkRescue(h.deps)).resolves.toBe('unavailable');
        expect(h.applyUpdate).not.toHaveBeenCalled();
    });

    it('resolves unavailable when the update check rejects (offline)', async () => {
        const h = makeDeps({
            getRegistration: () =>
                Promise.resolve(registration({ update: () => Promise.reject(new Error('offline')) })),
        });
        await expect(attemptShareLinkRescue(h.deps)).resolves.toBe('unavailable');
    });

    it('resolves unavailable when the deadline fires first', async () => {
        const h = makeDeps(); // getRegistration never resolves
        const outcome = attemptShareLinkRescue(h.deps);
        h.fireDeadline();
        await expect(outcome).resolves.toBe('unavailable');
        expect(h.applyUpdate).not.toHaveBeenCalled();
    });

    it('settles once: a late update-ready after the deadline does not apply', async () => {
        const h = makeDeps({
            getRegistration: () => Promise.resolve(registration({ installing: {} })),
        });
        const outcome = attemptShareLinkRescue(h.deps);
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        h.fireDeadline();
        h.fireReady();
        await expect(outcome).resolves.toBe('unavailable');
        expect(h.applyUpdate).not.toHaveBeenCalled();
    });

    it('cancels the deadline and unsubscribes after settling', async () => {
        const h = makeDeps({ getRegistration: () => Promise.resolve(registration()) });
        await attemptShareLinkRescue(h.deps);
        expect(h.isDeadlineScheduled()).toBe(false);
        expect(h.isReadySubscribed()).toBe(false);
    });
});
