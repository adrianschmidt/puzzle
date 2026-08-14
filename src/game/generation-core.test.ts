import { describe, it, expect } from 'vitest';
import { runGeneration, requestNeedsTracedTabs } from './generation-core.js';
import type { GenerationRequest } from './generation-core.js';
import type { ComposableConfig } from '../puzzle/composable-generator.js';

const IMAGE = { width: 1080, height: 720 };

function legacyClassicRequest(seed = 12345): GenerationRequest {
    return {
        cutStyle: 'classic',
        gridSize: { cols: 4, rows: 3 },
        imageSize: IMAGE,
        seed,
        tabDebug: false,
    };
}

describe('runGeneration', () => {
    it('is deterministic: same request twice yields identical results', () => {
        const a = runGeneration(legacyClassicRequest());
        const b = runGeneration(legacyClassicRequest());
        expect(b).toEqual(a);
    });

    it('produces quantized, sealed pieces (bounds present, no curve samples)', () => {
        const { pieces } = runGeneration(legacyClassicRequest());
        expect(pieces).toHaveLength(12);
        for (const piece of pieces) {
            expect(piece.bounds).toBeDefined();
            for (const edge of piece.edges) {
                expect('curvePoints' in edge).toBe(false);
            }
        }
    });

    it('returns the inscribed puzzle size (full image for classic)', () => {
        const { puzzleSize } = runGeneration(legacyClassicRequest());
        expect(puzzleSize).toEqual(IMAGE);
    });

    it('survives structuredClone losslessly (worker-protocol guard)', () => {
        const result = runGeneration(legacyClassicRequest());
        expect(structuredClone(result)).toEqual(result);
    });

    it('survives structuredClone losslessly with autoGroups and tabDebugReport populated', () => {
        // Wavy populates autoGroups (its minPieceArea is always set) and
        // tabDebug:true forces a TabDebugSession, so this exercises both fields'
        // clone-ability — legacy classic leaves them undefined, cloning trivially.
        const request: GenerationRequest = {
            cutStyle: 'wavy',
            gridSize: { cols: 4, rows: 3 },
            imageSize: IMAGE,
            seed: 12345,
            wavyConfig: { borderless: false },
            tabDebug: true,
        };
        const result = runGeneration(request);
        expect(result.autoGroups?.length).toBeGreaterThan(0);
        expect(Object.keys(result.tabDebugReport ?? {}).length).toBeGreaterThan(0);
        expect(structuredClone(result)).toEqual(result);
    });

    it('different seeds produce different geometry', () => {
        const a = runGeneration(legacyClassicRequest(1));
        const b = runGeneration(legacyClassicRequest(2));
        expect(a.pieces[0].shape).not.toEqual(b.pieces[0].shape);
    });
});

describe('requestNeedsTracedTabs', () => {
    const base = legacyClassicRequest();
    const composableClassicTabs: ComposableConfig = { tabGenerator: 'classic' };
    const composableTracedTabs: ComposableConfig = { tabGenerator: 'traced' };

    it.each<[string, Partial<GenerationRequest>, boolean]>([
        ['legacy classic', {}, false],
        ['sine classic', { classicConfig: { traceSetVersion: 1 } }, true],
        ['wavy legacy tabs', { cutStyle: 'wavy', wavyConfig: { borderless: false } }, false],
        ['wavy traced', { cutStyle: 'wavy', wavyConfig: { traceSetVersion: 1 } }, true],
        ['triangles', { cutStyle: 'triangles' }, true],
        ['fractal', { cutStyle: 'fractal' }, false],
        ['composable classic tabs', { cutStyle: 'composable', composableConfig: composableClassicTabs }, false],
        ['composable traced tabs', { cutStyle: 'composable', composableConfig: composableTracedTabs }, true],
    ])('%s', (_name, overrides, expected) => {
        expect(requestNeedsTracedTabs({ ...base, ...overrides })).toBe(expected);
    });
});
