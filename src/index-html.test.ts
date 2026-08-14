/**
 * The CSP is the only place the image *origin* policy lives: `isSafeImageUrl`
 * restricts the scheme, but http(s) stays open to any host (legit links carry
 * arbitrary Unsplash URLs), so a crafted `https://evil.example/pixel.png` is
 * stopped here or nowhere. Failure is silent both ways — delete the tag and
 * images load from anywhere; tighten it wrong and real images stop loading —
 * with no other test across this boundary.
 */

import { describe, it, expect } from 'vitest';
import indexHtml from '../index.html?raw';

const CSP_META = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/gi;

function cspContents(): string[] {
    return [...indexHtml.matchAll(CSP_META)].map((m) => m[1].replace(/\s+/g, ' ').trim());
}

function cspContent(): string {
    const all = cspContents();
    if (all.length !== 1) {
        throw new Error(`index.html has ${all.length} Content-Security-Policy meta tags, expected 1`);
    }
    return all[0];
}

function directiveSources(directive: string): string[] | null {
    const found = cspContent()
        .split(';')
        .map((d) => d.trim())
        .find((d) => d === directive || d.startsWith(`${directive} `));
    return found === undefined ? null : found.split(/\s+/).slice(1);
}

describe('index.html Content-Security-Policy', () => {
    it('declares exactly one CSP meta tag', () => {
        // Multiple policies INTERSECT, so a second tag can silently kill image
        // loading while every membership assertion below still passes.
        expect(cspContents()).toHaveLength(1);
    });

    it('allows exactly the two sources images come from, and no others', () => {
        // Equality, not membership: under `toContain`, appending
        // `https://evil.example` passes — widening is the silent direction.
        expect(directiveSources('img-src')).toEqual([
            "'self'",
            'https://*.unsplash.com',
        ]);
    });

    it('declares an img-src directive', () => {
        expect(directiveSources('img-src')).not.toBeNull();
    });

    it("allows 'self' for the bundled images, icons and favicon", () => {
        expect(directiveSources('img-src')).toContain("'self'");
    });

    it('does not allow data: URLs', () => {
        // Nothing renders a data: URL any more (legacy ones collapse to null
        // before an href). Re-adding it reopens the only path by which
        // link-supplied image bytes can paint.
        expect(directiveSources('img-src')).not.toContain('data:');
    });

    it('allows Unsplash subdomains for puzzle images and picker thumbnails', () => {
        // Wildcarded rather than pinned to images.unsplash.com so CDN host
        // variation doesn't silently break image loading.
        expect(directiveSources('img-src')).toContain('https://*.unsplash.com');
    });

    it('does not allow arbitrary https hosts', () => {
        // `https:` or `*` would readmit the tracking-pixel vector this closes.
        const sources = directiveSources('img-src') ?? [];
        expect(sources).not.toContain('*');
        expect(sources).not.toContain('https:');
    });

    it('sets no default-src', () => {
        // img-src only: a default-src would subject scripts/styles/fetches to
        // this policy, which the app hasn't been checked against.
        expect(directiveSources('default-src')).toBeNull();
    });
});
