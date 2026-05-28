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
 * - redact URLs (per-deploy chunk hashes rotate cardinality) and
 *   extension origins (ad-blocker IDs are fingerprints),
 * - fall back to `'unknown'` for empty messages,
 * - cap the length so a single property can't blow past Umami's limit.
 *
 * `maxLength` defaults to 200 and is applied after redaction so the
 * placeholders themselves are never split.
 */
export function sanitizeErrorReason(value: unknown, maxLength = DEFAULT_MAX_LENGTH): string {
    const raw = value instanceof Error ? value.message : String(value);
    const redacted = raw
        .replace(/https?:\/\/\S+/gi, '<url>')
        // Covers chrome-/moz-/safari-web-/ms-browser-extension and the
        // bare `extension://` form, so ad-blocker origins never ship.
        .replace(/[a-z-]*extension:\/\/\S+/gi, '<ext>')
        .trim();
    const reason = redacted || 'unknown';
    return reason.length > maxLength ? reason.slice(0, maxLength) : reason;
}
