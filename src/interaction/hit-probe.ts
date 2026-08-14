/**
 * Screen-space "near miss" grab tolerance for piece pointerdowns.
 *
 * Geometric hit-testing makes small/slim pieces hard to grab when zoomed out.
 * A background pointerdown probes a ring of points around it and grabs a piece
 * whose exact outline is within HIT_PROBE_RADIUS_PX *screen* pixels. Screen
 * space keeps the tolerance constant at every zoom; reusing the exact-outline
 * hit paths keeps the catch area piece-shaped, never a bounding box that could
 * grab the wrong neighbor.
 */

import type { Point } from '../model/types.js';

/** Screen-space offset from the press point. */
interface ProbeOffset {
    dx: number;
    dy: number;
}

/** Near-miss grab radius, in screen pixels. */
export const HIT_PROBE_RADIUS_PX = 8;

const PROBE_DIRECTIONS = 12;

/** Ring radii as fractions of the radius, nearest first. */
const PROBE_RING_FRACTIONS = [0.5, 1];

function computeOffsets(radius: number): readonly ProbeOffset[] {
    const offsets: ProbeOffset[] = [];
    for (const fraction of PROBE_RING_FRACTIONS) {
        const r = radius * fraction;
        for (let i = 0; i < PROBE_DIRECTIONS; i++) {
            const angle = (i / PROBE_DIRECTIONS) * Math.PI * 2;
            offsets.push({ dx: r * Math.cos(angle), dy: r * Math.sin(angle) });
        }
    }
    // Frozen: the default set is shared across every press, so a stray mutation would corrupt later probes.
    return Object.freeze(offsets);
}

// Precomputed once: the app only probes at the default radius (the radius param is for tests).
const DEFAULT_OFFSETS = computeOffsets(HIT_PROBE_RADIUS_PX);

/** Offsets to sample around a background press, nearest-ring-first (nearer piece preferred). */
export function hitProbeOffsets(radius = HIT_PROBE_RADIUS_PX): readonly ProbeOffset[] {
    return radius === HIT_PROBE_RADIUS_PX ? DEFAULT_OFFSETS : computeOffsets(radius);
}

/**
 * Return the id of a piece whose exact outline lies within `radius` screen
 * pixels of `point`, preferring the nearer ring, or null. Ties within a ring
 * are broken by sample angle, not strictly nearest (gap ≤ ring spacing).
 * `pieceIdAt` maps a screen point to the piece under it (null = background).
 */
export function probeNearbyPieceId(
    point: Point,
    pieceIdAt: (p: Point) => number | null,
    radius = HIT_PROBE_RADIUS_PX,
): number | null {
    for (const { dx, dy } of hitProbeOffsets(radius)) {
        const id = pieceIdAt({ x: point.x + dx, y: point.y + dy });
        if (id !== null) return id;
    }
    return null;
}
