import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { TabDebugSession } from './tab-debug.js';
import { generateComposablePuzzle } from '../composable-generator.js';
import { setTracedTabChoiceRecorder } from '../composable/traced-tab-recorder.js';
import { preloadTracedTabGenerator } from './traced-tab-loader.js';

describe('TabDebugSession', () => {
    // Traced tabs are registered as a stub that throws unless this
    // preload has run; await it once for the whole suite.
    beforeAll(async () => {
        await preloadTracedTabGenerator();
    });

    afterEach(() => {
        // Make sure no session leaks between tests.
        setTracedTabChoiceRecorder(null);
    });

    it('produces a report keyed by piece id for a traced-tab puzzle', () => {
        const debug = new TabDebugSession();
        const result = generateComposablePuzzle(3, 3, { width: 600, height: 600 }, 42, {
            baseCutGenerator: 'sine',
            baseCutConfig: { cols: 3, rows: 3, ha: 0.5, hf: 1.5, va: 0.5, vf: 1.5 },
            tabGenerator: 'traced',
            tabDebug: debug,
        });
        const report = result.tabDebugReport!;
        expect(report).toBeDefined();
        // 3x3 grid has 9 pieces; every inner piece should have at least one entry.
        const pieceIds = Object.keys(report).map(Number);
        expect(pieceIds.length).toBeGreaterThan(0);
        expect(pieceIds.length).toBeLessThanOrEqual(9);
        // Every entry has the expected shape, with traced metadata filled in.
        for (const entries of Object.values(report)) {
            for (const e of entries) {
                expect(typeof e.halfEdgeId).toBe('number');
                expect(typeof e.edgeIndex).toBe('number');
                expect(e.edgeIndex).toBeGreaterThanOrEqual(0);
                expect(typeof e.accepted).toBe('boolean');
                expect(e.traced).not.toBeNull();
                expect(typeof e.traced!.templateIdx).toBe('number');
                expect(typeof e.traced!.templateId).toBe('string');
                expect(e.traced!.templateId).toMatch(/^\d{2}-tab-/);
            }
        }
    });

    it('produces a report for non-traced generators with traced=null', () => {
        const debug = new TabDebugSession();
        const result = generateComposablePuzzle(3, 3, { width: 600, height: 600 }, 7, {
            baseCutGenerator: 'sine',
            baseCutConfig: { cols: 3, rows: 3, ha: 0.5, hf: 1.5, va: 0.5, vf: 1.5 },
            tabGenerator: 'classic',
            tabDebug: debug,
        });
        const report = result.tabDebugReport!;
        expect(Object.keys(report).length).toBeGreaterThan(0);
        for (const entries of Object.values(report)) {
            for (const e of entries) {
                expect(e.traced).toBeNull();
            }
        }
    });

    it('exposes a shared edge under BOTH piece ids on either side', () => {
        const debug = new TabDebugSession();
        const result = generateComposablePuzzle(3, 3, { width: 600, height: 600 }, 99, {
            baseCutGenerator: 'sine',
            baseCutConfig: { cols: 3, rows: 3, ha: 0.5, hf: 1.5, va: 0.5, vf: 1.5 },
            tabGenerator: 'traced',
            tabDebug: debug,
        });
        const report = result.tabDebugReport!;
        // For each entry that records a mate, the mate's report should
        // contain a matching halfEdgeId (the shared edge).
        for (const [pieceIdStr, entries] of Object.entries(report)) {
            const pieceId = Number(pieceIdStr);
            for (const e of entries) {
                if (e.matePieceId === null) continue;
                const mateEntries = report[e.matePieceId];
                expect(mateEntries, `mate piece ${e.matePieceId} of ${pieceId} should have entries`)
                    .toBeDefined();
                const found = mateEntries.some(m => m.halfEdgeId === e.halfEdgeId);
                expect(found, `mate ${e.matePieceId} should also list halfEdgeId=${e.halfEdgeId}`)
                    .toBe(true);
            }
        }
    });

    it('omits tabDebugReport when no session is passed', () => {
        const result = generateComposablePuzzle(3, 3, { width: 600, height: 600 }, 42, {
            baseCutGenerator: 'sine',
            baseCutConfig: { cols: 3, rows: 3, ha: 0.5, hf: 1.5, va: 0.5, vf: 1.5 },
            tabGenerator: 'traced',
        });
        expect(result.tabDebugReport).toBeUndefined();
    });

    it('is deterministic for a fixed seed', () => {
        const seed = 1234;
        const a = generateComposablePuzzle(3, 3, { width: 600, height: 600 }, seed, {
            baseCutGenerator: 'sine',
            baseCutConfig: { cols: 3, rows: 3, ha: 0.5, hf: 1.5, va: 0.5, vf: 1.5 },
            tabGenerator: 'traced',
            tabDebug: new TabDebugSession(),
        }).tabDebugReport!;
        const b = generateComposablePuzzle(3, 3, { width: 600, height: 600 }, seed, {
            baseCutGenerator: 'sine',
            baseCutConfig: { cols: 3, rows: 3, ha: 0.5, hf: 1.5, va: 0.5, vf: 1.5 },
            tabGenerator: 'traced',
            tabDebug: new TabDebugSession(),
        }).tabDebugReport!;
        // Same set of piece ids, same templateIds per piece in same order.
        expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
        for (const pid of Object.keys(a)) {
            const at = a[Number(pid)].map(e => e.traced?.templateId);
            const bt = b[Number(pid)].map(e => e.traced?.templateId);
            expect(at).toEqual(bt);
        }
    });
});
