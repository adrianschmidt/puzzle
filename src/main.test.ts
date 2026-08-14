/**
 * Guard: `main.ts` is an entry point, not a place for logic. `index.html`
 * loads it as a side-effecting module, so it can't be imported under test —
 * anything living there is unreachable by the suite (how it once reached 1939
 * lines). The composition root is `src/app/bootstrap.ts`: importable, tested,
 * where new wiring belongs.
 *
 * Not a line-count cap (a number the next feature raises by ten) — the next
 * statement added here fails it, whatever it is. That holds only as far as the
 * parse, which works in statements rather than lines; `the main.ts guard`
 * below pins each direction it must read correctly.
 */

import { describe, it, expect } from 'vitest';
import mainSrc from './main.ts?raw';

const WHERE_INSTEAD =
    'main.ts must stay an entry point: two CSS imports and the bootstrap() call. '
    + 'Put new wiring in src/app/bootstrap.ts — it exports a function, so '
    + 'bootstrap.test.ts can reach it, and nothing here can be reached at all.';

/**
 * Index of the quote closing the literal opened at `start`, or the last index
 * of `src` when it is never closed — an unterminated literal is kept whole, so
 * it trips the guard rather than deleting the rest of the file.
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
 * One left-to-right scan, not a pass per comment style: comments and string
 * literals nest, so whether `//`, `/*` or a quote starts anything depends on
 * what is already open, and no ordering of two whole-file passes gets every
 * case (a block opener in a line comment, a block closer in a line comment, a
 * `//` inside a string). Each hides an executing statement by over-stripping.
 *
 * Under-stripping is the safe direction: an unterminated `/*` keeps the rest
 * verbatim, so it trips the guard rather than deleting `bootstrap();`. Two
 * constructs still read wrong (a regex literal, a nested template literal),
 * both needing a `//` inside to bite and both landing fail-safe — the nested
 * template is pinned below.
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
 * Splits on `;`, not newlines, so a statement appended to an import line is
 * its own and a hand-wrapped import is one statement. Assumes no `;` inside a
 * string literal — holds for an import specifier and `bootstrap();`.
 */
function statements(src: string): string[] {
    return stripComments(src)
        .split(';')
        .map((statement) => statement.replace(/\s+/g, ' ').trim())
        .filter((statement) => statement.length > 0)
        .map((statement) => `${statement};`);
}

/**
 * The specifier must be the last thing before `;`: that is what stops an
 * import whose own `;` was dropped from absorbing the next statement (ASI
 * makes them two, this parser sees one). `$` is included because it is a legal
 * identifier char — excluding it false-flagged `import { $foo } from './x.js'`.
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
        // A line-based parse would pass this: the line starts with `import `.
        expect(
            offendingStatements(
                "import './palette.css'; window.addEventListener('resize', onResize);\n"
                + 'bootstrap();\n',
            ),
        ).toEqual(["window.addEventListener('resize', onResize);"]);
    });

    it('catches a statement following an import whose specifier contains //', () => {
        // The `//` in a URL specifier is not a comment: reading it as one
        // truncates at `import 'https:` and absorbs the next statement.
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
        // `// /*` is a line comment, not a block opener. Stripping blocks off
        // raw source reads it as one and eats the smuggled statement.
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
        // Mirror of the case above: the `// */` on line 2 really closes the
        // block opened on line 1 (verified under node), so a strip-line-
        // comments-first pass drops the closing marker and swallows the
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
        // Fail-safe: an unterminated opener keeps everything after it, so the
        // guard trips rather than dropping `bootstrap();` silently.
        expect(
            offendingStatements(
                "import './palette.css';\n"
                + '/* never closed\n'
                + 'bootstrap();\n',
            ),
        ).toEqual(['/* never closed bootstrap();']);
    });

    it('catches a statement after an import whose semicolon was dropped', () => {
        // ASI makes this two statements to the engine but one to this parser,
        // so the import shape must reject it; nothing else here enforces the
        // semicolon.
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
        // The scan closes the outer literal on the inner opening backtick and
        // over-strips, but the unterminated outer literal is kept verbatim and
        // trips the guard — fail-safe, like an unterminated block comment.
        expect(
            offendingStatements(
                "import './palette.css';\n"
                + 'const s = `${`//`}`; window.__debug = true;\n'
                + 'bootstrap();\n',
            ),
        ).toEqual(['const s = `${` bootstrap();']);
    });

    it('accepts an import of a $-prefixed binding', () => {
        // `$` is a legal identifier char; excluding it false-flagged a real
        // import.
        expect(
            offendingStatements(
                "import { $foo } from './x.js';\n"
                + 'bootstrap();\n',
            ),
        ).toEqual([]);
    });

    it('accepts an import hand-wrapped across several lines', () => {
        // A line-based parse would flag the continuation lines as offenders.
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
