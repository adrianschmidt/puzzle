/**
 * Rotate buttons — CW and CCW 90° rotation for the currently-selected
 * groups. Visible only for the fractal cut style.
 */

import type { SelectionManager } from '../interaction/selection-manager.js';
import type { RotationDirection } from '../game/rotate-group.js';

export interface RotateButtonsOptions {
    container: HTMLElement;
    selectionManager: SelectionManager;
    /** Rotate all currently-selected groups by 90° in the given direction. */
    onRotate: (direction: RotationDirection) => void;
}

export interface RotateButtonsHandle {
    /** Show the buttons (e.g. after switching to a fractal puzzle). */
    show: () => void;
    /** Hide the buttons (e.g. after switching to a classic puzzle). */
    hide: () => void;
    /** Remove the buttons from the DOM. */
    destroy: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Build a circular-arrow SVG. `mirror=true` mirrors the icon horizontally
 * so the arrow curls counter-clockwise.
 */
function makeRotateIcon(mirror: boolean): SVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    if (mirror) {
        svg.setAttribute('transform', 'scale(-1,1)');
    }

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M21 12a9 9 0 1 1-3.1-6.8');
    svg.appendChild(path);

    const arrow = document.createElementNS(SVG_NS, 'polyline');
    arrow.setAttribute('points', '21 3 21 9 15 9');
    svg.appendChild(arrow);

    return svg;
}

function makeButton(label: string, icon: SVGElement): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'rotate-button';
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.appendChild(icon);
    return button;
}

export function createRotateButtons(
    options: RotateButtonsOptions,
): RotateButtonsHandle {
    const { container, selectionManager, onRotate } = options;

    const ccwButton = makeButton(
        'Rotate selection 90° counter-clockwise',
        makeRotateIcon(true),
    );
    ccwButton.classList.add('rotate-button--ccw');

    const cwButton = makeButton(
        'Rotate selection 90° clockwise',
        makeRotateIcon(false),
    );
    cwButton.classList.add('rotate-button--cw');

    function updateEnabled(): void {
        const enabled = selectionManager.hasSelection;
        ccwButton.disabled = !enabled;
        cwButton.disabled = !enabled;
    }

    function handleCcw(): void {
        if (!selectionManager.hasSelection) return;
        onRotate('ccw');
    }

    function handleCw(): void {
        if (!selectionManager.hasSelection) return;
        onRotate('cw');
    }

    ccwButton.addEventListener('click', handleCcw);
    cwButton.addEventListener('click', handleCw);

    const removeListener = selectionManager.onChange(updateEnabled);
    updateEnabled();

    // Hidden by default; show() is called by the host based on cut style.
    ccwButton.style.display = 'none';
    cwButton.style.display = 'none';

    container.appendChild(ccwButton);
    container.appendChild(cwButton);

    return {
        show() {
            ccwButton.style.display = '';
            cwButton.style.display = '';
        },
        hide() {
            ccwButton.style.display = 'none';
            cwButton.style.display = 'none';
        },
        destroy() {
            ccwButton.removeEventListener('click', handleCcw);
            cwButton.removeEventListener('click', handleCw);
            removeListener();
            ccwButton.remove();
            cwButton.remove();
        },
    };
}
