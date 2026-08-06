/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    showLoadingOverlay,
    hideLoadingOverlay,
    yieldForPaint,
} from './loading-overlay.js';

describe('loading-overlay', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('showLoadingOverlay appends an overlay with the given text', () => {
        showLoadingOverlay('Building puzzle…');
        const overlay = document.body.querySelector('.loading-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay!.querySelector('.loading-overlay__text')!.textContent).toBe('Building puzzle…');
    });

    it('showLoadingOverlay is idempotent — only one overlay, text updated on repeat calls', () => {
        showLoadingOverlay('First');
        showLoadingOverlay('Second');
        const overlays = document.body.querySelectorAll('.loading-overlay');
        expect(overlays.length).toBe(1);
        expect(overlays[0].querySelector('.loading-overlay__text')!.textContent).toBe('Second');
    });

    it('showLoadingOverlay adopts a pre-rendered overlay from the HTML template', () => {
        const existing = document.createElement('div');
        existing.className = 'loading-overlay';
        const spinner = document.createElement('div');
        spinner.className = 'loading-overlay__spinner';
        const text = document.createElement('div');
        text.className = 'loading-overlay__text';
        text.textContent = 'From template';
        existing.appendChild(spinner);
        existing.appendChild(text);
        document.body.appendChild(existing);

        showLoadingOverlay('Updated');
        const overlays = document.body.querySelectorAll('.loading-overlay');
        expect(overlays.length).toBe(1);
        expect(overlays[0].querySelector('.loading-overlay__text')!.textContent).toBe('Updated');
    });

    it('hideLoadingOverlay removes the overlay from the DOM', () => {
        showLoadingOverlay('x');
        hideLoadingOverlay();
        expect(document.body.querySelector('.loading-overlay')).toBeNull();
    });

    it('hideLoadingOverlay is a no-op when no overlay exists', () => {
        expect(() => hideLoadingOverlay()).not.toThrow();
    });

    it('yieldForPaint resolves', async () => {
        await expect(yieldForPaint()).resolves.toBeUndefined();
    });

    it('renders a Cancel button when onCancel is provided and invokes it on click', () => {
        const onCancel = vi.fn();
        showLoadingOverlay(undefined, { onCancel });
        const button = document.querySelector<HTMLButtonElement>('.loading-overlay__cancel');
        expect(button).not.toBeNull();
        expect(button!.textContent).toBe('Cancel');
        button!.click();
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('wires a Cancel button that was already in the markup', () => {
        // index.html pre-renders the overlay and its spinner/text, and says it
        // mirrors this module's structure — so it may one day pre-render the
        // Cancel button too. Registering the click handler only in the
        // creation branch would leave such a button inert — clicking it would
        // do nothing. Focus is deliberately NOT hoisted with it: `does not
        // steal focus again when the overlay is re-shown` pins the opposite
        // invariant, so a pre-rendered button would be clickable but unfocused.
        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        const button = document.createElement('button');
        button.className = 'loading-overlay__cancel';
        overlay.appendChild(button);
        document.body.appendChild(overlay);

        const onCancel = vi.fn();
        showLoadingOverlay(undefined, { onCancel });

        document.querySelector<HTMLButtonElement>('.loading-overlay__cancel')!.click();
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('re-showing the overlay repoints Cancel at the new handler', () => {
        // Both directions matter: the second handler fires, and the first does
        // not. A per-call capture would call `first` here; a per-call
        // `addEventListener` would call both.
        const first = vi.fn();
        const second = vi.fn();
        showLoadingOverlay(undefined, { onCancel: first });
        showLoadingOverlay(undefined, { onCancel: second });

        const buttons = document.querySelectorAll('.loading-overlay__cancel');
        expect(buttons).toHaveLength(1);

        document.querySelector<HTMLButtonElement>('.loading-overlay__cancel')!.click();
        expect(second).toHaveBeenCalledOnce();
        expect(first).not.toHaveBeenCalled();
    });

    it('focuses the Cancel button and keeps it out of the live region', () => {
        // The overlay covers the page and swallows every pointer event, so
        // nothing else is actionable while it is up. Without focus the only
        // way to discover the affordance without sight is to guess that
        // Escape works; and an interactive control inside a `role="status"`
        // region is announced as part of a status message rather than as a
        // control.
        showLoadingOverlay(undefined, { onCancel: vi.fn() });
        const button = document.querySelector<HTMLButtonElement>('.loading-overlay__cancel')!;
        expect(document.activeElement).toBe(button);
        expect(button.closest('[role="status"]')).toBeNull();
        expect(button.closest('[aria-live]')).toBeNull();

        const label = document.querySelector('.loading-overlay__text')!;
        expect(label.getAttribute('role')).toBe('status');
        expect(label.getAttribute('aria-live')).toBe('polite');
    });

    it('gives focus back to where it was when the overlay hides', () => {
        // Cancel takes focus, and hiding detaches it — so without an
        // explicit restore a keyboard user lands on `document.body` and
        // loses their place. Bites where focus was meaningfully placed
        // beforehand: a share link arriving via `hashchange` mid-play, or
        // `__reproPuzzle`.
        const before = document.createElement('button');
        document.body.appendChild(before);
        before.focus();

        showLoadingOverlay(undefined, { onCancel: vi.fn() });
        expect(document.activeElement).not.toBe(before);

        hideLoadingOverlay();
        expect(document.activeElement).toBe(before);
    });

    it('gives focus back after an overlay that offers no Cancel button', () => {
        // `inert` blurs whatever was focused inside `#app` whether or not
        // the overlay offers Cancel, so the save cannot be keyed to the
        // button being created. Reachable mid-session: a share link arriving
        // via `hashchange` puts up `share-link-loader`'s non-cancellable
        // "Checking for app update…" overlay while the player has the
        // toolbar focused.
        const app = document.createElement('div');
        app.id = 'app';
        const before = document.createElement('button');
        app.appendChild(before);
        document.body.appendChild(app);
        before.focus();

        showLoadingOverlay('Checking for app update…');
        // jsdom implements no focus fixup for `inert`; do what the browser
        // does on its own once the attribute lands.
        before.blur();
        expect(document.activeElement).not.toBe(before);

        hideLoadingOverlay();
        expect(document.activeElement).toBe(before);
    });

    it('makes the app inert while the overlay is up and interactive again after', () => {
        // The overlay is modal to the pointer but has no focus trap, so
        // without this Shift+Tab off Cancel reaches the toolbar behind it,
        // where Enter starts a second flow against the same overlay.
        const app = document.createElement('div');
        app.id = 'app';
        document.body.appendChild(app);

        showLoadingOverlay(undefined, { onCancel: vi.fn() });
        expect(app.hasAttribute('inert')).toBe(true);

        hideLoadingOverlay();
        expect(app.hasAttribute('inert')).toBe(false);
    });

    it('does not steal focus again when the overlay is re-shown', () => {
        showLoadingOverlay(undefined, { onCancel: vi.fn() });
        const elsewhere = document.createElement('button');
        document.body.appendChild(elsewhere);
        elsewhere.focus();

        showLoadingOverlay('Still building…', { onCancel: vi.fn() });
        expect(document.activeElement).toBe(elsewhere);
    });

    it('renders no Cancel button without onCancel', () => {
        showLoadingOverlay();
        expect(document.querySelector('.loading-overlay__cancel')).toBeNull();
    });

    it('Escape triggers onCancel while the overlay is up', () => {
        const onCancel = vi.fn();
        showLoadingOverlay(undefined, { onCancel });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('Escape does nothing after hideLoadingOverlay', () => {
        const onCancel = vi.fn();
        showLoadingOverlay(undefined, { onCancel });
        hideLoadingOverlay();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(onCancel).not.toHaveBeenCalled();
    });

    // `cancelHandler = null` alone would also make the test above pass, so
    // it doesn't pin down the document listener actually being detached
    // (this repo's tests share one jsdom — a listener left attached is a
    // cross-file leak even though it's inert here). Assert directly.
    it('hideLoadingOverlay detaches its Escape keydown listener from document', () => {
        const removeSpy = vi.spyOn(document, 'removeEventListener');
        showLoadingOverlay(undefined, { onCancel: vi.fn() });
        hideLoadingOverlay();
        expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
        removeSpy.mockRestore();
    });

    it('re-showing without onCancel removes a previous Cancel button', () => {
        showLoadingOverlay(undefined, { onCancel: vi.fn() });
        showLoadingOverlay();
        expect(document.querySelector('.loading-overlay__cancel')).toBeNull();
    });
});
