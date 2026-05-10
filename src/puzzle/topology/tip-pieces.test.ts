/**
 * Regression test for "tip piece" artifacts (issue #220).
 *
 * With max amplitude/frequency settings, high-amplitude sine-wave cuts
 * create tiny "tip" faces (3-4 edges) where wave peaks are clipped at
 * multi-curve convergence points. These must be merged into adjacent
 * pieces so the final count matches cols*rows.
 */

import { describe, it, expect } from 'vitest';
import { generateTopologyPuzzle } from './generator.js';

function seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 1664525 + 1013904223) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

describe('tip piece merging', () => {
    const maxSettings = {
        baseCutGeneratorId: 'sine',
        baseCutConfig: {
            ha: 0.5, hf: 10, va: 0.5, vf: 10,
        },
        tabGeneratorId: 'none',
    };

    it('6x4 max amplitude/frequency produces exactly 24 pieces', () => {
        const { pieces } = generateTopologyPuzzle(
            6, 4, { width: 600, height: 400 },
            seededRandom(42),
            maxSettings,
        );
        expect(pieces).toHaveLength(24);
    });

    for (const seed of [42, 123, 7, 999, 2024]) {
        it(`6x4 max settings seed=${seed} produces 24 pieces`, () => {
            const { pieces } = generateTopologyPuzzle(
                6, 4, { width: 600, height: 400 },
                seededRandom(seed),
                maxSettings,
            );
            expect(pieces).toHaveLength(24);
        });
    }

    it('mate relationships are valid after tip merging', () => {
        const { pieces } = generateTopologyPuzzle(
            6, 4, { width: 600, height: 400 },
            seededRandom(42),
            maxSettings,
        );

        const edgeMap = new Map<number, { pieceId: number; mateEdgeId: number; matePieceId: number }>();
        for (const p of pieces) {
            for (const e of p.edges) {
                edgeMap.set(e.id, { pieceId: p.id, mateEdgeId: e.mateEdgeId, matePieceId: e.matePieceId });
            }
        }

        for (const p of pieces) {
            for (const e of p.edges) {
                if (e.mateEdgeId === -1) continue;
                const mate = edgeMap.get(e.mateEdgeId);
                expect(mate).toBeDefined();
                expect(mate!.mateEdgeId).toBe(e.id);
                expect(mate!.matePieceId).toBe(p.id);
            }
        }
    });
});
