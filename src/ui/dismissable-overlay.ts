/**
 * Shared dismissal scaffolding for overlay UIs.
 *
 * Modals (info modal, new-game dialog, completion screen) and popovers
 * (background-color picker) all reimplement the same pattern: a div that
 * dismisses on Escape / backdrop click / outside pointerdown, plus the
 * document-level listener cleanup. This file owns those mechanics so each
 * consumer only needs to think about its content.
 *
 * Two helpers are provided:
 *
 * - `createDismissableOverlay` for full-screen modals. Creates an overlay
 *   div in the supplied container; dismissal triggers are Escape and
 *   either backdrop clicks (target === overlay) or any click on the
 *   overlay (for click-anywhere overlays like puzzle-complete).
 *
 * - `attachDismissablePopover` for popovers anchored to a toggle button.
 *   The caller builds and positions the panel; this helper attaches the
 *   dismissal behaviour: Escape and a capture-phase document
 *   `pointerdown` outside both the panel and the anchor element.
 *
 * `onDismiss` fires only for helper-owned dismissal paths, not when the
 * caller invokes `dismiss()` directly. That way "user closed without
 * choosing" callbacks (size-picker `onCancel`) can be wired through
 * without a flag, while button handlers can dismiss without spuriously
 * firing the cancel hook.
 */

/** How a modal dismisses on click. */
export type ModalDismissTrigger = 'backdrop' | 'any-click' | 'none';

export interface DismissableOverlayOptions {
    /** Container the overlay is appended to. */
    container: HTMLElement;
    /** CSS class applied to the overlay div. */
    className: string;
    /**
     * Fires when the overlay is dismissed via Escape, backdrop click, or
     * any-click — i.e. one of the helper-owned triggers. Not fired when
     * the caller invokes `dismiss()` directly.
     */
    onDismiss?: () => void;
    /** Default true. */
    dismissOnEscape?: boolean;
    /** Default 'backdrop'. */
    dismissOn?: ModalDismissTrigger;
}

export interface DismissableOverlayHandle {
    /** The overlay div. Append your modal content into it. */
    overlay: HTMLDivElement;
    /** Remove the overlay and tear down listeners. Idempotent. */
    dismiss: () => void;
}

export function createDismissableOverlay(
    options: DismissableOverlayOptions,
): DismissableOverlayHandle {
    const {
        container,
        className,
        onDismiss,
        dismissOnEscape = true,
        dismissOn = 'backdrop',
    } = options;

    const overlay = document.createElement('div');
    overlay.className = className;

    let disposed = false;

    function dismiss(): void {
        if (disposed) return;
        disposed = true;
        overlay.remove();
        if (dismissOnEscape) {
            document.removeEventListener('keydown', handleKeyDown);
        }
    }

    function userDismiss(): void {
        if (disposed) return;
        dismiss();
        onDismiss?.();
    }

    function handleKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            userDismiss();
        }
    }

    if (dismissOn === 'backdrop') {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                userDismiss();
            }
        });
    } else if (dismissOn === 'any-click') {
        overlay.addEventListener('click', userDismiss);
    }

    if (dismissOnEscape) {
        document.addEventListener('keydown', handleKeyDown);
    }

    container.appendChild(overlay);

    return { overlay, dismiss };
}

export interface DismissablePopoverOptions {
    /** The panel element to attach dismissal behaviour to. */
    panel: HTMLElement;
    /**
     * The toggle that opens the popover. Pointerdowns on this element (or
     * its descendants) are ignored, so the toggle's own click handler can
     * own open/close behaviour.
     */
    anchor?: HTMLElement;
    /**
     * Fires when the popover is dismissed via outside pointerdown or
     * Escape. Not fired when the caller invokes `dismiss()` directly.
     */
    onDismiss?: () => void;
    /** Default true. */
    dismissOnEscape?: boolean;
}

export interface DismissablePopoverHandle {
    /** Remove the panel and tear down listeners. Idempotent. */
    dismiss: () => void;
}

export function attachDismissablePopover(
    options: DismissablePopoverOptions,
): DismissablePopoverHandle {
    const { panel, anchor, onDismiss, dismissOnEscape = true } = options;

    let disposed = false;
    let pointerDownListener: ((e: PointerEvent) => void) | null = null;
    let keyListener: ((e: KeyboardEvent) => void) | null = null;

    function dismiss(): void {
        if (disposed) return;
        disposed = true;
        panel.remove();
        if (pointerDownListener) {
            document.removeEventListener(
                'pointerdown',
                pointerDownListener,
                true,
            );
            pointerDownListener = null;
        }
        if (keyListener) {
            document.removeEventListener('keydown', keyListener);
            keyListener = null;
        }
    }

    function userDismiss(): void {
        if (disposed) return;
        dismiss();
        onDismiss?.();
    }

    // Defer listener installation so the click that opened the popover
    // doesn't immediately close it again.
    requestAnimationFrame(() => {
        if (disposed) return;

        // Capture phase so the dismiss fires reliably even when other
        // listeners (drag handlers) capture pointer events at lower nodes.
        pointerDownListener = (e: PointerEvent) => {
            const target = e.target as Node | null;
            if (!target) return;
            if (panel.contains(target)) return;
            if (anchor?.contains(target)) return;
            userDismiss();
        };
        document.addEventListener('pointerdown', pointerDownListener, true);

        if (dismissOnEscape) {
            keyListener = (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    userDismiss();
                }
            };
            document.addEventListener('keydown', keyListener);
        }
    });

    return { dismiss };
}
