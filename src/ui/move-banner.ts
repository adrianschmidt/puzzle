export interface MoveBannerOptions {
    container: HTMLElement;
    text: string;
    onOpen: () => void;
}

export function createMoveBanner(options: MoveBannerOptions): () => void {
    const { container, text, onOpen } = options;

    const banner = document.createElement('div');
    banner.className = 'move-banner';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'move-banner-open';
    open.textContent = text;
    open.addEventListener('click', onOpen);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'move-banner-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', () => banner.remove());

    banner.append(open, close);
    container.appendChild(banner);
    return () => banner.remove();
}
