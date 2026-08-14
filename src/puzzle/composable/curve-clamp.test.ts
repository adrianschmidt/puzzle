import { describe, it, expect } from 'vitest';
import { clampTabToCurve } from './curve-clamp.js';
import { classicTabTemplate } from './tab-shapes.js';
import type { Point } from '../../model/types.js';

function straightLine(x0: number, y0: number, x1: number, y1: number, n = 20): Point[] {
    const pts: Point[] = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push({ x: x0 + t * (x1 - x0), y: y0 + t * (y1 - y0) });
    }
    return pts;
}

function sineWave(length: number, amplitude: number, frequency: number, n = 40): Point[] {
    const pts: Point[] = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push({
            x: t * length,
            y: amplitude * Math.sin(2 * Math.PI * frequency * t),
        });
    }
    return pts;
}

function seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 1664525 + 1013904223) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

describe('clampTabToCurve', () => {
    it('produces a non-empty SVG path', () => {
        const curve = straightLine(0, 0, 100, 0);
        const tab = classicTabTemplate.generate(seededRandom(42));
        const result = clampTabToCurve(curve, tab);
        expect(result.svgPath).toBeTruthy();
        expect(result.svgPath.length).toBeGreaterThan(10);
    });

    it('SVG path contains Bézier commands (C)', () => {
        const curve = straightLine(0, 0, 100, 0);
        const tab = classicTabTemplate.generate(seededRandom(42));
        const result = clampTabToCurve(curve, tab);
        expect(result.svgPath).toContain('C');
    });

    it('works on a sine wave curve', () => {
        const curve = sineWave(200, 10, 2);
        const tab = classicTabTemplate.generate(seededRandom(42));
        const result = clampTabToCurve(curve, tab);
        expect(result.svgPath).toBeTruthy();
        expect(result.svgPath).toContain('C');
    });

    it('tab placement can be adjusted', () => {
        const curve = straightLine(0, 0, 100, 0);
        const tab = classicTabTemplate.generate(seededRandom(42));
        const result1 = clampTabToCurve(curve, tab, 0.3);
        const result2 = clampTabToCurve(curve, tab, 0.7);
        expect(result1.svgPath).not.toBe(result2.svgPath);
    });

    it('tab chord fraction produces different results', () => {
        const curve = straightLine(0, 0, 100, 0);
        const tab = classicTabTemplate.generate(seededRandom(42));
        const small = clampTabToCurve(curve, tab, 0.5, 0.2);
        const large = clampTabToCurve(curve, tab, 0.5, 0.6);
        expect(small.svgPath).not.toBe(large.svgPath);
    });

    it('preserves curve segments before and after the tab', () => {
        const curve = straightLine(0, 0, 100, 0, 40);
        const tab = classicTabTemplate.generate(seededRandom(42));
        const result = clampTabToCurve(curve, tab, 0.5, 0.3);
        expect(result.svgPath).toMatch(/^L/);
        expect(result.svgPath).toContain('C');
    });

    it('works on a vertical curve', () => {
        const curve = straightLine(50, 0, 50, 100);
        const tab = classicTabTemplate.generate(seededRandom(42));
        const result = clampTabToCurve(curve, tab);
        expect(result.svgPath).toBeTruthy();
    });

    it('works on a diagonal curve', () => {
        const curve = straightLine(0, 0, 100, 100);
        const tab = classicTabTemplate.generate(seededRandom(42));
        const result = clampTabToCurve(curve, tab);
        expect(result.svgPath).toBeTruthy();
    });
});
