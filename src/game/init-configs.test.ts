import { describe, it, expect } from 'vitest';
import { createNewGame } from './init.js';

describe('createNewGame — cut-style configs on GameState', () => {
    it('stores fractalConfig when cutStyle is fractal', () => {
        const state = createNewGame(
            'blank',
            { width: 1080, height: 720 },
            { width: 800, height: 600 },
            { cols: 4, rows: 3 },
            { cutStyle: 'fractal', seed: 1, fractalConfig: { borderless: true } },
        );
        expect(state.fractalConfig).toEqual({ borderless: true });
        expect(state.composableConfig).toBeUndefined();
    });

    it('stores composableConfig when cutStyle is composable', () => {
        const cfg = {
            baseCutGenerator: 'sine',
            baseCutConfig: { ha: 0.2, hf: 1, va: 0.3, vf: 2 },
            tabGenerator: 'classic',
            tabConfig: {},
        };
        const state = createNewGame(
            'blank',
            { width: 1080, height: 720 },
            { width: 800, height: 600 },
            { cols: 4, rows: 3 },
            { cutStyle: 'composable', seed: 1, composableConfig: cfg },
        );
        expect(state.composableConfig).toEqual(cfg);
        expect(state.fractalConfig).toBeUndefined();
    });

    it('leaves both configs undefined for classic puzzles', () => {
        const state = createNewGame(
            'blank',
            { width: 1080, height: 720 },
            { width: 800, height: 600 },
            { cols: 4, rows: 3 },
            { cutStyle: 'classic', seed: 1 },
        );
        expect(state.composableConfig).toBeUndefined();
        expect(state.fractalConfig).toBeUndefined();
    });
});
