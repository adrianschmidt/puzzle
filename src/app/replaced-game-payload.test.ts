import { describe, it, expect } from 'vitest';
import { makeGameState, makePiece } from '../test-helpers/fixtures.js';
import type { GameState, PieceGroup } from '../model/types.js';
import { buildReplacedGameData } from './replaced-game-payload.js';

function stateWith(pieceCount: number, groupCount: number, completed = false): GameState {
    const pieces = Array.from({ length: pieceCount }, (_, id) => makePiece({ id }));
    const firstGroupSize = pieceCount - groupCount + 1;
    const groups: PieceGroup[] = Array.from({ length: groupCount }, (_, id) => {
        const pieceIds = id === 0
            ? pieces.slice(0, firstGroupSize).map((p) => p.id)
            : [firstGroupSize + id - 1];
        return {
            id,
            pieces: new Map(pieceIds.map((pieceId) => [pieceId, { x: 0, y: 0 }])),
            position: { x: 0, y: 0 },
            rotation: 0,
        };
    });
    return makeGameState({ pieces, groups, completed });
}

describe('buildReplacedGameData', () => {
    it.each([
        [24, 24, 0],
        [24, 13, 0.478],
        [48, 2, 0.979],
        [192, 1, 1],
    ])('reports %i pieces in %i groups as progress %s', (pieces, groups, progress) => {
        expect(buildReplacedGameData(stateWith(pieces, groups), undefined).replacedProgress)
            .toBe(progress);
    });

    it('reports a one-piece puzzle as fully done', () => {
        expect(buildReplacedGameData(stateWith(1, 1), undefined).replacedProgress).toBe(1);
    });

    it('reports the outgoing puzzle size and completion', () => {
        const data = buildReplacedGameData(stateWith(48, 1, true), undefined);

        expect(data.replacedPieceCount).toBe(48);
        expect(data.replacedCompleted).toBe(true);
    });

    it('reports the outgoing puzzle\'s cut style', () => {
        const outgoing = { ...stateWith(24, 3), cutStyle: 'wavy' };

        expect(buildReplacedGameData(outgoing, undefined).replacedCutStyle).toBe('wavy');
    });

    it('reports an outgoing puzzle saved without a cut style as classic', () => {
        expect(buildReplacedGameData(stateWith(24, 3), undefined).replacedCutStyle).toBe('classic');
    });

    it('reports an unfinished outgoing puzzle as not completed', () => {
        expect(buildReplacedGameData(stateWith(48, 5), undefined).replacedCompleted).toBe(false);
    });

    it('reports how long the outgoing puzzle had been going', () => {
        expect(buildReplacedGameData(stateWith(24, 3), 90_000).replacedElapsedMs).toBe(90_000);
    });

    it('omits the elapsed time when it is unknown', () => {
        expect('replacedElapsedMs' in buildReplacedGameData(stateWith(24, 3), undefined))
            .toBe(false);
    });
});
