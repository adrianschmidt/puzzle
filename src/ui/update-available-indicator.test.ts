/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUpdateAvailableIndicator } from './update-available-indicator.js';

describe('createUpdateAvailableIndicator', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('renders a persistent indicator button with refresh copy', () => {
        createUpdateAvailableIndicator({ onRefresh: vi.fn() });
        const el = document.querySelector('.update-available-indicator');
        expect(el).not.toBeNull();
        expect(el!.tagName).toBe('BUTTON');
        expect(el!.textContent).toBe('Update ready — tap to refresh');
    });

    it('calls onRefresh when tapped', () => {
        const onRefresh = vi.fn();
        createUpdateAvailableIndicator({ onRefresh });
        document
            .querySelector<HTMLButtonElement>('.update-available-indicator')!
            .click();
        expect(onRefresh).toHaveBeenCalledOnce();
    });

    it('keeps only one indicator at a time', () => {
        createUpdateAvailableIndicator({ onRefresh: vi.fn() });
        createUpdateAvailableIndicator({ onRefresh: vi.fn() });
        expect(
            document.querySelectorAll('.update-available-indicator').length,
        ).toBe(1);
    });

    it('cleanup removes the indicator', () => {
        const cleanup = createUpdateAvailableIndicator({ onRefresh: vi.fn() });
        cleanup();
        expect(
            document.querySelector('.update-available-indicator'),
        ).toBeNull();
    });
});
