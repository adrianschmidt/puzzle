/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    MOVED_TO_KEY,
    hasMoved,
    isIosStandalone,
    markMoved,
    movedToUrl,
    moveSourceOrigin,
    receiveMoveUrl,
    shareBaseUrl,
} from './move-config.js';

afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
    history.replaceState(null, '', '/');
});

describe('movedToUrl', () => {
    it('is undefined when VITE_MOVED_TO is unset', () => {
        vi.stubEnv('VITE_MOVED_TO', '');
        expect(movedToUrl()).toBeUndefined();
    });

    it('normalizes the configured URL', () => {
        vi.stubEnv('VITE_MOVED_TO', 'https://puzzlewise.github.io');
        expect(movedToUrl()).toBe('https://puzzlewise.github.io/');
    });
});

describe('moveSourceOrigin', () => {
    it('defaults to the legacy origin', () => {
        vi.stubEnv('VITE_MOVED_FROM', '');
        expect(moveSourceOrigin()).toBe('https://adrianschmidt.github.io');
    });

    it('reduces an override to its origin', () => {
        vi.stubEnv('VITE_MOVED_FROM', 'http://localhost:5173/puzzle/');
        expect(moveSourceOrigin()).toBe('http://localhost:5173');
    });
});

describe('receiveMoveUrl', () => {
    it('replaces query and hash with the receive parameter', () => {
        expect(receiveMoveUrl('http://localhost:5174/puzzle/?x=1#p=abc'))
            .toBe('http://localhost:5174/puzzle/?receive-move');
    });
});

describe('isIosStandalone', () => {
    it('is true only for navigator.standalone === true', () => {
        expect(isIosStandalone({ standalone: true } as unknown as Navigator)).toBe(true);
        expect(isIosStandalone({ standalone: false } as unknown as Navigator)).toBe(false);
        expect(isIosStandalone({} as Navigator)).toBe(false);
    });
});

describe('shareBaseUrl', () => {
    it('is the current page without its hash when not moved', () => {
        vi.stubEnv('VITE_MOVED_TO', '');
        history.replaceState(null, '', '/puzzle/?userid=x#p=abc');
        expect(shareBaseUrl()).toBe(`${location.origin}/puzzle/?userid=x`);
    });

    it('is the new site when VITE_MOVED_TO is set', () => {
        vi.stubEnv('VITE_MOVED_TO', 'https://puzzlewise.github.io/');
        expect(shareBaseUrl()).toBe('https://puzzlewise.github.io/');
    });
});

describe('hasMoved / markMoved', () => {
    it('records the target URL', () => {
        expect(hasMoved()).toBe(false);
        markMoved('https://puzzlewise.github.io/');
        expect(hasMoved()).toBe(true);
        expect(localStorage.getItem(MOVED_TO_KEY)).toBe('https://puzzlewise.github.io/');
    });
});
