import { describe, it, expect } from 'vitest';
import {
    encodePayload,
    decodePayload,
    buildShareUrl,
    parseLocationHash,
    gameStateToPayload,
    hasShareableProgress,
    type SharePayload,
} from './share-link.js';
import type { GameState } from '../model/types.js';

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

function buildState(partial: Partial<GameState>): GameState {
    return {
        pieces: [],
        groups: [],
        imageUrl: 'blank',
        imageSize: { width: 1080, height: 720 },
        gridSize: { cols: 4, rows: 3 },
        completed: false,
        seed: 42,
        cutStyle: 'classic',
        rotationMode: 'none',
        ...partial,
    };
}

describe('gameStateToPayload', () => {
    it('maps a starting classic puzzle to a minimal payload', () => {
        const state = buildState({});
        const payload = gameStateToPayload(state, { includeProgress: false });
        expect(payload).toEqual({
            v: 1, i: 'blank', is: [1080, 720], g: [4, 3],
            c: 'classic', s: 42, r: 'none',
        });
    });

    it('includes attribution when present', () => {
        const state = buildState({
            attribution: {
                photographerName: 'Ada',
                photographerUrl: 'https://u',
                photoUrl: 'https://p',
            },
        });
        const payload = gameStateToPayload(state, { includeProgress: false });
        expect(payload.a).toEqual({ n: 'Ada', u: 'https://u', p: 'https://p' });
    });

    it('includes fractalConfig with rotation mode', () => {
        const state = buildState({
            cutStyle: 'fractal',
            rotationMode: 'quarter-turn',
            fractalConfig: { borderless: true },
        });
        const payload = gameStateToPayload(state, { includeProgress: false });
        expect(payload.c).toBe('fractal');
        expect(payload.r).toBe('quarter-turn');
        expect(payload.ff).toEqual({ bl: true });
    });

    it('includes composableConfig', () => {
        const state = buildState({
            cutStyle: 'composable',
            composableConfig: {
                horizontalAmplitude: 0.2, horizontalFrequency: 1,
                verticalAmplitude: 0.3, verticalFrequency: 2, disableTabs: false,
            },
        });
        const payload = gameStateToPayload(state, { includeProgress: false });
        expect(payload.cf).toEqual({ ha: 0.2, hf: 1, va: 0.3, vf: 2, dt: false });
    });

    it('omits progress when includeProgress is false', () => {
        const state = buildState({
            groups: [
                { id: 0, pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 100, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
                { id: 2, pieces: new Map([[2, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
            ],
        });
        const payload = gameStateToPayload(state, { includeProgress: false });
        expect(payload.pr).toBeUndefined();
    });

    it('captures merged-group piece IDs when includeProgress is true', () => {
        const state = buildState({
            groups: [
                { id: 0, pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 100, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
                { id: 2, pieces: new Map([[2, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
            ],
        });
        const payload = gameStateToPayload(state, { includeProgress: true });
        expect(payload.pr?.m).toEqual([[0, 1]]);
        expect(payload.pr?.mr).toBeUndefined();
        expect(payload.pr?.sr).toBeUndefined();
    });

    it('sorts merged groups deterministically by smallest piece ID', () => {
        const state = buildState({
            groups: [
                { id: 7, pieces: new Map([[5, { x: 0, y: 0 }], [6, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
                { id: 3, pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
                { id: 9, pieces: new Map([[2, { x: 0, y: 0 }], [3, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
            ],
        });
        const payload = gameStateToPayload(state, { includeProgress: true });
        expect(payload.pr?.m).toEqual([[0, 1], [2, 3], [5, 6]]);
    });

    it('mr parallels the sorted m array, not the original group order', () => {
        const state = buildState({
            rotationMode: 'quarter-turn',
            groups: [
                { id: 7, pieces: new Map([[5, { x: 0, y: 0 }], [6, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 3 },
                { id: 3, pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 1 },
            ],
        });
        const payload = gameStateToPayload(state, { includeProgress: true });
        expect(payload.pr?.m).toEqual([[0, 1], [5, 6]]);
        expect(payload.pr?.mr).toEqual([1, 3]);
    });

    it('fills composable defaults from generator when sub-fields are undefined', () => {
        const state = buildState({
            cutStyle: 'composable',
            composableConfig: {},
        });
        const payload = gameStateToPayload(state, { includeProgress: false });
        expect(payload.cf).toEqual({ ha: 0.15, hf: 1.5, va: 0.15, vf: 1.5, dt: true });
    });

    it('captures rotation fidelity in quarter-turn mode', () => {
        const state = buildState({
            rotationMode: 'quarter-turn',
            groups: [
                { id: 0, pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 100, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 2 },
                { id: 2, pieces: new Map([[2, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 1 },
                { id: 3, pieces: new Map([[3, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
            ],
        });
        const payload = gameStateToPayload(state, { includeProgress: true });
        expect(payload.pr?.m).toEqual([[0, 1]]);
        expect(payload.pr?.mr).toEqual([2]);
        // Solo rotations: only non-zero ones are encoded.
        expect(payload.pr?.sr).toEqual([2, 1]);
    });
});

describe('hasShareableProgress', () => {
    it('is false when the puzzle has no merged groups', () => {
        const state = buildState({
            groups: [
                { id: 0, pieces: new Map([[0, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
            ],
        });
        expect(hasShareableProgress(state)).toBe(false);
    });

    it('is false when the puzzle is complete', () => {
        const state = buildState({
            completed: true,
            groups: [
                { id: 0, pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
            ],
        });
        expect(hasShareableProgress(state)).toBe(false);
    });

    it('is true when there is at least one multi-piece group and the puzzle is in progress', () => {
        const state = buildState({
            groups: [
                { id: 0, pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
                { id: 2, pieces: new Map([[2, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
            ],
        });
        expect(hasShareableProgress(state)).toBe(true);
    });
});
