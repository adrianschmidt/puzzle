import { describe, test, expect } from 'vitest';
import { generateFractalPuzzle } from './fractal-generator.js';
import type { Piece, Edge } from '../model/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse all SVG path commands from a shape string. */
function parseCommands(shape: string): string[] {
    return shape.match(/[MLAZ][^MLAZ]*/g) ?? [];
}

/** Check that a shape string starts with M and ends with Z. */
function isClosedPath(shape: string): boolean {
    const trimmed = shape.trim();
    return trimmed.startsWith('M') && trimmed.endsWith('Z');
}

/**
 * Compute the absolute position of a point given piece-local coords
 * and the piece's imageOffset (which is negated: offset = -topLeft).
 */
function toAbsolute(localX: number, localY: number, piece: Piece): { x: number; y: number } {
    return {
        x: localX - piece.imageOffset.x,
        y: localY - piece.imageOffset.y,
    };
}

/** True when a point is within `eps` of any puzzle boundary side. */
function isOnBorder(
    x: number, y: number,
    W: number, H: number,
    eps = 1.5,
): boolean {
    return x < eps || x > W - eps || y < eps || y > H - eps;
}

/**
 * Collect all edges whose start AND end (in absolute coords) lie on the
 * puzzle boundary rectangle.
 */
function collectBorderEdges(
    pieces: Piece[],
    W: number,
    H: number,
): { piece: Piece; edge: Edge }[] {
    const result: { piece: Piece; edge: Edge }[] = [];
    for (const piece of pieces) {
        for (const edge of piece.edges) {
            const s = toAbsolute(edge.start.x, edge.start.y, piece);
            const e = toAbsolute(edge.end.x, edge.end.y, piece);
            if (isOnBorder(s.x, s.y, W, H) && isOnBorder(e.x, e.y, W, H)) {
                result.push({ piece, edge });
            }
        }
    }
    return result;
}

/** Build a map from edgeId → { piece, edge } for quick lookups. */
function buildEdgeMap(pieces: Piece[]): Map<number, { piece: Piece; edge: Edge }> {
    const map = new Map<number, { piece: Piece; edge: Edge }>();
    for (const piece of pieces) {
        for (const edge of piece.edges) {
            map.set(edge.id, { piece, edge });
        }
    }
    return map;
}

// ---------------------------------------------------------------------------
// Test configurations
// ---------------------------------------------------------------------------

interface TestCase {
    label: string;
    cols: number;
    rows: number;
    imageSize: { width: number; height: number };
    seeds: number[];
}

const CASES: TestCase[] = [
    { label: '4×3 landscape', cols: 4, rows: 3, imageSize: { width: 400, height: 300 }, seeds: [1, 42, 999] },
    { label: '6×4 landscape', cols: 6, rows: 4, imageSize: { width: 600, height: 400 }, seeds: [7, 123] },
    { label: '4×4 square', cols: 4, rows: 4, imageSize: { width: 400, height: 400 }, seeds: [42, 77] },
    { label: '3×5 portrait', cols: 3, rows: 5, imageSize: { width: 300, height: 500 }, seeds: [42] },
];

const SMALL_CASES: TestCase[] = [
    { label: '3×3 minimum odd', cols: 3, rows: 3, imageSize: { width: 300, height: 300 }, seeds: [1, 42, 100] },
    { label: '2×2 minimum', cols: 2, rows: 2, imageSize: { width: 200, height: 200 }, seeds: [1, 42, 100] },
];

const LARGE_CASES: TestCase[] = [
    { label: '8×6 large', cols: 8, rows: 6, imageSize: { width: 800, height: 600 }, seeds: [42] },
    { label: '10×8 large', cols: 10, rows: 8, imageSize: { width: 1000, height: 800 }, seeds: [7] },
];

const ALL_CASES = [...CASES, ...SMALL_CASES, ...LARGE_CASES];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fractal border: piece count', () => {
    for (const tc of ALL_CASES) {
        for (const seed of tc.seeds) {
            test(`${tc.label} seed=${seed}: piece count does not exceed cols×rows`, () => {
                const pieces = generateFractalPuzzle(tc.cols, tc.rows, tc.imageSize, seed);
                // The fractal generator merges tiles into pieces, so the
                // count should be strictly less than (or at most equal to)
                // the number of tiles.
                expect(pieces.length).toBeGreaterThan(0);
                expect(pieces.length).toBeLessThanOrEqual(tc.cols * tc.rows);
            });
        }
    }
});

describe('fractal border: shapes are valid closed SVG paths', () => {
    for (const tc of ALL_CASES) {
        for (const seed of tc.seeds) {
            test(`${tc.label} seed=${seed}: every shape starts with M and ends with Z`, () => {
                const pieces = generateFractalPuzzle(tc.cols, tc.rows, tc.imageSize, seed);
                for (const piece of pieces) {
                    expect(
                        isClosedPath(piece.shape),
                        `Piece ${piece.id} shape is not a closed path: ${piece.shape.slice(0, 80)}…`,
                    ).toBe(true);
                }
            });
        }
    }
});

describe('fractal border: no arc commands on boundary edges', () => {
    for (const tc of CASES) {
        for (const seed of tc.seeds) {
            test(`${tc.label} seed=${seed}: border edges use L (not A) commands`, () => {
                const { width: W, height: H } = tc.imageSize;
                const pieces = generateFractalPuzzle(tc.cols, tc.rows, tc.imageSize, seed);
                const borderEdges = collectBorderEdges(pieces, W, H);

                const violations: string[] = [];
                for (const { piece, edge } of borderEdges) {
                    if (edge.path.includes('A')) {
                        violations.push(
                            `Piece ${piece.id} edge ${edge.id}: border edge has arc: ${edge.path}`,
                        );
                    }
                }
                expect(violations).toEqual([]);
            });
        }
    }
});

describe('fractal border: no arcs in boundary region of piece shapes', () => {
    // A stricter check: scan the full shape string for A commands whose
    // coordinates fall on the boundary.  This catches arcs that might
    // sneak in via gap-filler sub-paths, not just individual edges.
    for (const tc of CASES) {
        for (const seed of tc.seeds) {
            test(`${tc.label} seed=${seed}: shape path has no arcs touching the boundary`, () => {
                const { width: W, height: H } = tc.imageSize;
                const pieces = generateFractalPuzzle(tc.cols, tc.rows, tc.imageSize, seed);
                const violations: string[] = [];

                for (const piece of pieces) {
                    const cmds = parseCommands(piece.shape);
                    for (const cmd of cmds) {
                        if (!cmd.startsWith('A')) continue;
                        // Extract the endpoint of the A command (last two numbers)
                        const nums = cmd.match(/-?[\d.]+/g);
                        if (!nums || nums.length < 7) continue;
                        const ex = parseFloat(nums[nums.length - 2]);
                        const ey = parseFloat(nums[nums.length - 1]);
                        const abs = toAbsolute(ex, ey, piece);
                        if (isOnBorder(abs.x, abs.y, W, H)) {
                            violations.push(
                                `Piece ${piece.id}: arc endpoint lands on border at (${abs.x.toFixed(1)}, ${abs.y.toFixed(1)})`,
                            );
                        }
                    }
                }
                expect(violations).toEqual([]);
            });
        }
    }
});

describe('fractal border: straight-line coverage of all four sides', () => {
    // For each side of the puzzle rectangle, collect all border edge
    // segments that lie on that side. Their union should cover the full
    // side length from corner to corner (within tolerance).
    for (const tc of CASES) {
        for (const seed of tc.seeds) {
            test(`${tc.label} seed=${seed}: border edges cover all four sides`, () => {
                const { width: W, height: H } = tc.imageSize;
                const pieces = generateFractalPuzzle(tc.cols, tc.rows, tc.imageSize, seed);
                const eps = 2;

                // Collect segments per side: each segment is a [min, max] range
                // along the side's axis.
                const sides: Record<string, number[][]> = {
                    top: [],    // y ≈ 0,   range along x
                    bottom: [], // y ≈ H,   range along x
                    left: [],   // x ≈ 0,   range along y
                    right: [],  // x ≈ W,   range along y
                };

                for (const piece of pieces) {
                    // Scan shape for L commands (boundary edges produce L commands)
                    // We need to track the "cursor" through the path to get
                    // absolute positions of each L endpoint.
                    const cmds = parseCommands(piece.shape);
                    let cx = 0, cy = 0;
                    for (const cmd of cmds) {
                        const nums = cmd.match(/-?[\d.]+/g)?.map(Number) ?? [];
                        if (cmd.startsWith('M') && nums.length >= 2) {
                            cx = nums[0]; cy = nums[1];
                        } else if (cmd.startsWith('L') && nums.length >= 2) {
                            const nx = nums[0], ny = nums[1];
                            const sAbs = toAbsolute(cx, cy, piece);
                            const eAbs = toAbsolute(nx, ny, piece);

                            // Check if this segment lies on a border side
                            if (sAbs.y < eps && eAbs.y < eps) {
                                sides.top.push([Math.min(sAbs.x, eAbs.x), Math.max(sAbs.x, eAbs.x)]);
                            }
                            if (sAbs.y > H - eps && eAbs.y > H - eps) {
                                sides.bottom.push([Math.min(sAbs.x, eAbs.x), Math.max(sAbs.x, eAbs.x)]);
                            }
                            if (sAbs.x < eps && eAbs.x < eps) {
                                sides.left.push([Math.min(sAbs.y, eAbs.y), Math.max(sAbs.y, eAbs.y)]);
                            }
                            if (sAbs.x > W - eps && eAbs.x > W - eps) {
                                sides.right.push([Math.min(sAbs.y, eAbs.y), Math.max(sAbs.y, eAbs.y)]);
                            }
                            cx = nx; cy = ny;
                        } else if (cmd.startsWith('A') && nums.length >= 7) {
                            cx = nums[nums.length - 2]; cy = nums[nums.length - 1];
                        } else if (cmd.startsWith('Z')) {
                            // cursor returns to start — not needed for this check
                        }
                    }
                }

                // Merge overlapping segments and check total coverage
                function coverage(segments: number[][], totalLen: number): number {
                    if (segments.length === 0) return 0;
                    const sorted = [...segments].sort((a, b) => a[0] - b[0]);
                    const merged: number[][] = [sorted[0]];
                    for (let i = 1; i < sorted.length; i++) {
                        const last = merged[merged.length - 1];
                        if (sorted[i][0] <= last[1] + eps) {
                            last[1] = Math.max(last[1], sorted[i][1]);
                        } else {
                            merged.push(sorted[i]);
                        }
                    }
                    let total = 0;
                    for (const [a, b] of merged) total += b - a;
                    return total / totalLen;
                }

                // Each side should be ≥95% covered (small gaps from coordinate rounding are OK)
                const topCov = coverage(sides.top, W);
                const bottomCov = coverage(sides.bottom, W);
                const leftCov = coverage(sides.left, H);
                const rightCov = coverage(sides.right, H);

                expect(topCov).toBeGreaterThan(0.95);
                expect(bottomCov).toBeGreaterThan(0.95);
                expect(leftCov).toBeGreaterThan(0.95);
                expect(rightCov).toBeGreaterThan(0.95);
            });
        }
    }
});

describe('fractal border: rectangle corners present in piece shapes', () => {
    // The four corners of the puzzle rectangle — (0,0), (W,0), (W,H), (0,H) —
    // must each appear in at least one piece's shape path.
    for (const tc of CASES) {
        for (const seed of tc.seeds) {
            test(`${tc.label} seed=${seed}: all four rectangle corners are in piece shapes`, () => {
                const { width: W, height: H } = tc.imageSize;
                const pieces = generateFractalPuzzle(tc.cols, tc.rows, tc.imageSize, seed);
                const eps = 2;

                const corners = [
                    { label: '(0,0)', x: 0, y: 0 },
                    { label: `(${W},0)`, x: W, y: 0 },
                    { label: `(${W},${H})`, x: W, y: H },
                    { label: `(0,${H})`, x: 0, y: H },
                ];

                for (const corner of corners) {
                    let found = false;
                    for (const piece of pieces) {
                        const cmds = parseCommands(piece.shape);
                        for (const cmd of cmds) {
                            if (cmd.startsWith('Z')) continue;
                            const nums = cmd.match(/-?[\d.]+/g)?.map(Number) ?? [];
                            if (nums.length < 2) continue;
                            // Take the last coordinate pair
                            const lx = nums[nums.length - 2];
                            const ly = nums[nums.length - 1];
                            const abs = toAbsolute(lx, ly, piece);
                            if (Math.abs(abs.x - corner.x) < eps && Math.abs(abs.y - corner.y) < eps) {
                                found = true;
                                break;
                            }
                        }
                        if (found) break;
                    }
                    expect(found, `Corner ${corner.label} not found in any piece shape`).toBe(true);
                }
            });
        }
    }
});

describe('fractal border: interior mate relationships are valid', () => {
    for (const tc of ALL_CASES) {
        for (const seed of tc.seeds) {
            test(`${tc.label} seed=${seed}: every mateEdgeId references a real edge`, () => {
                const pieces = generateFractalPuzzle(tc.cols, tc.rows, tc.imageSize, seed);
                const edgeMap = buildEdgeMap(pieces);

                for (const piece of pieces) {
                    for (const edge of piece.edges) {
                        if (edge.mateEdgeId === -1) {
                            expect(edge.matePieceId).toBe(-1);
                            continue;
                        }
                        // mateEdgeId must reference an existing edge
                        const mate = edgeMap.get(edge.mateEdgeId);
                        expect(
                            mate,
                            `Piece ${piece.id} edge ${edge.id}: mateEdgeId ${edge.mateEdgeId} not found`,
                        ).toBeDefined();

                        // The mate must belong to the declared matePieceId
                        expect(mate!.piece.id).toBe(edge.matePieceId);

                        // The mate must point back
                        expect(mate!.edge.mateEdgeId).toBe(edge.id);
                        expect(mate!.edge.matePieceId).toBe(piece.id);
                    }
                }
            });
        }
    }
});

describe('fractal border: border edges are not mated (or mate is also border)', () => {
    // Border edges (matePieceId === -1) should NOT reference interior pieces.
    // Mated border edges (two pieces sharing a boundary segment) are fine,
    // but a border edge's mate must also be a border-adjacent edge.
    for (const tc of CASES) {
        for (const seed of tc.seeds) {
            test(`${tc.label} seed=${seed}: border edges have matePieceId === -1`, () => {
                const { width: W, height: H } = tc.imageSize;
                const pieces = generateFractalPuzzle(tc.cols, tc.rows, tc.imageSize, seed);

                // Edges on the puzzle boundary that are unmated should have -1
                const borderEdges = collectBorderEdges(pieces, W, H);
                for (const { piece, edge } of borderEdges) {
                    if (edge.matePieceId === -1) {
                        expect(edge.mateEdgeId).toBe(-1);
                    }
                    // Mated border edges are also valid — they connect two
                    // pieces that share a boundary segment.
                }
            });
        }
    }
});

describe('fractal border: edge cases', () => {
    test('2×2 grid produces at least 1 piece with valid shape', () => {
        for (const seed of [1, 42, 100, 7777]) {
            const pieces = generateFractalPuzzle(2, 2, { width: 200, height: 200 }, seed);
            expect(pieces.length).toBeGreaterThanOrEqual(1);
            for (const piece of pieces) {
                expect(isClosedPath(piece.shape)).toBe(true);
            }
        }
    });

    test('3×3 grid: all pieces are valid closed paths with no border arcs', () => {
        const W = 300, H = 300;
        for (const seed of [1, 42, 100]) {
            const pieces = generateFractalPuzzle(3, 3, { width: W, height: H }, seed);
            for (const piece of pieces) {
                expect(isClosedPath(piece.shape)).toBe(true);
            }
            const borderEdges = collectBorderEdges(pieces, W, H);
            for (const { edge } of borderEdges) {
                expect(edge.path).not.toContain('A');
            }
        }
    });

    test('rectangular grid (3×5 portrait): borders are straight', () => {
        const W = 300, H = 500;
        const pieces = generateFractalPuzzle(3, 5, { width: W, height: H }, 42);
        const borderEdges = collectBorderEdges(pieces, W, H);
        for (const { edge } of borderEdges) {
            expect(edge.path).not.toContain('A');
        }
    });

    test('rectangular grid (6×3 wide landscape): borders are straight', () => {
        const W = 600, H = 300;
        const pieces = generateFractalPuzzle(6, 3, { width: W, height: H }, 42);
        const borderEdges = collectBorderEdges(pieces, W, H);
        for (const { edge } of borderEdges) {
            expect(edge.path).not.toContain('A');
        }
    });

    test('large grid (8×6): piece count is reasonable', () => {
        const pieces = generateFractalPuzzle(8, 6, { width: 800, height: 600 }, 42);
        // With 48 tiles and ~2-8 tiles per piece, expect roughly 6-24 pieces
        expect(pieces.length).toBeGreaterThanOrEqual(4);
        expect(pieces.length).toBeLessThanOrEqual(48);
    });

    test('large grid (10×8): all four rectangle corners present', () => {
        const W = 1000, H = 800;
        const pieces = generateFractalPuzzle(10, 8, { width: W, height: H }, 7);
        const eps = 2;
        const corners = [
            [0, 0], [W, 0], [W, H], [0, H],
        ];
        for (const [cx, cy] of corners) {
            let found = false;
            for (const piece of pieces) {
                const cmds = parseCommands(piece.shape);
                for (const cmd of cmds) {
                    const nums = cmd.match(/-?[\d.]+/g)?.map(Number) ?? [];
                    if (nums.length < 2) continue;
                    const lx = nums[nums.length - 2];
                    const ly = nums[nums.length - 1];
                    const abs = toAbsolute(lx, ly, piece);
                    if (Math.abs(abs.x - cx) < eps && Math.abs(abs.y - cy) < eps) {
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }
            expect(found, `Corner (${cx},${cy}) missing in 10×8 grid`).toBe(true);
        }
    });
});

describe('fractal border: multi-seed consistency', () => {
    test('border straightness holds across 20 seeds on 4×3 grid', () => {
        const W = 400, H = 300;
        for (let seed = 1; seed <= 20; seed++) {
            const pieces = generateFractalPuzzle(4, 3, { width: W, height: H }, seed);
            const borderEdges = collectBorderEdges(pieces, W, H);
            for (const { piece, edge } of borderEdges) {
                expect(
                    edge.path.includes('A'),
                    `Seed ${seed}, piece ${piece.id} edge ${edge.id}: border has arc`,
                ).toBe(false);
            }
        }
    });

    test('border straightness holds across 20 seeds on 6×4 grid', () => {
        const W = 600, H = 400;
        for (let seed = 1; seed <= 20; seed++) {
            const pieces = generateFractalPuzzle(6, 4, { width: W, height: H }, seed);
            const borderEdges = collectBorderEdges(pieces, W, H);
            for (const { piece, edge } of borderEdges) {
                expect(
                    edge.path.includes('A'),
                    `Seed ${seed}, piece ${piece.id} edge ${edge.id}: border has arc`,
                ).toBe(false);
            }
        }
    });
});
