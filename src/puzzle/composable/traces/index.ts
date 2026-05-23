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

export const TRACED_TEMPLATES: readonly TracedTemplate[] = [
    tab02 as TracedTemplate,
    tab03 as TracedTemplate,
    tab04 as TracedTemplate,
    tab05 as TracedTemplate,
    tab06 as TracedTemplate,
    tab07 as TracedTemplate,
    tab08 as TracedTemplate,
    tab09 as TracedTemplate,
    tab10 as TracedTemplate,
    tab11 as TracedTemplate,
    tab12 as TracedTemplate,
    tab13 as TracedTemplate,
    tab14 as TracedTemplate,
    tab15 as TracedTemplate,
    tab16 as TracedTemplate,
    tab17 as TracedTemplate,
    tab18 as TracedTemplate,
    tab19 as TracedTemplate,
    tab20 as TracedTemplate,
    tab21 as TracedTemplate,
] as const;
