import { describe, expect, it } from 'vitest';
import { buildShape, fmt } from './build-shape.js';
import type { Edge } from './types.js';

function edge(id: number, start: { x: number; y: number }, end: { x: number; y: number }, path: string): Edge {
    return { id, mateEdgeId: -1, matePieceId: -1, path, start, end };
}

describe('fmt', () => {
    it('emits integers without decimals and rounds others to 2 dp', () => {
        expect(fmt(5)).toBe('5');
        expect(fmt(1.005)).toBe('1.00'); // toFixed semantics, matches previous behavior
        expect(fmt(3.14159)).toBe('3.14');
    });
});

describe('buildShape', () => {
    it('returns an empty string for no edges', () => {
        expect(buildShape([])).toBe('');
    });

    it('wraps a chained loop in a single M..Z subpath', () => {
        const edges = [
            edge(0, { x: 0, y: 0 }, { x: 10, y: 0 }, 'L 10 0'),
            edge(1, { x: 10, y: 0 }, { x: 10, y: 10 }, 'L 10 10'),
            edge(2, { x: 10, y: 10 }, { x: 0, y: 0 }, 'L 0 0'),
        ];
        expect(buildShape(edges)).toBe('M 0 0 L 10 0 L 10 10 L 0 0 Z');
    });

    it('starts a new M..Z subpath when the chain breaks by more than 0.5 px', () => {
        const edges = [
            edge(0, { x: 0, y: 0 }, { x: 10, y: 0 }, 'L 10 0'),
            edge(1, { x: 20, y: 20 }, { x: 30, y: 20 }, 'L 30 20'),
        ];
        expect(buildShape(edges)).toBe('M 0 0 L 10 0 Z M 20 20 L 30 20 Z');
    });

    it('tolerates sub-epsilon gaps between consecutive edges', () => {
        const edges = [
            edge(0, { x: 0, y: 0 }, { x: 10, y: 0 }, 'L 10 0'),
            edge(1, { x: 10.4, y: 0.4 }, { x: 10, y: 10 }, 'L 10 10'),
        ];
        expect(buildShape(edges)).toBe('M 0 0 L 10 0 L 10 10 Z');
    });
});
