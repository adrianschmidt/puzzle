import { track, type MoveTrigger } from '../analytics/index.js';
import { createMoveBanner } from '../ui/move-banner.js';
import { createMoveDialog } from '../ui/move-dialog.js';
import { hasMoved, isIosStandalone } from './move-config.js';
import { runMoveHandoff, type MoveOutcome } from './move-sender.js';

export interface MoveSourceDeps {
    container: HTMLElement;
    targetUrl: string;
    flushSave: () => void;
    location?: Pick<Location, 'assign'>;
    nav?: Navigator;
    handoff?: (signal: AbortSignal) => Promise<MoveOutcome>;
}

export interface MoveSource {
    onNewGame(openNewGame: () => void): void;
    showBanner(): void;
}

export function redirectShareLink(
    targetUrl: string,
    location: Pick<Location, 'hash' | 'replace'> = window.location,
): boolean {
    if (!location.hash.startsWith('#p=')) return false;
    location.replace(targetUrl + location.hash);
    return true;
}

function trackOutcome(outcome: MoveOutcome): void {
    if (outcome.status === 'canceled') return;
    track(
        'move-result',
        outcome.status === 'failed'
            ? { outcome: 'failed', reason: outcome.reason }
            : { outcome: outcome.status },
    );
}

export function createMoveSource(deps: MoveSourceDeps): MoveSource {
    const { container, targetUrl, flushSave, location = window.location, nav = navigator } = deps;
    const handoff = deps.handoff ?? ((signal: AbortSignal) => runMoveHandoff({ targetUrl, signal }));
    const targetHost = new URL(targetUrl).host;
    const iosStandalone = isIosStandalone(nav);

    let removeBanner: (() => void) | undefined;

    function showMovedBanner(): void {
        removeBanner?.();
        removeBanner = createMoveBanner({
            container,
            text: `Your puzzle is now at ${targetHost}`,
            onOpen: () => location.assign(targetUrl),
        });
    }

    function openDialog(trigger: MoveTrigger, onStartHere?: () => void): void {
        const variant = iosStandalone ? 'ios-standalone' : 'handoff';
        track('move-dialog-shown', { trigger, variant });
        createMoveDialog({
            container,
            variant,
            targetHost,
            onStartHere,
            move: (signal) => {
                track('move-started', { trigger });
                flushSave();
                return handoff(signal);
            },
            onOutcome: (outcome) => {
                trackOutcome(outcome);
                if (outcome.status === 'done' && container.querySelector('.move-banner') !== null) {
                    showMovedBanner();
                }
            },
        });
    }

    return {
        onNewGame(openNewGame) {
            if (hasMoved()) {
                location.assign(targetUrl);
                return;
            }
            openDialog('new-game', openNewGame);
        },
        showBanner() {
            if (iosStandalone) return;
            if (hasMoved()) {
                showMovedBanner();
                return;
            }
            removeBanner = createMoveBanner({
                container,
                text: 'Puzzle has moved — bring your puzzle along',
                onOpen: () => openDialog('banner'),
            });
        },
    };
}
