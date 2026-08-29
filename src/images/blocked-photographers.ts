/**
 * Photographers whose photos are excluded from every category — Unsplash's
 * random API has no exclusion parameter, so results are filtered after the
 * fetch (#568). Matched via the profile URL because both the API's raw
 * `user.links.html` and our UTM-tagged `photographerUrl` carry it.
 *
 * Imported by scripts/harvest-backup-pool.ts under tsx, so this module must
 * not import anything that touches `import.meta.env`.
 */
export const BLOCKED_PHOTOGRAPHER_USERNAMES: readonly string[] = [
    'silverkblack',
];

export function isBlockedPhotographerUrl(profileUrl: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(profileUrl);
    } catch {
        return false;
    }

    const path = parsed.pathname.toLowerCase();

    return BLOCKED_PHOTOGRAPHER_USERNAMES.some(
        (username) => path === `/@${username.toLowerCase()}`,
    );
}
