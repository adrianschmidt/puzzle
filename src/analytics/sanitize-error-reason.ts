/**
 * Shared sanitizer for turning an arbitrary thrown value into a
 * bounded, low-disclosure `reason` string suitable for analytics.
 *
 * Used by every code path that ships an error message to Umami (the
 * traced-chunk loader and the global unhandled-error handler), so the
 * redaction and length rules stay in one place.
 */

const DEFAULT_MAX_LENGTH = 200;

/**
 * Coerce `value` to its message, then:
 * - redact extension origins (ad-blocker IDs are fingerprints) and
 *   URI-bearing substrings of any scheme — `http(s)`, `ws(s)`, `file`,
 *   `ftp`, `blob:`, `data:` (a base64 `data:` URI would otherwise leak
 *   and consume the whole length budget) — since per-deploy chunk
 *   hashes and tokened URLs rotate cardinality and can carry secrets,
 * - fall back to `'unknown'` for empty messages,
 * - cap the length so a single property can't blow past Umami's limit.
 *
 * `maxLength` defaults to 200 and is applied after redaction so the
 * placeholders themselves are never split.
 *
 * Scheme-less hosts/paths are intentionally left alone — redacting them
 * would mangle ordinary error prose with too many false positives.
 */
export function sanitizeErrorReason(value: unknown, maxLength = DEFAULT_MAX_LENGTH): string {
    const raw = value instanceof Error ? value.message : String(value);
    const redacted = raw
        // Extension origins first (most specific) so they read as <ext>:
        // covers chrome-/moz-/safari-web-/ms-browser-extension and bare
        // `extension://`. Must precede the generic scheme rule below,
        // which would otherwise swallow them as <url>.
        .replace(/[a-z-]*extension:\/\/\S+/gi, '<ext>')
        // `data:`/`blob:` URIs (no `//`, handled explicitly).
        .replace(/\bdata:\S+/gi, '<url>')
        .replace(/\bblob:\S+/gi, '<url>')
        // Any other `scheme://…` (http, https, ws, wss, file, ftp, …).
        .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
        .trim();
    const reason = redacted || 'unknown';
    return reason.length > maxLength ? reason.slice(0, maxLength) : reason;
}
