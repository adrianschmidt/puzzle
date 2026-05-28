import { describe, it, expect } from 'vitest';
import { sanitizeErrorReason } from './sanitize-error-reason.js';

describe('sanitizeErrorReason', () => {
    it('uses an Error message', () => {
        expect(sanitizeErrorReason(new Error('boom'))).toBe('boom');
    });

    it('coerces non-Error values via String()', () => {
        expect(sanitizeErrorReason('boom')).toBe('boom');
        expect(sanitizeErrorReason(42)).toBe('42');
        expect(sanitizeErrorReason({ toString: () => 'objy' })).toBe('objy');
    });

    it('redacts http(s) URLs', () => {
        expect(
            sanitizeErrorReason(
                new Error('Failed to fetch dynamically imported module: https://x.example/a/b-123.js'),
            ),
        ).toBe('Failed to fetch dynamically imported module: <url>');
    });

    it('redacts non-http URI schemes', () => {
        expect(sanitizeErrorReason(new Error('socket ws://host:8080/feed dropped')))
            .toBe('socket <url> dropped');
        expect(sanitizeErrorReason(new Error('cannot read file:///etc/hosts')))
            .toBe('cannot read <url>');
        expect(sanitizeErrorReason(new Error('load failed blob:https://app/9f-uuid')))
            .toBe('load failed <url>');
    });

    it('redacts (and bounds) data: URIs that would otherwise eat the budget', () => {
        const reason = sanitizeErrorReason(
            new Error(`bad image data:image/png;base64,${'A'.repeat(400)}`),
        );
        expect(reason).toBe('bad image <url>');
    });

    it('redacts extension origins across schemes', () => {
        expect(sanitizeErrorReason(new Error('blocked chrome-extension://abc/x.js')))
            .toBe('blocked <ext>');
        expect(sanitizeErrorReason(new Error('blocked safari-web-extension://ABCD/x.js')))
            .toBe('blocked <ext>');
        expect(sanitizeErrorReason(new Error('blocked extension://abc/x.js')))
            .toBe('blocked <ext>');
    });

    it('falls back to "unknown" for empty or whitespace-only messages', () => {
        expect(sanitizeErrorReason(new Error(''))).toBe('unknown');
        expect(sanitizeErrorReason(new Error('   '))).toBe('unknown');
    });

    it('truncates to the max length (default 200)', () => {
        const reason = sanitizeErrorReason(new Error('x'.repeat(500)));
        expect(reason.length).toBe(200);
        expect(reason).toBe('x'.repeat(200));
    });

    it('honours a custom max length', () => {
        expect(sanitizeErrorReason(new Error('x'.repeat(50)), 10)).toBe('x'.repeat(10));
    });
});
