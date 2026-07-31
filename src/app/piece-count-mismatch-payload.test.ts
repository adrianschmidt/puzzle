import { describe, it, expect } from 'vitest';
import { buildPieceCountMismatchData } from './piece-count-mismatch-payload.js';
import type { GameState } from '../model/types.js';
import { makeGameState } from '../test-helpers/fixtures.js';

function stateFixture(overrides: Partial<GameState> = {}): GameState {
    return makeGameState({
        seed: 124741785,
        cutStyle: 'classic',
        imageUrl: 'https://images.unsplash.com/photo-123?w=1080&q=80',
        imageSize: { width: 1080, height: 720 },
        gridSize: { cols: 16, rows: 12 },
        rotationMode: 'none',
        classicConfig: { traceSetVersion: 1 },
        ...overrides,
    });
}

const MISMATCH = { expected: 192, actual: 189, baseCutId: 'sine' };

describe('buildPieceCountMismatchData', () => {
    it('carries the counts and the base cut that declared them', () => {
        const data = buildPieceCountMismatchData(stateFixture(), MISMATCH, 'fresh');
        expect(data.expected).toBe(192);
        expect(data.actual).toBe(189);
        expect(data.baseCut).toBe('sine');
        expect(data.cutStyle).toBe('classic');
        expect(data.source).toBe('fresh');
    });

    it('carries the repro params flattened', () => {
        const data = buildPieceCountMismatchData(stateFixture(), MISMATCH, 'fresh');
        expect(data.seed).toBe(124741785);
        expect(data.cols).toBe(16);
        expect(data.rows).toBe(12);
        expect(data.imageWidth).toBe(1080);
        expect(data.imageHeight).toBe(720);
        expect(data.rotationMode).toBe('none');
        expect(data.styleConfig).toBe('{"traceSetVersion":1}');
    });

    it('never carries the image URL, under any key', () => {
        const data = buildPieceCountMismatchData(stateFixture(), MISMATCH, 'fresh');
        const serialized = JSON.stringify(data);
        expect(serialized).not.toContain('unsplash');
        expect(serialized).not.toContain('images.unsplash.com');
        expect(Object.keys(data)).not.toContain('imageUrl');
    });

    it('omits styleConfig when the puzzle carries no per-style block', () => {
        const data = buildPieceCountMismatchData(
            stateFixture({ classicConfig: undefined }), MISMATCH, 'fresh');
        expect(data.styleConfig).toBeUndefined();
    });

    it('reports the user grid, not the generation grid', () => {
        // A borderless puzzle generates an oversized grid, but the repro params
        // must be what __reproPuzzle replays from, which is the user grid.
        const data = buildPieceCountMismatchData(
            stateFixture({ gridSize: { cols: 16, rows: 12 } }),
            { expected: 252, actual: 249, baseCutId: 'sine' },
            'fresh',
        );
        expect(data.cols).toBe(16);
        expect(data.rows).toBe(12);
        expect(data.expected).toBe(252);
    });

    it('stays inside Umami event-data limits for every production cut style', () => {
        // Strings <=500 chars, <=50 properties. Numbers carry at most 4
        // decimals. The export shows 102 chars as the longest string shipping
        // today; nothing currently holds that, so this does.
        const styles: Array<Partial<GameState>> = [
            { cutStyle: 'classic', classicConfig: { traceSetVersion: 1 } },
            { cutStyle: 'classic', classicConfig: undefined },
            { cutStyle: 'wavy', wavyConfig: { borderless: true, traceSetVersion: 1 } },
            { cutStyle: 'triangles', trianglesConfig: { traceSetVersion: 1 } },
            { cutStyle: 'fractal', fractalConfig: { borderless: false } },
        ] as unknown as Array<Partial<GameState>>;

        for (const overrides of styles) {
            const data = buildPieceCountMismatchData(
                stateFixture(overrides), MISMATCH, 'fresh');
            expect(Object.keys(data).length).toBeLessThanOrEqual(50);
            for (const [key, value] of Object.entries(data)) {
                if (typeof value === 'string') {
                    expect(value.length, `${overrides.cutStyle}/${key}`)
                        .toBeLessThanOrEqual(500);
                }
                if (typeof value === 'number') {
                    expect(Number.isFinite(value), `${overrides.cutStyle}/${key}`).toBe(true);
                }
            }
        }
    });

    it('rounds fractional image dimensions to Umami number precision', () => {
        // Inscribed rectangles produce fractional sizes. Umami keeps 4
        // decimals; the share-link decoder floors to whole pixels, so
        // rounding here loses nothing a replay would have kept.
        const data = buildPieceCountMismatchData(
            stateFixture({ imageSize: { width: 1080.123456, height: 719.987654 } }),
            MISMATCH, 'fresh');
        expect(data.imageWidth).toBe(1080.1235);
        expect(data.imageHeight).toBe(719.9877);
    });
});
