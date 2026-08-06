import { createToolbarButton } from './toolbar-button.js';

export interface InfoButtonOptions {
    container: HTMLElement;
    onShowInfo: () => void;
}

export function createInfoButton(options: InfoButtonOptions): () => void {
    return createToolbarButton({
        container: options.container,
        className: 'info-button',
        label: 'ℹ️',
        title: 'Info & Help',
        onClick: options.onShowInfo,
    });
}
