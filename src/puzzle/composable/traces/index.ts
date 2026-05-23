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
] as const;
