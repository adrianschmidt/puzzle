/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { createMoveBanner } from './move-banner.js';

describe('createMoveBanner', () => {
    it('opens on tap and dismisses on ×', () => {
        const container = document.createElement('div');
        const onOpen = vi.fn();
        createMoveBanner({ container, text: 'Puzzle has moved', onOpen });

        const open = container.querySelector<HTMLButtonElement>('.move-banner-open')!;
        expect(open.textContent).toBe('Puzzle has moved');
        open.click();
        expect(onOpen).toHaveBeenCalledTimes(1);

        container.querySelector<HTMLButtonElement>('.move-banner-close')!.click();
        expect(container.querySelector('.move-banner')).toBeNull();
    });
});
