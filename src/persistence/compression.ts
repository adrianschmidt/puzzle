/** Fallback only: used when an uncompressed write exceeds quota (writeWithOverflow in storage.ts). */

import { compressToUTF16, decompressFromUTF16 } from 'lz-string';

/** U+0001 leading byte: a JSON.stringify object payload starts with `{`, so a stored blob is classified without a version flag. */
export const COMPRESSED_MARKER = '\x01LZ';

export function compressForStorage(json: string): string {
    return COMPRESSED_MARKER + compressToUTF16(json);
}

/**
 * Unmarked values pass through unchanged, so pre-compression and normal-sized
 * saves still load. A corrupt compressed payload yields a JSON.parse-failing
 * string, which the caller treats as "no valid save".
 */
export function decompressFromStorage(raw: string): string {
    if (!raw.startsWith(COMPRESSED_MARKER)) {
        return raw;
    }
    return decompressFromUTF16(raw.slice(COMPRESSED_MARKER.length)) ?? '';
}
