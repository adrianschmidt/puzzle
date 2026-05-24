/**
 * Library of traced puzzle-tab Bezier paths.
 *
 * Each JSON file is produced by tools/trace-tab/ from a real photograph.
 * One file per trace gives readable diffs when traces are added or
 * replaced.
 */

import type { Point } from '../../../model/types.js';
import tab02 from './02-tab-a.json';
import tab03 from './03-tab-b.json';
import tab04 from './04-tab-c.json';
import tab05 from './05-tab-d.json';
import tab06 from './06-tab-e.json';
import tab07 from './07-tab-f.json';
import tab08 from './08-tab-g.json';
import tab09 from './09-tab-h.json';
import tab10 from './10-tab-i.json';
import tab11 from './11-tab-j.json';
import tab12 from './12-tab-k.json';
import tab13 from './13-tab-l.json';
import tab14 from './14-tab-m.json';
import tab15 from './15-tab-n.json';
import tab16 from './16-tab-o.json';
import tab17 from './17-tab-p.json';
import tab18 from './18-tab-q.json';
import tab19 from './19-tab-r.json';
import tab20 from './20-tab-s.json';
import tab21 from './21-tab-t.json';

export interface TracedLandmarks {
    /** Y of the highest point of the tab, normalized to chord length. */
    apex_y: number;
    /** Widest point of the head. */
    head: { y: number; width: number; center_x: number };
    /** Narrowest point of the neck. */
    neck: { y: number; width: number; center_x: number };
}

export interface TracedTemplate {
    /** Stable identifier, used as filename stem. */
    id: string;
    source: {
        photo: string;
        captured: string;
        notes?: string;
    };
    /**
     * BezierPath in normalized neck-frame: starts at (0,0), ends at (1,0),
     * protrudes in +Y. Flat array, length 3n+1 for n cubic segments.
     */
    path: readonly Point[];
    landmarks: TracedLandmarks;
}

/**
 * Narrow an unknown JSON value to a {@link TracedTemplate}. Used to
 * validate each checked-in trace at module import — any structural
 * problem (missing fields, NaN landmarks, wrong-length `path`) throws
 * immediately at startup instead of propagating NaNs through the
 * pinch / scale math later. The same helper backs the schema tests in
 * `index.test.ts`, so production and tests share one narrowing.
 */
export function assertTracedTemplate(raw: unknown, label: string): TracedTemplate {
    const fail = (msg: string): never => {
        throw new Error(`Trace ${label}: ${msg}`);
    };
    if (!raw || typeof raw !== 'object') fail('not an object');
    const t = raw as Record<string, unknown>;
    if (typeof t.id !== 'string') fail('missing string id');

    if (!t.source || typeof t.source !== 'object') fail('missing source object');
    const src = t.source as Record<string, unknown>;
    if (typeof src.photo !== 'string') fail('source.photo not a string');
    if (typeof src.captured !== 'string') fail('source.captured not a string');

    if (!Array.isArray(t.path)) fail('path is not an array');
    const path = t.path as unknown[];
    if (path.length < 4 || (path.length - 1) % 3 !== 0) {
        fail(`path length must be 3n+1 (n ≥ 1); got ${path.length}`);
    }
    for (let i = 0; i < path.length; i++) {
        const p = path[i] as Record<string, unknown> | null;
        if (!p || typeof p !== 'object'
            || typeof p.x !== 'number' || !Number.isFinite(p.x)
            || typeof p.y !== 'number' || !Number.isFinite(p.y)) {
            fail(`path[${i}] is not a finite Point`);
        }
    }

    if (!t.landmarks || typeof t.landmarks !== 'object') fail('missing landmarks');
    const lm = t.landmarks as Record<string, unknown>;
    const finiteAt = (path: string, v: unknown): void => {
        if (typeof v !== 'number' || !Number.isFinite(v)) {
            fail(`landmarks.${path} is not a finite number`);
        }
    };
    finiteAt('apex_y', lm.apex_y);
    for (const part of ['head', 'neck'] as const) {
        const node = lm[part] as Record<string, unknown> | undefined;
        if (!node || typeof node !== 'object') fail(`landmarks.${part} missing`);
        finiteAt(`${part}.y`, node!.y);
        finiteAt(`${part}.width`, node!.width);
        finiteAt(`${part}.center_x`, node!.center_x);
    }

    return raw as TracedTemplate;
}

export const TRACED_TEMPLATES: readonly TracedTemplate[] = [
    assertTracedTemplate(tab02, '02-tab-a'),
    assertTracedTemplate(tab03, '03-tab-b'),
    assertTracedTemplate(tab04, '04-tab-c'),
    assertTracedTemplate(tab05, '05-tab-d'),
    assertTracedTemplate(tab06, '06-tab-e'),
    assertTracedTemplate(tab07, '07-tab-f'),
    assertTracedTemplate(tab08, '08-tab-g'),
    assertTracedTemplate(tab09, '09-tab-h'),
    assertTracedTemplate(tab10, '10-tab-i'),
    assertTracedTemplate(tab11, '11-tab-j'),
    assertTracedTemplate(tab12, '12-tab-k'),
    assertTracedTemplate(tab13, '13-tab-l'),
    assertTracedTemplate(tab14, '14-tab-m'),
    assertTracedTemplate(tab15, '15-tab-n'),
    assertTracedTemplate(tab16, '16-tab-o'),
    assertTracedTemplate(tab17, '17-tab-p'),
    assertTracedTemplate(tab18, '18-tab-q'),
    assertTracedTemplate(tab19, '19-tab-r'),
    assertTracedTemplate(tab20, '20-tab-s'),
    assertTracedTemplate(tab21, '21-tab-t'),
] as const;
