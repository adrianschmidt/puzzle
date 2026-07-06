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

    it('includes wavyConfig in the repro block for a wavy-borderless puzzle', () => {
        createInfoModal({
            container,
            getState: () =>
                makeState({
                    cutStyle: 'wavy',
                    fractalConfig: undefined,
                    wavyConfig: { borderless: true },
                }),
        });

        const repro = container.querySelector<HTMLElement>(
            '[data-testid="repro-params"]',
        );
        expect(repro).not.toBeNull();

        const parsed = JSON.parse(repro!.textContent ?? '{}');
        expect(parsed.wavyConfig).toEqual({ borderless: true });
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

    it('gives every toggle checkbox the shared form-checkbox accent class', () => {
        // Pass state so the share section (guarded on options.state) renders;
        // its "Include my current progress" checkbox is itself an
        // .info-setting-toggle and must carry the shared accent class too.
        createInfoModal({ container, state: makeState() });

        const checkboxes = container.querySelectorAll<HTMLInputElement>(
            '.info-setting-toggle input[type="checkbox"]',
        );
        expect(checkboxes.length).toBeGreaterThan(0);
        for (const checkbox of checkboxes) {
            expect(checkbox.classList.contains('form-checkbox')).toBe(true);
        }

        // Explicitly assert the share checkbox is among those covered, so the
        // loop above can't pass vacuously by the share section not rendering.
        const shareCheckbox = container.querySelector<HTMLInputElement>(
            '[data-testid="share-include-progress"]',
        );
        expect(shareCheckbox).not.toBeNull();
        expect(shareCheckbox!.classList.contains('form-checkbox')).toBe(true);
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

    it('mentions Triangles and its approximate piece counts', () => {
        createInfoModal({ container });
        const lis = cutStylesSection().querySelectorAll<HTMLLIElement>('ul > li');
        const trianglesLi = [...lis].find((li) =>
            li.textContent?.includes('Triangles'),
        );
        expect(trianglesLi).toBeDefined();
        expect(trianglesLi!.textContent).toContain('approximate');
    });

    it('mentions Borderless in the Wavy cut-style help', () => {
        createInfoModal({ container });
        // Find the Wavy <li> specifically — Fractal already has a Borderless
        // sub-bullet, so we scope to avoid a false positive from that bullet.
        const section = cutStylesSection();
        const lis = section.querySelectorAll<HTMLLIElement>('ul > li');
        const wavyLi = [...lis].find((li) => li.textContent?.includes('Wavy'));
        expect(wavyLi).toBeDefined();
        expect(wavyLi!.textContent).toContain('Borderless');
    });
});

describe('createInfoModal — How to Play section', () => {
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

    function howToPlaySection(): HTMLElement {
        const headings = container.querySelectorAll<HTMLHeadingElement>(
            '.info-section > h3',
        );
        const match = [...headings].find((h) => h.textContent === 'How to Play');
        return match!.parentElement!;
    }

    it('does not mention "composable" in How to Play', () => {
        createInfoModal({ container });
        expect(howToPlaySection().textContent?.toLowerCase()).not.toContain('composable');
    });

    it('documents the Marquee button and its drag-a-box gesture', () => {
        createInfoModal({ container });
        const text = howToPlaySection().textContent ?? '';
        expect(text).toContain('Marquee');
        expect(text).toContain('drag a box');
    });

    it('mentions Wavy alongside Free rotation', () => {
        createInfoModal({ container });
        const text = howToPlaySection().textContent ?? '';
        const freeRotIdx = text.indexOf('Free rotation');
        const wavyIdx = text.indexOf('Wavy');
        expect(freeRotIdx).toBeGreaterThan(-1);
        expect(wavyIdx).toBeGreaterThan(-1);
        // Wavy should be near (within ~60 chars of) the Free rotation phrase.
        expect(Math.abs(wavyIdx - freeRotIdx)).toBeLessThan(60);
    });
});

describe('createInfoModal — Piece outline setting', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        localStorage.clear();
        document.documentElement.style.removeProperty('--piece-edge-filter');
        document.documentElement.style.removeProperty('--piece-outline-color');
    });

    afterEach(() => {
        container.remove();
    });

    it('renders three Piece outline buttons (None, Shadow, Outline)', () => {
        createInfoModal({ container });

        const buttons = document.querySelectorAll(
            'button[data-testid^="piece-outline-"]',
        );
        expect(buttons.length).toBe(3);
        const labels = Array.from(buttons).map(
            (b) => b.querySelector('.preset-option-label')?.textContent,
        );
        expect(labels).toEqual(['None', 'Shadow', 'Outline']);
    });

    it('marks Shadow as selected by default', () => {
        createInfoModal({ container });

        const shadowBtn = document.querySelector(
            '[data-testid="piece-outline-shadow"]',
        );
        expect(shadowBtn?.classList.contains('selected')).toBe(true);
    });

    it('clicking Outline persists the choice and updates the CSS variable', () => {
        createInfoModal({ container });

        const outlineBtn = document.querySelector(
            '[data-testid="piece-outline-outline"]',
        ) as HTMLButtonElement;
        outlineBtn.click();

        expect(localStorage.getItem('puzzle-piece-outline')).toBe('outline');
        expect(
            document.documentElement.style.getPropertyValue('--piece-edge-filter'),
        ).toBe('url(#piece-outline)');
        expect(outlineBtn.classList.contains('selected')).toBe(true);
    });

    it('clicking a second option deselects the first', () => {
        createInfoModal({ container });

        const noneBtn = document.querySelector(
            '[data-testid="piece-outline-none"]',
        ) as HTMLButtonElement;
        const outlineBtn = document.querySelector(
            '[data-testid="piece-outline-outline"]',
        ) as HTMLButtonElement;

        outlineBtn.click();
        noneBtn.click();

        expect(noneBtn.classList.contains('selected')).toBe(true);
        expect(outlineBtn.classList.contains('selected')).toBe(false);
    });

    it('hides the outline-colour row by default (Shadow active)', () => {
        createInfoModal({ container });
        const row = document.querySelector(
            '[data-testid="piece-outline-color-row"]',
        ) as HTMLElement;
        expect(row).toBeTruthy();
        expect(row.hidden).toBe(true);
    });

    it('reveals the colour row when Outline is selected, hides it for None', () => {
        createInfoModal({ container });
        const row = document.querySelector(
            '[data-testid="piece-outline-color-row"]',
        ) as HTMLElement;
        const outlineBtn = document.querySelector(
            '[data-testid="piece-outline-outline"]',
        ) as HTMLButtonElement;
        const noneBtn = document.querySelector(
            '[data-testid="piece-outline-none"]',
        ) as HTMLButtonElement;

        outlineBtn.click();
        expect(row.hidden).toBe(false);

        noneBtn.click();
        expect(row.hidden).toBe(true);
    });

    it('shows the colour row on open when Outline is the saved style', () => {
        localStorage.setItem('puzzle-piece-outline', 'outline');
        createInfoModal({ container });
        const row = document.querySelector(
            '[data-testid="piece-outline-color-row"]',
        ) as HTMLElement;
        expect(row.hidden).toBe(false);
    });

    it('selecting a swatch persists the colour and sets the CSS variable', () => {
        localStorage.setItem('puzzle-piece-outline', 'outline');
        createInfoModal({ container });

        (
            document.querySelector(
                'button.outline-color-button',
            ) as HTMLButtonElement
        ).click();
        (
            document.querySelector(
                '[data-swatch-id="blue-default"]',
            ) as HTMLButtonElement
        ).click();

        expect(localStorage.getItem('puzzle-piece-outline-color')).toBe(
            'blue-default',
        );
        expect(
            document.documentElement.style.getPropertyValue(
                '--piece-outline-color',
            ),
        ).toBe('var(--color-blue-default)');
    });

    it('toggles the marquee-contain preference from the settings checkbox', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        createInfoModal({ container });

        const checkbox = container.querySelector<HTMLInputElement>(
            '[data-testid="marquee-contain-toggle"]',
        );
        expect(checkbox).not.toBeNull();
        expect(checkbox!.checked).toBe(false); // intersect default

        checkbox!.checked = true;
        checkbox!.dispatchEvent(new Event('change'));

        expect(localStorage.getItem('puzzle-marquee-contain')).toBe('true');
    });
});
