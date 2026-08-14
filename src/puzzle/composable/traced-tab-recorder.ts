/**
 * Its own tiny module so recorder-hook consumers (notably {@link TabDebugSession})
 * don't transitively pull in the ~80 KB of trace JSONs `tab-shapes-traced.ts`
 * owns. Each side imports only its half from here; neither reaches the other
 * through static imports.
 */

/**
 * Captures everything needed to reproduce the curve one
 * tracedTabTemplate.generate() call produced. Consumed by the dev-time
 * {@link TabDebugSession}.
 *
 * Caveat: params are recorded for the BASE rung of the traced retry ladder.
 * When a later rung (shrink, pull-to-center, sign-flip) is committed instead,
 * they describe the base tab, not the committed curve. The edge → piece and
 * `accepted` correlation is unaffected.
 */
export interface TracedTabChoice {
    templateIdx: number;
    templateId: string;
    flip: boolean;
    scalex: number;
    scaley: number;
    mid: number;
    neckScale: number;
}

/**
 * Recorder slot, invoked once per `tracedTabTemplate.generate()` after choices
 * are made. A no-op default (rather than nullable) keeps the call site
 * unconditional — no per-edge null check, and the optimizer can fold the empty
 * body out of the hot path when no recorder is attached.
 */
let tracedTabRecorder: (choice: TracedTabChoice) => void = () => {};

export function setTracedTabChoiceRecorder(
    fn: ((choice: TracedTabChoice) => void) | null,
): void {
    tracedTabRecorder = fn ?? (() => {});
}

export function recordTracedTabChoice(choice: TracedTabChoice): void {
    tracedTabRecorder(choice);
}
