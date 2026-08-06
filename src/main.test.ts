/**
 * Guard: `main.ts` is an entry point, not a place to put logic.
 *
 * It cannot be imported under test — `index.html` loads it as a
 * side-effecting module, and importing it would boot the app — so anything
 * living there is permanently unreachable by the suite. That is how it
 * reached 1939 lines. The composition root is `src/app/bootstrap.ts`, which
 * exports a function, IS importable, and has tests; new wiring belongs there.
 *
 * Deliberately not a line-count cap: a threshold is a number the next feature
 * raises by ten. This assertion has nothing to relax — the next statement
 * added here fails it, whatever that statement is.
 *
 * That last claim is only as strong as the parse, so the parse works in
 * statements rather than lines, and `the main.ts guard` below pins each
 * direction: a statement smuggled onto the end of an import line is caught,
 * an import hand-wrapped across several lines is not mistaken for one, a
 * `//` inside an import specifier does not hide the statement after it, a
 * `/*` smuggled into a line comment does not delete it, a block comment
 * closed from inside a line comment does not swallow the statement after
 * it, an import binding named with a `$` is not mistaken for an offence,
 * and dropping an import's semicolon does not let the next statement ride
 * along inside it. Of the two constructs the scan does read wrong, the
 * nested template literal is pinned as well, in the direction that matters:
 * it trips the guard rather than silently emptying the file. The regex
 * literal is documented at `stripComments` but has no test — neither
 * construct belongs in a file of two CSS imports and one call.
 */

import { describe, it, expect } from 'vitest';
import mainSrc from './main.ts?raw';

const WHERE_INSTEAD =
    'main.ts must stay an entry point: two CSS imports and the bootstrap() call. '
    + 'Put new wiring in src/app/bootstrap.ts — it exports a function, so '
    + 'bootstrap.test.ts can reach it, and nothing here can be reached at all.';

/**
 * Index of the quote closing the string literal that opens at `start`, or
 * the last index of `src` when it is never closed — an unterminated literal
 * is kept whole, so it survives into a statement and trips the guard rather
 * than deleting the rest of the file.
 */
function closingQuoteIndex(src: string, start: number): number {
    const quote = src[start];
    for (let i = start + 1; i < src.length; i += 1) {
        if (src[i] === '\\') { i += 1; continue; }
        if (src[i] === quote) return i;
    }
    return src.length - 1;
}

/**
 * One left-to-right scan rather than a pass per comment style. The two are
 * not equivalent: comments and string literals nest, so whether `//`, `/*`
 * or a quote starts anything at all depends on what is already open, and a
 * pass that strips one style whole-file has no way to know. Each of the
 * three cases below is wrong under one pass order and right under the
 * other, so no ordering of two passes gets all three:
 *
 *   - `// /*` — a block opener inside a line comment. Stripping blocks
 *     first reads it as a real opener and deletes everything up to the
 *     next closing marker.
 *   - a closing marker inside a line comment, closing a block opened on an
 *     earlier line. Stripping line comments first eats that marker, and
 *     the now-unterminated block runs on to the file's next closing
 *     marker.
 *   - `//` inside a string literal (`import 'https://…'`, `'//cdn…'`).
 *     Either strip reads it as a comment.
 *
 * All three hide an executing statement, because over-stripping either
 * deletes the statement outright or deletes the `;` that separates it from
 * the import above — and `import 'x` + `window.foo = 1;` merges into one
 * text that conforms to the import shape checked below. The scan tracks
 * what is open instead, so all three fall out of one rule.
 *
 * Under-stripping is the safe direction and is what an unterminated `/*`
 * gets: the rest of the source is kept verbatim, so it trips the guard as
 * an offending statement rather than vanishing along with `bootstrap();`.
 *
 * Two constructs are still read wrong, both needing a `//` inside them to
 * bite, and neither belonging in an entry point of two CSS imports and one
 * call:
 *
 *   - A regex literal. `/` opens no state here, so a `//` inside one reads
 *     as a comment start. To hide anything it would have to sit on a line
 *     whose `;` it also eats.
 *   - A *nested* template literal. `closingQuoteIndex` looks only for the
 *     next unescaped backtick, so the outer literal in `` `${`//`}` ``
 *     closes on the inner *opening* backtick; the scan resumes on `//` and
 *     drops the rest of that line. That is the over-strip direction, but
 *     it still lands fail-safe: the unterminated outer literal is kept
 *     verbatim, so it merges with the statement below and trips the guard,
 *     exactly as an unterminated `/*` does. Pinned below.
 */
function stripComments(src: string): string {
    let out = '';
    let i = 0;
    while (i < src.length) {
        const pair = src.slice(i, i + 2);
        if (pair === '//') {
            const newline = src.indexOf('\n', i);
            i = newline === -1 ? src.length : newline;
            continue;
        }
        if (pair === '/*') {
            const end = src.indexOf('*/', i + 2);
            if (end === -1) {
                out += src.slice(i);
                break;
            }
            i = end + 2;
            continue;
        }
        const char = src[i];
        if (char === "'" || char === '"' || char === '`') {
            const close = closingQuoteIndex(src, i);
            out += src.slice(i, close + 1);
            i = close + 1;
            continue;
        }
        out += char;
        i += 1;
    }
    return out;
}

/**
 * Splits on `;` rather than on newlines, so a statement appended to an import
 * line is a statement of its own and a hand-wrapped multi-line import is one
 * statement rather than three fragments. That assumes no `;` inside a string
 * literal, which holds for an import specifier and for `bootstrap();` — and
 * an entry point that needs more than those is failing this guard anyway.
 */
function statements(src: string): string[] {
    return stripComments(src)
        .split(';')
        .map((statement) => statement.replace(/\s+/g, ' ').trim())
        .filter((statement) => statement.length > 0)
        .map((statement) => `${statement};`);
}

/**
 * The specifier has to be the last thing before the `;`, which is what stops
 * an import whose own `;` was dropped from absorbing the following statement:
 * JavaScript's automatic semicolon insertion makes
 * `import x from 'y'` ⏎ `window.debug = true;` two statements, but this
 * parser sees one, and a looser `^import [^;]*;$` would call it an import and
 * wave the smuggled assignment through. Everything an import may carry before
 * `from` is identifier/brace/comma/star text, so the merged text cannot
 * satisfy the shape. `$` is part of that — it is a legal identifier
 * character, and excluding it made `import { $foo } from './x.js';` an
 * offending statement, which is the costly direction: CI fails and the
 * message tells the maintainer to move a legitimate *import* into
 * `bootstrap.ts`. Adding it costs nothing, since `$` cannot begin a
 * statement that survives the merge check either.
 */
const IMPORT_STATEMENT = /^import (?:[\w$*{},\s]+ from )?('[^']*'|"[^"]*");$/;

function offendingStatements(src: string): string[] {
    return statements(src).filter(
        (statement) => !IMPORT_STATEMENT.test(statement) && statement !== 'bootstrap();',
    );
}

describe('main.ts', () => {
    it('contains only imports and the bootstrap call', () => {
        expect(offendingStatements(mainSrc), WHERE_INSTEAD).toEqual([]);
    });

    it('imports the palette before the main stylesheet', () => {
        // Cascade order: palette.css defines the custom properties style.css
        // reads, and ES module evaluation follows import order.
        const imports = statements(mainSrc).filter((line) => line.startsWith('import '));
        expect(imports[0]).toContain('palette.css');
        expect(imports[1]).toContain('style.css');
    });

    it('calls bootstrap exactly once', () => {
        expect(statements(mainSrc).filter((line) => line === 'bootstrap();')).toHaveLength(1);
    });
});

describe('the main.ts guard', () => {
    it('catches a statement smuggled onto an import line', () => {
        // The guard promises the *next statement* fails it, whatever that
        // statement is. A line-based parse would have let this through,
        // because the line it rides on does start with `import `.
        expect(
            offendingStatements(
                "import './palette.css'; window.addEventListener('resize', onResize);\n"
                + 'bootstrap();\n',
            ),
        ).toEqual(["window.addEventListener('resize', onResize);"]);
    });

    it('catches a statement following an import whose specifier contains //', () => {
        // The `//` of a URL specifier is not a comment start. Reading it as
        // one truncated the line at `import 'https:`, and the next statement
        // was then absorbed into that fragment — which conforms, so it passed.
        const offenderAfter = (specifier: string): string[] => offendingStatements(
            `import '${specifier}';\n`
            + 'window.__debug = true;\n'
            + "import { bootstrap } from './app/bootstrap.js';\n"
            + 'bootstrap();\n',
        );

        expect(offenderAfter('https://fonts.example/f.css')).toEqual(['window.__debug = true;']);
        expect(offenderAfter('//cdn.example/f.css')).toEqual(['window.__debug = true;']);
    });

    it('catches a statement hidden behind a block-comment opener in a line comment', () => {
        // `// /*` is a line comment, not the start of a block comment.
        // Stripping block comments off raw source read it as one, and
        // everything up to the next closing marker — including the smuggled
        // statement — vanished before the split could see it.
        expect(
            offendingStatements(
                "import './palette.css'; // /*\n"
                + 'window.__debug = true;\n'
                + '/* an ordinary block comment */\n'
                + "import { bootstrap } from './app/bootstrap.js';\n"
                + 'bootstrap();\n',
            ),
        ).toEqual(['window.__debug = true;']);
    });

    it('catches a statement after a block comment closed from inside a line comment', () => {
        // The mirror image of the case above, and the one a strip-line-
        // comments-first pass gets wrong: the closing marker on the second
        // line really does close the block opened on the first, so
        // `window.__debug = true;` really executes (verified under `node`).
        // Deleting the line comment whole would take that closing marker
        // with it, leaving a dangling opener that the *next* ordinary block
        // comment's closing marker then terminates — swallowing the
        // smuggled statement.
        expect(
            offendingStatements(
                "import './palette.css';\n"
                + '/* a\n'
                + '// */ window.__debug = true;\n'
                + '/* an ordinary block comment */\n'
                + "import { bootstrap } from './app/bootstrap.js';\n"
                + 'bootstrap();\n',
            ),
        ).toEqual(['window.__debug = true;']);
    });

    it('reports an unterminated block comment rather than dropping the file', () => {
        // Under-stripping is the fail-safe direction: an opener with no
        // closing marker keeps everything after it, so the guard trips.
        // Over-stripping would delete `bootstrap();` and pass silently.
        expect(
            offendingStatements(
                "import './palette.css';\n"
                + '/* never closed\n'
                + 'bootstrap();\n',
            ),
        ).toEqual(['/* never closed bootstrap();']);
    });

    it('catches a statement after an import whose semicolon was dropped', () => {
        // Automatic semicolon insertion makes this two statements to the
        // engine. To the parser it is one, so the import shape is what has to
        // reject it: the specifier must be the last thing before the `;`.
        // Nothing else in the repo enforces the semicolon — there is no
        // ESLint here — so the guard cannot lean on one being present.
        expect(
            offendingStatements(
                "import './palette.css';\n"
                + "import { bootstrap } from './app/bootstrap.js'\n"
                + 'window.__debug = true;\n'
                + 'bootstrap();\n',
            ),
        ).toEqual(["import { bootstrap } from './app/bootstrap.js' window.__debug = true;"]);
    });

    it('reports a nested template literal rather than dropping the file', () => {
        // The scan closes the outer literal on the inner *opening* backtick,
        // so it resumes on `//` and eats the rest of that line — the
        // smuggled assignment included. It still trips, because the
        // unterminated outer literal is kept verbatim and swallows the
        // `bootstrap();` below it into one non-conforming statement. Same
        // fail-safe as an unterminated block comment: the guard's promise is
        // that it never passes silently, not that it always names the
        // culprit.
        expect(
            offendingStatements(
                "import './palette.css';\n"
                + 'const s = `${`//`}`; window.__debug = true;\n'
                + 'bootstrap();\n',
            ),
        ).toEqual(['const s = `${` bootstrap();']);
    });

    it('accepts an import of a $-prefixed binding', () => {
        // `$` is a legal identifier character. Excluding it from the import
        // shape failed CI on a legitimate import and told the maintainer to
        // move it into bootstrap.ts — the inverse false positive again.
        expect(
            offendingStatements(
                "import { $foo } from './x.js';\n"
                + 'bootstrap();\n',
            ),
        ).toEqual([]);
    });

    it('accepts an import hand-wrapped across several lines', () => {
        // The inverse false positive: a line-based parse flagged the
        // continuation lines and told the maintainer to move an import into
        // bootstrap.ts, which is not advice this guard should ever give.
        expect(
            offendingStatements(
                'import {\n'
                + '    bootstrap,\n'
                + "} from './app/bootstrap.js';\n"
                + '\n'
                + 'bootstrap();\n',
            ),
        ).toEqual([]);
    });
});
