import { describe, it, expect } from 'vitest';
import { isSafeHttpUrl } from './safe-url.js';

describe('isSafeHttpUrl', () => {
    it('accepts absolute http and https URLs', () => {
        expect(isSafeHttpUrl('https://unsplash.com/@jane')).toBe(true);
        expect(isSafeHttpUrl('http://example.com/x')).toBe(true);
    });

    it('rejects javascript: URLs (the XSS vector)', () => {
        expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
        // Case and leading whitespace are normalized by the URL parser, so
        // these still resolve to the javascript: scheme and stay rejected.
        expect(isSafeHttpUrl('  JavaScript:alert(1)')).toBe(false);
    });

    it('rejects data: and other non-http(s) schemes', () => {
        expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
        expect(isSafeHttpUrl('vbscript:msgbox(1)')).toBe(false);
        expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false);
    });

    it('rejects relative and malformed URLs', () => {
        expect(isSafeHttpUrl('/relative/path')).toBe(false);
        expect(isSafeHttpUrl('not a url')).toBe(false);
        expect(isSafeHttpUrl('')).toBe(false);
    });
});
