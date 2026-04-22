/**
 * Share-link codec — encodes a puzzle (+ optional progress) into a
 * URL-safe base64 JSON payload and back.
 *
 * Used by the "Share this puzzle" section of the info modal and by
 * main.ts on boot to detect and load `#p=...` hash links.
 */

import type { GameState } from '../model/types.js';

export interface SharePayload {
    /** Schema version; bumped on breaking changes. */
    v: 1;
    /** Image URL, or the sentinel "blank" for the locally-regenerated white canvas. */
    i: string;
    /** Image size [width, height]. */
    is: [number, number];
    /** Optional attribution. */
    a?: { n: string; u: string; p: string };
    /** Grid size [cols, rows]. */
    g: [number, number];
    /** Cut style. */
    c: 'classic' | 'fractal' | 'composable';
    /** PRNG seed. */
    s: number;
    /** Rotation mode. */
    r: 'none' | 'quarter-turn';
    /** Composable-cut config. */
    cf?: { ha: number; hf: number; va: number; vf: number; dt: boolean };
    /** Fractal-cut config (rotationEnabled is implicit via `r`). */
    ff?: { bl: boolean };
    /** Optional progress snapshot. */
    pr?: {
        m: number[][];
        mr?: number[];
        sr?: number[];
    };
}

export function encodePayload(payload: SharePayload): string {
    assertPayloadNumbersFinite(payload);
    const json = JSON.stringify(payload);
    return base64UrlEncode(json);
}

function assertPayloadNumbersFinite(payload: SharePayload): void {
    const check = (n: number, label: string): void => {
        if (!Number.isFinite(n)) {
            throw new Error(`Share payload ${label} must be finite (got ${n})`);
        }
    };
    check(payload.is[0], 'is[0]'); check(payload.is[1], 'is[1]');
    check(payload.g[0], 'g[0]');   check(payload.g[1], 'g[1]');
    check(payload.s, 's');
    if (payload.cf) {
        check(payload.cf.ha, 'cf.ha'); check(payload.cf.hf, 'cf.hf');
        check(payload.cf.va, 'cf.va'); check(payload.cf.vf, 'cf.vf');
    }
}

export function decodePayload(encoded: string): SharePayload | null {
    try {
        const json = base64UrlDecode(encoded);
        const parsed = JSON.parse(json) as unknown;
        if (!isValidPayload(parsed)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function base64UrlEncode(text: string): string {
    // btoa handles Latin-1; round-trip via UTF-8 so non-ASCII survives.
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(encoded: string): string {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - (padded.length % 4)) % 4;
    const binary = atob(padded + '='.repeat(pad));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

function isValidPayload(x: unknown): x is SharePayload {
    if (!x || typeof x !== 'object') return false;
    const p = x as Record<string, unknown>;
    if (p.v !== 1) return false;
    if (typeof p.i !== 'string') return false;
    if (!isTuple2Number(p.is)) return false;
    if (!isTuple2Number(p.g)) return false;
    if (p.c !== 'classic' && p.c !== 'fractal' && p.c !== 'composable') return false;
    if (typeof p.s !== 'number') return false;
    if (p.r !== 'none' && p.r !== 'quarter-turn') return false;
    return true;
}

function isTuple2Number(x: unknown): x is [number, number] {
    return Array.isArray(x) && x.length === 2
        && typeof x[0] === 'number' && typeof x[1] === 'number';
}

export function buildShareUrl(baseUrl: string, payload: SharePayload): string {
    const withoutHash = baseUrl.split('#')[0];
    return `${withoutHash}#p=${encodePayload(payload)}`;
}

export function parseLocationHash(hash: string): SharePayload | null {
    if (!hash.startsWith('#p=')) return null;
    const body = hash.slice(3);
    if (!body) return null;
    return decodePayload(body);
}

export interface EncodeOptions {
    includeProgress: boolean;
}

export function gameStateToPayload(
    state: GameState,
    options: EncodeOptions,
): SharePayload {
    const cutStyle = (state.cutStyle ?? 'classic') as SharePayload['c'];
    const rotationMode = (state.rotationMode ?? 'none') as SharePayload['r'];

    const payload: SharePayload = {
        v: 1,
        i: state.imageUrl,
        is: [state.imageSize.width, state.imageSize.height],
        g: [state.gridSize.cols, state.gridSize.rows],
        c: cutStyle,
        s: state.seed ?? 0,
        r: rotationMode,
    };

    if (state.attribution) {
        payload.a = {
            n: state.attribution.photographerName,
            u: state.attribution.photographerUrl,
            p: state.attribution.photoUrl,
        };
    }

    if (cutStyle === 'composable' && state.composableConfig) {
        const c = state.composableConfig;
        payload.cf = {
            ha: c.horizontalAmplitude ?? 0,
            hf: c.horizontalFrequency ?? 0,
            va: c.verticalAmplitude ?? 0,
            vf: c.verticalFrequency ?? 0,
            dt: c.disableTabs ?? false,
        };
    }

    if (cutStyle === 'fractal' && state.fractalConfig) {
        payload.ff = { bl: state.fractalConfig.borderless ?? false };
    }

    if (options.includeProgress) {
        const progress = extractProgress(state);
        if (progress) payload.pr = progress;
    }

    return payload;
}

export function hasShareableProgress(state: GameState): boolean {
    if (state.completed) return false;
    return state.groups.some((g) => g.pieces.size >= 2);
}

function extractProgress(state: GameState): SharePayload['pr'] | null {
    const merged = state.groups.filter((g) => g.pieces.size >= 2);
    if (merged.length === 0) return null;

    const m = merged.map((g) => [...g.pieces.keys()].sort((a, b) => a - b));
    const pr: NonNullable<SharePayload['pr']> = { m };

    if (state.rotationMode === 'quarter-turn') {
        pr.mr = merged.map((g) => g.rotation);
        const sr: number[] = [];
        for (const g of state.groups) {
            if (g.pieces.size !== 1) continue;
            if (g.rotation === 0) continue;
            const [pieceId] = g.pieces.keys();
            sr.push(pieceId, g.rotation);
        }
        if (sr.length > 0) pr.sr = sr;
    }

    return pr;
}
