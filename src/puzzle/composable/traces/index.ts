/**
 * Library of traced puzzle-tab Bezier paths.
 *
 * Each JSON file is produced by tools/trace-tab/ from a real photograph.
 * One file per trace gives readable diffs when traces are added or
 * replaced.
 */

import type { Point } from '../../../model/types.js';
import tab01 from './tab-01-spike-screenshot.json';

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
    tab01 as TracedTemplate,
] as const;
