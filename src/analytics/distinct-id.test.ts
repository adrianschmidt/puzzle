/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DISTINCT_ID_KEY, resolveDistinctId } from './distinct-id.js';

function visit(pathAndQuery: string): void {
    history.replaceState(null, '', pathAndQuery);
}

describe('resolveDistinctId', () => {
    beforeEach(() => {
        localStorage.clear();
        visit('/puzzle/');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns undefined when nothing is stored and no param is given', () => {
        expect(resolveDistinctId()).toBeUndefined();
    });

    it('persists a valid ?userid= and returns it', () => {
        visit('/puzzle/?userid=adrian-phone');

        expect(resolveDistinctId()).toBe('adrian-phone');
        expect(localStorage.getItem(DISTINCT_ID_KEY)).toBe('adrian-phone');
    });

    it('returns the stored id on a later boot without the param', () => {
        visit('/puzzle/dev/?userid=adrian');
        resolveDistinctId();
        visit('/puzzle/');

        expect(resolveDistinctId()).toBe('adrian');
    });

    it('replaces a previously stored id', () => {
        localStorage.setItem(DISTINCT_ID_KEY, 'old');
        visit('/puzzle/?userid=new');

        expect(resolveDistinctId()).toBe('new');
        expect(localStorage.getItem(DISTINCT_ID_KEY)).toBe('new');
    });

    it.each(['', 'off'])('clears the stored id for ?userid=%s', (value) => {
        localStorage.setItem(DISTINCT_ID_KEY, 'adrian');
        visit(`/puzzle/?userid=${value}`);

        expect(resolveDistinctId()).toBeUndefined();
        expect(localStorage.getItem(DISTINCT_ID_KEY)).toBeNull();
    });

    it.each(['Adrian', 'a b', 'a_b', 'x'.repeat(33), '%3Cscript%3E'])(
        'ignores the invalid id %j and keeps the stored one',
        (value) => {
            localStorage.setItem(DISTINCT_ID_KEY, 'adrian');
            visit(`/puzzle/?userid=${value}`);

            expect(resolveDistinctId()).toBe('adrian');
            expect(localStorage.getItem(DISTINCT_ID_KEY)).toBe('adrian');
        },
    );

    it('accepts an id of exactly 32 characters', () => {
        const id = 'a'.repeat(32);
        visit(`/puzzle/?userid=${id}`);

        expect(resolveDistinctId()).toBe(id);
    });

    it('ignores a tampered stored value', () => {
        localStorage.setItem(DISTINCT_ID_KEY, 'Not Valid');

        expect(resolveDistinctId()).toBeUndefined();
    });

    it.each(['adrian', 'off', '', 'INVALID'])(
        'strips ?userid=%s from the URL, keeping other params and the hash',
        (value) => {
            visit(`/puzzle/?tabDebug=1&userid=${value}#p=abc`);

            resolveDistinctId();

            expect(window.location.pathname).toBe('/puzzle/');
            expect(window.location.search).toBe('?tabDebug=1');
            expect(window.location.hash).toBe('#p=abc');
        },
    );

    it('leaves no dangling "?" when userid was the only param', () => {
        visit('/puzzle/?userid=adrian');

        resolveDistinctId();

        expect(window.location.href).toBe(`${window.location.origin}/puzzle/`);
    });

    it('does not touch history when the param is absent', () => {
        visit('/puzzle/?tabDebug=1#p=abc');
        const replaceState = vi.spyOn(history, 'replaceState');

        resolveDistinctId();

        expect(replaceState).not.toHaveBeenCalled();
    });

    it('still uses a valid param for this session when storage rejects the write', () => {
        visit('/puzzle/?userid=adrian');
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('full', 'QuotaExceededError');
        });

        expect(resolveDistinctId()).toBe('adrian');
        expect(window.location.search).toBe('');
    });

    it('still uses and stores a valid param when the URL cannot be rewritten', () => {
        visit('/puzzle/?userid=adrian');
        vi.spyOn(history, 'replaceState').mockImplementation(() => {
            throw new DOMException('throttled', 'SecurityError');
        });

        expect(resolveDistinctId()).toBe('adrian');
        expect(localStorage.getItem(DISTINCT_ID_KEY)).toBe('adrian');
    });

    it('returns undefined when storage is unreadable', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('denied', 'SecurityError');
        });

        expect(resolveDistinctId()).toBeUndefined();
    });
});
