import { MOVE_FAILURE_TEXT } from '../move/move-protocol.js';
import type { MoveOutcome } from '../move/move-sender.js';
import { createDismissableOverlay } from './dismissable-overlay.js';
import { moveButton } from './receive-move-screen.js';

export type MoveDialogVariant = 'handoff' | 'ios-standalone';

export interface MoveDialogOptions {
    container: HTMLElement;
    variant: MoveDialogVariant;
    targetHost: string;
    move: (signal: AbortSignal) => Promise<MoveOutcome>;
    onStartHere?: () => void;
    onOutcome?: (outcome: MoveOutcome) => void;
}

type RetryableOutcome = Extract<MoveOutcome, { status: 'failed' | 'popup-blocked' | 'timeout' }>;

function retryMessage(outcome: RetryableOutcome): string {
    switch (outcome.status) {
        case 'failed':
            return `The move didn’t work — ${MOVE_FAILURE_TEXT[outcome.reason]}. Your puzzle is still here.`;
        case 'popup-blocked':
            return 'Your browser blocked the new window — allow pop-ups and try again.';
        case 'timeout':
            return 'Couldn’t reach the new site.';
    }
}

export function createMoveDialog(options: MoveDialogOptions): () => void {
    const { container, variant, targetHost, move, onStartHere, onOutcome } = options;
    const controller = new AbortController();
    const { overlay, dismiss } = createDismissableOverlay({
        container,
        className: 'move-overlay',
        onDismiss: () => controller.abort(),
    });

    function close(): void {
        controller.abort();
        dismiss();
    }

    const dialog = document.createElement('div');
    dialog.className = 'move-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Puzzle has moved');

    const title = document.createElement('h2');
    title.className = 'move-title';
    title.textContent = 'Puzzle has moved';

    const body = document.createElement('p');
    body.className = 'move-body';
    body.textContent = variant === 'handoff'
        ? `Puzzle now lives at ${targetHost}. Bring your puzzle and settings along — ` +
          'it opens in a new tab, right where you left off. Everything here stays as it is.'
        : `Puzzle now lives at ${targetHost}. To keep getting updates, open ${targetHost} ` +
          'in Safari and add it to your Home Screen. Your current puzzle stays here.';

    const status = document.createElement('p');
    status.className = 'move-status';
    status.setAttribute('role', 'status');

    const buttons = document.createElement('div');
    buttons.className = 'move-buttons';

    if (onStartHere) {
        const startHere = moveButton('Start a new puzzle here anyway');
        startHere.addEventListener('click', () => {
            close();
            onStartHere();
        });
        buttons.appendChild(startHere);
    }

    if (variant === 'ios-standalone') {
        const closeButton = moveButton('Close', onStartHere === undefined);
        closeButton.addEventListener('click', close);
        buttons.appendChild(closeButton);
    } else {
        if (!onStartHere) {
            const notNow = moveButton('Not now');
            notNow.addEventListener('click', close);
            buttons.appendChild(notNow);
        }

        const moveNow = moveButton('Move to the new site', true);
        const runMove = async (): Promise<void> => {
            moveNow.disabled = true;
            moveNow.textContent = 'Moving…';
            status.textContent = '';
            const outcome = await move(controller.signal);
            onOutcome?.(outcome);
            switch (outcome.status) {
                case 'canceled':
                    return;
                case 'declined':
                    close();
                    return;
                case 'done': {
                    status.textContent = 'Done — your puzzle is open in the new tab.';
                    const closeButton = moveButton('Close', true);
                    closeButton.addEventListener('click', close);
                    buttons.replaceChildren(closeButton);
                    return;
                }
                default:
                    status.textContent = retryMessage(outcome);
                    moveNow.disabled = false;
                    moveNow.textContent = 'Try again';
            }
        };
        moveNow.addEventListener('click', () => {
            void runMove();
        });
        buttons.appendChild(moveNow);
    }

    dialog.append(title, body, status, buttons);
    overlay.appendChild(dialog);
    return close;
}
