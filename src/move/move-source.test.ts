/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../analytics/index.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../analytics/index.js')>();
    return { ...actual, track: vi.fn() };
});

import { track } from '../analytics/index.js';
import { createMoveSource, redirectShareLink, type MoveSourceDeps } from './move-source.js';
import { MOVED_TO_KEY } from './move-config.js';
import type { MoveOutcome } from './move-sender.js';

const TARGET_URL = 'https://puzzlewise.github.io/';

function setUp(overrides: Pick<Partial<MoveSourceDeps>, 'handoff' | 'nav'> = {}) {
    const container = document.createElement('div');
    document.body.replaceChildren(container);
    const flushSave = vi.fn();
    const location = { assign: vi.fn() };
    const handoff = vi.fn(overrides.handoff ?? (async (): Promise<MoveOutcome> => ({ status: 'done' })));
    const source = createMoveSource({
        container,
        targetUrl: TARGET_URL,
        flushSave,
        location,
        nav: overrides.nav ?? ({} as Navigator),
        handoff,
    });
    const button = (label: string) =>
        [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label);
    return { container, source, button, flushSave, location, handoff };
}

beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
});

afterEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
});

describe('redirectShareLink', () => {
    it('sends a #p= link to the new site with its hash', () => {
        const location = { hash: '#p=abc', replace: vi.fn() };
        expect(redirectShareLink(TARGET_URL, location)).toBe(true);
        expect(location.replace).toHaveBeenCalledWith('https://puzzlewise.github.io/#p=abc');
    });

    it('leaves other pages alone', () => {
        const location = { hash: '#other', replace: vi.fn() };
        expect(redirectShareLink(TARGET_URL, location)).toBe(false);
        expect(location.replace).not.toHaveBeenCalled();
    });
});

describe('createMoveSource', () => {
    it('shows the move dialog instead of the new-game dialog', () => {
        const openNewGame = vi.fn();
        const { source, button } = setUp();
        source.onNewGame(openNewGame);

        expect(openNewGame).not.toHaveBeenCalled();
        expect(track).toHaveBeenCalledWith('move-dialog-shown', { trigger: 'new-game', variant: 'handoff' });
        button('Start a new puzzle here anyway')!.click();
        expect(openNewGame).toHaveBeenCalledTimes(1);
    });

    it('flushes the pending save before handing off, and tracks the result', async () => {
        const { source, button, flushSave, handoff } = setUp();
        source.onNewGame(vi.fn());
        button('Move to the new site')!.click();

        expect(flushSave).toHaveBeenCalled();
        expect(flushSave.mock.invocationCallOrder[0])
            .toBeLessThan(handoff.mock.invocationCallOrder[0]);
        expect(track).toHaveBeenCalledWith('move-started', { trigger: 'new-game' });
        await vi.waitFor(() => expect(track).toHaveBeenCalledWith('move-result', { outcome: 'done' }));
    });

    it('tracks a failure reason', async () => {
        const { source, button } = setUp({
            handoff: async () => ({ status: 'failed', reason: 'write-failed' }),
        });
        source.showBanner();
        button('Puzzle has moved — bring your puzzle along')!.click();
        button('Move to the new site')!.click();
        await vi.waitFor(() =>
            expect(track).toHaveBeenCalledWith('move-result', { outcome: 'failed', reason: 'write-failed' }));
    });

    it('sends no result when the dialog is closed mid-handoff', async () => {
        const { source, button } = setUp({
            handoff: (signal) => new Promise<MoveOutcome>((resolve) => {
                signal.addEventListener('abort', () => resolve({ status: 'canceled' }));
            }),
        });
        source.onNewGame(vi.fn());
        button('Move to the new site')!.click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(vi.mocked(track).mock.calls.map(([name]) => name)).not.toContain('move-result');
    });

    it('shows the banner and opens the dialog from it', () => {
        const { source, button, container } = setUp();
        source.showBanner();
        button('Puzzle has moved — bring your puzzle along')!.click();
        expect(container.querySelector('.move-dialog')).not.toBeNull();
        expect(track).toHaveBeenCalledWith('move-dialog-shown', { trigger: 'banner', variant: 'handoff' });
    });

    it('switches the banner to the moved state once a move from it is done', async () => {
        const { source, button, container, location } = setUp();
        source.showBanner();
        button('Puzzle has moved — bring your puzzle along')!.click();
        button('Move to the new site')!.click();

        await vi.waitFor(() => expect(button('Your puzzle is now at puzzlewise.github.io')).toBeDefined());
        expect(container.querySelectorAll('.move-banner')).toHaveLength(1);
        button('Your puzzle is now at puzzlewise.github.io')!.click();
        expect(location.assign).toHaveBeenCalledWith(TARGET_URL);
    });

    it('after a move, New puzzle and the banner go straight to the new site', () => {
        localStorage.setItem(MOVED_TO_KEY, TARGET_URL);
        const openNewGame = vi.fn();
        const { source, button, location } = setUp();

        source.onNewGame(openNewGame);
        expect(location.assign).toHaveBeenCalledWith(TARGET_URL);
        expect(openNewGame).not.toHaveBeenCalled();

        source.showBanner();
        button('Your puzzle is now at puzzlewise.github.io')!.click();
        expect(location.assign).toHaveBeenCalledTimes(2);
    });

    it('on an installed iOS app, shows no banner and the instructions variant', () => {
        const { source, container, button } = setUp({ nav: { standalone: true } as unknown as Navigator });
        source.showBanner();
        expect(container.querySelector('.move-banner')).toBeNull();

        source.onNewGame(vi.fn());
        expect(button('Move to the new site')).toBeUndefined();
        expect(track).toHaveBeenCalledWith('move-dialog-shown', { trigger: 'new-game', variant: 'ios-standalone' });
    });
});
