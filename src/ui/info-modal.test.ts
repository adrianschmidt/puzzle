/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createInfoModal } from './info-modal.js';
import type { GameState } from '../model/types.js';
import { makeGameState } from '../test-helpers/fixtures.js';

function makeState(overrides?: Partial<GameState>): GameState {
    return makeGameState({
        seed: 12345,
        cutStyle: 'fractal',
        rotationMode: 'quarter-turn',
        fractalConfig: { borderless: true },
        ...overrides,
    });
}

describe('createInfoModal', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        localStorage.clear();
    });

    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        document.documentElement.className = '';
    });

    it('wraps debug content in a <details> element that is collapsed by default', () => {
        createInfoModal({ container });

        const debug = container.querySelector<HTMLDetailsElement>(
            '[data-testid="debug-section"]',
        );
        expect(debug?.tagName.toLowerCase()).toBe('details');
        expect(debug?.open).toBe(false);
    });

    it('renders repro params as JSON inside the debug section', () => {
        createInfoModal({ container, getState: () => makeState() });

        const repro = container.querySelector<HTMLElement>(
            '[data-testid="repro-params"]',
        );
        expect(repro).not.toBeNull();

        const parsed = JSON.parse(repro!.textContent ?? '{}');
        expect(parsed).toEqual({
            seed: 12345,
            cutStyle: 'fractal',
            gridSize: { cols: 8, rows: 6 },
            rotationMode: 'quarter-turn',
            fractalConfig: { borderless: true },
        });
    });

    it('hides the repro block when no state source is provided', () => {
        createInfoModal({ container });

        const setting = container.querySelector<HTMLElement>(
            '[data-testid="repro-params-setting"]',
        );
        expect(setting?.style.display).toBe('none');
    });

    it('omits undefined state fields from the repro block', () => {
        createInfoModal({
            container,
            getState: () =>
                makeState({
                    fractalConfig: undefined,
                    rotationMode: undefined,
                }),
        });

        const repro = container.querySelector<HTMLElement>(
            '[data-testid="repro-params"]',
        );
        const parsed = JSON.parse(repro!.textContent ?? '{}');
        expect(parsed.fractalConfig).toBeUndefined();
        expect(parsed.composableConfig).toBeUndefined();
        expect(parsed.rotationMode).toBeUndefined();
        expect(parsed.seed).toBe(12345);
    });

    it('toggles show-debug-pieces on <html> when the debug-pieces checkbox changes', () => {
        createInfoModal({ container });

        const toggle = container.querySelector<HTMLInputElement>(
            '[data-testid="debug-pieces-toggle"]',
        );
        expect(toggle).not.toBeNull();
        expect(
            document.documentElement.classList.contains('show-debug-pieces'),
        ).toBe(false);

        toggle!.checked = true;
        toggle!.dispatchEvent(new Event('change'));
        expect(
            document.documentElement.classList.contains('show-debug-pieces'),
        ).toBe(true);

        toggle!.checked = false;
        toggle!.dispatchEvent(new Event('change'));
        expect(
            document.documentElement.classList.contains('show-debug-pieces'),
        ).toBe(false);
    });

    it('reflects pre-existing show-debug-pieces class as the checkbox state on open', () => {
        document.documentElement.classList.add('show-debug-pieces');
        createInfoModal({ container });

        const toggle = container.querySelector<HTMLInputElement>(
            '[data-testid="debug-pieces-toggle"]',
        );
        expect(toggle!.checked).toBe(true);
    });

    it('renders the share section as the first section in the modal content', () => {
        createInfoModal({ container, state: makeState() });

        const firstSection = container.querySelector<HTMLElement>(
            '.info-modal-content > section.info-section',
        );
        expect(firstSection?.classList.contains('share-section')).toBe(true);
    });

    it('mentions Free rotation in both the How to Play and Cut Styles sections', () => {
        createInfoModal({ container });

        const sections = container.querySelectorAll<HTMLElement>('section.info-section');
        const howToPlay = Array.from(sections).find(
            (s) => s.querySelector('h3')?.textContent === 'How to Play',
        );
        const cutStyles = Array.from(sections).find(
            (s) => s.querySelector('h3')?.textContent === 'Cut Styles',
        );

        expect(howToPlay?.textContent).toContain('Free rotation');
        expect(cutStyles?.textContent).toContain('Free rotation');
    });
});

describe('createInfoModal — Cut Styles section', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
    });

    function cutStylesSection(): HTMLElement {
        // Locate the Cut Styles section by its heading text.
        const headings = container.querySelectorAll<HTMLHeadingElement>(
            '.info-section > h3',
        );
        const match = [...headings].find((h) => h.textContent === 'Cut Styles');
        return match!.parentElement!;
    }

    it('mentions Wavy as a cut style', () => {
        createInfoModal({ container });
        expect(cutStylesSection().textContent).toContain('Wavy');
    });

    it('does not mention Composable in the help text', () => {
        createInfoModal({ container });
        expect(cutStylesSection().textContent).not.toContain('Composable');
    });

    it('mentions Free rotation in the Wavy bullet', () => {
        createInfoModal({ container });
        const html = cutStylesSection().innerHTML;
        const wavyIdx = html.indexOf('Wavy');
        const freeRotIdx = html.indexOf('Free rotation');
        expect(wavyIdx).toBeGreaterThan(-1);
        expect(freeRotIdx).toBeGreaterThan(wavyIdx);
    });
});
