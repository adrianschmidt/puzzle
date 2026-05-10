/**
 * Topology-driven puzzle generator.
 *
 * Single-pass pipeline:
 *   1. BaseCutGenerator → input cuts (Curves)
 *   2. buildDCEL → topology graph (single intersection pass)
 *   3. applyTabs → per-edge tab application with collision rejection
 *   4. facesToPieceDefinitions → PieceDefinition[]
 *   5. composePuzzle → final Piece[]
 *
 * The base-cut and tab generators are looked up from the registry by
 * id, so the same code path serves the sine grid, Venn diagrams, and
 * any future plug-ins. See issue #166 for the architecture.
 */

import type { Piece, Point, Size } from '../../model/types.js';
import { buildDCEL, getFaceEdges } from './dcel.js';
import type { Face, HalfEdge } from './dcel.js';
import { facesToPieceDefinitions } from './faces-to-pieces.js';
import type { EdgeDefinition } from '../composable/types.js';
import { classicTabTemplate } from '../composable/tab-shapes.js';
import { composePuzzle } from '../composable/compose.js';
import { applyTabs } from './apply-tabs.js';
import { autoGroupSmallPieces } from './auto-group.js';
import type { AutoGroup } from './auto-group.js';
import { getBaseCutGenerator, getTabGenerator } from './generator-registry.js';
import { diagnostics } from '../../diagnostics.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the topology generator.
 *
 * The base-cut and tab generators are referenced by id (looked up
 * via the registry); their parameters are passed as opaque records
 * that each generator validates internally. Use `tabGeneratorId:
 * 'none'` to skip tab application entirely.
 */
export interface TopologyGeneratorConfig {
    /** Base-cut generator id (default: 'sine'). */
    baseCutGeneratorId?: string;
    /** Opaque config forwarded to the base-cut generator. */
    baseCutConfig?: Record<string, unknown>;
    /** Tab generator id (default: 'classic'; pass 'none' to skip). */
    tabGeneratorId?: string;
    /** Opaque config forwarded to the tab generator. */
    tabConfig?: Record<string, unknown>;
    /**
     * Minimum area (px²) below which a piece is auto-grouped with its
     * largest neighbour by {@link autoGroupSmallPieces}, run as a
     * post-pass over the generated DCEL. The resulting groups are
     * surfaced via {@link TopologyPuzzle.autoGroups} so the gameplay
     * layer can glue tiny noise faces (sub-pixel slivers from sine/Voronoi
     * intersections) into their neighbours instead of shipping them as
     * standalone pieces.
     *
     * Omit (default `undefined`) to skip auto-grouping entirely; in that
     * case `autoGroups` is empty and every piece stands alone. Direct
     * callers in tests typically leave this unset.
     */
    minPieceArea?: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Result of {@link generateTopologyPuzzle}.
 *
 * `autoGroups` is populated when the caller supplied
 * {@link TopologyGeneratorConfig.minPieceArea}; the gameplay layer
 * uses it to glue together tiny noise faces (sub-pixel slivers from
 * curve-intersection rounding) into starting groups so the player
 * never sees them as solo pieces. When `minPieceArea` is omitted,
 * `autoGroups` is empty — every piece becomes its own group via the
 * caller's normal one-group-per-piece initialisation.
 */
export interface TopologyPuzzle {
    pieces: Piece[];
    autoGroups: AutoGroup[];
}

/**
 * Generate a puzzle using the topology-driven pipeline.
 *
 * @param cols - Number of piece columns
 * @param rows - Number of piece rows
 * @param imageSize - Pixel dimensions of the puzzle image
 * @param random - Seeded PRNG function
 * @param config - Optional generator configuration
 * @returns Pieces plus any auto-grouping the small-piece pass produced.
 */
export function generateTopologyPuzzle(
    cols: number,
    rows: number,
    imageSize: Size,
    random: () => number,
    config?: TopologyGeneratorConfig,
): TopologyPuzzle {
    const baseCutId = config?.baseCutGeneratorId ?? 'sine';
    const tabId = config?.tabGeneratorId ?? 'classic';

    // 1. Generate the cuts. The sine grid needs cols/rows; other
    //    generators that ignore them aren't harmed by their presence.
    const baseCutGenerator = getBaseCutGenerator(baseCutId);
    const baseCutCfg = {
        cols, rows,
        ...(config?.baseCutConfig ?? {}),
    };
    const curves = baseCutGenerator.generate(imageSize, random, baseCutCfg);

    diagnostics.log('cuts', `Generated ${curves.length} curves (4 border + ${curves.length - 4} internal)`, {
        curveSegments: curves.map((c, i) => ({
            index: i,
            segments: c.segments.length,
            start: c.start,
            end: c.end,
        })),
    });

    // 2. Build the topology graph in a single intersection pass.
    const graph = buildDCEL({ curves });

    // 3. Apply tabs per edge with collision rejection. The graph's
    //    topology is unchanged — only edge curves are swapped.
    if (tabId !== 'none') {
        const tabGenerator = getTabGenerator(tabId);
        applyTabs(graph, tabGenerator, random, { tabConfig: config?.tabConfig });
    }

    // 4. Faces → piece definitions. Tiny faces are not merged here —
    //    the auto-group pass below handles them by gluing them into
    //    starting PieceGroups instead of mutating the DCEL.
    const computeArea = (face: { outerEdge: HalfEdge }) => {
        let area = 0;
        let current = face.outerEdge;
        do {
            const a = current.origin.position;
            const b = current.twin.origin.position;
            area += (a.x * b.y - b.x * a.y);
            current = current.next;
        } while (current !== face.outerEdge);
        return area / 2;
    };
    logFaceDetails('dcel-faces', graph.faces, computeArea as (face: Face) => number);

    const pieceDefs = facesToPieceDefinitions(graph);

    diagnostics.log('pieces', `Generated ${pieceDefs.length} piece definitions`);

    // 5. Auto-group sub-threshold pieces. We compute area/adjacency from
    //    the piece definitions (rather than the DCEL faces directly) so
    //    the auto-group pass operates on the same identifiers callers
    //    will see. Adjacency follows mate relationships across all loops
    //    of each piece — inner-boundary edges count as neighbours, which
    //    is what we want (a tiny piece living inside a hole should be
    //    glued to the surrounding frame, not orphaned).
    const minPieceArea = config?.minPieceArea;
    let autoGroups: AutoGroup[] = [];
    if (minPieceArea !== undefined) {
        const areas = new Map<number, number>();
        const neighbours = new Map<number, Set<number>>();
        for (const def of pieceDefs) {
            areas.set(def.id, computeOuterLoopArea(def.edges));
            const ns = new Set<number>();
            for (const e of def.edges) {
                if (e.matePieceId >= 0) ns.add(e.matePieceId);
            }
            neighbours.set(def.id, ns);
        }
        autoGroups = autoGroupSmallPieces(
            {
                pieceIds: pieceDefs.map(d => d.id),
                areas,
                neighbours,
            },
            minPieceArea,
        );
    }

    // 6. Compose final pieces. Tabs (when enabled) are already in the
    //    edge geometry, so disable the composition layer's own tab
    //    logic.
    const pieces = composePuzzle(pieceDefs, classicTabTemplate, random, { disableTabs: true });

    return { pieces, autoGroups };
}

// ---------------------------------------------------------------------------
// Outer-loop polygon area (shoelace on edge endpoints)
// ---------------------------------------------------------------------------

/**
 * Compute the polygon area of a piece's outer loop using the shoelace
 * formula on edge endpoints. The outer loop is the prefix of `edges`
 * before the first chain break (where the previous edge's `end` no
 * longer matches the current edge's `start`).
 *
 * Endpoints alone are sufficient for distinguishing sub-pixel numerical-
 * noise faces (a few px²) from legitimate puzzle pieces (hundreds of px²
 * or more); we don't sample curve points here.
 */
function computeOuterLoopArea(edges: EdgeDefinition[]): number {
    if (edges.length === 0) return 0;
    let area = 0;
    for (let i = 0; i < edges.length; i++) {
        const cur = edges[i];
        if (i > 0) {
            const prev = edges[i - 1];
            // Chain break = end of outer loop. Inner-boundary loops
            // don't contribute to "is this piece tiny" — they're holes,
            // and their area would only confuse the threshold.
            if (Math.abs(prev.end.x - cur.start.x) > 0.5
                || Math.abs(prev.end.y - cur.start.y) > 0.5) {
                break;
            }
        }
        area += cur.start.x * cur.end.y - cur.end.x * cur.start.y;
    }
    return Math.abs(area) / 2;
}

// ---------------------------------------------------------------------------
// DCEL face logging (used by tests via the diagnostics singleton)
// ---------------------------------------------------------------------------

function logFaceDetails(
    stage: string,
    faces: Face[],
    computeArea: (face: Face) => number,
): void {
    if (!diagnostics.enabled) return;
    const innerFaces = faces.filter(f => !f.isOuter);
    diagnostics.log(stage, `Total faces: ${faces.length}, inner: ${innerFaces.length}`);

    for (const face of innerFaces) {
        const edges = getFaceEdges(face);
        const area = computeArea(face);
        const verts = edges.map(e => e.origin.position);
        const bbox = computeBBox(verts);
        diagnostics.log(stage, `Face ${face.id}: edges=${edges.length}, area=${area.toFixed(1)}, bbox=${bboxStr(bbox)}`);
    }
}

function computeBBox(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
}

function bboxStr(b: { minX: number; minY: number; maxX: number; maxY: number }): string {
    return `[${b.minX.toFixed(0)},${b.minY.toFixed(0)}]→[${b.maxX.toFixed(0)},${b.maxY.toFixed(0)}]`;
}
