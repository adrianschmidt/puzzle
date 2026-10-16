import { diagnostics } from '../diagnostics.js';

export const MOVED_TO_KEY = 'puzzle-moved-to';

export const RECEIVE_MOVE_PARAM = 'receive-move';

const DEFAULT_SOURCE_ORIGIN = 'https://adrianschmidt.github.io';

export function movedToUrl(): string | undefined {
    const raw = import.meta.env.VITE_MOVED_TO as string | undefined;
    return raw ? new URL(raw).href : undefined;
}

export function moveSourceOrigin(): string {
    const raw = import.meta.env.VITE_MOVED_FROM as string | undefined;
    return new URL(raw || DEFAULT_SOURCE_ORIGIN).origin;
}

export function receiveMoveUrl(targetUrl: string): string {
    const url = new URL(targetUrl);
    url.search = RECEIVE_MOVE_PARAM;
    url.hash = '';
    return url.href;
}

/**
 * `navigator.standalone` is set only by iOS/iPadOS Safari for home-screen web
 * apps, whose storage is isolated from Safari's — a handoff from there could
 * not reach the new site's Safari or home-screen storage.
 */
export function isIosStandalone(nav: Navigator = navigator): boolean {
    return (nav as Navigator & { standalone?: unknown }).standalone === true;
}

export function shareBaseUrl(): string {
    return movedToUrl() ?? window.location.href.split('#')[0];
}

export function hasMoved(): boolean {
    try {
        return localStorage.getItem(MOVED_TO_KEY) !== null;
    } catch {
        return false;
    }
}

export function markMoved(targetUrl: string): void {
    try {
        localStorage.setItem(MOVED_TO_KEY, targetUrl);
    } catch (error) {
        diagnostics.warn(`Could not record "${MOVED_TO_KEY}":`, error);
    }
}
