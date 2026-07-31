import { describe, it, expect, vi } from 'vitest';
import { buildPieceCountMismatchData } from './piece-count-mismatch-payload.js';
import type { GameState } from '../model/types.js';
import { createSeededRandom } from '../puzzle/seeded-random.js';
import { makeGameState } from '../test-helpers/fixtures.js';
import { getCutStyleStrategy } from '../game/cut-style-strategies.js';
import { CUT_STYLE_OPTIONS } from '../game/cut-styles.js';

function stateFixture(overrides: Partial<GameState> = {}): GameState {
    return makeGameState({
        seed: 124741785,
        cutStyle: 'classic',
        imageUrl: 'https://images.unsplash.com/photo-123?w=1080&q=80',
        imageSize: { width: 1080, height: 720 },
        gridSize: { cols: 16, rows: 12 },
        rotationMode: 'none',
        classicConfig: { traceSetVersion: 1 },
        ...overrides,
    });
}

const MISMATCH = { expected: 192, actual: 189, baseCutId: 'sine' };

describe('buildPieceCountMismatchData', () => {
    it('carries the counts and the base cut that declared them', () => {
        const data = buildPieceCountMismatchData(stateFixture(), MISMATCH, 'fresh');
        expect(data.expected).toBe(192);
        expect(data.actual).toBe(189);
        expect(data.baseCut).toBe('sine');
        expect(data.cutStyle).toBe('classic');
        expect(data.source).toBe('fresh');
    });

    it('carries a dev-console source distinctly from a real-player one', () => {
        // #512: `'dev'` (a dev-console start, e.g. `__newComposableGame`)
        // must stay distinguishable from `'fresh'` (a real player) and from
        // `'repro'` (a `__reproPuzzle` replay) — all three are excluded from
        // the incident count differently: 'fresh' is the count itself,
        // 'repro'/'dev' are both subtracted from it.
        const data = buildPieceCountMismatchData(stateFixture(), MISMATCH, 'dev');
        expect(data.source).toBe('dev');
    });

    it('carries the repro params flattened', () => {
        const data = buildPieceCountMismatchData(stateFixture(), MISMATCH, 'fresh');
        expect(data.seed).toBe(124741785);
        expect(data.cols).toBe(16);
        expect(data.rows).toBe(12);
        expect(data.imageWidth).toBe(1080);
        expect(data.imageHeight).toBe(720);
        expect(data.rotationMode).toBe('none');
        expect(data.styleConfig).toBe('{"traceSetVersion":1}');
    });

    it.each([
        ['classic', { classicConfig: { traceSetVersion: 1 } }, '{"traceSetVersion":1}'],
        ['wavy', { wavyConfig: { borderless: true } }, '{"borderless":true}'],
        ['triangles', { trianglesConfig: { traceSetVersion: 2 } }, '{"traceSetVersion":2}'],
        ['fractal', { fractalConfig: { borderless: true } }, '{"borderless":true}'],
        [
            'composable',
            { composableConfig: { baseCutGenerator: 'sine', tabGenerator: 'classic' } },
            '{"baseCutGenerator":"sine","tabGenerator":"classic"}',
        ],
    ])('reports %s\'s own config block, never a foreign one', (cutStyle, config, expected) => {
        // The fixture always sets `classicConfig`, which stands in here for
        // the stray foreign block a crafted link or hand-edited save can
        // carry: `buildReproParams` copies every block on the state, so a
        // builder that took "whichever is present" would report it for all
        // five styles. Only the classic row should resolve to it.
        const data = buildPieceCountMismatchData(
            stateFixture({ cutStyle, ...config } as Partial<GameState>),
            MISMATCH, 'fresh');
        expect(data.styleConfig).toBe(expected);
    });

    it.each(
        CUT_STYLE_OPTIONS.map((o) => [o.id, getCutStyleStrategy(o.id).configKey] as const),
    )(
        'reads %s\'s config from the block createNewGame writes it to',
        (cutStyle, configKey) => {
            // `STYLE_CONFIG_READERS` is the READ side of the style ->
            // config-block mapping; `CutStyleStrategy.configKey` (consumed by
            // `init.ts`) is the WRITE side, and nothing else forces the two to
            // agree. A sixth style whose entries disagreed would compile and
            // pass the `it.each` above — which sets the block the reader reads
            // — while shipping rows with `styleConfig` silently absent,
            // indistinguishable from legacy Classic, whose absence is
            // load-bearing. Deriving the read from `configKey` instead is not
            // the fix: it is optional on the strategy, so the reader table
            // would lose its forced-entry property.
            if (configKey === undefined) {
                // The documented allowance on `CutStyleStrategy.configKey`:
                // "a future style that takes no config at all". There is no
                // write side to cross-check, so pin the property that still
                // has to hold — the fixture's `classicConfig` is foreign to
                // such a style, and its reader must report nothing rather
                // than pick that block up.
                const data = buildPieceCountMismatchData(
                    stateFixture({ cutStyle } as Partial<GameState>),
                    MISMATCH, 'fresh');
                expect(data.styleConfig).toBeUndefined();
                return;
            }

            const marker = { markerFor: cutStyle };
            const data = buildPieceCountMismatchData(
                stateFixture({
                    cutStyle,
                    classicConfig: undefined,
                    [configKey]: marker,
                } as Partial<GameState>),
                MISMATCH, 'fresh');

            expect(data.styleConfig).toBe(JSON.stringify(marker));
        },
    );

    it.each(['constructor', 'toString', '__proto__', 'valueOf'])(
        'reports no styleConfig for the inherited key %s',
        (cutStyle) => {
            // Two layers hold this: `isCutStyle` narrows with an own-key
            // `hasOwnProperty` check, and `STYLE_CONFIG_READERS` is
            // prototype-less. This case exercises LAYER 1 only — the predicate
            // rejects the key before the table is ever indexed — so it passes
            // with the prototype strip deleted. The test below covers layer 2
            // on its own; keep both.
            const data = buildPieceCountMismatchData(
                stateFixture({ cutStyle } as Partial<GameState>), MISMATCH, 'fresh');

            expect(data.styleConfig).toBeUndefined();
            expect(data.styleConfigOmitted).toBeUndefined();
            expect(JSON.stringify(data)).not.toContain('unsplash');
        },
    );

    it('resolves no reader for an inherited key even if isCutStyle admits one', async () => {
        // Layer 2 alone: `Object.setPrototypeOf(STYLE_CONFIG_READERS, null)`.
        // Its comment says the point is that the table is safe on its own
        // terms, without depending on a predicate in another module — so the
        // test has to remove that predicate. Mocking `isCutStyle` to accept
        // anything is exactly the "simplification to `value in CUT_STYLES`"
        // the comment warns about, made concrete.
        //
        // Without the prototype strip, `STYLE_CONFIG_READERS['constructor']`
        // resolves to `Object`, `Object(repro)` returns `repro` itself, and
        // `styleConfig` becomes `JSON.stringify(repro)` — shipping `imageUrl`,
        // the one field this event promises never to carry. The fixture's
        // Unsplash URL is what makes the last assertion discriminating.
        //
        // `vi.doMock` (not `vi.mock`) plus a dynamic import, so the stub is
        // scoped to this test instead of being hoisted over the whole file:
        // every other case here needs the real predicate.
        vi.resetModules();
        // A spy, not a bare arrow, so the assertion below can prove the stub
        // was the predicate the builder actually called. Without that proof
        // this test degrades silently into a duplicate of the layer-1 `it.each`
        // above the moment `isCutStyle` moves out of the `../sharing/index.js`
        // barrel: `vi.doMock` would stop applying, the real predicate would
        // reject `'constructor'` before the table is indexed, and all three
        // expectations would still pass — with layer 2 no longer exercised.
        const isCutStyleStub = vi.fn(() => true);
        vi.doMock('../sharing/index.js', async (importOriginal) => {
            const actual = await importOriginal<typeof import('../sharing/index.js')>();
            return {
                ...actual,
                isCutStyle: isCutStyleStub as unknown as typeof actual.isCutStyle,
            };
        });
        try {
            const { buildPieceCountMismatchData: build } =
                await import('./piece-count-mismatch-payload.js');

            const data = build(
                stateFixture({ cutStyle: 'constructor' } as unknown as Partial<GameState>),
                MISMATCH, 'fresh');

            expect(isCutStyleStub).toHaveBeenCalledWith('constructor');
            expect(data.styleConfig).toBeUndefined();
            expect(data.styleConfigOmitted).toBeUndefined();
            expect(JSON.stringify(data)).not.toContain('unsplash');
        } finally {
            // Explicit teardown: `vite.config.ts` sets no `restoreMocks`, and a
            // leaked module mock would silently disable `isCutStyle` for every
            // test declared after this one.
            vi.doUnmock('../sharing/index.js');
            vi.resetModules();
        }
    });

    // `isValidPayload` only checks `typeof s === 'number'`, so a crafted share
    // link can carry a fraction, a negative, or a value past Umami's
    // DECIMAL(19,4) range — rounded or row-losing respectively, in both cases
    // leaving a seed that reads as replayable and isn't.
    //
    // Each expectation is spelled out rather than asserted as a range: a plain
    // "is a uint32" check passes for `% 4294967296` and `Math.trunc` too, and
    // both of those differ from `>>> 0` on the negative row (`-1` would ship
    // as `-1` and lose the row to the unsigned column).
    it.each([
        ['a fraction', 1.5, 1],
        ['a negative value', -1, 4294967295],
        ['a value past the uint32 range', 4294967296 + 7, 7],
        // Beyond DECIMAL(19,4). Worth pinning even though it normalizes to a
        // useless 0: 1e30's ulp is 2^47, so the crafted value collapses onto a
        // multiple of 2^32 — an assertion built on this value alone proves
        // nothing, which is why the discriminating rows above exist.
        ['a value past DECIMAL(19,4)', 1e30, 0],
    ])('normalizes %s to a uint32', (_label, crafted, expected) => {
        const { seed } = buildPieceCountMismatchData(
            stateFixture({ seed: crafted }), MISMATCH, 'fresh');
        expect(seed).toBe(expected);
    });

    it('normalizes a crafted seed without changing which puzzle it replays', () => {
        // The point of normalizing rather than dropping: the reported value
        // drives the same PRNG stream the puzzle was generated from
        // (`createSeededRandom` applies ToInt32, and ToInt32(ToUint32(x)) ===
        // ToInt32(x)). `-1` so the two arguments genuinely differ — the
        // assertion is vacuous on any value normalization leaves alone.
        const crafted = -1;
        const { seed } = buildPieceCountMismatchData(
            stateFixture({ seed: crafted }), MISMATCH, 'fresh');

        expect(seed).not.toBe(crafted);
        expect(createSeededRandom(seed)()).toBe(createSeededRandom(crafted)());
    });

    it('leaves a real uint32 seed exactly as generated', () => {
        // `generateSeed` reaches the top of the uint32 range; normalizing
        // must not turn those into negative or otherwise unfamiliar numbers,
        // or the event would stop matching the info modal's repro block.
        const data = buildPieceCountMismatchData(
            stateFixture({ seed: 4294967295 }), MISMATCH, 'fresh');
        expect(data.seed).toBe(4294967295);
    });

    it('never carries the image URL, under any key', () => {
        const data = buildPieceCountMismatchData(stateFixture(), MISMATCH, 'fresh');
        const serialized = JSON.stringify(data);
        expect(serialized).not.toContain('unsplash');
        expect(serialized).not.toContain('images.unsplash.com');
        expect(Object.keys(data)).not.toContain('imageUrl');
    });

    it('omits styleConfig when the puzzle carries no per-style block', () => {
        const data = buildPieceCountMismatchData(
            stateFixture({ classicConfig: undefined }), MISMATCH, 'fresh');
        expect(data.styleConfig).toBeUndefined();
    });

    it('reads the classic config for a state with no cutStyle, matching the cutStyle fallback', () => {
        // `cutStyle` falls back to 'classic' for the payload, so the config
        // must be read under the same rule. Reporting `cutStyle: 'classic'`
        // with no `styleConfig` would mean LEGACY classic to an operator — a
        // different generator — so the row would replay the wrong puzzle
        // while looking valid. Unreachable via createNewGame; pinned so the
        // two readings cannot drift apart.
        const data = buildPieceCountMismatchData(
            stateFixture({ cutStyle: undefined, classicConfig: { traceSetVersion: 1 } }),
            MISMATCH, 'fresh');
        expect(data.cutStyle).toBe('classic');
        expect(data.styleConfig).toBe('{"traceSetVersion":1}');
    });

    it('reports the user grid, not the generation grid', () => {
        // A borderless puzzle generates an oversized grid, but the repro params
        // must be what __reproPuzzle replays from, which is the user grid.
        const data = buildPieceCountMismatchData(
            stateFixture({ gridSize: { cols: 16, rows: 12 } }),
            { expected: 252, actual: 249, baseCutId: 'sine' },
            'fresh',
        );
        expect(data.cols).toBe(16);
        expect(data.rows).toBe(12);
        expect(data.expected).toBe(252);
    });

    it('stays inside Umami event-data limits for every production cut style', () => {
        // Strings <=500 chars, <=50 properties. The loop below only checks
        // finiteness on numbers — 4-decimal precision is pinned separately,
        // for imageWidth/imageHeight only, by the rounding test below. The
        // export shows 102 chars as the longest string shipping today;
        // nothing currently holds that, so this does.
        //
        // Every non-classic case clears `classicConfig`, which the fixture
        // sets: without that, the builder resolves the classic block for all
        // of them and this loop measures the same string five times over
        // instead of each style's own.
        const styles: Array<Partial<GameState>> = [
            { cutStyle: 'classic', classicConfig: { traceSetVersion: 1 } },
            { cutStyle: 'classic', classicConfig: undefined },
            {
                cutStyle: 'wavy', classicConfig: undefined,
                wavyConfig: { borderless: true, traceSetVersion: 1 },
            },
            {
                cutStyle: 'triangles', classicConfig: undefined,
                trianglesConfig: { traceSetVersion: 1 },
            },
            {
                cutStyle: 'fractal', classicConfig: undefined,
                fractalConfig: { borderless: false },
            },
        ] as unknown as Array<Partial<GameState>>;

        for (const overrides of styles) {
            const data = buildPieceCountMismatchData(
                stateFixture(overrides), MISMATCH, 'fresh');
            expect(Object.keys(data).length).toBeLessThanOrEqual(50);
            for (const [key, value] of Object.entries(data)) {
                if (typeof value === 'string') {
                    expect(value.length, `${overrides.cutStyle}/${key}`)
                        .toBeLessThanOrEqual(500);
                }
                if (typeof value === 'number') {
                    expect(Number.isFinite(value), `${overrides.cutStyle}/${key}`).toBe(true);
                }
            }
        }
    });

    it('omits an oversized composable styleConfig and flags styleConfigOmitted instead', () => {
        // A crafted share link can give composable's baseCutConfig/tabConfig
        // (opaque Record<string, unknown>, unbounded by the decoder) enough
        // bulk to cross Umami's 500-char string limit. Build one that does.
        const oversizedBaseCutConfig: Record<string, number> = {};
        for (let i = 0; i < 60; i++) {
            oversizedBaseCutConfig[`param${i}`] = i;
        }
        const data = buildPieceCountMismatchData(
            stateFixture({
                cutStyle: 'composable',
                classicConfig: undefined,
                composableConfig: {
                    baseCutGenerator: 'sine',
                    baseCutConfig: oversizedBaseCutConfig,
                    tabGenerator: 'classic',
                },
            }),
            MISMATCH, 'fresh');

        expect(JSON.stringify(oversizedBaseCutConfig).length).toBeGreaterThan(500);
        expect(data.styleConfig).toBeUndefined();
        expect(data.styleConfigOmitted).toBe(true);
        expect(Object.keys(data).length).toBeLessThanOrEqual(50);
        for (const [key, value] of Object.entries(data)) {
            if (typeof value === 'string') {
                expect(value.length, key).toBeLessThanOrEqual(500);
            }
        }
    });

    it('reports an unserializable styleConfig instead of throwing', () => {
        // `JSON.stringify` is the one operation in the builder that can throw,
        // and composable's baseCutConfig reaches it as an opaque
        // Record<string, unknown> — a dev-console `__newComposableGame` config
        // is a live object, so a circular reference is constructible. Both
        // call sites fire this event AFTER installing the game, from inside
        // the flow's own try/finally, so an escape here would show a false
        // "Couldn't load shared puzzle" toast on a game that started fine.
        const circular: Record<string, unknown> = { ha: 0.15 };
        circular.self = circular;
        const state = stateFixture({
            cutStyle: 'composable',
            classicConfig: undefined,
            composableConfig: {
                baseCutGenerator: 'sine',
                baseCutConfig: circular,
                tabGenerator: 'classic',
            },
        });

        const data = buildPieceCountMismatchData(state, MISMATCH, 'fresh');

        expect(data.styleConfig).toBeUndefined();
        // Same bucket as an oversized config: the row loses its replayability
        // but keeps every other repro field and the counts.
        expect(data.styleConfigOmitted).toBe(true);
        expect(data.seed).toBe(124741785);
        expect(data.expected).toBe(192);
    });

    it('carries no styleConfigOmitted key at all for a normal-sized config', () => {
        const data = buildPieceCountMismatchData(
            stateFixture({
                cutStyle: 'composable',
                classicConfig: undefined,
                composableConfig: {
                    baseCutGenerator: 'sine',
                    baseCutConfig: { ha: 0.15, hf: 1.5, va: 0.15, vf: 1.5 },
                    tabGenerator: 'classic',
                },
            }),
            MISMATCH, 'fresh');

        expect(data.styleConfig).toBeDefined();
        expect(Object.keys(data)).not.toContain('styleConfigOmitted');
    });

    it('rounds fractional image dimensions to Umami number precision', () => {
        // Inscribed rectangles produce fractional sizes. Umami keeps 4
        // decimals; the share-link decoder floors to whole pixels, so
        // rounding here loses nothing a replay would have kept.
        const data = buildPieceCountMismatchData(
            stateFixture({ imageSize: { width: 1080.123456, height: 719.987654 } }),
            MISMATCH, 'fresh');
        expect(data.imageWidth).toBe(1080.1235);
        expect(data.imageHeight).toBe(719.9877);
    });
});
