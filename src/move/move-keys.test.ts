import { describe, it, expect } from 'vitest';
import { GAME_CONTEXT_KEY } from '../analytics/game-context.js';
import { STORAGE_KEY, PROGRESS_KEY } from '../persistence/index.js';
import { MOVED_KEYS, NOT_MOVED_KEYS } from './move-keys.js';

describe('moved storage keys', () => {
    it('matches the moved keys of the frozen legacy build', () => {
        expect([...MOVED_KEYS].sort(), 'change only alongside a rebuilt legacy site').toEqual([
            'puzzle-analytics-userid',
            'puzzle-background-color',
            'puzzle-background-colour',
            'puzzle-composable-config',
            'puzzle-cut-style',
            'puzzle-fractal-config',
            'puzzle-game-analytics',
            'puzzle-game-state',
            'puzzle-image-category',
            'puzzle-image-source',
            'puzzle-image-vibrant',
            'puzzle-marquee-contain',
            'puzzle-merge-tolerance',
            'puzzle-offset-drag',
            'puzzle-piece-outline',
            'puzzle-piece-outline-color',
            'puzzle-progress',
            'puzzle-rotation-enabled',
            'puzzle-size-preference',
            'puzzle-wavy-config',
        ]);
    });

    it('keeps the keys the receiver special-cases under the names the frozen build sends', () => {
        expect([STORAGE_KEY, PROGRESS_KEY, GAME_CONTEXT_KEY].filter((key) => !MOVED_KEYS.includes(key))).toEqual([]);
    });

    it('moves only keys the sender collects', () => {
        expect(MOVED_KEYS.filter((key) => !key.startsWith('puzzle-'))).toEqual([]);
    });

    it('never lists a key as both moved and not moved', () => {
        expect(MOVED_KEYS.filter((key) => NOT_MOVED_KEYS.includes(key))).toEqual([]);
    });
});
