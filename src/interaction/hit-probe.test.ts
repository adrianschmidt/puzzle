import { describe, it, expect } from 'vitest';
import { hitProbeOffsets, probeNearbyPieceId, HIT_PROBE_RADIUS_PX } from './hit-probe.js';

describe('hitProbeOffsets', () => {
    it('samples two rings of 12 directions', () => {
        const offsets = hitProbeOffsets(8);
        expect(offsets).toHaveLength(24);
    });

    it('keeps every offset within the radius', () => {
        const r = 8;
        for (const { dx, dy } of hitProbeOffsets(r)) {
            expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(r + 1e-9);
        }
    });

    it('orders the nearer ring before the farther ring', () => {
        const r = 8;
        const offsets = hitProbeOffsets(r);
        const firstRingMax = Math.max(
            ...offsets.slice(0, 12).map(({ dx, dy }) => Math.hypot(dx, dy)),
        );
        const secondRingMin = Math.min(
            ...offsets.slice(12).map(({ dx, dy }) => Math.hypot(dx, dy)),
        );
        expect(firstRingMax).toBeLessThan(secondRingMin);
    });

    it('defaults to HIT_PROBE_RADIUS_PX', () => {
        const def = hitProbeOffsets();
        const explicit = hitProbeOffsets(HIT_PROBE_RADIUS_PX);
        expect(def).toEqual(explicit);
    });
});

describe('probeNearbyPieceId', () => {
    it('returns null when no sampled point hits a piece', () => {
        const result = probeNearbyPieceId({ x: 100, y: 100 }, () => null);
        expect(result).toBeNull();
    });

    it('returns the piece found by a sampled point', () => {
        // Report piece 5 only for points to the right of the press.
        const pieceIdAt = (p: { x: number; y: number }) =>
            p.x > 100 ? 5 : null;
        const result = probeNearbyPieceId({ x: 100, y: 100 }, pieceIdAt);
        expect(result).toBe(5);
    });

    it('prefers a piece on the nearer ring over one only on the farther ring', () => {
        // The near ring is at radius 4 (0.5 × 8); the far ring at 8.
        // Piece 1 sits just past 4px; piece 2 only past 6px. Nearer wins.
        const pieceIdAt = (p: { x: number; y: number }) => {
            const d = Math.hypot(p.x - 100, p.y - 100);
            if (d > 6) return 2;
            if (d > 3.9) return 1;
            return null;
        };
        const result = probeNearbyPieceId({ x: 100, y: 100 }, pieceIdAt, 8);
        expect(result).toBe(1);
    });

    it('passes absolute screen points (press + offset) to pieceIdAt', () => {
        const seen: Array<{ x: number; y: number }> = [];
        probeNearbyPieceId({ x: 50, y: 70 }, (p) => {
            seen.push(p);
            return null;
        });
        // Every probed point is the press plus an offset within the radius.
        for (const p of seen) {
            expect(Math.hypot(p.x - 50, p.y - 70)).toBeLessThanOrEqual(HIT_PROBE_RADIUS_PX + 1e-9);
        }
        expect(seen.length).toBe(24);
    });
});
