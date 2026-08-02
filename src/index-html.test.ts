/**
 * Guard: the app shell's `img-src` Content-Security-Policy.
 *
 * `index.html` is not reachable from any other test — `main.test.ts` guards
 * the entry point it loads, and this guards the shell itself. The CSP is the
 * only place the *origin* policy for images is expressed: the share codec's
 * `isSafeImageUrl` restricts the scheme, but http(s) has to stay open to any
 * host (legitimate links carry arbitrary Unsplash URLs), so a crafted link
 * pointing at `https://evil.example/pixel.png` is stopped here or nowhere.
 *
 * Worth pinning because the failure is silent in both directions: delete the
 * tag and images load from anywhere again with nothing to notice it, or
 * tighten it wrongly and real puzzle images stop loading with no test to say
 * so. Each source below is asserted with the reason it is required, so a
 * future edit has to argue with the reason rather than with a regex.
 */

import { describe, it, expect } from 'vitest';
import indexHtml from '../index.html?raw';

const CSP_META = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/gi;

/** Every CSP meta tag's `content`, whitespace-normalized. */
function cspContents(): string[] {
    return [...indexHtml.matchAll(CSP_META)].map((m) => m[1].replace(/\s+/g, ' ').trim());
}

/** The `content` of the single CSP meta tag. */
function cspContent(): string {
    const all = cspContents();
    if (all.length !== 1) {
        throw new Error(`index.html has ${all.length} Content-Security-Policy meta tags, expected 1`);
    }
    return all[0];
}

/** The sources listed for `directive`, or `null` when it is absent. */
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

    it('allows exactly the three sources images come from, and no others', () => {
        // Equality, not membership: the whole directive is the assertion.
        // Under `toContain` checks, appending `https://evil.example` to the
        // policy passes every test in this file — and adding a source is the
        // direction that silently widens the policy.
        expect(directiveSources('img-src')).toEqual([
            "'self'",
            'data:',
            'https://*.unsplash.com',
        ]);
    });

    it('declares an img-src directive', () => {
        expect(directiveSources('img-src')).not.toBeNull();
    });

    it("allows 'self' for the bundled images, icons and favicon", () => {
        // first-puzzle.jpg, puzzle-image.jpg, icon-192/512.png, favicon-48.png,
        // apple-touch-icon.png are all served from the app origin.
        expect(directiveSources('img-src')).toContain("'self'");
    });

    it('allows data: for the blank puzzle canvas', () => {
        // A blank puzzle keeps the painted canvas in `state.imageUrl` and
        // `gameStateToPayload` copies it to the wire verbatim, so both the
        // live puzzle and its share link render from a data: PNG.
        expect(directiveSources('img-src')).toContain('data:');
    });

    it('allows Unsplash subdomains for puzzle images and picker thumbnails', () => {
        // `urls.regular` (the puzzle image) and `urls.small` (picker
        // thumbnails) are both Unsplash CDN URLs. Wildcarded rather than
        // pinned to images.unsplash.com so CDN host variation does not
        // silently break image loading.
        expect(directiveSources('img-src')).toContain('https://*.unsplash.com');
    });

    it('does not allow arbitrary https hosts', () => {
        // The whole point: `https:` or `*` as a source would readmit the
        // tracking-pixel vector the directive exists to close.
        const sources = directiveSources('img-src') ?? [];
        expect(sources).not.toContain('*');
        expect(sources).not.toContain('https:');
    });

    it('sets no default-src', () => {
        // Deliberately img-src only. Adding default-src silently subjects
        // scripts, styles and fetches to the same policy, which this app has
        // not been checked against — that needs to be its own change.
        expect(directiveSources('default-src')).toBeNull();
    });
});
