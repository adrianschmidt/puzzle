import { describe, expect, it } from 'vitest';
import { buildReproParams, reproParamsToPayload } from './repro-params.js';
import { decodePayload, encodePayload } from './share-link.js';
import { makeGameState } from '../test-helpers/fixtures.js';

function classicTracedState() {
    const state = makeGameState();
    state.seed = 1534700170;
    state.cutStyle = 'classic';
    state.imageUrl = 'https://images.unsplash.com/photo-x?w=1080';
    state.imageSize = { width: 1080, height: 1440 };
    state.gridSize = { cols: 12, rows: 16 };
    state.rotationMode = 'free';
    state.classicConfig = { traceSetVersion: 1 };
    return state;
}

describe('buildReproParams', () => {
    it('includes imageUrl and imageSize', () => {
        const params = buildReproParams(classicTracedState());
        expect(params.imageUrl).toBe('https://images.unsplash.com/photo-x?w=1080');
        expect(params.imageSize).toEqual({ width: 1080, height: 1440 });
    });

    it('passes classicConfig through and omits other styles’ configs', () => {
        const params = buildReproParams(classicTracedState());
        expect(params.classicConfig).toEqual({ traceSetVersion: 1 });
        expect(params).not.toHaveProperty('wavyConfig');
        expect(params).not.toHaveProperty('composableConfig');
    });

    it('omits classicConfig for a legacy-classic state', () => {
        const state = classicTracedState();
        delete state.classicConfig;
        expect(buildReproParams(state)).not.toHaveProperty('classicConfig');
    });

    it('collapses a blank canvas data URL to the blank sentinel', () => {
        const state = classicTracedState();
        // What main.ts stores for a blank puzzle: the painted canvas itself.
        state.imageUrl = 'data:image/png;base64,' + 'A'.repeat(6000);
        const params = buildReproParams(state);
        expect(params.imageUrl).toBe('blank');
        // The whole point: no part of the multi-KB URL reaches the printed
        // block, whatever else the builder carries through.
        expect(JSON.stringify(params)).not.toContain('data:');
    });

    it('omits imageUrl and imageSize rather than emitting undefined keys', () => {
        // A hand-built or legacy state can lack fields the current type
        // declares as required.
        const state = classicTracedState() as Partial<ReturnType<typeof classicTracedState>>;
        delete state.imageUrl;
        delete state.imageSize;
        const params = buildReproParams(state as ReturnType<typeof classicTracedState>);
        expect(params).not.toHaveProperty('imageUrl');
        expect(params).not.toHaveProperty('imageSize');
    });
});

describe('reproParamsToPayload', () => {
    it('maps a classic-traced params object', () => {
        const payload = reproParamsToPayload(buildReproParams(classicTracedState()));
        expect(payload).toEqual({
            v: 1,
            i: 'https://images.unsplash.com/photo-x?w=1080',
            is: [1080, 1440],
            g: [12, 16],
            c: 'classic',
            s: 1534700170,
            r: 'free',
            clf: { tv: 1 },
        });
    });

    it('omits clf when classicConfig is absent (legacy generator semantics)', () => {
        const params = buildReproParams(classicTracedState());
        delete params.classicConfig;
        expect(reproParamsToPayload(params)).not.toHaveProperty('clf');
    });

    it('replays a collapsed blank canvas at the recorded dimensions', () => {
        const state = classicTracedState();
        state.imageUrl = 'data:image/png;base64,AAAA';
        const payload = reproParamsToPayload(buildReproParams(state));
        expect(payload.i).toBe('blank');
        expect(payload.is).toEqual([1080, 1440]);
    });

    it('falls back to the blank canvas and no rotation', () => {
        const params = buildReproParams(classicTracedState());
        delete params.imageUrl;
        delete params.rotationMode;
        const payload = reproParamsToPayload(params);
        expect(payload.i).toBe('blank');
        expect(payload.r).toBe('none');
    });

    it('maps wavy config', () => {
        const state = classicTracedState();
        state.cutStyle = 'wavy';
        delete state.classicConfig;
        state.wavyConfig = { borderless: true, traceSetVersion: 1 };
        const payload = reproParamsToPayload(buildReproParams(state));
        expect(payload.wf).toEqual({ bl: true, tv: 1 });
        expect(payload).not.toHaveProperty('clf');
    });

    it('maps fractal config', () => {
        const state = classicTracedState();
        state.cutStyle = 'fractal';
        delete state.classicConfig;
        state.fractalConfig = { borderless: true };
        const payload = reproParamsToPayload(buildReproParams(state));
        expect(payload.ff).toEqual({ bl: true });
        expect(payload).not.toHaveProperty('clf');
    });

    it('maps triangles config', () => {
        const state = classicTracedState();
        state.cutStyle = 'triangles';
        delete state.classicConfig;
        state.trianglesConfig = { traceSetVersion: 1 };
        const payload = reproParamsToPayload(buildReproParams(state));
        expect(payload.tf).toEqual({ tv: 1 });
        expect(payload).not.toHaveProperty('clf');
    });

    it('maps composable config through the shared block mapping', () => {
        const state = classicTracedState();
        state.cutStyle = 'composable';
        delete state.classicConfig;
        state.composableConfig = {
            baseCutGenerator: 'sine',
            baseCutConfig: { ha: 0.4 },
            tabGenerator: 'classic',
            tabConfig: {},
            minPieceArea: 500,
        };
        const payload = reproParamsToPayload(buildReproParams(state));
        expect(payload.cf).toEqual({
            bg: 'sine', bgc: { ha: 0.4 }, tg: 'classic', tgc: {}, mpa: 500,
        });
    });

    for (const field of ['seed', 'cutStyle', 'imageSize', 'gridSize'] as const) {
        it(`throws naming the missing field: ${field}`, () => {
            const params = buildReproParams(classicTracedState());
            delete params[field];
            expect(() => reproParamsToPayload(params)).toThrow(field);
        });
    }

    it('throws naming the field when it is null rather than absent', () => {
        const params = buildReproParams(classicTracedState());
        // A hand-edited params object can carry an explicit `null`. Without
        // `required` rejecting it, the `imageSize.width` read below throws an
        // unattributed TypeError instead of naming the field.
        (params as { imageSize?: unknown }).imageSize = null;
        expect(() => reproParamsToPayload(params)).toThrow(/imageSize/);
    });

    it('throws naming cutStyle when it is not a known style', () => {
        const params = buildReproParams(classicTracedState());
        params.cutStyle = 'clasic';
        expect(() => reproParamsToPayload(params)).toThrow(/cutStyle/);
    });

    it('rejects an inherited Object property masquerading as a cut style', () => {
        const params = buildReproParams(classicTracedState());
        params.cutStyle = 'toString';
        expect(() => reproParamsToPayload(params)).toThrow(/cutStyle/);
    });

    it('throws naming cutStyle for a non-string that stringifies to a style', () => {
        const params = buildReproParams(classicTracedState());
        // `hasOwnProperty` coerces its key, so `['classic']` passes the
        // membership test on its own; the predicate checks `typeof` internally
        // so this names the field here instead of degrading to the decoder's
        // unattributed `null`.
        (params as { cutStyle?: unknown }).cutStyle = ['classic'];
        expect(() => reproParamsToPayload(params)).toThrow(/cutStyle/);
    });

    it('throws naming rotationMode when it is not a known mode', () => {
        const params = buildReproParams(classicTracedState());
        // The typo a screenshot invites: the block prints 'quarter-turn'.
        params.rotationMode = 'quarter turn';
        expect(() => reproParamsToPayload(params)).toThrow(/rotationMode/);
    });

    it('survives the share codec round-trip the console helper uses', () => {
        const payload = reproParamsToPayload(buildReproParams(classicTracedState()));
        const decoded = decodePayload(encodePayload(payload));
        expect(decoded).not.toBeNull();
        expect(decoded).toMatchObject({ s: 1534700170, c: 'classic', is: [1080, 1440], clf: { tv: 1 } });
    });
});
