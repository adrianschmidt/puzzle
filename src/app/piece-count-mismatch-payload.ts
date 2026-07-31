/**
 * Build the analytics payload attached to `piece-count-mismatch`.
 *
 * Derives from `buildReproParams` rather than reading `GameState` directly, so
 * the event and the info modal's "Reproduction parameters" block cannot drift
 * apart — a row in Umami is meant to paste straight into `__reproPuzzle`.
 *
 * Three deliberate divergences from what the modal prints, all documented on
 * `PieceCountMismatchData`:
 *
 * - `imageUrl` is dropped entirely.
 * - `seed` is normalized to a uint32, while the modal prints `state.seed`
 *   raw. Identical for every real seed and every legitimate share link; a
 *   crafted link carrying `s: -1` shows `-1` in the modal and `4294967295`
 *   here. Both replay the same puzzle (`createSeededRandom` applies ToInt32),
 *   so an operator cross-referencing a screenshot against a row should read
 *   them as the same puzzle, not two.
 * - `imageWidth`/`imageHeight` are rounded to Umami's 4-decimal precision
 *   (`toUmamiPrecision`), while the modal prints `state.imageSize` raw. The
 *   narrowest of the three: only Fractal's `inscribePuzzleSize` produces a
 *   fractional size, and Fractal is structurally exempt from this event
 *   (`PieceCountMismatchData.baseCut`) — the other four styles pass the image
 *   size through unchanged, and the decoder floors a crafted `is` to whole
 *   pixels. So the two agree on every row that can actually ship today; the
 *   rounding is here so the value tests assert is the value the column
 *   stores, rather than letting the tracker round it out of sight.
 */

import type { GameState } from '../model/types.js';
import type { PieceCountMismatchData } from '../analytics/index.js';
import type { PieceCountMismatch } from '../puzzle/topology/generator.js';
import { buildReproParams, isCutStyle, type ReproParams } from '../sharing/index.js';
import type { CutStyle } from '../game/cut-styles.js';

/**
 * Umami keeps 4 decimal places on numbers. Rounding here rather than letting
 * the tracker do it keeps the value we assert in tests identical to the value
 * that lands in the database.
 */
function toUmamiPrecision(value: number): number {
    return Math.round(value * 10000) / 10000;
}

/** Umami's event-data string-property limit; see `PieceCountMismatchData`. */
const UMAMI_STRING_LIMIT = 500;

/**
 * Which block each cut style's config lives in.
 *
 * A `Record<CutStyle, …>` rather than a `switch`, so a sixth cut style is a
 * COMPILE error here instead of falling into a default arm — the forcing
 * function `STRATEGIES` (`cut-style-strategies.ts`) and `CUT_STYLE_OPTIONS`
 * (`cut-styles.ts`, "a new cut style must declare … to compile") already use.
 * It matters more here than the exhaustiveness hole it closes suggests: an
 * unhandled style would silently emit no `styleConfig`, which is
 * indistinguishable from legacy Classic, whose absence is load-bearing.
 * `traceSetVersionOf` and `applyStyleConfigs` still switch on the style and
 * keep the hole; this is the idiom they should converge on, not a divergence.
 */
const STYLE_CONFIG_READERS: Record<CutStyle, (r: ReproParams) => object | undefined> = {
    classic: (r) => r.classicConfig,
    wavy: (r) => r.wavyConfig,
    triangles: (r) => r.trianglesConfig,
    fractal: (r) => r.fractalConfig,
    composable: (r) => r.composableConfig,
};

// `styleConfigOf` indexes the table with a runtime value, so drop the
// prototype: `STYLE_CONFIG_READERS['constructor']` is otherwise `Object`, and
// `Object(repro)` returns `repro` itself — `styleConfig` would become
// `JSON.stringify(repro)`, shipping `imageUrl`, the one field this event
// promises never to carry. Nothing reaches that today, because `isCutStyle`
// narrows with an own-key `hasOwnProperty` check first; the point is that the
// only thing standing between an inherited key and `imageUrl` egress is a
// predicate in another module, chosen for a different reason. This makes the
// table safe on its own terms.
Object.setPrototypeOf(STYLE_CONFIG_READERS, null);

/**
 * The per-style config block belonging to the puzzle's own cut style.
 *
 * Gated on `cutStyle` rather than picking whichever block happens to be
 * present, for the reason `traceSetVersionOf` and `applyStyleConfigs` both
 * give: `buildReproParams` copies every block the state carries, so a state
 * with a stray foreign block — a crafted share link, a hand-edited save —
 * would otherwise have another style's config attributed to it, producing a
 * row that reads as replayable and isn't. `createNewGame` already drops the
 * blocks that don't match the selected style, so on every state this codebase
 * produces the two readings agree; the gate keeps them agreeing structurally.
 *
 * Takes the resolved `cutStyle` as a parameter rather than re-deriving it from
 * `repro`, so the block reported and the `cutStyle` field labelling it are one
 * reading of the rule instead of two kept in step. Reading the config under a
 * stricter rule than the field would emit `cutStyle: 'classic'` with no
 * `styleConfig` for a state that has a live `classicConfig` — which the schema
 * defines as LEGACY Classic, a different generator. Unlike the `-1` sentinels,
 * such a row reads as valid and replayable while replaying the wrong puzzle.
 *
 * `ReproParams.cutStyle` is `string | undefined` — the object is also hand-
 * typed into a console from a screenshot — so the value is narrowed with the
 * same runtime predicate the share-link decoder uses before the table lookup.
 */
function styleConfigOf(repro: ReproParams, cutStyle: string): object | undefined {
    if (!isCutStyle(cutStyle)) return undefined;
    // `?.` is not dead code, despite the total `Record` type: the table above
    // is prototype-less and the index is a runtime value, so a lookup that
    // ever escaped `isCutStyle` yields `undefined` here rather than a
    // TypeError — which this builder must not raise, for the reason the
    // `tryStringify` note below gives.
    return STYLE_CONFIG_READERS[cutStyle]?.(repro);
}

export function buildPieceCountMismatchData(
    state: GameState,
    mismatch: PieceCountMismatch,
    source: PieceCountMismatchData['source'],
): PieceCountMismatchData {
    const repro = buildReproParams(state);
    // Resolved once and used for both the reported field and the config
    // lookup — see `styleConfigOf` for why those two must not diverge.
    // Unreachable today (`createNewGame` always sets `cutStyle`); sharing the
    // binding is what keeps it that way structurally rather than by comment.
    const cutStyle = repro.cutStyle ?? 'classic';
    const styleConfig = styleConfigOf(repro, cutStyle);

    // The `-1` fallbacks below are unreachable for a generated puzzle —
    // createNewGame always sets seed, gridSize and imageSize — but ReproParams
    // types every field optional because it is also hand-typed from a
    // screenshot. -1 rather than dropping the event: a diagnostic that
    // silently declines to report is worse than one carrying an obviously
    // impossible value, which is visible in the data as a bug in THIS code.
    //
    // `cutStyle` and `rotationMode` fall back to a real VALUE instead, which
    // is not an inconsistency: absence of either has a defined meaning
    // throughout this codebase — a state with no cut style is classic
    // (`save-coordinator.ts` reads it the same `?? 'classic'` way), one with
    // no rotation mode is 'none' — so the fallback restates what the state
    // means rather than inventing something. A missing seed, grid or image
    // size has no such reading, which is what the sentinel is for.
    const data: PieceCountMismatchData = {
        cutStyle,
        baseCut: mismatch.baseCutId,
        expected: mismatch.expected,
        actual: mismatch.actual,
        // `>>> 0` is a strict no-op on every seed this app produces
        // (`generateSeed` returns a uint32) and on every legitimate share
        // link. It matters for a crafted one: the decoder only checks
        // `typeof s === 'number'` (`isValidPayload` in `share-link.ts`), so
        // `1e30` or `0.5` can reach here, and Umami stores numeric event data
        // in a DECIMAL(19,4) column — an out-of-range value loses the whole
        // row and a fractional one is rounded into a seed that reads as
        // replayable and isn't. Normalizing doesn't change which puzzle the
        // value reproduces: `createSeededRandom` applies ToInt32 (`seed | 0`)
        // to whatever it is handed, and ToInt32(ToUint32(x)) === ToInt32(x).
        seed: repro.seed === undefined ? -1 : repro.seed >>> 0,
        cols: repro.gridSize?.cols ?? -1,
        rows: repro.gridSize?.rows ?? -1,
        imageWidth: toUmamiPrecision(repro.imageSize?.width ?? -1),
        imageHeight: toUmamiPrecision(repro.imageSize?.height ?? -1),
        rotationMode: repro.rotationMode ?? 'none',
        source,
    };

    if (styleConfig !== undefined) {
        // A crafted composable share link can carry an open-ended
        // baseCutConfig/tabConfig (src/model/types.ts, both typed
        // Record<string, unknown> with no size bound the decoder enforces),
        // so this can exceed Umami's string limit. Omit rather than
        // truncate: truncated JSON doesn't parse, so it would look
        // replayable and not be — see PieceCountMismatchData.
        //
        // The serialization is also the one operation in this builder that can
        // THROW: `JSON.stringify` rejects a circular structure or a BigInt and
        // overflows on a deeply-nested one, and a composable config reaches
        // here as an opaque Record<string, unknown>. No flow gets such a config
        // this far today — the save on the way to this event stringifies the
        // same object graph first and throws; `PieceCountMismatchData`'s
        // `styleConfig` doc carries that ordering argument in full, so it is
        // not restated here.
        //
        // The `try` is defense in depth against that ordering changing, and it
        // belongs HERE rather than at the two call sites: both fire the event
        // after the game is already installed and both sit inside the flow's
        // outer try, so an escape would surface as a false "Couldn't load
        // shared puzzle" toast plus a `shared-load-failed`/`new-game-failed`
        // event on a game that started fine. Handling it here also keeps the
        // failure informative — it lands in the same `styleConfigOmitted`
        // bucket a too-long config does, rather than losing the whole event.
        const serialized = tryStringify(styleConfig);
        if (serialized !== undefined && serialized.length <= UMAMI_STRING_LIMIT) {
            data.styleConfig = serialized;
        } else {
            data.styleConfigOmitted = true;
        }
    }

    return data;
}

/** `JSON.stringify`, or undefined when the value cannot be serialized. */
function tryStringify(value: object): string | undefined {
    try {
        return JSON.stringify(value);
    } catch {
        return undefined;
    }
}
