/**
 * Diagnostic logging for the topology pipeline.
 *
 * When enabled, collects structured log entries at each stage of puzzle
 * generation. Used by tests to understand pipeline behavior without
 * visual inspection.
 */

import type { Point } from '../../model/types.js';
import type { Face } from './dcel.js';
import { getFaceEdges } from './dcel.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiagnosticEntry {
    stage: string;
    message: string;
    data?: Record<string, unknown>;
}

export interface DiagnosticLog {
    entries: DiagnosticEntry[];
    log(stage: string, message: string, data?: Record<string, unknown>): void;
    clear(): void;
}

// ---------------------------------------------------------------------------
// Singleton diagnostic log (disabled by default)
// ---------------------------------------------------------------------------

let _enabled = false;
const _entries: DiagnosticEntry[] = [];

export const diagnostics: DiagnosticLog = {
    get entries() { return _entries; },
    log(stage, message, data) {
        if (!_enabled) return;
        _entries.push({ stage, message, data });
    },
    clear() {
        _entries.length = 0;
    },
};

export function enableDiagnostics(): void {
    _enabled = true;
    _entries.length = 0;
}

export function disableDiagnostics(): void {
    _enabled = false;
    _entries.length = 0;
}

// ---------------------------------------------------------------------------
// Helpers for logging face details
// ---------------------------------------------------------------------------

export function logFaceDetails(
    stage: string,
    faces: Face[],
    computeArea: (face: Face) => number,
): void {
    if (!_enabled) return;
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
