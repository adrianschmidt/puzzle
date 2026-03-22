import { describe, it, expect } from 'vitest';
import {
    generateProceduralPuzzle,
    randomTabParams,
    buildWobbleLine,
    buildProceduralEdgePath,
    Dir,
} from './procedural-generator.js';
import { createSeededRandom } from './seeded-random.js';

describe('generateProceduralPuzzle', () => {
    const cols = 8;
    const rows = 6;
    const imageSize = { width: 800, height: 600 };
    const seed = 42;
    const pieces = generateProceduralPuzzle(cols, rows, imageSize, seed);

    it('generates the correct number of pieces', () => {
        expect(pieces).toHaveLength(cols * rows);
    });

    it('assigns unique IDs to all pieces', () => {
        const ids = pieces.map((p) => p.id);
        expect(new Set(ids).size).toBe(pieces.length);
    });

    it('gives each piece exactly 4 edges', () => {
        for (const piece of pieces) {
            expect(piece.edges).toHaveLength(4);
        }
    });

    it('assigns unique IDs to all edges across all pieces', () => {
        const edgeIds = pieces.flatMap((p) => p.edges.map((e) => e.id));
        expect(new Set(edgeIds).size).toBe(edgeIds.length);
    });

    it('produces symmetric mate relationships', () => {
        for (const piece of pieces) {
            for (const edge of piece.edges) {
                if (edge.mateEdgeId === -1) continue;

                const matePiece = pieces.find((p) => p.id === edge.matePieceId);
                expect(matePiece, `Mate piece ${edge.matePieceId} not found`).toBeDefined();

                const mateEdge = matePiece!.edges.find((e) => e.id === edge.mateEdgeId);
                expect(mateEdge, `Mate edge ${edge.mateEdgeId} not found on piece ${matePiece!.id}`).toBeDefined();

                expect(mateEdge!.matePieceId).toBe(piece.id);
                expect(mateEdge!.mateEdgeId).toBe(edge.id);
            }
        }
    });

    it('marks border edges correctly', () => {
        for (const piece of pieces) {
            const row = Math.floor(piece.id / cols);
            const col = piece.id % cols;
            const [top, right, bottom, left] = piece.edges;

            if (row === 0) {
                expect(top.mateEdgeId).toBe(-1);
                expect(top.matePieceId).toBe(-1);
            } else {
                expect(top.mateEdgeId).not.toBe(-1);
                expect(top.matePieceId).not.toBe(-1);
            }

            if (row === rows - 1) {
                expect(bottom.mateEdgeId).toBe(-1);
            } else {
                expect(bottom.mateEdgeId).not.toBe(-1);
            }

            if (col === 0) {
                expect(left.mateEdgeId).toBe(-1);
            } else {
                expect(left.mateEdgeId).not.toBe(-1);
            }

            if (col === cols - 1) {
                expect(right.mateEdgeId).toBe(-1);
            } else {
                expect(right.mateEdgeId).not.toBe(-1);
            }
        }
    });

    it('produces correct image offsets', () => {
        const pieceWidth = imageSize.width / cols;
        const pieceHeight = imageSize.height / rows;

        for (const piece of pieces) {
            const row = Math.floor(piece.id / cols);
            const col = piece.id % cols;

            expect(piece.imageOffset.x).toBe(-col * pieceWidth);
            expect(piece.imageOffset.y).toBe(-row * pieceHeight);
        }
    });

    it('produces valid SVG path shapes', () => {
        for (const piece of pieces) {
            expect(piece.shape).toMatch(/^M /);
            expect(piece.shape).toMatch(/ Z$/);
        }
    });

    it('produces non-empty edge paths', () => {
        for (const piece of pieces) {
            for (const edge of piece.edges) {
                expect(edge.path.length).toBeGreaterThan(0);
            }
        }
    });

    it('corner pieces have exactly 2 border edges', () => {
        const corners = [
            0,
            cols - 1,
            (rows - 1) * cols,
            rows * cols - 1,
        ];

        for (const cornerId of corners) {
            const piece = pieces.find((p) => p.id === cornerId)!;
            const borderCount = piece.edges.filter((e) => e.mateEdgeId === -1).length;
            expect(borderCount, `Corner piece ${cornerId}`).toBe(2);
        }
    });

    it('non-corner edge pieces have exactly 1 border edge', () => {
        for (const piece of pieces) {
            const row = Math.floor(piece.id / cols);
            const col = piece.id % cols;
            const isEdge = row === 0 || row === rows - 1 || col === 0 || col === cols - 1;
            const isCorner =
                (row === 0 || row === rows - 1) && (col === 0 || col === cols - 1);

            if (isEdge && !isCorner) {
                const borderCount = piece.edges.filter((e) => e.mateEdgeId === -1).length;
                expect(borderCount, `Edge piece ${piece.id}`).toBe(1);
            }
        }
    });

    it('interior pieces have no border edges', () => {
        for (const piece of pieces) {
            const row = Math.floor(piece.id / cols);
            const col = piece.id % cols;
            const isInterior = row > 0 && row < rows - 1 && col > 0 && col < cols - 1;

            if (isInterior) {
                const borderCount = piece.edges.filter((e) => e.mateEdgeId === -1).length;
                expect(borderCount, `Interior piece ${piece.id}`).toBe(0);
            }
        }
    });

    it('internal edges use cubic Bézier curves (C commands)', () => {
        for (const piece of pieces) {
            for (const edge of piece.edges) {
                if (edge.mateEdgeId === -1) continue;
                // Should contain C (cubic Bézier) commands for the tab shape
                expect(edge.path).toContain('C ');
            }
        }
    });

    it('internal edges use quadratic Bézier (Q) for wobble segments', () => {
        for (const piece of pieces) {
            for (const edge of piece.edges) {
                if (edge.mateEdgeId === -1) continue;
                // Should contain Q (quadratic Bézier) for wobble lines
                expect(edge.path).toContain('Q ');
            }
        }
    });
});

describe('reproducibility', () => {
    it('same seed produces identical pieces', () => {
        const imageSize = { width: 800, height: 600 };
        const pieces1 = generateProceduralPuzzle(8, 6, imageSize, 99999);
        const pieces2 = generateProceduralPuzzle(8, 6, imageSize, 99999);

        expect(pieces1).toEqual(pieces2);
    });

    it('different seeds produce different piece shapes', () => {
        const imageSize = { width: 800, height: 600 };
        const pieces1 = generateProceduralPuzzle(8, 6, imageSize, 1);
        const pieces2 = generateProceduralPuzzle(8, 6, imageSize, 2);

        // Shapes should differ — check a few interior pieces
        const interiorPiece1 = pieces1.find((p) => p.id === 9)!; // row 1, col 1
        const interiorPiece2 = pieces2.find((p) => p.id === 9)!;

        expect(interiorPiece1.shape).not.toBe(interiorPiece2.shape);
    });
});

describe('different grid sizes', () => {
    it('works with a 2×2 grid', () => {
        const pieces = generateProceduralPuzzle(2, 2, { width: 200, height: 200 }, 42);
        expect(pieces).toHaveLength(4);

        for (const piece of pieces) {
            const borderCount = piece.edges.filter((e) => e.mateEdgeId === -1).length;
            expect(borderCount).toBe(2);
        }
    });

    it('works with a 1×1 grid (single piece)', () => {
        const pieces = generateProceduralPuzzle(1, 1, { width: 100, height: 100 }, 42);
        expect(pieces).toHaveLength(1);

        const borderCount = pieces[0].edges.filter((e) => e.mateEdgeId === -1).length;
        expect(borderCount).toBe(4);
    });

    it('works with a non-square grid', () => {
        const pieces = generateProceduralPuzzle(3, 5, { width: 300, height: 500 }, 42);
        expect(pieces).toHaveLength(15);
    });

    it('works with large grids', () => {
        const pieces = generateProceduralPuzzle(12, 16, { width: 1200, height: 1600 }, 42);
        expect(pieces).toHaveLength(192);

        // Verify mate symmetry on larger grid too
        for (const piece of pieces) {
            for (const edge of piece.edges) {
                if (edge.mateEdgeId === -1) continue;

                const matePiece = pieces.find((p) => p.id === edge.matePieceId)!;
                const mateEdge = matePiece.edges.find((e) => e.id === edge.mateEdgeId)!;
                expect(mateEdge.matePieceId).toBe(piece.id);
            }
        }
    });
});

describe('randomTabParams', () => {
    it('produces values within expected ranges', () => {
        const random = createSeededRandom(42);

        for (let i = 0; i < 100; i++) {
            const params = randomTabParams(random);

            expect(typeof params.isTab).toBe('boolean');
            expect(params.heightFraction).toBeGreaterThanOrEqual(0.22);
            expect(params.heightFraction).toBeLessThanOrEqual(0.36);
            expect(params.neckFraction).toBeGreaterThanOrEqual(0.04);
            expect(params.neckFraction).toBeLessThanOrEqual(0.09);
            expect(params.headWidthFraction).toBeGreaterThanOrEqual(0.18);
            expect(params.headWidthFraction).toBeLessThanOrEqual(0.30);
            expect(params.centreOffset).toBeGreaterThanOrEqual(-0.05);
            expect(params.centreOffset).toBeLessThanOrEqual(0.05);
            expect(params.skew).toBeGreaterThanOrEqual(-0.03);
            expect(params.skew).toBeLessThanOrEqual(0.03);
            expect(params.headProfile).toBeGreaterThanOrEqual(0);
            expect(params.headProfile).toBeLessThanOrEqual(1);
            expect(params.neckPinch).toBeGreaterThanOrEqual(0.3);
            expect(params.neckPinch).toBeLessThanOrEqual(0.8);
            expect(params.wobbleAmplitude).toBeGreaterThanOrEqual(0.003);
            expect(params.wobbleAmplitude).toBeLessThanOrEqual(0.012);
            expect(params.wobblePhase).toBeGreaterThanOrEqual(0);
            expect(params.wobblePhase).toBeLessThanOrEqual(Math.PI * 2);
        }
    });

    it('produces varied values across calls', () => {
        const random = createSeededRandom(42);
        const params1 = randomTabParams(random);
        const params2 = randomTabParams(random);

        // At least one parameter should differ
        const allSame =
            params1.heightFraction === params2.heightFraction &&
            params1.neckFraction === params2.neckFraction &&
            params1.headWidthFraction === params2.headWidthFraction &&
            params1.centreOffset === params2.centreOffset &&
            params1.skew === params2.skew &&
            params1.headProfile === params2.headProfile &&
            params1.neckPinch === params2.neckPinch;

        expect(allSame).toBe(false);
    });

    it('head width is always wider than neck width', () => {
        const random = createSeededRandom(42);

        for (let i = 0; i < 200; i++) {
            const params = randomTabParams(random);
            expect(params.headWidthFraction).toBeGreaterThan(params.neckFraction);
        }
    });
});

describe('edge path variation', () => {
    it('internal edges of different pieces have different paths', () => {
        const pieces = generateProceduralPuzzle(4, 4, { width: 400, height: 400 }, 42);

        // Collect all internal edge paths
        const internalPaths = pieces.flatMap((p) =>
            p.edges.filter((e) => e.mateEdgeId !== -1).map((e) => e.path),
        );

        // There should be many unique paths (not all identical like old generator)
        const uniquePaths = new Set(internalPaths);

        // With a 4×4 grid there are 24 shared internal edges (×2 sides = 48 internal edge paths)
        // Each shared edge has unique params, so paths should be varied
        // We expect at least half to be unique (both sides of a shared edge differ
        // because one is tab and one is blank with same params)
        expect(uniquePaths.size).toBeGreaterThan(internalPaths.length / 4);
    });
});

describe('buildWobbleLine', () => {
    it('returns a straight line for very short segments', () => {
        const result = buildWobbleLine(
            { x: 10, y: 10 },
            { x: 10.5, y: 10 },
            0, -1, 5, 0,
        );
        expect(result).toMatch(/^L /);
    });

    it('returns a quadratic Bézier for normal-length segments', () => {
        const result = buildWobbleLine(
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            0, -1, 3, 1.0,
        );
        expect(result).toMatch(/^Q /);
    });

    it('control point is offset perpendicular to the line', () => {
        // Horizontal line with normal pointing up (nx=0, ny=-1)
        // With positive sin(phase) * amplitude, the CP should be offset upward (negative y)
        const phase = Math.PI / 2; // sin(π/2) = 1
        const amplitude = 5;
        const result = buildWobbleLine(
            { x: 0, y: 50 },
            { x: 100, y: 50 },
            0, -1, amplitude, phase,
        );

        // Parse the Q command: Q cpX cpY, toX toY
        const match = result.match(/Q ([\d.-]+) ([\d.-]+),/);
        expect(match).not.toBeNull();

        const cpX = parseFloat(match![1]);
        const cpY = parseFloat(match![2]);

        // CP should be at midpoint x=50, with y offset = 50 + (-1)*5 = 45
        expect(cpX).toBeCloseTo(50, 1);
        expect(cpY).toBeCloseTo(45, 1);
    });

    it('wobble amplitude of 0 produces a nearly straight line', () => {
        const result = buildWobbleLine(
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            0, -1, 0, 1.0,
        );
        // CP should be very close to the midpoint (50, 0)
        const match = result.match(/Q ([\d.-]+) ([\d.-]+),/);
        expect(match).not.toBeNull();

        const cpX = parseFloat(match![1]);
        const cpY = parseFloat(match![2]);

        expect(cpX).toBeCloseTo(50, 1);
        expect(cpY).toBeCloseTo(0, 1);
    });
});

describe('buildProceduralEdgePath', () => {
    const defaultParams = (): import('./procedural-generator.js').TabParams => ({
        isTab: true,
        heightFraction: 0.28,
        neckFraction: 0.065,
        headWidthFraction: 0.24,
        centreOffset: 0,
        skew: 0,
        headProfile: 0,
        neckPinch: 0.5,
        wobbleAmplitude: 0.006,
        wobblePhase: 0,
    });

    it('contains cubic Bézier commands for the tab shape', () => {
        const path = buildProceduralEdgePath(
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            Dir.Top,
            true,
            defaultParams(),
        );

        // Should have multiple C commands (neck + head curves)
        const cCount = (path.match(/C /g) || []).length;
        expect(cCount).toBeGreaterThanOrEqual(4);
    });

    it('contains Q commands for wobble segments', () => {
        const path = buildProceduralEdgePath(
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            Dir.Top,
            true,
            defaultParams(),
        );

        // Should have Q commands for wobble lines before and after tab
        const qCount = (path.match(/Q /g) || []).length;
        expect(qCount).toBeGreaterThanOrEqual(2);
    });

    it('tab extends outward (positive normal direction)', () => {
        // Horizontal top edge: start (0,0) → end (100,0)
        // Normal points upward (nx=0, ny changes sign based on isTab)
        const tabPath = buildProceduralEdgePath(
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            Dir.Top,
            true, // tab protrudes outward
            defaultParams(),
        );

        // Extract Y coordinates from the path — tab should have negative Y values
        // (protruding "up" from a top edge)
        const yValues = [...tabPath.matchAll(/([\d.-]+)/g)]
            .map((m) => parseFloat(m[1]))
            .filter((_, i) => i % 2 === 1); // every other number is Y

        const minY = Math.min(...yValues);
        expect(minY).toBeLessThan(0); // tab extends above the edge line
    });

    it('blank indents inward (negative normal direction)', () => {
        const blankPath = buildProceduralEdgePath(
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            Dir.Top,
            false, // blank indents inward
            defaultParams(),
        );

        // Extract Y coordinates — blank should have positive Y values
        const yValues = [...blankPath.matchAll(/([\d.-]+)/g)]
            .map((m) => parseFloat(m[1]))
            .filter((_, i) => i % 2 === 1);

        const maxY = Math.max(...yValues);
        expect(maxY).toBeGreaterThan(0); // blank extends below the edge line
    });

    it('different head profiles produce different paths', () => {
        const roundParams = { ...defaultParams(), headProfile: 0 };
        const squareParams = { ...defaultParams(), headProfile: 0.5 };
        const heartParams = { ...defaultParams(), headProfile: 1.0 };

        const roundPath = buildProceduralEdgePath(
            { x: 0, y: 0 }, { x: 100, y: 0 }, Dir.Top, true, roundParams,
        );
        const squarePath = buildProceduralEdgePath(
            { x: 0, y: 0 }, { x: 100, y: 0 }, Dir.Top, true, squareParams,
        );
        const heartPath = buildProceduralEdgePath(
            { x: 0, y: 0 }, { x: 100, y: 0 }, Dir.Top, true, heartParams,
        );

        // All three should be different
        expect(roundPath).not.toBe(squarePath);
        expect(squarePath).not.toBe(heartPath);
        expect(roundPath).not.toBe(heartPath);
    });

    it('skew shifts the tab head along the edge', () => {
        const noSkew = { ...defaultParams(), skew: 0 };
        const rightSkew = { ...defaultParams(), skew: 0.03 };

        const pathNoSkew = buildProceduralEdgePath(
            { x: 0, y: 0 }, { x: 100, y: 0 }, Dir.Top, true, noSkew,
        );
        const pathRightSkew = buildProceduralEdgePath(
            { x: 0, y: 0 }, { x: 100, y: 0 }, Dir.Top, true, rightSkew,
        );

        expect(pathNoSkew).not.toBe(pathRightSkew);
    });

    it('produces valid SVG path data (no NaN or Infinity)', () => {
        const random = createSeededRandom(42);

        for (let i = 0; i < 50; i++) {
            const params = randomTabParams(random);
            const path = buildProceduralEdgePath(
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                Dir.Top,
                params.isTab,
                params,
            );

            expect(path).not.toContain('NaN');
            expect(path).not.toContain('Infinity');
        }
    });

    it('works for all four edge directions', () => {
        const params = defaultParams();
        const dirs = [Dir.Top, Dir.Right, Dir.Bottom, Dir.Left] as const;
        const endpoints: [{ x: number; y: number }, { x: number; y: number }][] = [
            [{ x: 0, y: 0 }, { x: 100, y: 0 }],     // Top
            [{ x: 100, y: 0 }, { x: 100, y: 100 }],   // Right
            [{ x: 100, y: 100 }, { x: 0, y: 100 }],   // Bottom
            [{ x: 0, y: 100 }, { x: 0, y: 0 }],       // Left
        ];

        for (let i = 0; i < dirs.length; i++) {
            const path = buildProceduralEdgePath(
                endpoints[i][0],
                endpoints[i][1],
                dirs[i],
                true,
                params,
            );

            expect(path).not.toContain('NaN');
            expect(path).not.toContain('Infinity');
            expect(path.length).toBeGreaterThan(0);
        }
    });
});

describe('neck narrower than head (mushroom shape)', () => {
    it('the head is consistently wider than the neck across many random params', () => {
        const random = createSeededRandom(123);

        for (let i = 0; i < 200; i++) {
            const params = randomTabParams(random);
            // headWidthFraction should always exceed neckFraction
            // (enforced by the parameter ranges: neck max 0.09 < head min 0.18)
            expect(params.headWidthFraction).toBeGreaterThan(params.neckFraction * 1.5);
        }
    });
});
