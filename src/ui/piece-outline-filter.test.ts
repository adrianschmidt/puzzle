/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { installPieceOutlineFilter } from './piece-outline-filter.js';

describe('installPieceOutlineFilter', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    it('appends a <filter id="piece-outline"> to the document', () => {
        installPieceOutlineFilter();
        const filter = document.querySelector('filter#piece-outline');
        expect(filter).toBeTruthy();
    });

    it('uses feMorphology dilate with radius 1', () => {
        installPieceOutlineFilter();
        const morph = document.querySelector(
            'filter#piece-outline feMorphology',
        );
        expect(morph?.getAttribute('operator')).toBe('dilate');
        expect(morph?.getAttribute('radius')).toBe('1');
    });

    it('composites the original SourceGraphic on top via feMerge', () => {
        installPieceOutlineFilter();
        const mergeNodes = document.querySelectorAll(
            'filter#piece-outline feMergeNode',
        );
        expect(mergeNodes.length).toBe(2);
        expect(mergeNodes[0].getAttribute('in')).toBe('outline');
        expect(mergeNodes[1].getAttribute('in')).toBe('SourceGraphic');
    });

    it('uses the SVG namespace for filter elements', () => {
        installPieceOutlineFilter();
        const filter = document.querySelector('filter#piece-outline');
        expect(filter?.namespaceURI).toBe('http://www.w3.org/2000/svg');
    });

    it('is idempotent — a second call does not duplicate the filter', () => {
        installPieceOutlineFilter();
        installPieceOutlineFilter();
        const filters = document.querySelectorAll('filter#piece-outline');
        expect(filters.length).toBe(1);
    });

    it('host <svg> is visually hidden (no layout impact)', () => {
        installPieceOutlineFilter();
        const svg = document.querySelector('svg[data-piece-outline-host]');
        expect(svg).toBeTruthy();
        expect(svg?.getAttribute('width')).toBe('0');
        expect(svg?.getAttribute('height')).toBe('0');
        expect(svg?.getAttribute('aria-hidden')).toBe('true');
    });
});
