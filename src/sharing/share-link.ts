/**
 * Share-link codec — encodes a puzzle (+ optional progress) into a
 * URL-safe base64 JSON payload and back.
 *
 * Used by the "Share this puzzle" section of the info modal and by
 * main.ts on boot to detect and load `#p=...` hash links.
 */

import type { GameState } from '../model/types.js';
import { normaliseDegrees } from '../model/helpers.js';

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
    r: 'none' | 'quarter-turn' | 'free';
    /** Composable cut config. */
    cf?: {
        /** BaseCutGenerator id. */
        bg: string;
        /** Generator-specific config (opaque). */
        bgc: Record<string, unknown>;
        /** TabGenerator id ('none' to disable tabs). */
        tg: string;
        /** Tab-generator-specific config (opaque). */
        tgc: Record<string, unknown>;
        /** Optional minPieceArea override (Plan 3 will use this). */
        mpa?: number;
    };
    /** Fractal-cut config. */
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
    if (payload.cf && payload.c === 'composable') {
        const bgc = (payload.cf.bgc ?? {}) as Record<string, unknown>;
        for (const key of Object.keys(bgc)) {
            const v = bgc[key];
            if (typeof v === 'number' && !Number.isFinite(v)) {
                throw new Error(`Share payload cf.bgc.${key} must be finite (got ${v})`);
            }
        }
    }
}

export function decodePayload(encoded: string): SharePayload | null {
    try {
        const json = base64UrlDecode(encoded);
        const parsed = JSON.parse(json) as unknown;
        const translated = translateLegacyComposable(parsed);
        if (!isValidPayload(translated)) return null;
        return translated;
    } catch {
        return null;
    }
}

/**
 * Translate a legacy composable cf shape (with ha/hf/va/vf/dt fields)
 * into the new shape (bg/bgc/tg/tgc) so the framework only ever sees
 * the new format.
 */
function translateLegacyComposable(parsed: unknown): unknown {
    if (!parsed || typeof parsed !== 'object') return parsed;
    const p = parsed as Record<string, unknown>;
    if (p.c !== 'composable') return parsed;
    if (!p.cf || typeof p.cf !== 'object') return parsed;

    const cf = p.cf as Record<string, unknown>;
    const isLegacy = ('ha' in cf || 'hf' in cf || 'va' in cf || 'vf' in cf || 'dt' in cf)
                  && !('bg' in cf);
    if (!isLegacy) return parsed;

    return {
        ...p,
        cf: {
            bg: 'sine',
            bgc: { ha: cf.ha, hf: cf.hf, va: cf.va, vf: cf.vf },
            tg: cf.dt === true ? 'none' : 'classic',
            tgc: {},
        },
    };
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
    if (p.r !== 'none' && p.r !== 'quarter-turn' && p.r !== 'free') return false;
    if (p.c === 'composable' && p.cf !== undefined && !isValidComposableCf(p.cf)) return false;
    if (p.pr !== undefined && !isValidProgress(p.pr)) return false;
    return true;
}

function isValidComposableCf(cf: unknown): boolean {
    if (!cf || typeof cf !== 'object') return false;
    const c = cf as Record<string, unknown>;
    if (typeof c.bg !== 'string') return false;
    if (typeof c.bgc !== 'object' || c.bgc === null) return false;
    if (typeof c.tg !== 'string') return false;
    if (typeof c.tgc !== 'object' || c.tgc === null) return false;
    if (c.mpa !== undefined && typeof c.mpa !== 'number') return false;
    return true;
}

function isTuple2Number(x: unknown): x is [number, number] {
    return Array.isArray(x) && x.length === 2
        && typeof x[0] === 'number' && typeof x[1] === 'number';
}

/**
 * A crafted link that satisfies the schema but feeds non-numeric or
 * out-of-range data through `applyProgress` would crash with a
 * `TypeError` (or write garbage into `group.rotation`). Reject obviously
 * malformed shapes here before they reach the game state.
 */
function isValidProgress(x: unknown): boolean {
    if (!x || typeof x !== 'object') return false;
    const pr = x as Record<string, unknown>;
    if (!Array.isArray(pr.m)) return false;
    for (const inner of pr.m) {
        if (!Array.isArray(inner)) return false;
        for (const id of inner) {
            if (!Number.isInteger(id)) return false;
        }
    }
    if (pr.mr !== undefined) {
        if (!Array.isArray(pr.mr)) return false;
        for (const v of pr.mr) {
            if (typeof v !== 'number' || !Number.isFinite(v)) return false;
        }
    }
    if (pr.sr !== undefined) {
        if (!Array.isArray(pr.sr)) return false;
        if (pr.sr.length % 2 !== 0) return false;
        for (let i = 0; i < pr.sr.length; i++) {
            const v = pr.sr[i];
            // Even indices are piece IDs (must be integers); odd indices
            // are rotation values (any finite number — applyProgress
            // normalises them in free mode).
            if (i % 2 === 0) {
                if (!Number.isInteger(v)) return false;
            } else {
                if (typeof v !== 'number' || !Number.isFinite(v)) return false;
            }
        }
    }
    return true;
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
        // Write the opaque generator/config shape directly to the wire.
        // Defaults: sine base-cut generator and classic tab generator
        // (matching src/puzzle/topology/generator.ts) so recipients reproduce
        // the same cuts when the sender omitted sub-fields.
        const c = state.composableConfig;
        const cf: NonNullable<SharePayload['cf']> = {
            bg: c.baseCutGenerator ?? 'sine',
            bgc: (c.baseCutConfig ?? {}) as Record<string, unknown>,
            tg: c.tabGenerator ?? 'classic',
            tgc: (c.tabConfig ?? {}) as Record<string, unknown>,
        };
        // Only emit `mpa` when the sender explicitly set it; recipients
        // fall back to the generator's own default when it's absent.
        if (c.minPieceArea !== undefined) {
            cf.mpa = c.minPieceArea;
        }
        payload.cf = cf;
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
    // Sort groups by smallest piece ID so the encoded output is deterministic
    // regardless of the order groups were created in `state.groups`.
    const merged = state.groups
        .filter((g) => g.pieces.size >= 2)
        .sort((a, b) => smallestPieceId(a) - smallestPieceId(b));
    if (merged.length === 0) return null;

    const m = merged.map((g) => [...g.pieces.keys()].sort((a, b) => a - b));
    const pr: NonNullable<SharePayload['pr']> = { m };

    if (state.rotationMode === 'quarter-turn') {
        // Wire format for v: 1 share links is quarter-turn integers 0..3,
        // matching what existing shared URLs in the wild encode. The internal
        // representation switched to degrees in the rotation-as-degrees
        // refactor, so we divide by 90 here.
        pr.mr = merged.map((g) => Math.round(g.rotation / 90));
        const sr: number[] = [];
        for (const g of state.groups) {
            if (g.pieces.size !== 1) continue;
            if (g.rotation === 0) continue;
            const [pieceId] = g.pieces.keys();
            sr.push(pieceId, Math.round(g.rotation / 90));
        }
        if (sr.length > 0) pr.sr = sr;
    } else if (state.rotationMode === 'free') {
        // Free mode encodes integer degrees 0..359 directly. Solo pieces are
        // virtually always at non-zero rotation, so the sparse `sr` encoding
        // becomes effectively dense; keep the format for consistency with v: 1.
        // The explicit % 360 guards against float arithmetic leaving g.rotation
        // just outside [0, 360) — e.g. 359.6 → round → 360 → % 360 → 0.
        pr.mr = merged.map((g) => normaliseDegrees(Math.round(g.rotation)));
        const sr: number[] = [];
        for (const g of state.groups) {
            if (g.pieces.size !== 1) continue;
            if (g.rotation === 0) continue;
            const [pieceId] = g.pieces.keys();
            sr.push(pieceId, normaliseDegrees(Math.round(g.rotation)));
        }
        if (sr.length > 0) pr.sr = sr;
    }

    return pr;
}

function smallestPieceId(group: { pieces: Map<number, unknown> }): number {
    let min = Infinity;
    for (const id of group.pieces.keys()) {
        if (id < min) min = id;
    }
    return min;
}
