/**
 * Screen-space "near miss" grab tolerance for piece pointerdowns.
 *
 * Piece hit-testing is geometric: the browser reports which piece's exact
 * outline sits under the pointer. That makes small/slim pieces (notably
 * Fractal) hard to grab when zoomed out — a few pixels off the outline lands
 * on the background and pans instead of dragging.
 *
 * To compensate without distorting any piece geometry — and without the
 * per-zoom SVG repaint that a zoom-scaled hit-area stroke caused — a
 * pointerdown that lands on the background probes a ring of points around it.
 * If a piece's exact outline is within {@link HIT_PROBE_RADIUS_PX} *screen*
 * pixels, that piece is grabbed instead of starting a pan.
 *
 * Because the radius is in screen space, the tolerance is constant at every
 * zoom: generous relative to a tiny zoomed-out piece, tight relative to a
 * large zoomed-in one (so precise targeting is preserved). The probe reuses
 * the existing exact-outline hit paths, so the catch area stays shaped like
 * the piece — never a bounding box that could grab the wrong neighbor.
 */

import type { Point } from '../model/types.js';

/** A screen-space sample offset from the press point. */
interface ProbeOffset {
    dx: number;
    dy: number;
}

/** Radius of the near-miss grab tolerance, in screen pixels. */
export const HIT_PROBE_RADIUS_PX = 8;

/** Directions sampled per ring. 12 ≈ one sample every 30°. */
const PROBE_DIRECTIONS = 12;

/** Rings sampled, as fractions of the radius, nearest first. */
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
    // Frozen because the default set is shared across every press (see
    // DEFAULT_OFFSETS) — callers iterate, never mutate, and freezing makes
    // an accidental mutation throw rather than corrupt later probes.
    return Object.freeze(offsets);
}

// The app only ever probes at the default radius, so precompute that set
// once rather than redoing the trig and allocations on every press. The
// `radius` parameter exists mainly for testing.
const DEFAULT_OFFSETS = computeOffsets(HIT_PROBE_RADIUS_PX);

/**
 * Screen-space offsets to sample around a background press, ordered
 * nearest-ring-first so a nearer piece is preferred over a farther one.
 *
 * Pure (no DOM) so the sampling pattern can be unit-tested directly.
 */
export function hitProbeOffsets(radius = HIT_PROBE_RADIUS_PX): readonly ProbeOffset[] {
    return radius === HIT_PROBE_RADIUS_PX ? DEFAULT_OFFSETS : computeOffsets(radius);
}

/**
 * Return the id of a piece whose exact outline lies within `radius` screen
 * pixels of `point`, preferring the nearer sampling ring, or null if none is
 * close enough. (Within a ring the first sampled direction wins, so among
 * equidistant pieces the choice is by angle, not strictly nearest — the gap
 * is at most the ring spacing.)
 *
 * `pieceIdAt` maps a screen point to the piece under it (null for
 * background); it is injected so this is testable without a real layout.
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
