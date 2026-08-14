import { describe, it, expect } from 'vitest';
import { CURRENT_TRACE_SET_VERSION } from '../puzzle/composable/traces/trace-set-version.js';
import { generatorConfigsForNewGame } from './generator-configs.js';

describe('generatorConfigsForNewGame', () => {
    it('stamps the current trace-set version on a fresh Wavy game', () => {
        expect(generatorConfigsForNewGame({
            cutStyle: 'wavy',
            wavyConfig: { borderless: true },
            tracedTabsOk: true,
        })).toEqual({
            wavyConfig: { borderless: true, traceSetVersion: CURRENT_TRACE_SET_VERSION },
        });
    });

    it('defaults Wavy borderless to false when the dialog supplied no config', () => {
        const configs = generatorConfigsForNewGame({ cutStyle: 'wavy', tracedTabsOk: true });
        expect(configs.wavyConfig).toEqual({
            borderless: false,
            traceSetVersion: CURRENT_TRACE_SET_VERSION,
        });
    });

    it('stamps Triangles too', () => {
        expect(generatorConfigsForNewGame({ cutStyle: 'triangles', tracedTabsOk: true }))
            .toEqual({ trianglesConfig: { traceSetVersion: CURRENT_TRACE_SET_VERSION } });
    });

    it('stamps Classic when traced tabs loaded', () => {
        expect(generatorConfigsForNewGame({ cutStyle: 'classic', tracedTabsOk: true }))
            .toEqual({ classicConfig: { traceSetVersion: CURRENT_TRACE_SET_VERSION } });
    });

    it('withholds classicConfig when traced tabs failed, selecting the legacy cut', () => {
        // `{}` IS the `legacy-classic` outcome: a Classic game without
        // classicConfig falls back to the legacy straight-grid generator.
        expect(generatorConfigsForNewGame({ cutStyle: 'classic', tracedTabsOk: false }))
            .toEqual({});
    });

    it('passes fractal borderless through regardless of cut style', () => {
        expect(generatorConfigsForNewGame({
            cutStyle: 'classic',
            fractalConfig: { borderless: true },
            tracedTabsOk: true,
        })).toEqual({
            fractalConfig: { borderless: true },
            classicConfig: { traceSetVersion: CURRENT_TRACE_SET_VERSION },
        });
    });

    it('stamps nothing for a Composable game', () => {
        expect(generatorConfigsForNewGame({ cutStyle: 'composable', tracedTabsOk: true }))
            .toEqual({});
    });
});
