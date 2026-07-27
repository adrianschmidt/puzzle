/**
 * @vitest-environment jsdom
 *
 * buildFreshGameData/buildSharedGameData route imageUrl through
 * classifyImageSource, which resolves relative URLs against
 * window.location.href — the Unsplash-host cases below need a real DOM to
 * classify correctly instead of falling back to 'fallback' on a missing
 * `window`.
 */

import { describe, it, expect } from 'vitest';
import { makeGameState } from '../test-helpers/fixtures.js';
import { buildFreshGameData, buildSharedGameData } from './new-game-payload.js';

function freshOpts(overrides = {}) {
    return {
        state: makeGameState({ cutStyle: 'classic' }),
        cutStyle: 'classic',
        rotationMode: 'none' as const,
        orientation: 'landscape' as const,
        oriented: { cols: 8, rows: 6 },
        imageSource: 'random',
        imageCategory: 'any',
        vibrant: false,
        chunkDegraded: false,
        bootFallback: false,
        ...overrides,
    };
}

describe('buildFreshGameData', () => {
    it('marks the source fresh and reports the oriented grid', () => {
        const data = buildFreshGameData(freshOpts({ oriented: { cols: 6, rows: 8 } }));
        expect(data.source).toBe('fresh');
        expect(data.cols).toBe(6);
        expect(data.rows).toBe(8);
    });

    it('flags a degraded traced-tab chunk', () => {
        // Without this flag a degraded game is indistinguishable from genuine
        // pre-upgrade Classic traffic — both are classic with no traceSetVersion.
        expect(buildFreshGameData(freshOpts({ chunkDegraded: true })).tracedChunkDegraded).toBe(true);
    });

    it('omits tracedChunkDegraded rather than setting it false', () => {
        // Absence cannot be filtered in Umami; the query subtracts on presence.
        expect('tracedChunkDegraded' in buildFreshGameData(freshOpts())).toBe(false);
    });

    it('flags a boot-fallback game', () => {
        expect(buildFreshGameData(freshOpts({ bootFallback: true })).bootFallback).toBe(true);
    });

    it('omits bootFallback rather than setting it false', () => {
        // Same reasoning as tracedChunkDegraded above: absence, not `false`,
        // is what the pre-upgrade-tail query in umami.ts subtracts on.
        expect('bootFallback' in buildFreshGameData(freshOpts())).toBe(false);
    });

    it('adds image fields only for an Unsplash photo', () => {
        const unsplash = makeGameState({ imageUrl: 'https://images.unsplash.com/photo-1' });
        const data = buildFreshGameData(freshOpts({
            state: unsplash, imageCategory: 'nature', vibrant: true,
        }));
        expect(data.imageSource).toBe('unsplash');
        expect(data.imageCategory).toBe('nature');
        expect(data.vibrant).toBe(true);
        expect(data.imagePicked).toBe(false);
    });

    it('reports imagePicked when the player chose a candidate', () => {
        const unsplash = makeGameState({ imageUrl: 'https://images.unsplash.com/photo-1' });
        const data = buildFreshGameData(freshOpts({
            state: unsplash,
            pickedImage: { imageUrl: 'x', imageSize: { width: 1, height: 1 } } as never,
        }));
        expect(data.imagePicked).toBe(true);
    });

    it('omits imageCategory, vibrant, and imagePicked when the source is not Unsplash', () => {
        // freshOpts()'s default state resolves to a non-unsplash imageSource
        // ('fallback'), so the trio must not appear at all — not even as
        // falsy values — the way it would for an Unsplash photo above.
        const data = buildFreshGameData(freshOpts());
        expect('imageCategory' in data).toBe(false);
        expect('vibrant' in data).toBe(false);
        expect('imagePicked' in data).toBe(false);
    });

    it('includes traceSetVersion when the generated state carries one', () => {
        const state = makeGameState({
            cutStyle: 'classic',
            classicConfig: { traceSetVersion: 4 },
        });
        expect(buildFreshGameData(freshOpts({ state })).traceSetVersion).toBe(4);
    });

    it('omits traceSetVersion when the generated state carries none', () => {
        // freshOpts()'s default state is Classic with no classicConfig — the
        // legacy-generator case, which must not carry the key at all.
        expect('traceSetVersion' in buildFreshGameData(freshOpts())).toBe(false);
    });
});

describe('buildSharedGameData', () => {
    it('marks the source shared and reads geometry off the generated state', () => {
        const data = buildSharedGameData({
            state: makeGameState({ gridSize: { cols: 4, rows: 7 } }),
            includesProgress: true,
            recipientHadSavedState: false,
            sharedColor: 'adopted',
        });
        expect(data.source).toBe('shared');
        expect(data.cols).toBe(4);
        expect(data.rows).toBe(7);
        expect(data.includesProgress).toBe(true);
        expect(data.sharedColor).toBe('adopted');
    });

    it('derives orientation from the post-transpose grid, squares reading landscape', () => {
        // The link stores the post-transpose grid, matching orientGridSize's
        // normalization.
        expect(buildSharedGameData({
            state: makeGameState({ gridSize: { cols: 4, rows: 9 } }),
            includesProgress: false, recipientHadSavedState: false, sharedColor: 'none',
        }).orientation).toBe('portrait');

        expect(buildSharedGameData({
            state: makeGameState({ gridSize: { cols: 5, rows: 5 } }),
            includesProgress: false, recipientHadSavedState: false, sharedColor: 'none',
        }).orientation).toBe('landscape');
    });

    it('includes traceSetVersion when the generated state carries one', () => {
        const state = makeGameState({
            cutStyle: 'classic',
            classicConfig: { traceSetVersion: 5 },
        });
        const data = buildSharedGameData({
            state, includesProgress: false, recipientHadSavedState: false, sharedColor: 'none',
        });
        expect(data.traceSetVersion).toBe(5);
    });

    it('omits traceSetVersion when the generated state carries none', () => {
        // A pre-upgrade Classic link (or any style with no matching config
        // block) must not carry the key at all — the fresh path's absence
        // reading is what this matches.
        const state = makeGameState({ gridSize: { cols: 4, rows: 7 } });
        const data = buildSharedGameData({
            state, includesProgress: false, recipientHadSavedState: false, sharedColor: 'none',
        });
        expect('traceSetVersion' in data).toBe(false);
    });
});
