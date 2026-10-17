/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMoveDialog, type MoveDialogOptions } from './move-dialog.js';
import type { MoveOutcome } from '../move/move-sender.js';

function mount(overrides: Partial<MoveDialogOptions> = {}) {
    const container = document.createElement('div');
    document.body.replaceChildren(container);
    const options: MoveDialogOptions = {
        container,
        variant: 'handoff',
        targetHost: 'puzzlewise.github.io',
        move: vi.fn(async (): Promise<MoveOutcome> => ({ status: 'done' })),
        ...overrides,
    };
    const close = createMoveDialog(options);
    const buttons = () => [...container.querySelectorAll<HTMLButtonElement>('.move-btn')];
    const button = (label: string) => buttons().find((b) => b.textContent === label)!;
    const status = () => container.querySelector('.move-status')?.textContent;
    return { container, options, close, buttons, button, status };
}

describe('createMoveDialog', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    it('offers Move and Not now when opened from the banner', () => {
        const { buttons } = mount();
        expect(buttons().map((b) => b.textContent)).toEqual(['Not now', 'Move to the new site']);
    });

    it('offers starting here instead of Not now when opened from New puzzle', () => {
        const onStartHere = vi.fn();
        const { buttons, button, container } = mount({ onStartHere });
        expect(buttons().map((b) => b.textContent))
            .toEqual(['Start a new puzzle here anyway', 'Move to the new site']);
        button('Start a new puzzle here anyway').click();
        expect(onStartHere).toHaveBeenCalledTimes(1);
        expect(container.querySelector('.move-dialog')).toBeNull();
    });

    it('names the new host', () => {
        const { container } = mount();
        expect(container.querySelector('.move-body')?.textContent).toContain('puzzlewise.github.io');
    });

    it('shows success and reports the outcome', async () => {
        const onOutcome = vi.fn();
        const { button, status, buttons } = mount({ onOutcome });
        button('Move to the new site').click();
        await vi.waitFor(() => expect(status()).toBe('Done — your puzzle is open in the new tab.'));
        expect(onOutcome).toHaveBeenCalledWith({ status: 'done' });
        expect(buttons().map((b) => b.textContent)).toEqual(['Close']);
    });

    it.each([
        [{ status: 'popup-blocked' } as MoveOutcome, 'Your browser blocked the new window — allow pop-ups and try again.'],
        [{ status: 'timeout' } as MoveOutcome, 'Couldn’t reach the new site.'],
        [{ status: 'closed' } as MoveOutcome, 'The new site’s window was closed before the move finished.'],
    ])('explains %o and offers a retry', async (outcome, message) => {
        const { button, status } = mount({ move: async () => outcome });
        button('Move to the new site').click();
        await vi.waitFor(() => expect(status()).toBe(message));
        expect(button('Try again').disabled).toBe(false);
    });

    it('explains a failure without offering a retry that would fail the same way', async () => {
        const { button, buttons, status } = mount({
            move: async () => ({ status: 'failed', reason: 'write-failed' }),
        });
        button('Move to the new site').click();
        await vi.waitFor(() => expect(status())
            .toBe('The move didn’t work — the new site couldn’t store it. Your puzzle is still here.'));
        expect(buttons().map((b) => b.textContent)).toEqual(['Close']);
    });

    it('keeps starting a new puzzle here available after a failure from New puzzle', async () => {
        const onStartHere = vi.fn();
        const { button, buttons, status } = mount({
            onStartHere,
            move: async () => ({ status: 'failed', reason: 'unloadable-save' }),
        });
        button('Move to the new site').click();
        await vi.waitFor(() => expect(status()).toMatch(/The move didn’t work/));

        expect(buttons().map((b) => b.textContent)).toEqual(['Start a new puzzle here anyway', 'Close']);
        button('Start a new puzzle here anyway').click();
        expect(onStartHere).toHaveBeenCalledTimes(1);
    });

    it('offers only Close after a successful move, even from New puzzle', async () => {
        const { button, buttons, status } = mount({ onStartHere: vi.fn() });
        button('Move to the new site').click();
        await vi.waitFor(() => expect(status()).toBe('Done — your puzzle is open in the new tab.'));
        expect(buttons().map((b) => b.textContent)).toEqual(['Close']);
    });

    it('closes when the new site declines', async () => {
        const { button, container } = mount({ move: async () => ({ status: 'declined' }) });
        button('Move to the new site').click();
        await vi.waitFor(() => expect(container.querySelector('.move-dialog')).toBeNull());
    });

    it('aborts an in-flight handoff when closed', () => {
        let signal: AbortSignal | undefined;
        const { button, close } = mount({
            move: (s) => {
                signal = s;
                return new Promise<MoveOutcome>(() => {});
            },
        });
        button('Move to the new site').click();
        expect(button('Moving…').disabled).toBe(true);
        close();
        expect(signal?.aborted).toBe(true);
    });

    it('aborts an in-flight handoff on Escape', () => {
        let signal: AbortSignal | undefined;
        const { button } = mount({
            move: (s) => {
                signal = s;
                return new Promise<MoveOutcome>(() => {});
            },
        });
        button('Move to the new site').click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(signal?.aborted).toBe(true);
    });

    it('shows instructions without a move button on an installed iOS app', () => {
        const move = vi.fn();
        const { buttons, container } = mount({ variant: 'ios-standalone', move, onStartHere: vi.fn() });
        expect(buttons().map((b) => b.textContent)).toEqual(['Start a new puzzle here anyway', 'Close']);
        expect(container.querySelector('.move-body')?.textContent).toMatch(/Safari.*Home Screen/);
        expect(move).not.toHaveBeenCalled();
    });
});
