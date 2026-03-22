import { describe, it, expect } from 'vitest';
import {
    getImageDimensions,
    getPieceBaseDimension,
    getGridCols,
    getGridRows,
    PIECE_PADDING,
} from './svg-dom-utils.js';
import type { Edge, GameState, Piece } from '../model/types.js';

/** Create a minimal edge with start/end points. */
function edge(
    start: { x: number; y: number },
    end: { x: number; y: number },
): Edge {
    return {
        id: 0,
        mateEdgeId: -1,
        matePieceId: -1,
        path: `L ${end.x} ${end.y}`,
        start,
        end,
    };
}

/** Create a rectangular piece with given cell dimensions. */
function rectPiece(
    id: number,
    width: number,
    height: number,
    offsetX = 0,
    offsetY = 0,
): Piece {
    return {
        id,
        edges: [
            edge({ x: 0, y: 0 }, { x: width, y: 0 }),       // top
            edge({ x: width, y: 0 }, { x: width, y: height }), // right
            edge({ x: width, y: height }, { x: 0, y: height }), // bottom
            edge({ x: 0, y: height }, { x: 0, y: 0 }),         // left
        ],
        shape: `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`,
        imageOffset: { x: offsetX, y: offsetY },
    };
}

/** Create a minimal GameState with the given pieces. */
function gameState(pieces: Piece[]): GameState {
    return {
        pieces,
        groups: [],
        imageUrl: 'test.jpg',
        imageSize: { width: 800, height: 600 },
        completed: false,
    };
}

describe('PIECE_PADDING', () => {
    it('is a positive number', () => {
        expect(PIECE_PADDING).toBeGreaterThan(0);
    });
});

describe('getPieceBaseDimension', () => {
    it('returns width from edge endpoints', () => {
        const piece = rectPiece(0, 100, 75);
        expect(getPieceBaseDimension(piece, 'x')).toBe(100);
    });

    it('returns height from edge endpoints', () => {
        const piece = rectPiece(0, 100, 75);
        expect(getPieceBaseDimension(piece, 'y')).toBe(75);
    });

    it('handles square pieces', () => {
        const piece = rectPiece(0, 50, 50);
        expect(getPieceBaseDimension(piece, 'x')).toBe(50);
        expect(getPieceBaseDimension(piece, 'y')).toBe(50);
    });
});

describe('getImageDimensions', () => {
    it('returns 0×0 for empty state', () => {
        const state = gameState([]);
        expect(getImageDimensions(state)).toEqual({ width: 0, height: 0 });
    });

    it('returns correct size for a single piece', () => {
        const state = gameState([rectPiece(0, 100, 75, 0, 0)]);
        expect(getImageDimensions(state)).toEqual({ width: 100, height: 75 });
    });

    it('returns correct size for a 2×2 grid', () => {
        const pieces = [
            rectPiece(0, 100, 75, 0, 0),       // top-left
            rectPiece(1, 100, 75, -100, 0),     // top-right
            rectPiece(2, 100, 75, 0, -75),      // bottom-left
            rectPiece(3, 100, 75, -100, -75),   // bottom-right
        ];
        const state = gameState(pieces);
        expect(getImageDimensions(state)).toEqual({ width: 200, height: 150 });
    });

    it('returns correct size for a 6×8 grid (800×600)', () => {
        const pieces: Piece[] = [];
        const pw = 100; // 800/8
        const ph = 100; // 600/6

        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 8; col++) {
                pieces.push(
                    rectPiece(
                        row * 8 + col,
                        pw,
                        ph,
                        -col * pw,
                        -row * ph,
                    ),
                );
            }
        }

        const state = gameState(pieces);
        expect(getImageDimensions(state)).toEqual({ width: 800, height: 600 });
    });
});

describe('getGridCols', () => {
    it('returns 1 for empty state', () => {
        expect(getGridCols(gameState([]))).toBe(1);
    });

    it('returns 1 for a single piece', () => {
        expect(getGridCols(gameState([rectPiece(0, 100, 100)]))).toBe(1);
    });

    it('returns correct column count for a 3×2 grid', () => {
        const pieces = [
            rectPiece(0, 50, 50, 0, 0),
            rectPiece(1, 50, 50, -50, 0),
            rectPiece(2, 50, 50, -100, 0),
            rectPiece(3, 50, 50, 0, -50),
            rectPiece(4, 50, 50, -50, -50),
            rectPiece(5, 50, 50, -100, -50),
        ];

        expect(getGridCols(gameState(pieces))).toBe(3);
    });
});

describe('getGridRows', () => {
    it('returns 1 for empty state', () => {
        expect(getGridRows(gameState([]))).toBe(1);
    });

    it('returns 1 for a single piece', () => {
        expect(getGridRows(gameState([rectPiece(0, 100, 100)]))).toBe(1);
    });

    it('returns correct row count for a 3×2 grid', () => {
        const pieces = [
            rectPiece(0, 50, 50, 0, 0),
            rectPiece(1, 50, 50, -50, 0),
            rectPiece(2, 50, 50, -100, 0),
            rectPiece(3, 50, 50, 0, -50),
            rectPiece(4, 50, 50, -50, -50),
            rectPiece(5, 50, 50, -100, -50),
        ];

        expect(getGridRows(gameState(pieces))).toBe(2);
    });
});
