/**
 * Recorder slot for traced-tab choices.
 *
 * Lives in its own tiny module so consumers that only need the
 * recorder hook (notably {@link TabDebugSession}) don't transitively
 * pull in the 80 KB of trace JSONs that `tab-shapes-traced.ts` owns.
 * `tab-shapes-traced.ts` imports {@link recordTracedTabChoice} from
 * here; {@link TabDebugSession} imports
 * {@link setTracedTabChoiceRecorder} from here. Neither side reaches
 * the other through static imports any more.
 */

/**
 * Per-call template + transform record. Captures everything needed to
 * reproduce the curve a single tracedTabTemplate.generate() invocation
 * produced. Consumed by the dev-time {@link TabDebugSession}.
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
 * Recorder slot — invoked once per `tracedTabTemplate.generate()` call
 * after the choices are made. Defaults to a no-op; tests and the
 * dev-time tab-debug session swap in a real recorder via
 * {@link setTracedTabChoiceRecorder}.
 *
 * Keeping it as a function (rather than a nullable, with an `if` guard)
 * lets V8 inline the no-op away in production builds — zero overhead
 * when the recorder hasn't been set.
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
