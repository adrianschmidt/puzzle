/**
 * localStorage compression helper.
 *
 * Wraps lz-string's UTF-16 codec and a marker prefix so the storage layer
 * can store a compressed payload and still recognise it on load. Compression
 * is used only as a fallback when an uncompressed write exceeds the quota
 * (see `writeWithOverflow` in storage.ts), so most saves never pass through here.
 */

import { compressToUTF16, decompressFromUTF16 } from 'lz-string';

/**
 * Prefix marking a stored value as lz-string-compressed.
 *
 * Begins with the U+0001 control character, which a `JSON.stringify` object
 * payload (always starting with `{`) can never begin with — so a stored blob
 * is classified unambiguously without a format/version flag.
 */
export const COMPRESSED_MARKER = '\x01LZ';

/** Compress a JSON string for localStorage, tagged with {@link COMPRESSED_MARKER}. */
export function compressForStorage(json: string): string {
    return COMPRESSED_MARKER + compressToUTF16(json);
}

/**
 * Reverse {@link compressForStorage}.
 *
 * A value without the marker is returned unchanged, so saves written before
 * compression existed (and normal-sized saves today) still load. A corrupt
 * compressed payload yields a string that fails downstream `JSON.parse`,
 * which the caller already treats as "no valid save".
 */
export function decompressFromStorage(raw: string): string {
    if (!raw.startsWith(COMPRESSED_MARKER)) {
        return raw;
    }
    return decompressFromUTF16(raw.slice(COMPRESSED_MARKER.length)) ?? '';
}
