/**
 * URL-scheme guard for values that end up in an anchor `href`.
 *
 * Attribution URLs carried by a share link are attacker-controlled: a
 * crafted `#p=...` link can set them to a `javascript:` (or `data:`)
 * scheme that executes on click. `target="_blank"` /
 * `rel="noopener noreferrer"` do NOT neutralize that. Restricting the
 * href to absolute http(s) URLs closes the vector while accepting every
 * legitimate (Unsplash) link, which is always https.
 */
export function isSafeHttpUrl(url: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        // Relative or malformed URLs have no scheme we can trust.
        return false;
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/** MIME-type prefix a `data:` URL must carry to be accepted as an image. */
const IMAGE_MIME_PREFIX = 'image/';

/**
 * URL-scheme guard for a share link's image URL (`SharePayload.i`), which
 * reaches `state.imageUrl` and the SVG `<image>` href in
 * `renderer/svg-dom-renderer.ts`.
 *
 * Deliberately NOT {@link isSafeHttpUrl}: that one requires an *absolute*
 * http(s) URL because its values end up in an anchor `href`. Image URLs have a
 * wider legitimate set, and reusing the stricter guard would reject links this
 * app itself emits:
 *
 *  - `'blank'` — the wire sentinel (see `SharePayload.i`).
 *  - `data:image/*` — legacy blank-puzzle links carry a painted canvas PNG.
 *    Restricted to `image/` subtypes: `data:text/html` has no business in an
 *    image href even though an `<image>` would not execute it.
 *  - relative — `BUNDLED_IMAGE_URL` is `'first-puzzle.jpg'`, which resolves
 *    against the app origin. Note "relative" has to be *tested*, not inferred
 *    from a failed absolute parse: a protocol-relative `//evil.example/x.png`
 *    (and its `\\`, `/\`, `///` variants) also throws in `new URL()` without a
 *    base, and then resolves cross-origin — a relative reference inherits the
 *    base's SCHEME, not its origin. Hence the sentinel base below.
 *
 * What this rejects is `javascript:`, `vbscript:`, `file:`, `blob:` and every
 * other scheme. `blob:` is deliberate rather than an oversight: the app's only
 * `URL.createObjectURL` is the corrupt-save download anchor
 * (`ui/corrupt-save-dialog.ts`), never an image, and a `blob:` minted in the
 * sharer's session is already a dead reference on the recipient's machine.
 *
 * Note what this does NOT do: http(s) is accepted for *any* host, because
 * legitimate links carry arbitrary `https://images.unsplash.com/...` URLs and
 * no scheme check can tell those from `https://evil.example/pixel.png`. The
 * origin policy — which is what actually stops a crafted link turning into a
 * tracking pixel — lives in the `img-src` CSP in `index.html`, where it also
 * covers resumed saves rather than just share links. This function's job is
 * the scheme, and making `SharePayload.i`'s declared type honest.
 */
export function isSafeImageUrl(url: string): boolean {
    if (url === 'blank') return true;
    if (url.trim() === '') return false;

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return isSameOriginRelative(url);
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return true;
    // Read the MIME type off `pathname`, not off a lowercased whole `href`:
    // copying a long URL to test an 11-character prefix is a real allocation
    // on the boot path. `protocol` is already lowercased by the parser, which
    // is what makes slicing safe; `pathname` is not, so `data:IMAGE/png,x`
    // still needs the case fold.
    return parsed.protocol === 'data:'
        && parsed.pathname.slice(0, IMAGE_MIME_PREFIX.length).toLowerCase() === IMAGE_MIME_PREFIX;
}

/**
 * Whether `url` is a relative reference that resolves inside its own base.
 *
 * Resolving against a sentinel base and requiring the origin back, rather than
 * treating "`new URL()` threw" as proof of relativeness: the throw only means
 * there was no scheme, and `//evil.example/x.png` clears that bar while
 * resolving to another origin entirely.
 */
function isSameOriginRelative(url: string): boolean {
    const base = 'https://relative.invalid';
    try {
        return new URL(url, `${base}/`).origin === base;
    } catch {
        return false;
    }
}
