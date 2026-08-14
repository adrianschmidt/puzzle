/**
 * Guards the two `.oxlintrc.jsonc` options the lint gate rests on and the
 * scope CI runs it over. Neither is self-protecting like the rule set:
 * `reportUnusedDisableDirectives` has no twin — delete it and lint keeps
 * exiting 0 while inline suppressions accumulate for unenforced rules (#502).
 * The scope check pins that `oxlint src` and tsconfig's `include` stay equal,
 * two independent strings — a lint path outside the typechecked set gets
 * type-aware rules judged against an inferred project.
 *
 * Reads a repo-root file from `src/` (like `index-html.test.ts`): the artifact
 * under test has no `src` counterpart to sit beside.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import oxlintrcSrc from '../.oxlintrc.jsonc?raw';
import packageJson from '../package.json';
import tsconfigSrc from '../tsconfig.json?raw';
import ciWorkflow from '../.github/workflows/ci.yml?raw';

/**
 * Strip `//` and block comments so a JSONC file can be parsed. String-aware: a
 * `//` inside a string is content. Both forms are needed — `.oxlintrc.jsonc`
 * uses line comments, `tsconfig.json` block ones — and neither imports as JSON.
 */
function stripJsoncComments(source: string): string {
    let out = '';
    let inString = false;
    let escaped = false;

    for (let i = 0; i < source.length; i++) {
        const ch = source[i];

        if (inString) {
            out += ch;
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }

        if (ch === '"') {
            inString = true;
            out += ch;
            continue;
        }

        if (ch === '/' && source[i + 1] === '/') {
            while (i < source.length && source[i] !== '\n') i++;
            out += '\n';
            continue;
        }

        if (ch === '/' && source[i + 1] === '*') {
            i += 2;
            while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
            i++;
            out += ' ';
            continue;
        }

        out += ch;
    }

    return out;
}

/** Flags that consume the following argv token as their value. */
const VALUE_FLAGS = new Set(['-c', '--config']);

interface OxlintConfig {
    categories?: Record<string, unknown>;
    rules?: Record<string, unknown>;
    options?: { typeAware?: unknown; reportUnusedDisableDirectives?: unknown };
    ignorePatterns?: unknown;
    overrides?: { files?: unknown; rules?: Record<string, unknown> }[];
}

const config = JSON.parse(stripJsoncComments(oxlintrcSrc)) as OxlintConfig;
const tsconfig = JSON.parse(stripJsoncComments(tsconfigSrc)) as { include: string[] };

describe('the oxlint config guard', () => {
    it('parses the JSONC config, comments and all', () => {
        // If this fails, every assertion below is vacuous.
        expect(config.options).toBeDefined();
    });

    it('keeps a `//` inside a string out of the comment stripper', () => {
        const parsed = JSON.parse(
            stripJsoncComments('{"a": "http://x", // trailing\n "b": 1}'),
        ) as { a: string; b: number };
        expect(parsed).toEqual({ a: 'http://x', b: 1 });
    });

    it('strips block comments too, which tsconfig.json uses', () => {
        const parsed = JSON.parse(
            stripJsoncComments('{"a": 1, /* note */ "b": "/* not a comment */"}'),
        ) as { a: number; b: string };
        expect(parsed).toEqual({ a: 1, b: '/* not a comment */' });
    });

    it('parses tsconfig.json, which the scope check reads', () => {
        // Non-vacuity only — the scope relationship is asserted below, not the
        // literal, so a coordinated dir addition doesn't redden a parse test.
        expect(tsconfig.include.length).toBeGreaterThan(0);
    });
});

describe('.oxlintrc.jsonc', () => {
    it('runs type-aware rules', () => {
        expect(config.options?.typeAware).toBe(true);
    });

    it('fails the build on an unused disable directive, not just warns', () => {
        // At default warning severity oxlint exits 0, so a stale suppression
        // prints into a green log and gates nothing.
        expect(config.options?.reportUnusedDisableDirectives).toBe('error');
    });

    it('ignores the paths no tsconfig covers', () => {
        // Keeps a bare `oxlint`/editor run in agreement with CI. Leading
        // slashes matter: these are gitignore-style, so an unanchored
        // `scripts/` also matches `src/**/scripts/` and drops shipped source
        // from the lint scope.
        expect(config.ignorePatterns).toEqual([
            '/scripts/', '/tools/', '/docs/', '/*.config.ts',
        ]);
        // The property, not just the literal: an unanchored entry added later
        // would silently drop `src/**/scripts/**` (round 4's bug).
        for (const pattern of config.ignorePatterns as string[]) {
            expect(pattern.startsWith('/')).toBe(true);
        }
    });

    it('keeps every violation at error severity, not warning', () => {
        // oxlint exits 0 on warnings, so `"correctness": "warn"` reports every
        // violation and fails nothing — and a directive still counts as *used*
        // suppressing a warning, so nothing else here notices.
        expect(config.categories).toEqual({
            correctness: 'error',
            suspicious: 'error',
        });
    });

    it('pins exactly which rules are disabled', () => {
        // Pinned by literal, not property-checked: otherwise an extra rule
        // could be switched off with no test movement. Matters most for rules
        // no live directive anchors (e.g. oxc/approx-constant) — those get
        // disabled silently.
        const off = Object.entries(config.rules ?? {})
            .filter(([, severity]) => severity === 'off')
            .map(([rule]) => rule)
            .sort();
        expect(off).toEqual([
            'no-underscore-dangle',
            'typescript/consistent-return',
            'typescript/no-unnecessary-boolean-literal-compare',
            'typescript/no-unnecessary-type-assertion',
            'typescript/no-unsafe-type-assertion',
            'typescript/unbound-method',
            'unicorn/consistent-function-scoping',
            'unicorn/no-array-reverse',
            'unicorn/no-array-sort',
            'unicorn/require-post-message-target-origin',
        ]);
    });

    it('keeps every per-rule severity at error or off, never warn', () => {
        // Same argument as the categories assertion, per-rule. At "warn"
        // oxlint exits 0 and a live directive still counts as *used*, so
        // neither check notices.
        const severities = [
            ...Object.values(config.rules ?? {}),
            ...(config.overrides ?? []).flatMap((o) => Object.values(o.rules ?? {})),
        ];
        expect(severities.length).toBeGreaterThan(0);
        for (const severity of severities) {
            expect(['error', 'off']).toContain(severity);
        }
    });

    it('keeps the two exemptions in separate overrides entries', () => {
        // Merging these into one entry with a combined `files` list once
        // silently disabled approx-constant for src/diagnostics.ts — it has no
        // directive anchoring it, unlike no-console.
        expect(config.overrides).toHaveLength(2);

        const approx = config.overrides?.find(
            (o) => o.rules && 'oxc/approx-constant' in o.rules,
        );
        expect(approx?.files).toEqual(['**/*.test.ts']);

        const console_ = config.overrides?.find(
            (o) => o.rules && 'no-console' in o.rules,
        );
        expect(console_?.files).toEqual(['**/*.test.ts', 'src/diagnostics.ts']);
        expect(console_?.rules).not.toHaveProperty('oxc/approx-constant');
    });
});

describe('the lint scripts', () => {
    const scripts = packageJson.scripts as Record<string, string | undefined>;

    it('lints every directory tsconfig.json type-checks', () => {
        // The relationship, not the literal: `oxlint src` and tsconfig's
        // `include` agreeing is a coincidence of two independent strings, so
        // changing one without the other is the failure this guards, both
        // ways. `exclude` is out of scope (sw.ts's exclusion is a separate
        // seam). The parse drops flags and any value following a value-taking
        // flag, so `-c .oxlintrc.jsonc` isn't read as a positional path.
        const argv = (scripts.lint ?? '').replace(/^oxlint\s*/, '').split(/\s+/).filter(Boolean);
        const linted: string[] = [];
        for (let i = 0; i < argv.length; i++) {
            if (VALUE_FLAGS.has(argv[i])) { i++; continue; }
            if (argv[i].startsWith('-')) continue;
            linted.push(argv[i]);
        }
        expect(linted).toEqual(tsconfig.include);
    });

    it('ignores directory-scoped configs under the linted tree', () => {
        // A nested .oxlintrc.json REPLACES the root rule set for its subtree,
        // so an empty `{}` under src/ silences every rule there and exits 0
        // (#502 accretion) — no root-config assertion would notice.
        expect(scripts.lint).toContain('--disable-nested-config');
        expect(scripts['lint:fix']).toContain('--disable-nested-config');
        // Name the config explicitly, so an oxlint release changing discovery
        // can't silently drop CI to defaults.
        expect(scripts.lint).toContain('-c .oxlintrc.jsonc');
        expect(scripts['lint:fix']).toContain('-c .oxlintrc.jsonc');
    });

    it('autofixes over that same scope', () => {
        expect(scripts['lint:fix']).toBe(`${scripts.lint ?? ''} --fix`);
    });

    it('runs inside the single CI job that is a required check', () => {
        // Required-check contexts are named by hand in the branch ruleset, so
        // a separate `lint` job would be ungated until the ruleset is edited.
        // Asserting the job *count* is what makes the title true.
        const jobsBlock = ciWorkflow.slice(ciWorkflow.indexOf('\njobs:'));
        const jobs = (jobsBlock.match(/^ {2}([\w-]+):$/gm) ?? []).map((s) => s.trim());
        expect(jobs).toEqual(['test:']);

        // Matched as a whole rendered step line in the jobs block, so a
        // comment — or `npm run lint || true`, as un-gating as
        // continue-on-error — can't satisfy it.
        expect(jobsBlock).toMatch(/^\s*- run: npm run lint\s*$/m);
        const lintAt = jobsBlock.search(/^\s*- run: npm run lint\s*$/m);
        const buildAt = jobsBlock.search(/^\s*- run: npm run build\s*$/m);
        // A step that cannot fail the job is the same as no gate at all.
        expect(jobsBlock).not.toContain('continue-on-error');
        expect(lintAt).toBeGreaterThan(-1);
        expect(buildAt).toBeGreaterThan(-1);
        expect(lintAt).toBeLessThan(buildAt);
    });
});


/**
 * The assertions above are shape proxies — they check the config *says*
 * `"error"`, not that oxlint treats it as one — and this repo merges
 * Dependabot majors unattended. Two config-semantics bugs already shipped here
 * (unused-directive reporting at warning severity; gitignore-style
 * `ignorePatterns`), caught by human review, not by any shape assertion.
 * Running the real binary below is what covers a change in what these keys mean.
 */
/**
 * Fixture dirs live under `src/` so type-aware rules resolve against
 * `tsconfig.json`. `finally` doesn't run on SIGINT, so an interrupted
 * `npm test` can strand one in the linted tree and redden the next lint;
 * swept below rather than ignored, since ignoring the prefix (via
 * `ignorePatterns` or `.gitignore`, which oxlint ≥1.77 honors for passed
 * paths) would make every case here vacuous.
 */
const FIXTURE_PREFIX = 'src/.oxlint-gate-';

describe('the gate, executed', () => {
    beforeAll(() => {
        for (const entry of readdirSync('src')) {
            if (entry.startsWith('.oxlint-gate-')) {
                rmSync(join('src', entry), { recursive: true, force: true });
            }
        }
    });

    /**
     * Fixtures live under `src/` because type-aware rules resolve against
     * `tsconfig.json` (`include: ["src"]`); a fixture outside it has no project
     * and those rules go silently unenforceable. The argv is DERIVED from
     * `scripts.lint`, not copied, so a flag added to the shipped command is
     * exercised here — copying once let an `--allow=<rule>` slip past every
     * shape assertion.
     */
    function lintArgv(probePath: string): string[] {
        const argv = (packageJson.scripts as Record<string, string>).lint
            .replace(/^oxlint\s*/, '')
            .split(/\s+/)
            .filter(Boolean);
        // Drop the trailing scope positional(s); the probe path replaces them.
        const flags: string[] = [];
        for (let i = 0; i < argv.length; i++) {
            if (VALUE_FLAGS.has(argv[i])) { flags.push(argv[i], argv[i + 1]); i++; continue; }
            if (argv[i].startsWith('-')) flags.push(argv[i]);
        }
        return [...flags, probePath];
    }

    function lintFixture(contents: string, extraFiles: Record<string, string> = {}) {
        const dir = mkdtempSync(FIXTURE_PREFIX);
        try {
            writeFileSync(join(dir, 'probe.ts'), contents);
            for (const [name, body] of Object.entries(extraFiles)) {
                writeFileSync(join(dir, name), body);
            }
            // spawnSync, not execFileSync: a spawn failure surfaces via
            // `error` rather than throwing, so one shape covers both "oxlint
            // said no" and "oxlint never ran".
            const r = spawnSync('node_modules/.bin/oxlint', lintArgv(join(dir, 'probe.ts')), {
                encoding: 'utf8',
            });
            return {
                status: r.error ? -1 : (r.status ?? -1),
                output: [r.error?.message, r.stdout, r.stderr].filter(Boolean).join('\n'),
            };
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    it('fails the build on a real violation', () => {
        const { status, output } = lintFixture('export function f(): void { console.log("x"); }\n');
        expect(status, output).toBe(1);
    });

    it('fails the build on a stale disable directive', () => {
        // The anti-rot mechanism, executed. At default warning severity this
        // exits 0 (how it shipped in round 1). The directive is assembled
        // rather than written literally so grepping the tree for suppressions
        // keeps returning only real ones, not this fixture.
        const directive = ['// eslint', 'disable-next-line no-console'].join('-');
        const { status, output } = lintFixture(`${directive}\nexport const x = 1;\n`);
        expect(status, output).toBe(1);
    });

    it('fails the build on a type-aware violation', () => {
        // only-throw-error is the rule type-aware linting was chosen for; it
        // needs a tsconfig project (hence the src/ fixture). A peer-mismatched
        // oxlint/oxlint-tsgolint pair installs quietly — this catches it.
        const { status, output } = lintFixture('export function f(): void { throw "x"; }\n');
        expect(status, output).toBe(1);
    });

    it('ignores a nested config that would otherwise silence the subtree', () => {
        // Without --disable-nested-config an empty {} here drops the whole
        // directory out of the rule set and this exits 0.
        const { status, output } = lintFixture(
            'export function f(): void { console.log("x"); }\n',
            { '.oxlintrc.json': '{}\n' },
        );
        expect(status, output).toBe(1);
    });

    it('passes a clean file, so the cases above are not vacuous', () => {
        const { status, output } = lintFixture('export const x = 1;\n');
        expect(status, output).toBe(0);
    });
});
