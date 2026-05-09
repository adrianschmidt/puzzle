/**
 * Sine-grid base-cut generator.
 *
 * Produces a rectangular grid of cuts with sine-wave perturbations
 * (the classic Composable look). Border curves come first (top,
 * right, bottom, left), followed by horizontal internal cuts,
 * followed by vertical internal cuts.
 */

import type { Size } from '../../model/types.js';
import { Curve } from './curve.js';
import type { BaseCutGenerator } from './plugin-types.js';

/**
 * Field names match the share-link's compact convention (`ha` for
 * horizontalAmplitude, etc.). This keeps the share-link's bgc shape
 * and the generator's expected config shape identical, so no field-
 * name translation is needed at the share-link boundary.
 */
export interface SineCutConfig {
    cols: number;
    rows: number;
    /** Horizontal cut amplitude, fraction of piece height (0–0.5). */
    ha: number;
    /** Horizontal cut frequency in waves over the puzzle width. */
    hf: number;
    /** Vertical cut amplitude, fraction of piece width (0–0.5). */
    va: number;
    /** Vertical cut frequency in waves over the puzzle height. */
    vf: number;
}

export const sineCutGenerator: BaseCutGenerator = {
    id: 'sine',

    generate(frame: Size, random: () => number, config: unknown): Curve[] {
        // Fall back to sensible defaults when sub-fields are missing so that
        // `baseCutConfig: {}` (or no config) still produces the canonical
        // sine grid rather than collapsing to flat cuts via NaN comparisons.
        // These defaults mirror the previous behaviour from generator.ts.
        const cfg = (config ?? {}) as Partial<SineCutConfig>;
        const cols = cfg.cols ?? 1;
        const rows = cfg.rows ?? 1;
        const ha = cfg.ha ?? 0.15;
        const hf = cfg.hf ?? 1.5;
        const va = cfg.va ?? 0.15;
        const vf = cfg.vf ?? 1.5;

        const pieceWidth = frame.width / cols;
        const pieceHeight = frame.height / rows;
        const hPixelAmp = (ha * pieceHeight) / 2;
        const vPixelAmp = (va * pieceWidth) / 2;

        const curves: Curve[] = [
            Curve.line({ x: 0, y: 0 }, { x: frame.width, y: 0 }),
            Curve.line({ x: frame.width, y: 0 }, { x: frame.width, y: frame.height }),
            Curve.line({ x: frame.width, y: frame.height }, { x: 0, y: frame.height }),
            Curve.line({ x: 0, y: frame.height }, { x: 0, y: 0 }),
        ];

        // Per-cut random phase offsets — preserve PRNG call ordering
        const rowPhases: number[] = [];
        for (let r = 0; r <= rows; r++) rowPhases.push(random() * Math.PI * 2);
        const colPhases: number[] = [];
        for (let c = 0; c <= cols; c++) colPhases.push(random() * Math.PI * 2);

        for (let r = 1; r < rows; r++) {
            const y = r * pieceHeight;
            const useWave = hPixelAmp > 0 && hf > 0;
            curves.push(useWave
                ? generateSineCurve({ x: 0, y }, { x: frame.width, y },
                    hPixelAmp, hf, rowPhases[r])
                : Curve.line({ x: 0, y }, { x: frame.width, y }),
            );
        }
        for (let c = 1; c < cols; c++) {
            const x = c * pieceWidth;
            const useWave = vPixelAmp > 0 && vf > 0;
            curves.push(useWave
                ? generateSineCurve({ x, y: 0 }, { x, y: frame.height },
                    vPixelAmp, vf, colPhases[c])
                : Curve.line({ x, y: 0 }, { x, y: frame.height }),
            );
        }
        return curves;
    },
};

function generateSineCurve(
    start: { x: number; y: number },
    end: { x: number; y: number },
    amplitude: number,
    frequency: number,
    phase: number,
): Curve {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const tx = dx / len, ty = dy / len;
    const px = -ty, py = tx;

    const segmentsPerWave = 4;
    const totalSegments = Math.max(4, Math.ceil(frequency * segmentsPerWave));
    const bezierPoints: { x: number; y: number }[] = [];

    const evalSine = (t: number) => {
        const angle = 2 * Math.PI * frequency * t + phase;
        const s = amplitude * Math.sin(angle);
        const ds = amplitude * 2 * Math.PI * frequency * Math.cos(angle);
        return {
            x: start.x + t * dx + s * px,
            y: start.y + t * dy + s * py,
            tx: dx + ds * px,
            ty: dy + ds * py,
        };
    };

    for (let i = 0; i < totalSegments; i++) {
        const t0 = i / totalSegments, t1 = (i + 1) / totalSegments, dt = t1 - t0;
        const p0 = evalSine(t0), p1 = evalSine(t1);
        if (i === 0) bezierPoints.push({ x: p0.x, y: p0.y });
        bezierPoints.push(
            { x: p0.x + p0.tx * dt / 3, y: p0.y + p0.ty * dt / 3 },
            { x: p1.x - p1.tx * dt / 3, y: p1.y - p1.ty * dt / 3 },
            { x: p1.x, y: p1.y },
        );
    }

    return Curve.fromBezierPath(bezierPoints);
}
