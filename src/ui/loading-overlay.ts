/**
 * Full-screen "Building puzzle…" overlay for blocking work.
 *
 * Puzzle generation runs in a worker when available and can still take a
 * second or two on older devices; shared-link recipients in particular see
 * a dead page without feedback. `showLoadingOverlay` puts up a spinner and
 * explanatory text, `hideLoadingOverlay` tears it down once the game is
 * rendered. It also hosts an optional Cancel affordance (button + Escape)
 * for callers that can abort the underlying work.
 *
 * `yieldForPaint` is the helper that lets the browser actually paint the
 * overlay before a sync work burst; without it the overlay DOM is
 * created but never shown because the main thread never returns.
 */

const OVERLAY_CLASS = 'loading-overlay';
const TEXT_CLASS = 'loading-overlay__text';
const SPINNER_CLASS = 'loading-overlay__spinner';
const CANCEL_CLASS = 'loading-overlay__cancel';

export interface ShowLoadingOverlayOptions {
    /** Called on Cancel-button click or Escape while the overlay is up. */
    onCancel?: () => void;
}

const APP_ROOT_SELECTOR = '#app';

let cancelHandler: (() => void) | null = null;

/** Where focus was before the overlay took or destroyed it; put back by
 * {@link hideLoadingOverlay}. */
let focusBeforeOverlay: HTMLElement | null = null;

/**
 * `document.body` is where focus already sits on the dominant path (the
 * new-game dialog dismisses before it starts the game), and it is not a
 * place to put focus back.
 */
function restorableFocusTarget(active: Element | null): HTMLElement | null {
    return active instanceof HTMLElement && active !== document.body ? active : null;
}

function onOverlayKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') cancelHandler?.();
}

function onCancelClick(): void {
    cancelHandler?.();
}

/**
 * The overlay is modal to the pointer (it covers the page and takes every
 * event) but has no focus trap, so Shift+Tab off Cancel would otherwise
 * reach the toolbar behind it, where Enter starts a second flow against
 * the same singleton `cancelHandler`. `inert` makes the keyboard agree
 * with the pointer.
 */
function setAppInert(inert: boolean): void {
    const app = document.querySelector<HTMLElement>(APP_ROOT_SELECTOR);
    if (!app) return;
    if (inert) app.setAttribute('inert', '');
    else app.removeAttribute('inert');
}

export function showLoadingOverlay(
    text: string = 'Building puzzle…',
    options: ShowLoadingOverlayOptions = {},
): void {
    let overlay = document.querySelector<HTMLElement>(`.${OVERLAY_CLASS}`);
    const overlayWasUp = overlay !== null;
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = OVERLAY_CLASS;

        const spinner = document.createElement('div');
        spinner.className = SPINNER_CLASS;
        overlay.appendChild(spinner);

        // The live region is the text, not the overlay: the Cancel button
        // is a sibling inside the overlay, and a `role="status"` wrapper
        // would make an interactive control part of a status announcement.
        // `index.html`'s pre-rendered overlay marks it up the same way.
        const label = document.createElement('div');
        label.className = TEXT_CLASS;
        label.setAttribute('role', 'status');
        label.setAttribute('aria-live', 'polite');
        label.textContent = text;
        overlay.appendChild(label);

        document.body.appendChild(overlay);
    } else {
        const label = overlay.querySelector<HTMLElement>(`.${TEXT_CLASS}`);
        if (label) label.textContent = text;
    }

    // Both of the next two statements destroy focus — `inert` blurs
    // anything focused inside the app root, and Cancel takes it — so the
    // save belongs with neither. A re-show skips it: focus is by then the
    // overlay's own Cancel button, which `hideLoadingOverlay` removes, and
    // re-capturing would lose the original target.
    if (!overlayWasUp) focusBeforeOverlay = restorableFocusTarget(document.activeElement);
    setAppInert(true);
    syncCancelButton(overlay, options.onCancel);
}

function syncCancelButton(
    overlay: HTMLElement,
    onCancel: (() => void) | undefined,
): void {
    cancelHandler = onCancel ?? null;
    let button = overlay.querySelector<HTMLButtonElement>(`.${CANCEL_CLASS}`);

    if (!onCancel) {
        button?.remove();
        document.removeEventListener('keydown', onOverlayKeydown);
        return;
    }

    if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = CANCEL_CLASS;
        button.textContent = 'Cancel';
        overlay.appendChild(button);
        // Creation only, deliberately. The overlay covers the page and takes
        // every pointer event, so nothing else is actionable — without this the
        // only way to discover Cancel without sight is to guess that Escape
        // works, and focusing also makes Enter/Space cancel. It cannot be
        // hoisted next to the listener below: `does not steal focus again when
        // the overlay is re-shown` pins that a re-show leaves focus where the
        // user put it.
        button.focus();
    }
    // Both listeners register unconditionally: the callbacks are stable
    // module-level references reading module-level state, so a duplicate
    // addEventListener with the same type/callback/capture is a spec no-op.
    // Registering the click handler inside the creation branch instead would
    // leave the button inert if `index.html` ever pre-renders it the way it
    // already pre-renders the overlay around it.
    button.addEventListener('click', onCancelClick);
    document.addEventListener('keydown', onOverlayKeydown);
}

export function hideLoadingOverlay(): void {
    cancelHandler = null;
    document.removeEventListener('keydown', onOverlayKeydown);
    document.querySelector<HTMLElement>(`.${OVERLAY_CLASS}`)?.remove();
    setAppInert(false);
    // After the un-inert, which would otherwise reject the focus call.
    if (focusBeforeOverlay?.isConnected) focusBeforeOverlay.focus();
    focusBeforeOverlay = null;
}

/**
 * Wait for the browser to paint the current DOM state before returning.
 * Use this after `showLoadingOverlay` and before a synchronous heavy
 * work burst so the overlay actually appears on screen.
 */
export function yieldForPaint(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            setTimeout(resolve, 0);
        });
    });
}
