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
