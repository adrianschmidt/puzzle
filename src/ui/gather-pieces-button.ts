import { createToolbarButton } from './toolbar-button.js';

export interface GatherPiecesButtonOptions {
    container: HTMLElement;
    onGatherPieces: () => void;
}

export function createGatherPiecesButton(
    options: GatherPiecesButtonOptions,
): () => void {
    return createToolbarButton({
        container: options.container,
        className: 'gather-pieces-button',
        label: 'Gather Pieces',
        onClick: options.onGatherPieces,
    });
}
