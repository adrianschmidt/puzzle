/**
 * Guard tests for the multi-select highlight glow.
 *
 * The glow is CSS-only: it reads the `--selection-glow` custom property,
 * which is defined light on `:root` and flipped dark in the
 * `[data-ui-scheme="light"]` block so a same-hue light background does not
 * wash it out (see the adaptive-selection-glow spec). There is no JS to
 * unit-test, so these assertions guard the CSS wiring against an accidental
 * revert to the fixed `--ui-accent` — which nothing else would catch.
 */

import { describe, it, expect } from 'vitest';
import styleCss from './style.css?raw';

/**
 * Body of the CSS rule whose selector exactly matches `selector`.
 *
 * Assumes a flat, brace-free rule body: it locates the rule by `selector + ' {'`
 * and slices to the first `}`, so it would silently truncate on a nested block
 * (`@media`, `@supports`, CSS nesting). Correct for the top-level selectors used
 * here; don't reuse it for a rule that contains nested braces.
 */
function ruleBody(css: string, selector: string): string {
    const start = css.indexOf(selector + ' {');
    expect(start, `rule "${selector}" not found`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
}

/**
 * Guards for the new-game dialog's viewport fit. The dialog once rendered
 * taller than short viewports with no max-height and no scrolling, clipping
 * both ends unreachably (see the 2026-07-22 responsive-modal spec). Nothing
 * but these assertions would catch an accidental revert of the CSS wiring.
 */
describe('new-game dialog responsive CSS', () => {
    it('caps the dialog height and scrolls inside, not outside', () => {
        const body = ruleBody(styleCss, '.size-picker-dialog');
        expect(body).toMatch(/max-height:\s*100%/);
        expect(body).toMatch(/flex-direction:\s*column/);
        expect(body).toMatch(/overflow:\s*hidden/);
    });

    it('scrolls the dialog body internally', () => {
        const body = ruleBody(styleCss, '.dialog-content');
        expect(body).toMatch(/overflow-y:\s*auto/);
        expect(body).toMatch(/overscroll-behavior:\s*contain/);
        // Load-bearing: without min-height:0 the flex child can't shrink
        // below its content, so it never scrolls inside the flex column.
        expect(body).toMatch(/min-height:\s*0/);
    });

    it('lets dialog rows wrap instead of clipping wide controls', () => {
        expect(ruleBody(styleCss, '.dialog-row')).toMatch(/flex-wrap:\s*wrap/);
    });
});

describe('selection glow CSS', () => {
    it('defines --selection-glow on :root (light glow for dark backgrounds)', () => {
        expect(ruleBody(styleCss, ':root')).toMatch(
            /--selection-glow:\s*var\(--color-violet-lighter\)/,
        );
    });

    it('flips --selection-glow dark in the light-scheme block', () => {
        expect(ruleBody(styleCss, '[data-ui-scheme="light"]')).toMatch(
            /--selection-glow:\s*var\(--color-violet-darker\)/,
        );
    });

    it('drives the selection glow off --selection-glow, not --ui-accent', () => {
        for (const selector of [
            '[data-group-id].selected',
            '[data-group-id].selected.dragging',
        ]) {
            const body = ruleBody(styleCss, selector);
            // Three glow layers, each mixing --selection-glow with transparent.
            const glowLayers = body.match(/var\(--selection-glow\)/g) ?? [];
            expect(glowLayers.length, `${selector} glow layers`).toBe(3);
            // The fixed chrome accent must not sneak back into the glow.
            expect(body, `${selector} must not reference --ui-accent`).not.toMatch(
                /--ui-accent/,
            );
        }
    });
});
