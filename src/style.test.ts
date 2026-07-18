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
