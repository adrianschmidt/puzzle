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
import { tracedTabGenerator } from './traced-tab-generator.js';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const RUN = env.MEASURE_TABS === '1';

describe('traced-tab rejection measurement', () => {
    (RUN ? it : it.skip)('reports the flat-edge rate at the user settings', { timeout: 300_000 }, () => {
        const cfg = { cols: 16, rows: 12, ha: 0.5, hf: 8, va: 0.5, vf: 6 };
        const frame = { width: 1600, height: 1200 };
        const SEEDS = 15;

        let total = 0;
        let accepted = 0;
        for (let s = 0; s < SEEDS; s++) {
            const random = createSeededRandom(s);
            const curves = sineCutGenerator.generate(frame, random, cfg);
            const graph = buildDCEL({ curves });
            applyTabs(graph, tracedTabGenerator, random, {
                onCandidate: (_he, ok) => { total++; if (ok) accepted++; },
            });
        }
        const rejectPct = (100 * (total - accepted)) / total;
        // eslint-disable-next-line no-console
        console.log(`eligible=${total} accepted=${accepted} flat=${(total - accepted)} reject=${rejectPct.toFixed(1)}%`);
        // Sanity only — the real signal is the printed number vs the 20.7% baseline.
        expect(total).toBeGreaterThan(0);
    });
});
