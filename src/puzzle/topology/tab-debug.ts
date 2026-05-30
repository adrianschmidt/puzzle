/**
 * Dev-time tab-debug session.
 *
 * Wires together the two extension points that let us identify which
 * traced template ended up on which piece's tab:
 *
 *   - {@link setTracedTabChoiceRecorder} captures the per-call template
 *     selection inside `tracedTabTemplate.generate()`.
 *   - {@link ApplyTabsOptions.onCandidate} fires once per eligible edge,
 *     with the half-edge it was generated for and whether a candidate
 *     survived the collision / fold-back checks.
 *
 * A session zips those two streams (calls are 1:1 and in lockstep)
 * into per-tab records keyed by half-edge, then turns them into a
 * piece-keyed map after the topology graph has been turned into
 * piece definitions.
 *
 * Lockstep note: the 1:1 pairing holds on COUNT — `onCandidate` and the
 * recorder each fire once per edge. The recorded {@link TracedTabChoice}
 * geometry describes the traced generator's BASE rung; with the retry
 * ladder a different rung may be the committed curve, so the recorded
 * scale/flip/mid can differ from what's on screen. See TracedTabChoice.
 *
 * Production paths don't touch any of this — the recorder defaults to
 * a no-op and `onCandidate` is undefined unless a session is active.
 */

import type { HalfEdge, TopologyGraph } from './dcel.js';
import {
    setTracedTabChoiceRecorder,
    type TracedTabChoice,
} from '../composable/traced-tab-recorder.js';

/**
 * One tab's debug record, from a piece's point of view.
 *
 * `edgeIndex` is the position of this edge in the piece's
 * `PieceDefinition.edges[]` array — i.e. the same ordering the
 * renderer and the debug piece view use, so you can correlate this
 * with what you see on screen.
 */
export interface TabDebugEntry {
    /** Half-edge id from the DCEL — stable, useful as a join key. */
    halfEdgeId: number;
    /** Position of this edge in PieceDefinition.edges (outer loop first). */
    edgeIndex: number;
    /** Piece id this entry was attached to. */
    pieceId: number;
    /** Piece id on the *other* side of the shared edge, or null for borders. */
    matePieceId: number | null;
    /** Whether collision/fold-back checks accepted the candidate. */
    accepted: boolean;
    /** Traced-template selection, if the tab generator was 'traced'. */
    traced: TracedTabChoice | null;
}

/** Final per-piece map produced by {@link TabDebugSession.finish}. */
export type TabDebugReport = Record<number, TabDebugEntry[]>;

interface RawEntry {
    halfEdge: HalfEdge;
    accepted: boolean;
    traced: TracedTabChoice | null;
}

/**
 * Open a debug session. Call {@link onCandidate} as the `onCandidate`
 * option of `applyTabs`, then call {@link finish} once you have the
 * piece definitions (or face → piece mapping) ready.
 *
 * The session installs a traced-tab recorder for its lifetime; calling
 * `finish` (or `dispose`) un-installs it. Only one session can be
 * active at a time — starting a second one before finishing the first
 * silently overwrites the recorder, which is fine for a dev tool but
 * not something to do in tests that run in parallel.
 */
export class TabDebugSession {
    private entries: RawEntry[] = [];
    private lastChoice: TracedTabChoice | null = null;
    private disposed = false;

    constructor() {
        setTracedTabChoiceRecorder((choice) => {
            this.lastChoice = choice;
        });
    }

    /**
     * Pass this to `applyTabs({ onCandidate })`. The callback consumes
     * the most recent recorded traced-tab choice — if the active
     * generator wasn't 'traced', the slot is empty and `traced` ends
     * up null on the resulting entry.
     */
    readonly onCandidate = (he: HalfEdge, accepted: boolean): void => {
        const traced = this.lastChoice;
        this.lastChoice = null;
        this.entries.push({ halfEdge: he, accepted, traced });
    };

    /**
     * Build the piece-keyed report. Pass the same DCEL graph that was
     * handed to `applyTabs` — we derive the face → piece-id mapping
     * the same way `facesToPieceDefinitions` does (inner faces in DCEL
     * order, indexed from 0). After this call the session is disposed.
     */
    finish(graph: TopologyGraph): TabDebugReport {
        this.dispose();
        const faceIdToPieceId = new Map<number, number>();
        graph.faces.filter(f => !f.isOuter)
            .forEach((face, index) => faceIdToPieceId.set(face.id, index));
        // Per-piece edge ordering matches PieceDefinition.edges: walk
        // each face's outer loop (then inner-boundary loops) and assign
        // ascending edgeIndex. We don't have the PieceDefinitions in
        // hand here, so we reconstruct edge index by replaying the
        // walk from each entry's half-edge face.
        // Each shared edge belongs to two pieces (one half-edge in each
        // face's loop); we emit an entry under both piece ids so a
        // caller can look up by either piece.
        const report: TabDebugReport = {};
        for (const entry of this.entries) {
            const { halfEdge: he, accepted, traced } = entry;
            for (const side of [he, he.twin]) {
                const face = side.face;
                if (!face || face.isOuter) continue;
                const pieceId = faceIdToPieceId.get(face.id);
                if (pieceId === undefined) continue;
                const matePieceId = matePieceFor(side, faceIdToPieceId);
                const edgeIndex = indexInFaceWalk(side);
                (report[pieceId] ??= []).push({
                    halfEdgeId: he.id,
                    edgeIndex,
                    pieceId,
                    matePieceId,
                    accepted,
                    traced,
                });
            }
        }
        // Sort each piece's entries by edgeIndex so the screen order is
        // obvious in a JSON dump.
        for (const pid of Object.keys(report)) {
            report[Number(pid)].sort((a, b) => a.edgeIndex - b.edgeIndex);
        }
        return report;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        setTracedTabChoiceRecorder(null);
    }
}

function matePieceFor(
    he: HalfEdge,
    faceIdToPieceId: Map<number, number>,
): number | null {
    const twinFace = he.twin.face;
    if (!twinFace || twinFace.isOuter) return null;
    return faceIdToPieceId.get(twinFace.id) ?? null;
}

/**
 * Walk the loop containing `he` (outer or inner) and return how many
 * steps we took to reach `he` from the loop's "start". For outer
 * loops the start is `face.outerEdge`; for inner-boundary loops, the
 * matching entry in `face.innerBoundaries`.
 *
 * The walk mirrors `facesToPieceDefinitions`'s ordering: outer-loop
 * edges come first (index 0..N-1), then each inner loop (continuing
 * the index). This way the returned `edgeIndex` lines up with the
 * piece's `edges[]` array as the renderer presents it.
 */
function indexInFaceWalk(target: HalfEdge): number {
    const face = target.face;
    if (!face) return -1;

    let offset = 0;
    // Outer loop first.
    let i = walkUntil(face.outerEdge, target);
    if (i >= 0) return offset + i;
    offset += walkLength(face.outerEdge);
    // Then each inner-boundary loop.
    for (const innerStart of face.innerBoundaries) {
        i = walkUntil(innerStart, target);
        if (i >= 0) return offset + i;
        offset += walkLength(innerStart);
    }
    return -1;
}

function walkUntil(start: HalfEdge, target: HalfEdge): number {
    let i = 0;
    let cur = start;
    do {
        if (cur === target) return i;
        cur = cur.next;
        i++;
    } while (cur !== start);
    return -1;
}

function walkLength(start: HalfEdge): number {
    let n = 0;
    let cur = start;
    do {
        cur = cur.next;
        n++;
    } while (cur !== start);
    return n;
}
