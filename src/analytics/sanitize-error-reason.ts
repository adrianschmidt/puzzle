/**
 * Turns an arbitrary thrown value into a bounded, low-disclosure `reason`
 * string for analytics. Shared by every path that ships an error to Umami,
 * so redaction and length rules live in one place.
 */

const DEFAULT_MAX_LENGTH = 200;

/**
 * Coerce `value` to its message, then redact extension origins (ad-blocker
 * IDs are fingerprints) and URI-bearing substrings of any scheme — including
 * `data:`/`blob:`, which would otherwise leak and eat the length budget —
 * since chunk hashes and tokened URLs rotate cardinality and can carry
 * secrets. Empty messages fall back to `'unknown'`; the result is capped.
 *
 * `maxLength` (default 200) is applied after redaction so placeholders are
 * never split. Scheme-less hosts/paths are left alone — redacting them would
 * mangle ordinary prose with too many false positives.
 */
export function sanitizeErrorReason(value: unknown, maxLength = DEFAULT_MAX_LENGTH): string {
    const raw = value instanceof Error ? value.message : String(value);
    const redacted = raw
        // Extension origins first (most specific): must precede the generic
        // scheme rule below, which would otherwise swallow them as <url>.
        .replace(/[a-z-]*extension:\/\/\S+/gi, '<ext>')
        // `data:`/`blob:` have no `//`, so handle explicitly.
        .replace(/\bdata:\S+/gi, '<url>')
        .replace(/\bblob:\S+/gi, '<url>')
        .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
        .trim();
    const reason = redacted || 'unknown';
    return reason.length > maxLength ? reason.slice(0, maxLength) : reason;
}
