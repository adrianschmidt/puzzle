import { describe, it, expect } from 'vitest';
import {
    createNewGame,
    randomizePositions,
    DEFAULT_COLS,
    DEFAULT_ROWS,
    VIEWPORT_MARGIN,
} from './init.js';
import type { Size } from '../model/types.js';

/** A deterministic RNG for reproducible tests: cycles through provided values. */
function seededRandom(values: number[]): () => number {
    let index = 0;

    return () => {
        const val = values[index % values.length];
        index++;

        return val;
    };
}

const IMAGE_SIZE: Size = { width: 800, height: 600 };
const VIEWPORT: Size = { width: 1024, height: 768 };
const TOTAL_PIECES = DEFAULT_COLS * DEFAULT_ROWS; // 48

describe('createNewGame', () => {
    it('creates a game state with the correct number of pieces', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, {
            random: seededRandom([0.5]),
        });

        expect(state.pieces).toHaveLength(TOTAL_PIECES);
    });

    it('creates one group per piece', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, {
            random: seededRandom([0.5]),
        });

        expect(state.groups).toHaveLength(TOTAL_PIECES);
    });

    it('sets the image URL', () => {
        const state = createNewGame('my-image.png', IMAGE_SIZE, VIEWPORT, {
            random: seededRandom([0.5]),
        });

        expect(state.imageUrl).toBe('my-image.png');
    });

    it('starts with completed = false', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, {
            random: seededRandom([0.5]),
        });

        expect(state.completed).toBe(false);
    });

    it('each group contains exactly one piece', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, {
            random: seededRandom([0.5]),
        });

        for (const group of state.groups) {
            expect(group.pieces.size).toBe(1);
        }
    });

    it('every piece appears in exactly one group', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, {
            random: seededRandom([0.5]),
        });

        const pieceIds = new Set<number>();
        for (const group of state.groups) {
            for (const pieceId of group.pieces.keys()) {
                expect(pieceIds.has(pieceId)).toBe(false);
                pieceIds.add(pieceId);
            }
        }

        expect(pieceIds.size).toBe(TOTAL_PIECES);
    });

    it('each piece has groupOffset {0,0} (solo groups)', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, {
            random: seededRandom([0.5]),
        });

        for (const group of state.groups) {
            for (const offset of group.pieces.values()) {
                expect(offset).toEqual({ x: 0, y: 0 });
            }
        }
    });
});

describe('createInitialGroups', () => {
    it('assigns unique group IDs matching piece IDs', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, {
            random: seededRandom([0.5]),
        });

        const groupIds = state.groups.map((g) => g.id);
        const uniqueIds = new Set(groupIds);
        expect(uniqueIds.size).toBe(TOTAL_PIECES);

        // Each group ID should match the piece it contains
        for (const group of state.groups) {
            const [pieceId] = group.pieces.keys();
            expect(group.id).toBe(pieceId);
        }
    });
});

describe('randomizePositions', () => {
    const pieceWidth = 100;
    const pieceHeight = 100;

    it('returns the correct number of positions', () => {
        const positions = randomizePositions(
            10,
            pieceWidth,
            pieceHeight,
            VIEWPORT,
            seededRandom([0.5]),
        );

        expect(positions).toHaveLength(10);
    });

    it('keeps all positions within viewport bounds', () => {
        // Use a variety of random values to test bounds
        const values = [0, 0.25, 0.5, 0.75, 0.999];
        const positions = randomizePositions(
            values.length,
            pieceWidth,
            pieceHeight,
            VIEWPORT,
            seededRandom(values),
        );

        for (const pos of positions) {
            expect(pos.x).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
            expect(pos.y).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
            expect(pos.x).toBeLessThanOrEqual(
                VIEWPORT.width - pieceWidth - VIEWPORT_MARGIN,
            );
            expect(pos.y).toBeLessThanOrEqual(
                VIEWPORT.height - pieceHeight - VIEWPORT_MARGIN,
            );
        }
    });

    it('produces positions at expected coordinates for known random values', () => {
        const maxX = VIEWPORT.width - pieceWidth - VIEWPORT_MARGIN;
        const maxY = VIEWPORT.height - pieceHeight - VIEWPORT_MARGIN;
        const rangeX = maxX - VIEWPORT_MARGIN;
        const rangeY = maxY - VIEWPORT_MARGIN;

        // random = 0 → min position (both x and y)
        const positionsMin = randomizePositions(
            1,
            pieceWidth,
            pieceHeight,
            VIEWPORT,
            seededRandom([0]),
        );
        expect(positionsMin[0].x).toBe(VIEWPORT_MARGIN);
        expect(positionsMin[0].y).toBe(VIEWPORT_MARGIN);

        // random = 0.5 → middle position
        const positionsMid = randomizePositions(
            1,
            pieceWidth,
            pieceHeight,
            VIEWPORT,
            seededRandom([0.5]),
        );
        expect(positionsMid[0].x).toBeCloseTo(VIEWPORT_MARGIN + rangeX * 0.5);
        expect(positionsMid[0].y).toBeCloseTo(VIEWPORT_MARGIN + rangeY * 0.5);
    });

    it('handles a tiny viewport gracefully (clamps to valid range)', () => {
        const tinyViewport: Size = { width: 50, height: 50 };
        const positions = randomizePositions(
            5,
            pieceWidth,
            pieceHeight,
            tinyViewport,
            seededRandom([0.5]),
        );

        // All positions should be at the margin (no room to spread)
        for (const pos of positions) {
            expect(pos.x).toBe(VIEWPORT_MARGIN);
            expect(pos.y).toBe(VIEWPORT_MARGIN);
        }
    });

    it('uses the provided random function (deterministic)', () => {
        const rng1 = seededRandom([0.1, 0.2, 0.3]);
        const rng2 = seededRandom([0.1, 0.2, 0.3]);

        const pos1 = randomizePositions(3, pieceWidth, pieceHeight, VIEWPORT, rng1);
        const pos2 = randomizePositions(3, pieceWidth, pieceHeight, VIEWPORT, rng2);

        expect(pos1).toEqual(pos2);
    });

    it('varies positions with different random values', () => {
        const positions = randomizePositions(
            3,
            pieceWidth,
            pieceHeight,
            VIEWPORT,
            seededRandom([0.1, 0.5, 0.9]),
        );

        // With different random values, positions should differ
        const uniqueX = new Set(positions.map((p) => p.x));
        expect(uniqueX.size).toBeGreaterThan(1);
    });
});
