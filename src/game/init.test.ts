import { describe, it, expect, vi, afterEach } from 'vitest';
// `createNewGame` (in `init.ts`) calls `getCutStyleStrategy` from this
// module. A plain `vi.spyOn` on the export can't intercept that call under
// Vite's ESM — see `src/app/start-new-game.test.ts`'s `vi.mock('../game/index.js', ...)`
// for the same pattern. Wrapping the real implementation with `vi.fn(...)`
// keeps every existing test's real generation working; only the one test
// that installs a `mockImplementationOnce` below sees a fake strategy.
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
import { GenerationCancelledError } from './generate-async.js';
import type { GridSize, Piece, Size } from '../model/types.js';
import type { AutoGroup } from '../puzzle/topology/auto-group.js';
import type { PieceCountMismatch } from '../puzzle/topology/generator.js';
import { computePieceBounds } from '../model/derive.js';

/**
 * The real strategy lookup the mock above wraps, captured once so the
 * mismatch test's `afterEach` can restore it explicitly. `vi.clearAllMocks()`
 * (not used here, but repo-wide there is no `restoreMocks` in
 * `vite.config.ts`) only clears call records, not a `mockImplementationOnce`
 * override — without an explicit restore, a fake strategy installed by one
 * test could leak into a test declared after it.
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
const TOTAL_PIECES = DEFAULT_COLS * DEFAULT_ROWS; // 48

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
        // 16:9 image (1.778) cannot be matched exactly by a small integer
        // tile grid. The stored puzzle imageSize must fit inside the
        // original image bounds (so the image covers the puzzle with some
        // crop) rather than extend beyond them (which would show blank).
        const imageSize: Size = { width: 1920, height: 1080 };
        const state = createNewGame('test.jpg', imageSize, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom([0.5]),
            cutStyle: 'fractal',
            seed: 42,
        });
        expect(state.imageSize.width).toBeLessThanOrEqual(imageSize.width + 1e-9);
        expect(state.imageSize.height).toBeLessThanOrEqual(imageSize.height + 1e-9);
        // And at least one axis must match the image exactly (the puzzle
        // is inscribed, touching the image on one pair of edges).
        const matchesWidth = Math.abs(state.imageSize.width - imageSize.width) < 1e-6;
        const matchesHeight = Math.abs(state.imageSize.height - imageSize.height) < 1e-6;
        expect(matchesWidth || matchesHeight).toBe(true);
    });

    it('leaves imageSize unchanged when grid aspect matches image aspect', () => {
        // Classic puzzle with 8×6 grid on 4:3 image — grid aspect and image
        // aspect are 1.333 → no inscribing needed.
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

        // Each group ID should match the piece it contains
        for (const group of state.groups) {
            const [pieceId] = group.pieces.keys();
            expect(group.id).toBe(pieceId);
        }
    });

    describe('AutoGroup offset math', () => {
        // Build a minimal Piece with the only fields the auto-group offset
        // computation actually reads (id + imageOffset). The shape/edges
        // fields are unused by createInitialGroups, so we leave them empty.
        function makePiece(id: number, imageOffset: { x: number; y: number }): Piece {
            return { id, edges: [], shape: '', imageOffset, bounds: computePieceBounds({ edges: [] }) };
        }

        it('computes within-group offsets as anchor.imageOffset - piece.imageOffset', () => {
            // Two pieces in the same auto-group with distinct image offsets.
            // anchor (id 0): imageOffset (0, 0)
            // other  (id 1): imageOffset (-100, -50)
            // Expected within-group offsets:
            //   anchor → (0, 0)
            //   other  → (0,0) - (-100,-50) = (100, 50)
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

            // One group containing both pieces, anchored at the lowest piece id.
            expect(groups).toHaveLength(1);
            const group = groups[0];
            expect(group.id).toBe(0);
            expect(group.pieces.size).toBe(2);
            expect(group.pieces.get(0)).toEqual({ x: 0, y: 0 });
            expect(group.pieces.get(1)).toEqual({ x: 100, y: 50 });

            // One shared position and rotation for the whole group, derived
            // from the (mocked) RNG — not per-piece.
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
        // At least one group should have a non-zero rotation given varied inputs
        expect(state.groups.some((g) => g.rotation !== 0)).toBe(true);
        // And every rotation should be a valid quarter-turn in degrees
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
        // At least one group should have a non-quarter-turn rotation
        const quarterTurns = new Set([0, 90, 180, 270]);
        expect(state.groups.some((g) => !quarterTurns.has(g.rotation))).toBe(true);
        // Every rotation should be in [0, 360)
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

describe('createNewGame piece-count mismatch reporting', () => {
    afterEach(() => {
        // Guard against the fake strategy installed below leaking into a
        // later test — see the module-level comment on `realGetCutStyleStrategy`.
        vi.mocked(getCutStyleStrategy).mockImplementation(realGetCutStyleStrategy);
    });

    it('does not call the callback for a healthy composable puzzle', () => {
        // Real generation through the topology pipeline (not the legacy
        // classic path, which structurally can never carry a
        // `pieceCountMismatch` — see the mocked test below for that case).
        // This pins that the sine base-cut's real `expectedPieceCount` hook
        // does not false-positive against its own generator's real output.
        const onPieceCountMismatch = vi.fn();
        createNewGame('img.jpg', { width: 400, height: 400 },
            { width: 800, height: 600 }, { cols: 2, rows: 2 },
            { seed: 1, cutStyle: 'composable', onPieceCountMismatch });
        expect(onPieceCountMismatch).not.toHaveBeenCalled();
    });

    it('is optional — a reported mismatch with no callback still generates', () => {
        // The `?.` on `options.onPieceCountMismatch?.(…)` is the "a diagnostic
        // must never block a game start" invariant. Exercising it needs a run
        // that actually REPORTS a mismatch while omitting the callback: on
        // legacy Classic the guarded line never executes, so dropping the `?.`
        // would leave the suite green — which is why this installs the same
        // fake strategy the test below uses instead of running a real
        // generator.
        const fakeStrategy: CutStyleStrategy = {
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
        // Forces the mismatch path without depending on a real generator
        // actually miscounting: stub the strategy lookup so
        // `generatePieces` returns a `pieceCountMismatch` directly, and
        // assert `createNewGame` forwards that exact value to the
        // callback. This is the regression check for the destructure/invoke
        // wiring in `init.ts` — deleting that wiring should fail this test.
        const mismatch: PieceCountMismatch = { expected: 4, actual: 3, baseCutId: 'fake' };
        const fakeStrategy: CutStyleStrategy = {
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
    // jsdom has no Worker, so this exercises the sync-fallback path with
    // real generation — worker-path mechanics are generate-async.test.ts's job.
    afterEach(() => {
        // Same leak guard as the `createNewGame piece-count mismatch
        // reporting` describe above: a `mockImplementationOnce` left
        // unconsumed (e.g. a test failing before the call) must not leak
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
        // Reuses the fake-strategy fixture from the `createNewGame`
        // mismatch tests above to pin that `createNewGameAsync` forwards a
        // reported mismatch the same way the sync path does, and that the
        // callback has already run by the time the returned promise
        // resolves (`onPieceCountMismatch` fires inside `assembleGameState`,
        // which runs after the `await`).
        const mismatch: PieceCountMismatch = { expected: 4, actual: 3, baseCutId: 'fake' };
        const fakeStrategy: CutStyleStrategy = {
            scaleGrid: (grid) => grid,
            inscribePuzzleSize: (imageSize) => imageSize,
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

    it('rejects with GenerationCancelledError on an aborted signal', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(createNewGameAsync(
            'img.jpg', imageSize, viewport, { cols: 4, rows: 3 }, { seed: 1 },
            controller.signal,
        )).rejects.toBeInstanceOf(GenerationCancelledError);
    });
});
