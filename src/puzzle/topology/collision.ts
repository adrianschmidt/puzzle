/**
 * Pluggable collision detection and conflict resolution for tab lines.
 *
 * When a tab is being added to a cut line, the tab's path may intersect
 * other existing paths in the puzzle. This module provides interfaces
 * for detecting such collisions and deciding how to resolve them.
 *
 * The detection and resolution concerns are separated so they can be
 * swapped independently — e.g. a future resolver might shrink the tab
 * instead of skipping it entirely.
 *
 * See issue #215.
 */

import type { Curve } from './curve.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Detects whether a proposed tab path collides with existing paths.
 */
export interface CollisionDetector {
    /**
     * Check if a proposed tab curve collides with any existing curve.
     *
     * @param proposed - The tab curve in world coordinates (not yet merged)
     * @param existing - All cut curves in the puzzle
     * @param selfIndex - Index of the curve the tab is being added to
     *                    (excluded from collision checks)
     * @returns true if a collision is detected
     */
    hasCollision(
        proposed: Curve,
        existing: Curve[],
        selfIndex: number,
    ): boolean;
}

/**
 * Decides what to do when a collision is detected for a proposed tab.
 */
export interface ConflictResolver {
    /**
     * Resolve a collision (or lack thereof) for a tab merge.
     *
     * @param originalSegment - The unmodified edge segment (no tab)
     * @param mergedCurve - The curve with the tab merged in (null if
     *                      tab generation failed)
     * @param collides - Whether a collision was detected
     * @returns The curve to use — either the merged curve or the original
     */
    resolve(
        originalSegment: Curve,
        mergedCurve: Curve | null,
        collides: boolean,
    ): Curve;
}

// ---------------------------------------------------------------------------
// Default implementations
// ---------------------------------------------------------------------------

/**
 * Default collision detector: any intersection between the proposed tab
 * and another curve counts as a collision.
 *
 * Endpoint proximity (within `endpointTolerance` pixels) is ignored,
 * since cut lines naturally meet at grid intersections.
 */
export function createTabCollisionDetector(
    endpointTolerance = 2,
): CollisionDetector {
    return {
        hasCollision(proposed, existing, selfIndex) {
            const propStart = proposed.start;
            const propEnd = proposed.end;

            for (let i = 0; i < existing.length; i++) {
                if (i === selfIndex) continue;

                const intersections = proposed.intersect(existing[i]);

                // Filter out intersections near the tab's own endpoints,
                // which are expected where the tab rejoins its cut line.
                const real = intersections.filter(ix => {
                    const dx1 = ix.point.x - propStart.x;
                    const dy1 = ix.point.y - propStart.y;
                    const dx2 = ix.point.x - propEnd.x;
                    const dy2 = ix.point.y - propEnd.y;
                    const distToStart = Math.sqrt(dx1 * dx1 + dy1 * dy1);
                    const distToEnd = Math.sqrt(dx2 * dx2 + dy2 * dy2);
                    return distToStart > endpointTolerance
                        && distToEnd > endpointTolerance;
                });

                if (real.length > 0) return true;
            }

            return false;
        },
    };
}

/**
 * Default conflict resolver: skip the tab when a collision is detected.
 * The original (flat) segment is kept instead.
 */
export function createSkipOnCollisionResolver(): ConflictResolver {
    return {
        resolve(originalSegment, mergedCurve, collides) {
            if (collides || mergedCurve === null) return originalSegment;
            return mergedCurve;
        },
    };
}
