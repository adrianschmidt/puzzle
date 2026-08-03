/**
 * Share-link codec — encodes a puzzle (+ optional progress) into a
 * URL-safe base64 JSON payload and back.
 *
 * Used by the "Share this puzzle" section of the info modal and by
 * app/share-link-loader.ts, on boot and on an in-tab hash change, to
 * detect and load `#p=...` hash links.
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
import { isSafeHttpUrl, isSafeImageUrl } from './safe-url.js';

export interface SharePayload {
    /** Schema version; bumped on breaking changes. */
    v: 1;
    /**
     * Image URL, or the sentinel "blank" for the locally-regenerated white
     * canvas. See {@link collapseBlankImageUrl} for which producers map a
     * painted-canvas `data:` URL onto the sentinel and which don't.
     */
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
    /**
     * Sharer's background color (palette swatch id). Optional and
     * additive — old links lack it, old clients ignore it. The receiver
     * adopts it only when it has no color preference of its own.
     */
    bgc?: string;
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
    /**
     * Classic-cut config. `tv` = trace-set version. Its PRESENCE selects the
     * sine-based Classic generator; ABSENCE (every pre-upgrade link) selects
     * the legacy generateProceduralPuzzle. On decode an invalid `tv` drops the
     * block (as it does for triangles' `tf`), but here that fallback lands on
     * the legacy generator, whereas a dropped `tf` still reproduces via the
     * composable pipeline at the current trace set.
     */
    clf?: { tv: number };
    /** Optional progress snapshot. */
    pr?: {
        m: number[][];
        mr?: number[];
        sr?: number[];
    };
}

/**
 * The cut styles and rotation modes the wire format accepts, as own-key
 * sets. Declared as total `Record`s over the `SharePayload` unions, so a
 * sixth cut style (or a fourth rotation mode) fails to compile here instead
 * of being silently rejected at decode.
 *
 * Membership is tested with `hasOwnProperty` rather than `in` or a bare
 * lookup: `'toString'` is a truthy *inherited* member of any object literal,
 * so the cheaper checks would accept it as a cut style.
 */
const CUT_STYLES: Record<SharePayload['c'], true> = {
    classic: true,
    fractal: true,
    composable: true,
    wavy: true,
    triangles: true,
};

const ROTATION_MODES: Record<SharePayload['r'], true> = {
    none: true,
    'quarter-turn': true,
    free: true,
};

/**
 * Both predicates take `unknown`, not `string`: every caller passes a value
 * that is only *typed* as a string — a `JSON.parse`d payload field, or a
 * console object hand-typed from a screenshot — so the runtime type check
 * belongs inside, once, rather than at each call site. It is load-bearing:
 * `hasOwnProperty` coerces its key, so `['classic']` or a `{ toString() }`
 * object would otherwise pass membership and then read as an unknown style
 * everywhere downstream, where every comparison is against a string literal.
 */
export function isCutStyle(value: unknown): value is SharePayload['c'] {
    return typeof value === 'string'
        && Object.prototype.hasOwnProperty.call(CUT_STYLES, value);
}

export function isRotationMode(value: unknown): value is SharePayload['r'] {
    return typeof value === 'string'
        && Object.prototype.hasOwnProperty.call(ROTATION_MODES, value);
}

/**
 * Collapse a `GameState.imageUrl` onto the `'blank'` sentinel that the wire's
 * `i` field defines. Its caller writes the result to `ReproParams.imageUrl` —
 * a field the info modal prints — which reaches `i` only via
 * `reproParamsToPayload`'s `params.imageUrl ?? 'blank'`.
 *
 * A blank-canvas puzzle keeps the *painted canvas* in `state.imageUrl` — a
 * multi-KB base64 `data:` PNG from `canvas.toDataURL` — and those are the
 * only `data:`/`blob:` image URLs the app produces. `'blank'` says the same
 * thing in five characters and replays identically, because the load path
 * repaints the canvas from `is`. Sniffing the prefix is the workaround for
 * `GameState` carrying no "this is the blank canvas" flag (#496).
 *
 * `gameStateToPayload` deliberately does NOT call this. Doing so would
 * change the payload a blank puzzle's share link emits, which is a
 * wire-format change on the share path rather than the debug-surface
 * cleanup this is; the decoder has always accepted both forms, so the
 * divergence breaks nothing. Converging the two producers is a separate,
 * deliberate change.
 */
export function collapseBlankImageUrl(imageUrl: string): string {
    return imageUrl.startsWith('data:') ? 'blank' : imageUrl;
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
    if (payload.c === 'classic' && payload.clf?.tv !== undefined) {
        check(payload.clf.tv, 'clf.tv');
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
        // app/blank-canvas.ts (`canvas.width/height`). Legitimate sizes (<= MAX_IMAGE_DIM)
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
        // Both blocks are normalized whatever `c` says, matching the ungated
        // shape check in `isValidTraceSetBlock`. Gating these on the cut style
        // (as the `wf` branch above still does, and as these two did) leaves a
        // foreign block un-normalized: `{ c: 'classic', tf: { tv: 'x' } }`
        // passes the shape check, skips a triangles-gated clamp, and decodes to
        // a `SharePayload` whose `tf` contradicts its declared `{ tv: number }`
        // — the type-honesty gap #491 exists to close, moved rather than shut.
        // Nothing downstream reads a foreign block (`assembleGameState` drops
        // blocks that don't match the selected style), so this costs nothing
        // today; it means a future `payload.tf.tv` reader gets a number or
        // nothing, for all five cut styles.
        if (translated.tf) {
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
        if (translated.clf) {
            const clamped = clampTraceSetVersion(translated.clf.tv);
            // An invalid tv drops the block, so the puzzle reproduces with the
            // legacy generator (contrast triangles, which keeps the composable
            // pipeline and substitutes the current trace set).
            if (clamped === undefined) {
                delete translated.clf;
            } else {
                translated.clf.tv = clamped;
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
    if (!isCutStyle(p.c)) return false;
    if (typeof p.s !== 'number') return false;
    if (!isRotationMode(p.r)) return false;
    // After the cheap field checks: `i` is the one unbounded field on the wire
    // (a blank puzzle's canvas PNG is 6-20 KB, a crafted one is capped only by
    // the URL length limit), and parsing it is the most expensive check here.
    // No reason to pay that for a payload a 3-byte `c` would have rejected.
    if (!isSafeImageUrl(p.i)) return false;
    if (p.c === 'composable' && p.cf !== undefined && !isValidComposableCf(p.cf)) return false;
    if (p.ff !== undefined && !isValidBorderlessBlock(p.ff)) return false;
    if (p.wf !== undefined && !isValidBorderlessBlock(p.wf)) return false;
    if (p.tf !== undefined && !isValidTraceSetBlock(p.tf)) return false;
    if (p.clf !== undefined && !isValidTraceSetBlock(p.clf)) return false;
    if (p.pr !== undefined && !isValidProgress(p.pr)) return false;
    if (p.bgc !== undefined && typeof p.bgc !== 'string') return false;
    if (p.a !== undefined && !isValidAttribution(p.a)) return false;
    return true;
}

/**
 * Validate the fractal (`ff`) and wavy (`wf`) config blocks, whose only
 * shared field is the borderless flag.
 *
 * `bl` is typed `boolean` but reached `GameState` unchecked:
 * `shareInitOptions` copies it straight into `fractalConfig`/`wavyConfig`,
 * and from there it is printed in the info modal's repro block, re-emitted
 * on a re-share, and serialized into the `piece-count-mismatch` event's
 * `styleConfig`. What an arbitrary string parked there did to generation
 * differed by style, and neither answer was good: wavy funnels into
 * `generator.ts`'s strict `borderless === true`, so the value rode along
 * inertly while the puzzle looked entirely normal; fractal ran its own
 * pipeline and read the flag for truthiness at every hop, so `'yes'`
 * generated a genuinely BORDERLESS puzzle that a re-share then described as
 * bordered. Fractal now coerces with `=== true` too (`fractal/index.ts`,
 * `game/cut-style-strategies.ts`), which makes "non-`true` means off" a
 * property of the generators rather than a claim about them — but the
 * cheapest place to stop the value is still here, before it enters state.
 * `isValidComposableCf` has always type-checked composable's equivalent
 * `cf.bl`; this closes the same hole for the other two styles.
 *
 * Rejecting the whole payload matches how the codec handles every other
 * malformed optional block (`cf`, `pr`, `bgc`, `a`), and rejects nothing
 * this app has ever emitted: both producers go through `applyStyleConfigs`,
 * which has written a boolean `bl` since either block existed (`?? false`
 * historically, `=== true` now — see the note there for why the difference
 * matters on a state restored from an older build's save).
 *
 * `bl` is REQUIRED here, unlike the optional-but-typed `cf.bl` in
 * `isValidComposableCf`. Both forms reject the same values, so the
 * difference is only that this one makes "always emit `bl`" part of the wire
 * contract: a later producer-side change that dropped a `false` `bl` to
 * shorten links would be rejected outright by every client already shipped
 * with this decoder. Loosen this to the optional form in the same change if
 * that is ever worth doing — see the note at the `ff`/`wf` branches of
 * `applyStyleConfigs`.
 *
 * `wf.tv` is deliberately NOT checked here. `decodePayload` clamps it, and
 * an unusable one falls back to classic tabs rather than losing the link —
 * see the wavy branch there.
 *
 * Applied to EVERY cut style, unlike the `cf` check one line up, which is
 * gated on `p.c === 'composable'`. So `{ c: 'classic', wf: { bl: 'yes' } }` is
 * rejected even though nothing would read that `wf`. Deliberate: no producer
 * emits a foreign block (`applyStyleConfigs` writes only the one matching
 * `payload.c`), so the gate would buy nothing, and the ungated form keeps the
 * decode-time guarantee unconditional — a later reader that started consulting
 * `wf` for another style would inherit the check rather than need one added.
 */
function isValidBorderlessBlock(x: unknown): boolean {
    if (!x || typeof x !== 'object') return false;
    return typeof (x as Record<string, unknown>).bl === 'boolean';
}

/**
 * Validate the triangles (`tf`) and classic (`clf`) config blocks, whose only
 * field is the trace-set version.
 *
 * Shape only — `tv` is deliberately NOT checked here, exactly as `wf.tv` isn't
 * one function up. `decodePayload` clamps it through `clampTraceSetVersion`,
 * and an unusable value drops the block and falls back rather than losing the
 * whole link. Type-checking `tv` here would upgrade that graceful fallback into
 * an outright rejection, which is a worse outcome for a link whose only fault
 * is a trace set this build doesn't have.
 *
 * What the object check buys is the case the clamp cannot reach: the clamp
 * blocks are guarded on plain truthiness (`translated.clf && ...`), so before
 * this existed a *falsy* non-object — `clf: null`, `clf: 0` — skipped the clamp
 * entirely and survived decode. `decodePayload` then returned a `SharePayload`
 * whose `clf` was `null` while its declared type said `{ tv: number }`, one
 * `payload.clf.tv` away from a throw on a crafted link (#491). A truthy
 * non-object was always handled: it reached the clamp, `.tv` read `undefined`,
 * and the block was deleted.
 *
 * Ungated by `p.c` like {@link isValidBorderlessBlock}, but note the two are
 * not equivalent: that sibling fully enforces its declared shape (`bl` must be
 * a boolean) for every style, whereas leaving `tv` to the clamp means this one
 * cannot. `decodePayload` closes the difference from the other end by running
 * both clamps ungated too, so a block that survives validation is always
 * normalized or dropped whatever `c` says.
 */
function isValidTraceSetBlock(x: unknown): boolean {
    return !!x && typeof x === 'object';
}

/**
 * Validate the optional attribution block. The URLs flow into an anchor
 * `href` (see `createAttributionElement`), so a crafted link could
 * otherwise carry a `javascript:`-scheme URL that executes on click.
 * Require the shape `{ n, u, p }` with `u`/`p` restricted to absolute
 * http(s) URLs; every legitimate (Unsplash) link already satisfies this,
 * so this rejects only links that were already dangerous. Rejecting the
 * whole payload matches the codec's all-or-nothing handling of other
 * malformed optional fields (`bgc`, `pr`).
 */
function isValidAttribution(a: unknown): boolean {
    if (!a || typeof a !== 'object') return false;
    const o = a as Record<string, unknown>;
    if (typeof o.n !== 'string') return false;
    if (typeof o.u !== 'string' || !isSafeHttpUrl(o.u)) return false;
    if (typeof o.p !== 'string' || !isSafeHttpUrl(o.p)) return false;
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
    /** When set, written to `bgc` so the link carries the sharer's background. */
    backgroundColorId?: string;
}

/**
 * The five per-style config fields a repro-params object shares with
 * GameState. `applyStyleConfigs` reads whichever one matches the
 * payload's cut style; the rest are ignored.
 */
export interface StyleConfigSource {
    composableConfig?: GameState['composableConfig'];
    fractalConfig?: GameState['fractalConfig'];
    wavyConfig?: GameState['wavyConfig'];
    trianglesConfig?: GameState['trianglesConfig'];
    classicConfig?: GameState['classicConfig'];
}

/**
 * Copy the config block matching `payload.c` from `source` onto the
 * payload. Shared between `gameStateToPayload` (share links) and
 * `reproParamsToPayload` (the `__reproPuzzle` console helper) so the
 * style-block wire mapping exists once.
 *
 * Precondition: `payload.c` must already hold its final value. Reading
 * the cut style off the payload rather than off `source` is deliberate —
 * it cannot disagree with the `c` that actually ships — but it means a
 * caller that assembles the payload incrementally and calls this before
 * assigning `c` gets a silent no-op, not a type error. Both current
 * callers pass a fully-initialized object literal.
 */
export function applyStyleConfigs(payload: SharePayload, source: StyleConfigSource): void {
    if (payload.c === 'composable' && source.composableConfig) {
        // Write the opaque generator/config shape directly to the wire.
        // Defaults: sine base-cut generator and classic tab generator
        // (matching src/puzzle/topology/generator.ts) so recipients reproduce
        // the same cuts when the sender omitted sub-fields.
        const c = source.composableConfig;
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
        if (c.borderless !== undefined) cf.bl = c.borderless === true;
        payload.cf = cf;
    }

    // `bl` is written unconditionally on both blocks, including when it is
    // `false`. That is load-bearing, not verbosity: `isValidBorderlessBlock`
    // requires it, so omitting it to shorten links would make new links
    // undecodable by every already-shipped client. Loosen that validator
    // first if this ever changes.
    //
    // `=== true` rather than `?? false`, on all three blocks, so the encoder
    // can never emit a link its own decoder refuses. `borderless` is typed
    // `boolean | undefined`, so for anything this app builds the two are the
    // same expression — but a state restored from a save written by a PRE-
    // tightening build can carry a crafted `bl: 'yes'` verbatim
    // (`share-payload-to-init.ts` copies it into `wavyConfig`/`fractalConfig`,
    // `serialization.ts` round-trips the block as-is), and `?? false` would
    // pass that straight back onto the wire for the new `isValidBorderlessBlock`
    // to reject — a share link broken with no signal to the sharer. Coercing
    // also keeps the link faithful to what it REPRODUCES: `false` is what such
    // a state now generates, because every generator entry point coerces the
    // flag the same `=== true` way (`generator.ts` for wavy and composable,
    // `fractal/index.ts` and `game/cut-style-strategies.ts` for fractal, which
    // does not go through it). Not to what the sharer is looking at — a
    // restored save rebuilds its pieces from the stored blob instead of
    // regenerating, so a puzzle an older build cut borderless stays borderless
    // on screen while its link says bordered. That mismatch is the old build's
    // and needs a crafted `bl` — a hand-edited link or a hand-typed
    // `__reproPuzzle` param, neither of which the old build validated — to
    // exist at all; what this coercion owns is that encode and generate never
    // disagree going forward. Those two readings are kept deliberately in
    // step; loosening either end would make a link describe a puzzle that
    // isn't the one it reproduces.
    if (payload.c === 'fractal' && source.fractalConfig) {
        payload.ff = { bl: source.fractalConfig.borderless === true };
    }

    if (payload.c === 'wavy' && source.wavyConfig) {
        payload.wf = { bl: source.wavyConfig.borderless === true };
        if (source.wavyConfig.traceSetVersion !== undefined) {
            payload.wf.tv = source.wavyConfig.traceSetVersion;
        }
    }

    if (payload.c === 'triangles' && source.trianglesConfig?.traceSetVersion !== undefined) {
        payload.tf = { tv: source.trianglesConfig.traceSetVersion };
    }

    if (payload.c === 'classic' && source.classicConfig?.traceSetVersion !== undefined) {
        payload.clf = { tv: source.classicConfig.traceSetVersion };
    }
}

export function gameStateToPayload(
    state: GameState,
    options: EncodeOptions,
): SharePayload {
    const cutStyle = (state.cutStyle ?? 'classic') as SharePayload['c'];
    const rotationMode = (state.rotationMode ?? 'none') as SharePayload['r'];

    const payload: SharePayload = {
        v: 1,
        i: state.imageUrl ?? 'blank',
        is: [state.imageSize.width, state.imageSize.height],
        g: [state.gridSize.cols, state.gridSize.rows],
        c: cutStyle,
        s: state.seed ?? 0,
        r: rotationMode,
    };

    if (options.backgroundColorId !== undefined) {
        payload.bgc = options.backgroundColorId;
    }

    if (state.attribution) {
        payload.a = {
            n: state.attribution.photographerName,
            u: state.attribution.photographerUrl,
            p: state.attribution.photoUrl,
        };
    }

    applyStyleConfigs(payload, state);

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
