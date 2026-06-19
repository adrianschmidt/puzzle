import { describe, it, expect } from 'vitest';
import { CURRENT_TRACE_SET_VERSION, normalizeTraceSetVersion } from './trace-set-version.js';

describe('normalizeTraceSetVersion', () => {
    it('CURRENT_TRACE_SET_VERSION is a positive integer', () => {
        expect(Number.isInteger(CURRENT_TRACE_SET_VERSION)).toBe(true);
        expect(CURRENT_TRACE_SET_VERSION).toBeGreaterThanOrEqual(1);
    });

    it('accepts an integer >= 1 unchanged', () => {
        expect(normalizeTraceSetVersion(1)).toBe(1);
        expect(normalizeTraceSetVersion(7)).toBe(7);
    });

    it('floors a fractional value to the integer snapshot it names', () => {
        expect(normalizeTraceSetVersion(1.9)).toBe(1);
        expect(normalizeTraceSetVersion(2.5)).toBe(2);
    });

    it('rejects a sub-1 value', () => {
        expect(normalizeTraceSetVersion(0)).toBeUndefined();
        expect(normalizeTraceSetVersion(0.4)).toBeUndefined();
        expect(normalizeTraceSetVersion(-3)).toBeUndefined();
    });

    it('rejects non-finite numbers', () => {
        expect(normalizeTraceSetVersion(NaN)).toBeUndefined();
        expect(normalizeTraceSetVersion(Infinity)).toBeUndefined();
        expect(normalizeTraceSetVersion(-Infinity)).toBeUndefined();
    });

    it('rejects non-number values', () => {
        for (const bad of ['1', null, undefined, {}, [], true] as unknown[]) {
            expect(normalizeTraceSetVersion(bad)).toBeUndefined();
        }
    });
});
