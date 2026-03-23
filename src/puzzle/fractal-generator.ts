/**
 * Fractal circle-packing puzzle generator.
 *
 * Inspired by the Fractal Jigsaw Generator (proceduraljigsaw/Fractalpuzzlejs).
 * Uses a circle-packing grid where pieces are organic shapes formed by 
 * merging adjacent circles. No traditional tabs/blanks — pieces interlock 
 * through curved boundaries between circles.
 *
 * Algorithm:
 * 1. Create a hexagonal grid of circles that covers the puzzle area
 * 2. Randomly merge adjacent circles into pieces using flood-fill
 * 3. Generate piece boundaries using circular arcs between circle centres
 * 4. Convert to SVG paths and create Edge[] with mate relationships
 *
 * This produces a very different aesthetic from classic jigsaw pieces —
 * organic, flowing shapes that still maintain the interlocking property.
 */

import type { Edge, Piece, Point, Size } from '../model/types.js';
import { createSeededRandom } from './seeded-random.js';

/**
 * Represents a circle in the packing grid.
 */
interface Circle {
    /** Unique identifier for this circle. */
    id: number;
    /** Centre point of the circle. */
    centre: Point;
    /** Radius of the circle. */
    radius: number;
    /** Which piece this circle belongs to (assigned during merging). */
    pieceId: number;
    /** Adjacent circle IDs (connectivity graph). */
    neighbors: number[];
}

/**
 * A piece formed by merging one or more circles.
 */
interface FractalPiece {
    /** Unique piece identifier. */
    id: number;
    /** Circle IDs that form this piece. */
    circles: number[];
    /** Boundary segments between this piece and others/border. */
    boundaries: BoundarySegment[];
}

/**
 * A boundary segment between two pieces (or piece and border).
 */
interface BoundarySegment {
    /** Which circles this boundary is between. */
    fromCircle: number;
    toCircle: number;
    /** The piece this boundary borders (-1 for puzzle border). */
    neighborPieceId: number;
    /** Arc parameters for drawing the boundary. */
    arc: ArcSegment;
}

/**
 * Parameters for a circular arc boundary segment.
 */
interface ArcSegment {
    /** Start point of the arc. */
    start: Point;
    /** End point of the arc. */
    end: Point;
    /** Centre of the circle the arc belongs to. */
    centre: Point;
    /** Radius of the arc. */
    radius: number;
    /** Whether this is a large arc (>180°) or small arc. */
    largeArc: boolean;
}

/**
 * Generate a fractal puzzle using circle-packing.
 *
 * @param cols - Approximate number of pieces horizontally (affects circle density)
 * @param rows - Approximate number of pieces vertically (affects circle density)
 * @param imageSize - Pixel dimensions of the puzzle image
 * @param seed - PRNG seed for reproducible piece layouts
 * @returns Array of pieces with organic shapes and circular arc boundaries
 */
export function generateFractalPuzzle(
    cols: number,
    rows: number,
    imageSize: Size,
    seed: number,
): Piece[] {
    const random = createSeededRandom(seed);
    
    // Calculate circle density to achieve roughly cols×rows pieces
    const targetPieceCount = cols * rows;
    const circleRadius = Math.min(imageSize.width, imageSize.height) / (Math.max(cols, rows) * 2.5);
    
    // Create hexagonal circle grid
    const circles = createHexagonalCircleGrid(imageSize, circleRadius);
    
    // Randomly merge circles into pieces
    const pieces = mergeCirclesIntoPieces(circles, targetPieceCount, random);
    
    // Generate boundaries between pieces
    addBoundariesToPieces(pieces, circles, imageSize);
    
    // Convert to the standard Piece[] format
    return convertToStandardPieces(pieces, circles, imageSize);
}

/**
 * Create a hexagonal grid of circles covering the puzzle area.
 * Hexagonal packing is more natural than rectangular grid.
 */
function createHexagonalCircleGrid(imageSize: Size, radius: number): Circle[] {
    const circles: Circle[] = [];
    let circleId = 0;
    
    const dx = radius * 2;                    // Horizontal spacing
    const dy = radius * Math.sqrt(3);        // Vertical spacing for hex pattern
    const offsetX = radius;                   // Offset every other row
    
    // Add margin to ensure coverage at edges
    const margin = radius * 2;
    const startY = -margin;
    const endY = imageSize.height + margin;
    const startX = -margin;
    const endX = imageSize.width + margin;
    
    for (let y = startY; y < endY; y += dy) {
        const isOffsetRow = Math.floor((y - startY) / dy) % 2 === 1;
        const xStart = isOffsetRow ? startX + offsetX : startX;
        
        for (let x = xStart; x < endX; x += dx) {
            circles.push({
                id: circleId++,
                centre: { x, y },
                radius,
                pieceId: -1, // Unassigned initially
                neighbors: [],
            });
        }
    }
    
    // Build adjacency graph (circles are neighbors if their centres are close)
    const maxNeighborDistance = dx * 1.1; // Slightly larger than spacing to catch neighbors
    
    for (let i = 0; i < circles.length; i++) {
        for (let j = i + 1; j < circles.length; j++) {
            const dist = distance(circles[i].centre, circles[j].centre);
            if (dist <= maxNeighborDistance) {
                circles[i].neighbors.push(j);
                circles[j].neighbors.push(i);
            }
        }
    }
    
    return circles;
}

/**
 * Randomly merge circles into pieces using flood-fill algorithm.
 */
function mergeCirclesIntoPieces(
    circles: Circle[],
    targetPieceCount: number,
    random: () => number,
): FractalPiece[] {
    const pieces: FractalPiece[] = [];
    const visited = new Set<number>();
    
    // Calculate average piece size
    const avgPieceSize = Math.ceil(circles.length / targetPieceCount);
    const minPieceSize = Math.max(1, avgPieceSize - 2);
    const maxPieceSize = avgPieceSize + 3;
    
    let pieceId = 0;
    
    // Start flood-fill from random unvisited circles
    for (const startCircle of shuffleArray([...circles], random)) {
        if (visited.has(startCircle.id)) continue;
        
        // Grow a piece from this circle
        const pieceCircles: number[] = [];
        const queue = [startCircle.id];
        visited.add(startCircle.id);
        
        while (queue.length > 0 && pieceCircles.length < maxPieceSize) {
            const circleId = queue.shift()!;
            pieceCircles.push(circleId);
            circles[circleId].pieceId = pieceId;
            
            // Maybe add neighbors (probabilistic growth)
            if (pieceCircles.length < minPieceSize || random() < 0.4) {
                for (const neighborId of circles[circleId].neighbors) {
                    if (!visited.has(neighborId) && !queue.includes(neighborId)) {
                        visited.add(neighborId);
                        queue.push(neighborId);
                    }
                }
            }
        }
        
        if (pieceCircles.length > 0) {
            pieces.push({
                id: pieceId++,
                circles: pieceCircles,
                boundaries: [],
            });
        }
    }
    
    return pieces;
}

/**
 * Generate boundary segments between pieces.
 */
function addBoundariesToPieces(
    pieces: FractalPiece[],
    circles: Circle[],
    imageSize: Size,
): void {
    // For each piece, find boundaries with neighbors and borders
    for (const piece of pieces) {
        const boundaryMap = new Map<number, BoundarySegment[]>();
        
        // Check each circle in this piece
        for (const circleId of piece.circles) {
            const circle = circles[circleId];
            
            // Check each neighbor of this circle
            for (const neighborId of circle.neighbors) {
                const neighbor = circles[neighborId];
                const neighborPieceId = neighbor.pieceId;
                
                // Skip if neighbor is in same piece
                if (neighborPieceId === piece.id) continue;
                
                // Create boundary segment between these circles
                const arc = createArcBetweenCircles(circle, neighbor);
                
                const boundary: BoundarySegment = {
                    fromCircle: circleId,
                    toCircle: neighborId,
                    neighborPieceId,
                    arc,
                };
                
                if (!boundaryMap.has(neighborPieceId)) {
                    boundaryMap.set(neighborPieceId, []);
                }
                boundaryMap.get(neighborPieceId)!.push(boundary);
            }
            
            // Check if circle is near puzzle border
            const borderSegments = createBorderSegments(circle, imageSize);
            for (const borderSegment of borderSegments) {
                if (!boundaryMap.has(-1)) {
                    boundaryMap.set(-1, []);
                }
                boundaryMap.get(-1)!.push(borderSegment);
            }
        }
        
        // Consolidate boundaries
        piece.boundaries = Array.from(boundaryMap.values()).flat();
    }
}

/**
 * Create an arc segment between two adjacent circles.
 */
function createArcBetweenCircles(circle1: Circle, circle2: Circle): ArcSegment {
    const c1 = circle1.centre;
    const c2 = circle2.centre;
    
    // Find intersection points of the two circles
    const dist = distance(c1, c2);
    const r1 = circle1.radius;
    const r2 = circle2.radius;
    
    // Calculate intersection using circle-circle intersection formula
    const a = (r1 * r1 - r2 * r2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(r1 * r1 - a * a);
    
    // Point along the line between centres
    const p0 = {
        x: c1.x + a * (c2.x - c1.x) / dist,
        y: c1.y + a * (c2.y - c1.y) / dist,
    };
    
    // The two intersection points
    const intersection1 = {
        x: p0.x + h * (c2.y - c1.y) / dist,
        y: p0.y - h * (c2.x - c1.x) / dist,
    };
    
    const intersection2 = {
        x: p0.x - h * (c2.y - c1.y) / dist,
        y: p0.y + h * (c2.x - c1.x) / dist,
    };
    
    // Use the arc on circle1's boundary between the intersections
    return {
        start: intersection1,
        end: intersection2,
        centre: c1,
        radius: r1,
        largeArc: false, // Most arcs will be small
    };
}

/**
 * Create border segments for circles near the puzzle edge.
 */
function createBorderSegments(circle: Circle, imageSize: Size): BoundarySegment[] {
    const segments: BoundarySegment[] = [];
    const { centre, radius } = circle;
    
    // Check if circle intersects with puzzle boundaries
    const margin = radius * 0.1;
    
    // Left edge
    if (centre.x - radius <= margin) {
        segments.push(createBorderSegment(circle, -1, 'left', imageSize));
    }
    
    // Right edge  
    if (centre.x + radius >= imageSize.width - margin) {
        segments.push(createBorderSegment(circle, -1, 'right', imageSize));
    }
    
    // Top edge
    if (centre.y - radius <= margin) {
        segments.push(createBorderSegment(circle, -1, 'top', imageSize));
    }
    
    // Bottom edge
    if (centre.y + radius >= imageSize.height - margin) {
        segments.push(createBorderSegment(circle, -1, 'bottom', imageSize));
    }
    
    return segments;
}

/**
 * Create a single border segment.
 */
function createBorderSegment(
    circle: Circle,
    neighborPieceId: number,
    edge: 'left' | 'right' | 'top' | 'bottom',
    imageSize: Size,
): BoundarySegment {
    const { centre, radius } = circle;
    
    let start: Point, end: Point;
    
    switch (edge) {
        case 'left':
            start = { x: 0, y: centre.y - radius };
            end = { x: 0, y: centre.y + radius };
            break;
        case 'right':
            start = { x: imageSize.width, y: centre.y - radius };
            end = { x: imageSize.width, y: centre.y + radius };
            break;
        case 'top':
            start = { x: centre.x - radius, y: 0 };
            end = { x: centre.x + radius, y: 0 };
            break;
        case 'bottom':
            start = { x: centre.x - radius, y: imageSize.height };
            end = { x: centre.x + radius, y: imageSize.height };
            break;
    }
    
    return {
        fromCircle: circle.id,
        toCircle: -1, // Border
        neighborPieceId,
        arc: {
            start,
            end,
            centre,
            radius,
            largeArc: false,
        },
    };
}

/**
 * Convert fractal pieces to standard Piece[] format.
 */
function convertToStandardPieces(
    fractalPieces: FractalPiece[],
    circles: Circle[],
    _imageSize: Size,
): Piece[] {
    const pieces: Piece[] = [];
    let nextEdgeId = 0;
    
    // Keep track of shared boundaries for mate relationships
    const sharedBoundaries = new Map<string, { edgeId1: number; edgeId2: number }>();
    
    for (const fractalPiece of fractalPieces) {
        const edges: Edge[] = [];
        
        // Group boundaries by neighbor piece
        const boundaryGroups = new Map<number, BoundarySegment[]>();
        for (const boundary of fractalPiece.boundaries) {
            if (!boundaryGroups.has(boundary.neighborPieceId)) {
                boundaryGroups.set(boundary.neighborPieceId, []);
            }
            boundaryGroups.get(boundary.neighborPieceId)!.push(boundary);
        }
        
        // Create edges from boundary groups
        for (const [neighborPieceId, boundaries] of boundaryGroups) {
            const edgeId = nextEdgeId++;
            
            // Create SVG path from all boundary arcs
            const pathSegments: string[] = [];
            let currentPoint: Point = boundaries[0].arc.start;
            pathSegments.push(`M ${currentPoint.x} ${currentPoint.y}`);
            
            for (const boundary of boundaries) {
                const arc = boundary.arc;
                const largeArcFlag = arc.largeArc ? 1 : 0;
                const sweepFlag = 1; // Positive direction
                
                pathSegments.push(
                    `A ${arc.radius} ${arc.radius} 0 ${largeArcFlag} ${sweepFlag} ${arc.end.x} ${arc.end.y}`
                );
                currentPoint = arc.end;
            }
            
            const path = pathSegments.join(' ');
            
            // Handle mate relationships
            let mateEdgeId = -1;
            let matePieceId = neighborPieceId;
            
            if (neighborPieceId !== -1) {
                // This is a shared boundary - check if mate already exists
                const boundaryKey = [fractalPiece.id, neighborPieceId].sort().join('-');
                const sharedInfo = sharedBoundaries.get(boundaryKey);
                
                if (sharedInfo) {
                    // Mate already exists
                    mateEdgeId = sharedInfo.edgeId1;
                    // Update the existing mate to point back to this edge
                    sharedInfo.edgeId2 = edgeId;
                } else {
                    // First time seeing this boundary
                    sharedBoundaries.set(boundaryKey, { edgeId1: edgeId, edgeId2: -1 });
                }
            } else {
                matePieceId = -1; // Border edge
            }
            
            edges.push({
                id: edgeId,
                mateEdgeId,
                matePieceId,
                path,
                start: boundaries[0].arc.start,
                end: boundaries[boundaries.length - 1].arc.end,
            });
        }
        
        // Calculate piece shape (union of all edges)
        const shape = edges.map(edge => edge.path).join(' ') + ' Z';
        
        // Calculate image offset (use centre of circles in this piece)
        const avgCentre = calculateAveragePoint(
            fractalPiece.circles.map(id => circles[id].centre)
        );
        
        pieces.push({
            id: fractalPiece.id,
            edges,
            shape,
            imageOffset: { x: -avgCentre.x, y: -avgCentre.y },
        });
    }
    
    // Update mate relationships for shared boundaries
    for (const piece of pieces) {
        for (const edge of piece.edges) {
            if (edge.mateEdgeId === -1 && edge.matePieceId !== -1) {
                // Find the mate edge
                const matePiece = pieces.find(p => p.id === edge.matePieceId);
                if (matePiece) {
                    const mateEdge = matePiece.edges.find(e => 
                        sharedBoundaries.get([piece.id, edge.matePieceId].sort().join('-'))?.edgeId2 === e.id
                    );
                    if (mateEdge) {
                        edge.mateEdgeId = mateEdge.id;
                        mateEdge.mateEdgeId = edge.id;
                    }
                }
            }
        }
    }
    
    return pieces;
}

// Helper functions

function distance(p1: Point, p2: Point): number {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function shuffleArray<T>(array: T[], random: () => number): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function calculateAveragePoint(points: Point[]): Point {
    const sum = points.reduce(
        (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
        { x: 0, y: 0 }
    );
    return {
        x: sum.x / points.length,
        y: sum.y / points.length,
    };
}