/**
 * Modals (info modal, new-game dialog, completion screen) and popovers
 * (background-color picker) all reimplement the same pattern: a div that
 * dismisses on Escape / backdrop click / outside pointerdown, plus the
 * document-level listener cleanup. This file owns those mechanics so each
 * consumer only needs to think about its content.
 *
 * `onDismiss` fires only for helper-owned dismissal paths, not when the
 * caller invokes `dismiss()` directly. That way "user closed without
 * choosing" callbacks (size-picker `onCancel`) can be wired through
 * without a flag, while button handlers can dismiss without spuriously
 * firing the cancel hook.
 */

export type ModalDismissTrigger = 'backdrop' | 'any-click' | 'none';

export interface DismissableOverlayOptions {
    container: HTMLElement;
    className: string;
    /** Not fired when the caller invokes `dismiss()` directly. */
    onDismiss?: () => void;
    /** Default true. */
    dismissOnEscape?: boolean;
    /** Default 'backdrop'. */
    dismissOn?: ModalDismissTrigger;
}

export interface DismissableOverlayHandle {
    overlay: HTMLDivElement;
    /** Idempotent. */
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
    panel: HTMLElement;
    /**
     * Pointerdowns on this element (or its descendants) are ignored, so
     * the toggle's own click handler can own open/close behavior.
     */
    anchor?: HTMLElement;
    /** Not fired when the caller invokes `dismiss()` directly. */
    onDismiss?: () => void;
    /** Default true. */
    dismissOnEscape?: boolean;
}

export interface DismissablePopoverHandle {
    /** Idempotent. */
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
