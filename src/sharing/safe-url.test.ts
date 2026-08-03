import { describe, it, expect } from 'vitest';
import { isSafeHttpUrl, isSafeImageUrl, isDataUrl } from './safe-url.js';

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

describe('isSafeImageUrl', () => {
    it('accepts the "blank" wire sentinel', () => {
        expect(isSafeImageUrl('blank')).toBe(true);
    });

    it('accepts the data: PNG a blank-canvas share link actually carries', () => {
        // `gameStateToPayload` does NOT collapse this to the sentinel, so every
        // blank-puzzle link ever shared has a raw canvas PNG in `i`. Rejecting
        // `data:` would kill all of them.
        expect(isSafeImageUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
        expect(isSafeImageUrl('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
    });

    it('accepts relative URLs (the bundled image)', () => {
        expect(isSafeImageUrl('first-puzzle.jpg')).toBe(true);
        expect(isSafeImageUrl('/puzzle/first-puzzle.jpg')).toBe(true);
        expect(isSafeImageUrl('puzzle-image.jpg')).toBe(true);
    });

    it('accepts absolute http and https URLs', () => {
        expect(isSafeImageUrl('https://images.unsplash.com/photo-1?w=1080')).toBe(true);
        expect(isSafeImageUrl('http://example.com/x.jpg')).toBe(true);
    });

    it('rejects javascript: and other executable schemes', () => {
        expect(isSafeImageUrl('javascript:alert(1)')).toBe(false);
        expect(isSafeImageUrl('  JavaScript:alert(1)')).toBe(false);
        expect(isSafeImageUrl('vbscript:msgbox(1)')).toBe(false);
        expect(isSafeImageUrl('file:///etc/passwd')).toBe(false);
    });

    it('rejects a non-image data: URL', () => {
        expect(isSafeImageUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
        expect(isSafeImageUrl('data:application/json,{}')).toBe(false);
    });

    it('rejects blob: URLs', () => {
        // The app's only createObjectURL is the corrupt-save download anchor,
        // never an image; and a blob: from the sharer's session is dead on the
        // recipient's machine anyway.
        expect(isSafeImageUrl('blob:https://example.com/1234')).toBe(false);
    });

    it('rejects the empty string', () => {
        expect(isSafeImageUrl('')).toBe(false);
    });

    it.each([
        '//evil.example/pixel.png',
        '///evil.example/pixel.png',
        '/\\evil.example/pixel.png',
        '\\\\evil.example/pixel.png',
        '\\/evil.example/pixel.png',
    ])('rejects the protocol-relative form %s', (url) => {
        // These have no scheme, so `new URL(url)` throws exactly as
        // `first-puzzle.jpg` does — but a relative reference inherits the
        // base's scheme, not its origin, so each of these resolves to
        // https://evil.example/. Inferring "relative" from a failed parse
        // accepted all five.
        expect(isSafeImageUrl(url)).toBe(false);
    });

    it('still accepts the relative forms the app actually emits', () => {
        // The guard against over-correcting the case above.
        expect(isSafeImageUrl('first-puzzle.jpg')).toBe(true);
        expect(isSafeImageUrl('/puzzle/first-puzzle.jpg')).toBe(true);
        expect(isSafeImageUrl('./first-puzzle.jpg')).toBe(true);
        expect(isSafeImageUrl('puzzle-image.jpg?v=2')).toBe(true);
    });
});

describe('isDataUrl', () => {
    it('accepts a lowercase data: URL', () => {
        expect(isDataUrl('data:image/png;base64,AAAA')).toBe(true);
    });

    it('accepts an uppercase or mixed-case scheme', () => {
        expect(isDataUrl('DATA:image/png;base64,AAAA')).toBe(true);
        expect(isDataUrl('DaTa:image/png;base64,AAAA')).toBe(true);
    });

    it('rejects a non-data: URL', () => {
        expect(isDataUrl('https://images.unsplash.com/photo-1?w=1080')).toBe(false);
    });

    it('rejects the blank sentinel', () => {
        expect(isDataUrl('blank')).toBe(false);
    });

    it('rejects the empty string', () => {
        expect(isDataUrl('')).toBe(false);
    });

    it('accepts a data: URL with leading whitespace, matching what isSafeImageUrl parses', () => {
        expect(isDataUrl(' data:image/png;base64,AAAA')).toBe(true);
        expect(isDataUrl('\tdata:image/png;base64,AAAA')).toBe(true);
        expect(isDataUrl('da\nta:image/png;base64,AAAA')).toBe(true);
    });
});
