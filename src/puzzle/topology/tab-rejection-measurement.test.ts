/**
 * Gated measurement: traced-tab rejection rate at the user's real
 * Composable settings. Skipped unless MEASURE_TABS=1.
 *
 *   MEASURE_TABS=1 npx vitest run src/puzzle/topology/tab-rejection-measurement.test.ts
 *
 * Baseline (before the retry ladder): ~20.7% of internal edges flat,
 * all R4 crossings. Expect a substantial drop after the ladder lands.
 */

import { describe, it, expect } from 'vitest';
import { createSeededRandom } from '../seeded-random.js';
import { sineCutGenerator } from './sine-cut-generator.js';
import { buildDCEL } from './dcel.js';
import { applyTabs } from './apply-tabs.js';
import { preloadTracedTabGenerator } from './traced-tab-loader.js';
import { getTabGenerator } from './generator-registry.js';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const RUN = env.MEASURE_TABS === '1';

describe('traced-tab rejection measurement', () => {
    (RUN ? it : it.skip)('reports the flat-edge rate at the user settings', { timeout: 300_000 }, async () => {
        const cfg = { cols: 16, rows: 12, ha: 0.5, hf: 8, va: 0.5, vf: 6 };
        const frame = { width: 1600, height: 1200 };
        const SEEDS = 15;

        // Go through the SAME path the app uses: preload the lazy chunk,
        // then resolve the generator from the registry (the stub). This
        // exercises the registry/stub forwarding, so the number reflects
        // what players actually get — not a direct-import shortcut.
        await preloadTracedTabGenerator();
        const generator = getTabGenerator('traced');

        let total = 0;
        let accepted = 0;
        // Per-rung recovery: how many edges committed at each ladder rung
        // (0 = base, 1 = flip, 2 = shrink, 3 = shrink+center).
        const rungCommits = [0, 0, 0, 0];
        for (let s = 0; s < SEEDS; s++) {
            const random = createSeededRandom(s);
            const curves = sineCutGenerator.generate(frame, random, cfg);
            const graph = buildDCEL({ curves });
            applyTabs(graph, generator, random, {
                onCandidate: (_he, ok, idx) => {
                    total++;
                    if (ok) {
                        accepted++;
                        if (idx !== undefined && idx < rungCommits.length) rungCommits[idx]++;
                    }
                },
            });
        }
        const rejectPct = (100 * (total - accepted)) / total;
        const [base, flip, shrink, shrinkCenter] = rungCommits;
        // eslint-disable-next-line no-console
        console.log(`eligible=${total} accepted=${accepted} flat=${(total - accepted)} reject=${rejectPct.toFixed(1)}%`);
        // eslint-disable-next-line no-console
        console.log(`per-rung commits: base=${base} flip=${flip} shrink=${shrink} shrink+center=${shrinkCenter}`);
        expect(total).toBeGreaterThan(0);
        // MANUAL-ONLY guard: this whole test is it.skip in CI (runs only
        // with MEASURE_TABS=1), so this numeric assertion is NOT a CI gate.
        // CI's "the ladder is actually wired" guard is the non-gated
        // stub-forwarding test in traced-tab-loader.test.ts. When run here,
        // it goes through the real registry+preload path; pre-ladder this
        // regime sat at ~20.7%, with the ladder ~2%.
        expect(rejectPct).toBeLessThan(6);
    });
});
