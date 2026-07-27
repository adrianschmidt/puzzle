import { describe, it, expect } from 'vitest';
import { makeGameState } from '../test-helpers/fixtures.js';
import { getActiveTolerance, getActiveRotationTolerance } from '../ui/index.js';
import { activeSnapTolerances } from './snap-tolerances.js';

describe('activeSnapTolerances', () => {
    it('derives the position tolerance from image width, column count and cut style', () => {
        const state = makeGameState({
            imageSize: { width: 1200, height: 800 },
            gridSize: { cols: 12, rows: 8 },
            cutStyle: 'wavy',
        });

        expect(activeSnapTolerances(state)).toEqual({
            tolerancePx: getActiveTolerance(1200, 12, 'wavy'),
            rotationToleranceDeg: getActiveRotationTolerance(),
        });
    });

    it('passes an absent cut style through rather than defaulting it', () => {
        // The tolerance helper owns the default; substituting 'classic' here
        // would put the fallback in two places.
        const state = makeGameState({ cutStyle: undefined });

        expect(activeSnapTolerances(state).tolerancePx).toBe(
            getActiveTolerance(state.imageSize.width, state.gridSize.cols, undefined),
        );
    });
});
