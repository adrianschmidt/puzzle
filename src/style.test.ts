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

/** Index of the `}` closing the block opened at `open`. */
function matchingBrace(css: string, open: number): number {
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}' && --depth === 0) return i;
    }
    return css.length;
}

/**
 * Every declaration a **top-level** rule applies to `selector`, concatenated.
 *
 * Matches a whole comma-separated entry, so a rule shared by several
 * selectors is found by any one of them, and collects across rules — a
 * selector legitimately appears in more than one (`[data-piece-blank]` has
 * its own `fill` rule and shares the debug-opacity rule). Returning only the
 * first would make an assertion depend on rule order in the file.
 *
 * At-rule blocks (`@media`, `@supports`) are skipped whole, so a responsive
 * override never satisfies an assertion about the base rule. That is the
 * point: the dialog guards below exist because declarations belong in the
 * base rule, and merging an `@media` duplicate's body in would let exactly
 * the regression they watch for pass.
 */
function declarationsFor(css: string, selector: string): string {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const bodies: string[] = [];
    let i = 0;
    let preludeStart = 0;
    while ((i = withoutComments.indexOf('{', i)) !== -1) {
        const prelude = withoutComments.slice(preludeStart, i).trim();
        const end = matchingBrace(withoutComments, i);
        if (
            !prelude.startsWith('@')
            && prelude.split(',').map((s) => s.trim()).includes(selector)
        ) {
            bodies.push(withoutComments.slice(i + 1, end));
        }
        i = end + 1;
        preludeStart = i;
    }
    expect(bodies.length, `no rule found for "${selector}"`).toBeGreaterThan(0);
    return bodies.join('\n');
}

/**
 * The helper's own guards. Two `style.css` rules used to carry comments
 * telling editors to keep a base rule above its `@media` duplicate, because
 * the previous helper matched the first occurrence. These assertions are
 * what replaced that convention.
 */
describe('declarationsFor', () => {
    const css = `
@media (max-height: 560px) {
  .dialog { overflow-y: auto; }
}
.dialog { max-height: 100%; }
.dialog, .other { padding: 0; }
`;

    it('ignores declarations nested inside an at-rule block', () => {
        // A responsive override must never satisfy an assertion about the
        // base rule — that is the regression these dialog guards watch for.
        expect(declarationsFor(css, '.dialog')).not.toMatch(/overflow-y/);
    });

    it('finds a base rule below its @media duplicate', () => {
        expect(declarationsFor(css, '.dialog')).toMatch(/max-height:\s*100%/);
    });

    it('collects every top-level rule listing the selector', () => {
        expect(declarationsFor(css, '.dialog')).toMatch(/padding:\s*0/);
    });

    it('fails loudly when the selector is absent', () => {
        expect(() => declarationsFor(css, '.missing')).toThrow();
    });
});

/**
 * Guards for the new-game dialog's viewport fit. The dialog once rendered
 * taller than short viewports with no max-height and no scrolling, clipping
 * both ends unreachably (see the 2026-07-22 responsive-modal spec). Nothing
 * but these assertions would catch an accidental revert of the CSS wiring.
 */
describe('new-game dialog responsive CSS', () => {
    it('caps the dialog height and scrolls inside, not outside', () => {
        const body = declarationsFor(styleCss, '.size-picker-dialog');
        expect(body).toMatch(/max-height:\s*100%/);
        expect(body).toMatch(/flex-direction:\s*column/);
        expect(body).toMatch(/overflow:\s*hidden/);
    });

    it('scrolls the dialog body internally', () => {
        const body = declarationsFor(styleCss, '.dialog-content');
        expect(body).toMatch(/overflow-y:\s*auto/);
        expect(body).toMatch(/overscroll-behavior:\s*contain/);
        // Load-bearing: without min-height:0 the flex child can't shrink
        // below its content, so it never scrolls inside the flex column.
        expect(body).toMatch(/min-height:\s*0/);
    });

    it('lets dialog rows wrap instead of clipping wide controls', () => {
        expect(declarationsFor(styleCss, '.dialog-row')).toMatch(/flex-wrap:\s*wrap/);
    });

    it('caps the image-picker grid tracks so tiles align with sibling rows', () => {
        // Load-bearing: bare `1fr` (= minmax(auto, 1fr)) lets the tiles'
        // intrinsic minimum inflate both tracks and push the grid's right
        // edge out of line with the sibling rows; minmax(0, 1fr) removes the
        // auto floor. See the .image-picker-grid comment in style.css for the
        // full mechanism.
        expect(declarationsFor(styleCss, '.image-picker-grid')).toMatch(
            /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/,
        );
    });
});

describe('selection glow CSS', () => {
    it('defines --selection-glow on :root (light glow for dark backgrounds)', () => {
        expect(declarationsFor(styleCss, ':root')).toMatch(
            /--selection-glow:\s*var\(--color-violet-lighter\)/,
        );
    });

    it('flips --selection-glow dark in the light-scheme block', () => {
        expect(declarationsFor(styleCss, '[data-ui-scheme="light"]')).toMatch(
            /--selection-glow:\s*var\(--color-violet-darker\)/,
        );
    });

    it('drives the selection glow off --selection-glow, not --ui-accent', () => {
        for (const selector of [
            '[data-group-id].selected',
            '[data-group-id].selected.dragging',
        ]) {
            const body = declarationsFor(styleCss, selector);
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

describe('blank-piece CSS', () => {
    it('paints blank pieces from the --piece-blank-fill variable', () => {
        expect(declarationsFor(styleCss, '[data-piece-blank]')).toMatch(
            /fill:\s*var\(--piece-blank-fill\)/,
        );
    });

    it('defines --piece-blank-fill as white, in exactly one place', () => {
        // Nothing in TS names this color, so this assertion is what stops a
        // blank puzzle rendering SVG-default black if the declaration is
        // dropped. The count pins the "one definition" property itself — a
        // prefers-color-scheme override, which the CSS comment says must
        // never exist, would land here as a second occurrence.
        expect(declarationsFor(styleCss, ':root')).toMatch(
            /--piece-blank-fill:\s*#ffffff/,
        );
        expect(styleCss.match(/--piece-blank-fill:/g)).toHaveLength(1);
    });

    it('applies the debug opacity slider to blank pieces too', () => {
        expect(declarationsFor(styleCss, '[data-piece-blank]')).toMatch(
            /opacity:\s*var\(--piece-opacity\)/,
        );
    });

    it('hides blank pieces when the debug piece view is on', () => {
        expect(declarationsFor(styleCss, '.show-debug-pieces [data-piece-blank]')).toMatch(
            /display:\s*none/,
        );
    });
});
