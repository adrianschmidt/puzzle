import { describe, it, expect, vi, afterEach } from 'vitest';
// `createNewGame` calls `getCutStyleStrategy` from this module; a plain
// `vi.spyOn` can't intercept that under Vite's ESM. Wrapping the real impl in
// `vi.fn` keeps real generation working; only the test with a
// `mockImplementationOnce` below sees a fake strategy.
vi.mock('./cut-style-strategies.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./cut-style-strategies.js')>();
    return { ...actual, getCutStyleStrategy: vi.fn(actual.getCutStyleStrategy) };
});

import {
    createNewGame,
    createNewGameAsync,
    createInitialGroups,
    randomizePositions,
    DEFAULT_COLS,
    DEFAULT_ROWS,
    VIEWPORT_MARGIN,
} from './init.js';
import { getCutStyleStrategy, type CutStyleStrategy } from './cut-style-strategies.js';
import { GenerationCanceledError } from './generate-async.js';
import type { GridSize, Piece, Size } from '../model/types.js';
import type { AutoGroup } from '../puzzle/topology/auto-group.js';
import type { PieceCountMismatch } from '../puzzle/topology/generator.js';
import { computePieceBounds } from '../model/derive.js';

/**
 * The real strategy lookup the mock wraps, captured so `afterEach` can restore
 * it explicitly: `vite.config.ts` has no `restoreMocks`, and `clearAllMocks`
 * doesn't clear a `mockImplementationOnce`, so a fake could leak into a later test.
 */
const realGetCutStyleStrategy = vi.mocked(getCutStyleStrategy).getMockImplementation()!;

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
const DEFAULT_GRID: GridSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };
const TOTAL_PIECES = DEFAULT_COLS * DEFAULT_ROWS;

describe('createNewGame', () => {
    it('creates a game state with the correct number of pieces', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom([0.5]),
        });

        expect(state.pieces).toHaveLength(TOTAL_PIECES);
    });

    it('creates one group per piece', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom([0.5]),
        });

        expect(state.groups).toHaveLength(TOTAL_PIECES);
    });

    it('sets the image URL', () => {
        const state = createNewGame('my-image.png', IMAGE_SIZE, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom([0.5]),
        });

        expect(state.imageUrl).toBe('my-image.png');
    });

    it('starts with completed = false', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom([0.5]),
        });

        expect(state.completed).toBe(false);
    });

    it('stores the image size in the game state', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom([0.5]),
        });

        expect(state.imageSize).toEqual(IMAGE_SIZE);
    });

    it('stores the grid size in the game state', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom([0.5]),
        });

        expect(state.gridSize).toEqual(DEFAULT_GRID);
    });

    it('inscribes the fractal puzzle inside the image so arcs stay circular', () => {
        // 16:9 can't be matched exactly by a small integer grid; the stored
        // imageSize must fit inside the image (crop) not extend beyond (blank).
        const imageSize: Size = { width: 1920, height: 1080 };
        const state = createNewGame('test.jpg', imageSize, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom([0.5]),
            cutStyle: 'fractal',
            seed: 42,
        });
        expect(state.imageSize.width).toBeLessThanOrEqual(imageSize.width + 1e-9);
        expect(state.imageSize.height).toBeLessThanOrEqual(imageSize.height + 1e-9);
        // At least one axis matches exactly — inscribed, touching one edge pair.
        const matchesWidth = Math.abs(state.imageSize.width - imageSize.width) < 1e-6;
        const matchesHeight = Math.abs(state.imageSize.height - imageSize.height) < 1e-6;
        expect(matchesWidth || matchesHeight).toBe(true);
    });

    it('leaves imageSize unchanged when grid aspect matches image aspect', () => {
        // 8×6 grid on 4:3 image: aspects match (1.333) → no inscribing.
        const imageSize: Size = { width: 800, height: 600 };
        const state = createNewGame('test.jpg', imageSize, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom([0.5]),
            cutStyle: 'classic',
        });
        expect(state.imageSize).toEqual(imageSize);
    });

    it('respects custom grid size', () => {
        const customGrid: GridSize = { cols: 6, rows: 4 };
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, customGrid, {
            random: seededRandom([0.5]),
        });

        expect(state.pieces).toHaveLength(24);
        expect(state.groups).toHaveLength(24);
        expect(state.gridSize).toEqual(customGrid);
    });

    it('each group contains exactly one piece', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom([0.5]),
        });

        for (const group of state.groups) {
            expect(group.pieces.size).toBe(1);
        }
    });

    it('every piece appears in exactly one group', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, DEFAULT_GRID, {
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
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, DEFAULT_GRID, {
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
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom([0.5]),
        });

        const groupIds = state.groups.map((g) => g.id);
        const uniqueIds = new Set(groupIds);
        expect(uniqueIds.size).toBe(TOTAL_PIECES);

        for (const group of state.groups) {
            const [pieceId] = group.pieces.keys();
            expect(group.id).toBe(pieceId);
        }
    });

    describe('AutoGroup offset math', () => {
        // Minimal Piece: createInitialGroups reads only id + imageOffset.
        function makePiece(id: number, imageOffset: { x: number; y: number }): Piece {
            return { id, edges: [], shape: '', imageOffset, bounds: computePieceBounds({ edges: [] }) };
        }

        it('computes within-group offsets as anchor.imageOffset - piece.imageOffset', () => {
            // other's within-group offset = anchor.imageOffset - other.imageOffset
            //   = (0,0) - (-100,-50) = (100, 50)
            const pieces: Piece[] = [
                makePiece(0, { x: 0, y: 0 }),
                makePiece(1, { x: -100, y: -50 }),
            ];
            const autoGroups: AutoGroup[] = [{ id: 0, pieceIds: [0, 1] }];

            // Fixed RNG (always 0.5) → one deterministic shared position for the group.
            const groups = createInitialGroups(
                pieces,
                IMAGE_SIZE,
                VIEWPORT,
                DEFAULT_GRID,
                { random: seededRandom([0.5]) },
                autoGroups,
            );

            expect(groups).toHaveLength(1);
            const group = groups[0];
            expect(group.id).toBe(0);
            expect(group.pieces.size).toBe(2);
            expect(group.pieces.get(0)).toEqual({ x: 0, y: 0 });
            expect(group.pieces.get(1)).toEqual({ x: 100, y: 50 });

            // One shared position and rotation for the group, not per-piece.
            const pieceWidth = IMAGE_SIZE.width / DEFAULT_COLS;
            const pieceHeight = IMAGE_SIZE.height / DEFAULT_ROWS;
            const expectedX =
                VIEWPORT_MARGIN +
                0.5 * (VIEWPORT.width - pieceWidth - 2 * VIEWPORT_MARGIN);
            const expectedY =
                VIEWPORT_MARGIN +
                0.5 * (VIEWPORT.height - pieceHeight - 2 * VIEWPORT_MARGIN);
            expect(group.position.x).toBeCloseTo(expectedX);
            expect(group.position.y).toBeCloseTo(expectedY);
            expect(group.rotation).toBe(0);
        });
    });
});

describe('rotationMode', () => {
    it('defaults to "none" and leaves every group at rotation 0', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom([0.5]),
        });

        expect(state.rotationMode).toBe('none');
        for (const group of state.groups) {
            expect(group.rotation).toBe(0);
        }
    });

    it('assigns random quarter-turn rotations when rotationMode is "quarter-turn"', () => {
        // random returns values <1 that map to floor(v*4) in {0,1,2,3}
        const values = [0.1, 0.3, 0.6, 0.9];
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom([...values, 0.5]),
            rotationMode: 'quarter-turn',
        });

        expect(state.rotationMode).toBe('quarter-turn');
        expect(state.groups.some((g) => g.rotation !== 0)).toBe(true);
        for (const group of state.groups) {
            expect([0, 90, 180, 270]).toContain(group.rotation);
        }
    });

    it('assigns random rotations to classic-cut puzzles when rotationMode is "quarter-turn"', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom([0.1, 0.3, 0.6, 0.9, 0.5]),
            rotationMode: 'quarter-turn',
            cutStyle: 'classic',
        });

        expect(state.rotationMode).toBe('quarter-turn');
        expect(state.cutStyle).toBe('classic');
        expect(state.groups.some((g) => g.rotation !== 0)).toBe(true);
        for (const group of state.groups) {
            expect([0, 90, 180, 270]).toContain(group.rotation);
        }
    });

    it('assigns random rotations to composable-cut puzzles when rotationMode is "quarter-turn"', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom([0.1, 0.3, 0.6, 0.9, 0.5]),
            rotationMode: 'quarter-turn',
            cutStyle: 'composable',
        });

        expect(state.rotationMode).toBe('quarter-turn');
        expect(state.cutStyle).toBe('composable');
        expect(state.groups.some((g) => g.rotation !== 0)).toBe(true);
        for (const group of state.groups) {
            expect([0, 90, 180, 270]).toContain(group.rotation);
        }
    });

    it('assigns random float-degree rotations when rotationMode is "free"', () => {
        // random() always returns 0.5, so every group should be at exactly 180°
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom([0.5]),
            rotationMode: 'free',
        });

        expect(state.rotationMode).toBe('free');
        for (const group of state.groups) {
            expect(group.rotation).toBeCloseTo(180);
        }
    });

    it('produces float angles in [0, 360) for free mode with a varying PRNG', () => {
        const seq = [0.0, 0.13, 0.5, 0.789, 0.999];
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom(seq),
            rotationMode: 'free',
        });

        expect(state.rotationMode).toBe('free');
        const quarterTurns = new Set([0, 90, 180, 270]);
        expect(state.groups.some((g) => !quarterTurns.has(g.rotation))).toBe(true);
        for (const group of state.groups) {
            expect(group.rotation).toBeGreaterThanOrEqual(0);
            expect(group.rotation).toBeLessThan(360);
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

        // No room to spread → all positions clamp to the margin.
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

        const uniqueX = new Set(positions.map((p) => p.x));
        expect(uniqueX.size).toBeGreaterThan(1);
    });
});

describe('createNewGame piece-count mismatch reporting', () => {
    afterEach(() => {
        // Leak guard: restore the real strategy (see `realGetCutStyleStrategy`).
        vi.mocked(getCutStyleStrategy).mockImplementation(realGetCutStyleStrategy);
    });

    it('does not call the callback for a healthy composable puzzle', () => {
        // Real topology pipeline (not legacy classic, which can't carry a
        // mismatch): pins that the sine base-cut's `expectedPieceCount` hook
        // doesn't false-positive against its own output.
        const onPieceCountMismatch = vi.fn();
        createNewGame('img.jpg', { width: 400, height: 400 },
            { width: 800, height: 600 }, { cols: 2, rows: 2 },
            { seed: 1, cutStyle: 'composable', onPieceCountMismatch });
        expect(onPieceCountMismatch).not.toHaveBeenCalled();
    });

    it('is optional — a reported mismatch with no callback still generates', () => {
        // The `?.` on `onPieceCountMismatch?.(…)` means a diagnostic never
        // blocks game start. Exercising it needs a run that REPORTS a mismatch
        // with no callback — legacy Classic never reports one, so this installs
        // the fake strategy to make dropping the `?.` fail.
        const fakeStrategy: CutStyleStrategy = {
            configKey: 'classicConfig',
            scaleGrid: (grid) => grid,
            inscribePuzzleSize: (imageSize) => imageSize,
            generatePieces: () => ({
                pieces: [],
                pieceCountMismatch: { expected: 4, actual: 3, baseCutId: 'fake' },
            }),
        };
        vi.mocked(getCutStyleStrategy).mockImplementationOnce(() => fakeStrategy);

        expect(() =>
            createNewGame('img.jpg', { width: 400, height: 400 },
                { width: 800, height: 600 }, { cols: 2, rows: 2 },
                { seed: 1, cutStyle: 'classic' }),
        ).not.toThrow();
    });

    it('invokes the callback with the mismatch a strategy reports', () => {
        // Stub the strategy so `generatePieces` returns a mismatch directly,
        // and assert `createNewGame` forwards that exact value — regression
        // check for the destructure/invoke wiring in `init.ts`.
        const mismatch: PieceCountMismatch = { expected: 4, actual: 3, baseCutId: 'fake' };
        const fakeStrategy: CutStyleStrategy = {
            configKey: 'classicConfig',
            scaleGrid: (grid) => grid,
            inscribePuzzleSize: (imageSize) => imageSize,
            generatePieces: () => ({ pieces: [], pieceCountMismatch: mismatch }),
        };
        vi.mocked(getCutStyleStrategy).mockImplementationOnce(() => fakeStrategy);

        const onPieceCountMismatch = vi.fn();
        createNewGame('img.jpg', { width: 400, height: 400 },
            { width: 800, height: 600 }, { cols: 2, rows: 2 },
            { seed: 1, cutStyle: 'classic', onPieceCountMismatch });

        expect(onPieceCountMismatch).toHaveBeenCalledTimes(1);
        expect(onPieceCountMismatch).toHaveBeenCalledWith(mismatch);
    });
});

describe('createNewGameAsync', () => {
    // jsdom has no Worker, so this hits the sync-fallback path (worker mechanics
    // live in generate-async.test.ts).
    afterEach(() => {
        // Leak guard: an unconsumed `mockImplementationOnce` must not leak
        // into a later test.
        vi.mocked(getCutStyleStrategy).mockImplementation(realGetCutStyleStrategy);
    });

    const viewport: Size = { width: 800, height: 600 };
    const imageSize: Size = { width: 1080, height: 720 };

    it('resolves to the same state createNewGame builds for the same seed', async () => {
        const options = { seed: 123, cutStyle: 'classic' as const };
        const { state, generation } = await createNewGameAsync(
            'img.jpg', imageSize, viewport, { cols: 4, rows: 3 }, options,
        );
        const sync = createNewGame('img.jpg', imageSize, viewport, { cols: 4, rows: 3 }, options);

        expect(state.pieces).toEqual(sync.pieces);
        expect(state.seed).toBe(123);
        expect(generation.mode).toBe('sync-fallback');
        expect(generation.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('does not fire onPieceCountMismatch for a healthy classic generation', async () => {
        const onPieceCountMismatch = vi.fn();
        await createNewGameAsync('img.jpg', imageSize, viewport, { cols: 4, rows: 3 },
            { seed: 1, onPieceCountMismatch });

        expect(onPieceCountMismatch).not.toHaveBeenCalled();
    });

    it('fires onPieceCountMismatch (before resolving) for a mismatch a strategy reports', async () => {
        // Pins that `createNewGameAsync` forwards a reported mismatch like the
        // sync path, and that the callback has already fired when the promise
        // resolves (`onPieceCountMismatch` runs in `assembleGameState`, after
        // the `await`).
        const mismatch: PieceCountMismatch = { expected: 4, actual: 3, baseCutId: 'fake' };
        const fakeStrategy: CutStyleStrategy = {
            configKey: 'classicConfig',
            scaleGrid: (grid) => grid,
            inscribePuzzleSize: (size) => size,
            generatePieces: () => ({ pieces: [], pieceCountMismatch: mismatch }),
        };
        vi.mocked(getCutStyleStrategy).mockImplementationOnce(() => fakeStrategy);

        const onPieceCountMismatch = vi.fn();
        await createNewGameAsync('img.jpg', { width: 400, height: 400 },
            { width: 800, height: 600 }, { cols: 2, rows: 2 },
            { seed: 1, cutStyle: 'classic', onPieceCountMismatch });

        expect(onPieceCountMismatch).toHaveBeenCalledTimes(1);
        expect(onPieceCountMismatch).toHaveBeenCalledWith(mismatch);
    });

    it('rejects with GenerationCanceledError on an aborted signal', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(createNewGameAsync(
            'img.jpg', imageSize, viewport, { cols: 4, rows: 3 }, { seed: 1 },
            controller.signal,
        )).rejects.toBeInstanceOf(GenerationCanceledError);
    });
});
