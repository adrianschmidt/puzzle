/**
 * Share-link codec — encodes a puzzle (+ optional progress) into a
 * URL-safe base64 JSON payload and back.
 *
 * Used by the "Share this puzzle" section of the info modal and by
 * main.ts on boot to detect and load `#p=...` hash links.
 */

import type { GameState } from '../model/types.js';
import { normalizeDegrees } from '../model/helpers.js';
import type { ComposableConfig } from '../puzzle/composable-generator.js';
import {
    listBaseCutGeneratorIds,
    listTabGeneratorIds,
} from '../puzzle/topology/generator-registry.js';
import { clampGridDim } from '../puzzle/topology/grid-dim.js';
import { legacyDisableTabsToTabGenerator } from '../game/composable-config.js';
import { CURRENT_TRACE_SET_VERSION, normalizeTraceSetVersion } from '../puzzle/composable/traces/trace-set-version.js';

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
    c: 'classic' | 'fractal' | 'composable' | 'wavy' | 'triangles';
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
        /** Optional minPieceArea override; receiver uses this when present. */
        mpa?: number;
        /** Borderless mode; strips the outer ring of pieces when true. */
        bl?: boolean;
    };
    /** Fractal-cut config. */
    ff?: { bl: boolean };
    /** Wavy-cut config. `tv` = trace-set version (present ⇒ traced tabs; absent ⇒ classic). */
    wf?: { bl: boolean; tv?: number };
    /**
     * Triangles-cut config. `tv` pins the traced tab-library snapshot.
     * Unlike wavy's `wf.tv`, absence does NOT mean classic tabs — every
     * triangles puzzle uses traced tabs; a missing/invalid block just
     * falls back to the current trace set on the receiver.
     */
    tf?: { tv: number };
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
    if (payload.c === 'wavy' && payload.wf?.tv !== undefined) {
        check(payload.wf.tv, 'wf.tv');
    }
    if (payload.c === 'triangles' && payload.tf?.tv !== undefined) {
        check(payload.tf.tv, 'tf.tv');
    }
}

/**
 * Upper bound on a decoded image dimension (pixels). The app delivers
 * images at 1080px wide (height scaled by aspect ratio), so this cap
 * sits several times above any real image while bounding the canvas
 * allocation a crafted `is:[1e9, 1e9]` link would otherwise attempt — a
 * multi-gigapixel buffer that hangs the tab. 8192 is also a common
 * browser canvas-dimension ceiling, so legitimate sizes stay well under.
 */
const MAX_IMAGE_DIM = 8192;

/**
 * Upper bound on a decoded sine base-cut frequency (`hf`/`vf`). The
 * new-game dialog caps frequency at 10, so this sits an order of
 * magnitude above any UI-reachable value (mirroring how
 * {@link clampGridDim}'s ceiling keeps headroom over the UI grid cap) and
 * alters no real or dev-console puzzle.
 *
 * It bounds `generateSineCurve`'s segment allocation against a crafted
 * `cf.bgc.hf = 1e9` link. Per-curve segments grow linearly with
 * frequency (sine-cut-generator.ts: `ceil(frequency * segmentsPerWave)`,
 * `segmentsPerWave = 4`), and those segments feed an O(segments²)
 * curve-intersection path, so the worst case is quadratic in this cap.
 * If `segmentsPerWave` ever grows, re-evaluate the bound.
 */
const MAX_SINE_FREQUENCY = 100;

/**
 * Upper bound on a decoded sine base-cut amplitude (`ha`/`va`). The
 * new-game dialog caps amplitude at 0.5 (and the wavy cut style uses
 * exactly 0.5), so this clamps to the documented UI ceiling and alters no
 * real puzzle.
 *
 * Amplitude doesn't change the segment *count*, but it scales each
 * segment's perpendicular displacement, and thus its bounding box. The
 * O(segments²) intersection path (curve.ts: `Curve.intersect`) prunes
 * non-overlapping segment pairs via a bbox pre-filter (`bboxOverlap`); a
 * crafted huge amplitude inflates every segment's bbox enough to defeat
 * that pruning, re-inflating the intersection cost that the frequency cap
 * otherwise contains. Clamping amplitude to its legitimate range closes
 * that residual vector. Negative/zero amplitudes are safe (the generator
 * gates on `> 0` and falls back to a flat line), so only the upper bound
 * needs enforcing.
 */
const MAX_SINE_AMPLITUDE = 0.5;

/** Clamp a decoded dimension to a positive integer within `[1, max]`. */
function clampDim(n: number, max: number): number {
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(max, Math.floor(n)));
}

/**
 * Cap the sine base-cut frequencies (`hf`/`vf`) and amplitudes (`ha`/`va`)
 * on a decoded composable `bgc` to {@link MAX_SINE_FREQUENCY} /
 * {@link MAX_SINE_AMPLITUDE}. Only the `sine` generator reads these as
 * segment-driving / bbox-inflating knobs, so the clamp is gated on
 * `bg === 'sine'` and leaves every other generator's opaque config
 * untouched. A non-numeric value (e.g. a non-finite field that the JSON
 * round-trip turned into `null`) is skipped; the generator then falls back
 * to its own default. Mutates `bgc` in place.
 */
function clampSineConfig(cf: NonNullable<SharePayload['cf']>): void {
    if (cf.bg !== 'sine') return;
    const caps = { hf: MAX_SINE_FREQUENCY, vf: MAX_SINE_FREQUENCY, ha: MAX_SINE_AMPLITUDE, va: MAX_SINE_AMPLITUDE } as const;
    for (const key of ['hf', 'vf', 'ha', 'va'] as const) {
        const v = cf.bgc[key];
        if (typeof v === 'number') {
            cf.bgc[key] = Math.min(caps[key], v);
        }
    }
}

/**
 * Bound a decoded wavy trace-set version. A non-number or sub-1 value is
 * dropped (undefined ⇒ the puzzle reproduces with classic tabs, matching
 * pre-versioning links); a version newer than this client knows is clamped
 * down to the newest it can reproduce, so a forward-link still plays.
 */
function clampTraceSetVersion(tv: unknown): number | undefined {
    const v = normalizeTraceSetVersion(tv);
    return v === undefined ? undefined : Math.min(v, CURRENT_TRACE_SET_VERSION);
}

export function decodePayload(encoded: string): SharePayload | null {
    try {
        const json = base64UrlDecode(encoded);
        const parsed = JSON.parse(json) as unknown;
        const translated = translateLegacyComposable(parsed);
        if (!isValidPayload(translated)) return null;
        // Bound the grid before it reaches the generators (O(E²) crossing
        // check). Normal grids (<= the shared grid cap) pass through unchanged.
        translated.g = [clampGridDim(translated.g[0]), clampGridDim(translated.g[1])];
        // Bound the image size before it reaches the canvas allocation in
        // main.ts (`canvas.width/height`). Legitimate sizes (<= MAX_IMAGE_DIM)
        // pass through unchanged; a crafted `is:[1e9, 1e9]` is capped. Note that
        // a *fractional* `is` is not necessarily adversarial: fractal/wavy links
        // inscribe the image to the grid aspect (cut-style-strategies.ts), so a
        // dimension like 607.5 is a normal product of that path. The floor here
        // only snaps it sub-pixel, which is cosmetically irrelevant downstream.
        translated.is = [clampDim(translated.is[0], MAX_IMAGE_DIM), clampDim(translated.is[1], MAX_IMAGE_DIM)];
        // Bound the sine base-cut frequency and amplitude before they reach
        // generateSineCurve; see MAX_SINE_FREQUENCY / MAX_SINE_AMPLITUDE for the
        // DoS rationale. Legacy payloads were already rewritten to bg: 'sine'
        // above, so this covers them too.
        if (translated.c === 'composable' && translated.cf) {
            clampSineConfig(translated.cf);
        }
        if (translated.c === 'wavy' && translated.wf) {
            const clamped = clampTraceSetVersion(translated.wf.tv);
            if (clamped === undefined) {
                if (translated.wf.tv !== undefined) delete translated.wf.tv;
            } else {
                translated.wf.tv = clamped;
            }
        }
        if (translated.c === 'triangles' && translated.tf) {
            const clamped = clampTraceSetVersion(translated.tf.tv);
            // No legacy-classic fallback here (contrast wf.tv): an invalid tv
            // drops the whole block and the strategy substitutes the current
            // trace set.
            if (clamped === undefined) {
                delete translated.tf;
            } else {
                translated.tf.tv = clamped;
            }
        }
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
            tg: legacyDisableTabsToTabGenerator(cf.dt),
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
    if (p.c !== 'classic' && p.c !== 'fractal'
        && p.c !== 'composable' && p.c !== 'wavy' && p.c !== 'triangles') return false;
    if (typeof p.s !== 'number') return false;
    if (p.r !== 'none' && p.r !== 'quarter-turn' && p.r !== 'free') return false;
    if (p.c === 'composable' && p.cf !== undefined && !isValidComposableCf(p.cf)) return false;
    if (p.pr !== undefined && !isValidProgress(p.pr)) return false;
    return true;
}

// Lazy-cached id sets. The registries are populated at module-import
// time (see `generator-registry.ts`), so we only need to snapshot them
// on first lookup. O(1) `Set.has` thereafter beats the previous per-
// decode array allocation + linear `Array.includes`.
let knownBaseCutIds: Set<string> | null = null;
let knownTabIds: Set<string> | null = null;

function isKnownBaseCutId(id: string): boolean {
    if (!knownBaseCutIds) knownBaseCutIds = new Set(listBaseCutGeneratorIds());
    return knownBaseCutIds.has(id);
}

function isKnownTabId(id: string): boolean {
    if (!knownTabIds) knownTabIds = new Set(listTabGeneratorIds());
    return knownTabIds.has(id);
}

function isValidComposableCf(cf: unknown): boolean {
    if (!cf || typeof cf !== 'object') return false;
    const c = cf as Record<string, unknown>;
    if (typeof c.bg !== 'string') return false;
    if (!isKnownBaseCutId(c.bg)) return false;
    if (typeof c.bgc !== 'object' || c.bgc === null) return false;
    if (typeof c.tg !== 'string') return false;
    if (!isKnownTabId(c.tg)) return false;
    if (typeof c.tgc !== 'object' || c.tgc === null) return false;
    if (c.mpa !== undefined && typeof c.mpa !== 'number') return false;
    if (c.bl !== undefined && typeof c.bl !== 'boolean') return false;
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
            // normalizes them in free mode).
            if (i % 2 === 0) {
                if (!Number.isInteger(v)) return false;
            } else {
                if (typeof v !== 'number' || !Number.isFinite(v)) return false;
            }
        }
    }
    return true;
}

/**
 * Project a decoded share-link `cf` block onto the framework's
 * {@link ComposableConfig} shape. `decodePayload` already translates legacy
 * share-link payloads (v1 `ha`/`hf`/`va`/`vf`/`dt` fields) to the current
 * `bg`/`bgc`/`tg`/`tgc` shape on the way in, so this is a 1:1 rename plus
 * the optional `mpa` propagation that keeps auto-grouping behavior
 * consistent between sender and receiver.
 */
export function shareCfToComposableConfig(
    cf: NonNullable<SharePayload['cf']>,
): ComposableConfig {
    const config: ComposableConfig = {
        baseCutGenerator: cf.bg,
        baseCutConfig: cf.bgc,
        tabGenerator: cf.tg,
        tabConfig: cf.tgc,
    };
    if (cf.mpa !== undefined) config.minPieceArea = cf.mpa;
    if (cf.bl !== undefined) config.borderless = cf.bl;
    return config;
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
        if (c.borderless !== undefined) cf.bl = c.borderless;
        payload.cf = cf;
    }

    if (cutStyle === 'fractal' && state.fractalConfig) {
        payload.ff = { bl: state.fractalConfig.borderless ?? false };
    }

    if (cutStyle === 'wavy' && state.wavyConfig) {
        payload.wf = { bl: state.wavyConfig.borderless ?? false };
        if (state.wavyConfig.traceSetVersion !== undefined) {
            payload.wf.tv = state.wavyConfig.traceSetVersion;
        }
    }

    if (cutStyle === 'triangles' && state.trianglesConfig?.traceSetVersion !== undefined) {
        payload.tf = { tv: state.trianglesConfig.traceSetVersion };
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
        pr.mr = merged.map((g) => normalizeDegrees(Math.round(g.rotation)));
        const sr: number[] = [];
        for (const g of state.groups) {
            if (g.pieces.size !== 1) continue;
            if (g.rotation === 0) continue;
            const [pieceId] = g.pieces.keys();
            sr.push(pieceId, normalizeDegrees(Math.round(g.rotation)));
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
