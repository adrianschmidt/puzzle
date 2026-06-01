import { describe, it, expect } from 'vitest';
import {
    COMPRESSED_MARKER,
    compressForStorage,
    decompressFromStorage,
} from './compression.js';

describe('compression helper', () => {
    it('round-trips a JSON string', () => {
        const json = JSON.stringify({ a: 1, b: 'hello', c: [1, 2, 3] });
        const stored = compressForStorage(json);
        expect(decompressFromStorage(stored)).toBe(json);
    });

    it('tags compressed output with the marker', () => {
        const stored = compressForStorage('{"x":1}');
        expect(stored.startsWith(COMPRESSED_MARKER)).toBe(true);
    });

    it('shrinks large repetitive JSON', () => {
        const json = JSON.stringify(
            Array.from({ length: 2000 }, (_, i) => ({ path: 'C 1.234 5.678 9.0 1.2', id: i })),
        );
        const stored = compressForStorage(json);
        expect(stored.length).toBeLessThan(json.length / 2);
    });

    it('returns a marker-less (uncompressed) value unchanged', () => {
        const plain = '{"version":10,"pieces":[]}';
        expect(decompressFromStorage(plain)).toBe(plain);
    });

    it('the marker cannot collide with JSON.stringify output', () => {
        // JSON.stringify of an object always starts with "{".
        expect(COMPRESSED_MARKER.startsWith('{')).toBe(false);
        expect(JSON.stringify({}).startsWith(COMPRESSED_MARKER)).toBe(false);
    });

    it('decompresses a corrupt marked payload to a JSON-parse-failing value', () => {
        const result = decompressFromStorage(COMPRESSED_MARKER + 'not-valid-lz');
        expect(() => JSON.parse(result)).toThrow();
    });
});
