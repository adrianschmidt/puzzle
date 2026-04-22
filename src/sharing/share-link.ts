/**
 * Share-link codec — encodes a puzzle (+ optional progress) into a
 * URL-safe base64 JSON payload and back.
 *
 * Used by the "Share this puzzle" section of the info modal and by
 * main.ts on boot to detect and load `#p=...` hash links.
 */

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
