import { describe, it, expect } from 'vitest';
import {
    encodePayload,
    decodePayload,
    buildShareUrl,
    parseLocationHash,
    type SharePayload,
} from './share-link.js';

describe('share-link codec — minimal round-trip', () => {
    it('round-trips a minimal starting payload (no attribution, no progress)', () => {
        const payload: SharePayload = {
            v: 1,
            i: 'https://images.unsplash.com/photo-123?w=1080',
            is: [1080, 720],
            g: [8, 6],
            c: 'classic',
            s: 12345,
            r: 'none',
        };
        const encoded = encodePayload(payload);
        const decoded = decodePayload(encoded);
        expect(decoded).toEqual(payload);
    });

    it('produces a URL-safe base64 string (no "+", "/", "=")', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [1, 1], g: [2, 2], c: 'classic', s: 0, r: 'none',
        };
        const encoded = encodePayload(payload);
        expect(encoded).not.toMatch(/[+/=]/);
    });

    it('preserves the "blank" image sentinel verbatim', () => {
        const payload: SharePayload = {
            v: 1, i: 'blank', is: [1080, 720], g: [4, 3], c: 'classic', s: 7, r: 'none',
        };
        expect(decodePayload(encodePayload(payload))?.i).toBe('blank');
    });
});

describe('share-link codec — optional fields', () => {
    it('round-trips attribution', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [100, 100], g: [2, 2], c: 'classic', s: 1, r: 'none',
            a: { n: 'Ada', u: 'https://u', p: 'https://p' },
        };
        expect(decodePayload(encodePayload(payload))).toEqual(payload);
    });

    it('round-trips composable config', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [100, 100], g: [4, 3], c: 'composable', s: 1, r: 'none',
            cf: { ha: 0.2, hf: 1, va: 0.3, vf: 2, dt: false },
        };
        expect(decodePayload(encodePayload(payload))).toEqual(payload);
    });

    it('round-trips fractal config with rotation', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [100, 100], g: [8, 6], c: 'fractal', s: 1, r: 'quarter-turn',
            ff: { bl: true },
        };
        expect(decodePayload(encodePayload(payload))).toEqual(payload);
    });

    it('round-trips progress with merged groups only', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [100, 100], g: [3, 2], c: 'classic', s: 1, r: 'none',
            pr: { m: [[0, 1], [2, 3, 4]] },
        };
        expect(decodePayload(encodePayload(payload))).toEqual(payload);
    });

    it('round-trips progress with rotation fidelity', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [100, 100], g: [3, 2], c: 'fractal', s: 1, r: 'quarter-turn',
            ff: { bl: false },
            pr: { m: [[0, 1]], mr: [2], sr: [3, 1, 4, 3] },
        };
        expect(decodePayload(encodePayload(payload))).toEqual(payload);
    });
});

describe('share-link codec — rejection paths', () => {
    it('rejects unsupported schema version', () => {
        const bad = { v: 2, i: 'x', is: [1, 1], g: [2, 2], c: 'classic', s: 0, r: 'none' };
        const encoded = encodeRaw(bad);
        expect(decodePayload(encoded)).toBeNull();
    });

    it('rejects malformed base64', () => {
        expect(decodePayload('!!!not base64!!!')).toBeNull();
    });

    it('rejects JSON whose shape is wrong', () => {
        const encoded = encodeRaw({ hello: 'world' });
        expect(decodePayload(encoded)).toBeNull();
    });

    it('rejects invalid cut style', () => {
        const bad = { v: 1, i: 'x', is: [1, 1], g: [2, 2], c: 'bogus', s: 0, r: 'none' };
        expect(decodePayload(encodeRaw(bad))).toBeNull();
    });

    it('throws when tuple values are non-finite', () => {
        const bad: SharePayload = {
            v: 1, i: 'x', is: [NaN, 1], g: [2, 2], c: 'classic', s: 0, r: 'none',
        };
        expect(() => encodePayload(bad)).toThrow(/finite/i);
    });

    it('throws when seed is non-finite', () => {
        const bad: SharePayload = {
            v: 1, i: 'x', is: [1, 1], g: [2, 2], c: 'classic', s: Infinity, r: 'none',
        };
        expect(() => encodePayload(bad)).toThrow(/finite/i);
    });
});

describe('buildShareUrl', () => {
    it('appends "#p=<encoded>" to a bare URL', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [1, 1], g: [2, 2], c: 'classic', s: 0, r: 'none',
        };
        const url = buildShareUrl('https://example.com/puzzle/', payload);
        expect(url.startsWith('https://example.com/puzzle/#p=')).toBe(true);
    });

    it('strips an existing hash before appending', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [1, 1], g: [2, 2], c: 'classic', s: 0, r: 'none',
        };
        const url = buildShareUrl('https://example.com/puzzle/#stale', payload);
        expect(url.includes('#stale')).toBe(false);
        expect(url.includes('#p=')).toBe(true);
    });
});

describe('parseLocationHash', () => {
    it('returns null for empty hash', () => {
        expect(parseLocationHash('')).toBeNull();
    });

    it('returns null for unrelated hash', () => {
        expect(parseLocationHash('#section')).toBeNull();
    });

    it('returns the payload when the hash is a valid share link', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [1, 1], g: [2, 2], c: 'classic', s: 42, r: 'none',
        };
        const hash = '#p=' + encodePayload(payload);
        expect(parseLocationHash(hash)).toEqual(payload);
    });

    it('returns null for #p= with malformed body', () => {
        expect(parseLocationHash('#p=!!!')).toBeNull();
    });
});

// Helper that mirrors encodePayload without shape-validation, so we can
// craft malformed-but-well-encoded payloads for rejection tests.
function encodeRaw(obj: unknown): string {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
