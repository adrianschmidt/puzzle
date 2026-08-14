/**
 * Gated measurement: traced-tab rejection rate at the user's real Composable
 * settings. Skipped unless MEASURE_TABS=1:
 *
 *   MEASURE_TABS=1 npx vitest run src/puzzle/topology/tab-rejection-measurement.test.ts
 *
 * Baseline before the retry ladder: ~20.7% of internal edges flat (all R4
 * crossings); with the ladder ~2%.
 */

import { describe, it, expect } from 'vitest';
import { createSeededRandom } from '../seeded-random.js';
import { sineCutGenerator } from './sine-cut-generator.js';
import { triangularCutGenerator } from './triangular-cut-generator.js';
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

        // SAME path the app uses: preload the lazy chunk, then resolve from the
        // registry (the stub). Exercises the stub forwarding, so the number
        // reflects what players get, not a direct-import shortcut.
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
        console.log(`eligible=${total} accepted=${accepted} flat=${(total - accepted)} reject=${rejectPct.toFixed(1)}%`);
        console.log(`per-rung commits: base=${base} flip=${flip} shrink=${shrink} shrink+center=${shrinkCenter}`);
        expect(total).toBeGreaterThan(0);
        // MANUAL-ONLY: it.skip in CI (needs MEASURE_TABS=1), so this numeric
        // assertion is NOT a CI gate — the "ladder is wired" gate is the
        // stub-forwarding test in traced-tab-loader.test.ts. Pre-ladder ~20.7%,
        // with the ladder ~2%.
        expect(rejectPct).toBeLessThan(6);
    });

    (RUN ? it : it.skip)('reports the triangular flat-edge rate with the deep ladder', { timeout: 300_000 }, async () => {
        const frame = { width: 1600, height: 1200 };
        const SEEDS = 15;
        await preloadTracedTabGenerator();
        const generator = getTabGenerator('traced');

        let total = 0;
        let accepted = 0;
        // Deep ladder has 10 rungs (see deepRungs in traced-tab-generator.ts):
        // scale x invert for 1.0/0.8/0.64/0.512, then 0.512 center upright/invert.
        const rungCommits = Array.from({ length: 10 }, () => 0);
        for (let s = 0; s < SEEDS; s++) {
            const random = createSeededRandom(s);
            const curves = triangularCutGenerator.generate(frame, random, {
                cols: 16,
                rows: 12,
                jitter: 0.1,
            });
            const graph = buildDCEL({ curves });
            applyTabs(graph, generator, random, {
                tabConfig: { deepResolve: true },
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
        console.log(`[triangular] eligible=${total} accepted=${accepted} flat=${total - accepted} reject=${rejectPct.toFixed(1)}%`);
        console.log(`[triangular] per-rung commits: ${rungCommits.join(',')}`);
        expect(total).toBeGreaterThan(0);
    });
});
