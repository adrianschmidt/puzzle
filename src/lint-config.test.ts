/**
 * Guard: the two `.oxlintrc.jsonc` options the lint gate rests on, and the
 * scope the CI script runs it over.
 *
 * Neither is self-protecting the way the rule set is. A disabled rule that
 * should be enabled shows up as a violation the moment someone writes the
 * pattern it forbids, and `typeAware: false` immediately reddens CI — the
 * `only-throw-error` directive in `traced-tab-loader.test.ts` becomes an
 * unused directive. `reportUnusedDisableDirectives` has no such twin. Delete
 * it and every current directive stays valid, so lint keeps exiting 0 while
 * the repo drifts straight back to the state #502 was filed about: inline
 * suppressions accumulating for rules nobody enforces, invisible on a green
 * build.
 *
 * The scope assertion is here for a different reason: `oxlint src` and
 * `tsconfig.json`'s `"include": ["src"]` agreeing is a coincidence of two
 * independent strings, and the config's own comment claims they match. If the
 * lint script ever grows a path outside the typechecked set, type-aware rules
 * start judging that code against an inferred project rather than the one it
 * was written for.
 *
 * Follows `index-html.test.ts` in reading a repo-root file from `src/` — the
 * artifact under test has no `src` counterpart to sit beside.
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
 * `//` inside a JSON string is content, not a comment.
 *
 * Both forms are needed — `.oxlintrc.jsonc` uses line comments, `tsconfig.json`
 * uses block ones (`/* Bundler mode *​/`), and neither is strict JSON, so
 * `import`ing them directly fails.
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
        // If this fails, every assertion below is vacuous — pin it explicitly
        // rather than letting a parse change quietly pass the rest.
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
        // Non-vacuity only. The scope relationship is asserted below; pinning
        // the literal here too means the correct coordinated change — adding a
        // directory to both tsconfig and the lint script — reddens a test
        // named after parsing.
        expect(tsconfig.include.length).toBeGreaterThan(0);
    });
});

describe('.oxlintrc.jsonc', () => {
    it('runs type-aware rules', () => {
        expect(config.options?.typeAware).toBe(true);
    });

    it('fails the build on an unused disable directive, not just warns', () => {
        // The whole point: at the default warning severity oxlint exits 0, so
        // a stale suppression would print into a green log and gate nothing.
        expect(config.options?.reportUnusedDisableDirectives).toBe('error');
    });

    it('ignores the paths no tsconfig covers', () => {
        // Keeps a bare `npx oxlint` / editor run in agreement with CI, which
        // scopes itself with an explicit path instead. `*.config.ts` matters
        // most: vite.config.ts is the repo's only root-level .ts, so it is the
        // one file a rootless `oxlint --fix` would rewrite.
        // Leading slashes matter: these are gitignore-style patterns, so an
        // unanchored `scripts/` also matches `src/**/scripts/`, silently
        // dropping a shipped source directory out of the lint scope.
        expect(config.ignorePatterns).toEqual([
            '/scripts/', '/tools/', '/docs/', '/*.config.ts',
        ]);
        // The property, not just the literal: an unanchored entry added later
        // (and the literal above updated to match) would silently drop
        // `src/**/scripts/**` from the linted set — round 4's actual bug.
        for (const pattern of config.ignorePatterns as string[]) {
            expect(pattern.startsWith('/')).toBe(true);
        }
    });

    it('keeps every violation at error severity, not warning', () => {
        // The last way to turn the gate into a green log: oxlint exits 0 on
        // warnings, so `"correctness": "warn"` reports every violation and
        // fails nothing — and a directive still counts as *used* when it
        // suppresses a warning, so nothing else here would notice.
        expect(config.categories).toEqual({
            correctness: 'error',
            suspicious: 'error',
        });
    });

    it('pins exactly which rules are disabled', () => {
        // The other three widening surfaces — ignorePatterns, categories, and
        // overrides.files — are pinned by literal; this one was only
        // property-checked, so an eleventh rule could be switched off with no
        // test movement. That matters most for rules no directive anchors:
        // disabling no-console or only-throw-error reddens CI via their live
        // directives, but oxc/approx-constant has no such anchor and would go
        // quietly. Disabling a rule should be a deliberate two-file edit.
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
        // Same argument as the categories assertion above, applied to the
        // block two lines below it. `only-throw-error` is the sharpest case:
        // it is the named reason type-aware linting is in scope, and at "warn"
        // it degrades in both directions — oxlint exits 0, and its directive
        // in traced-tab-loader.test.ts still counts as *used*, so the
        // unused-directive check does not notice either.
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
        // The one config shape here with a demonstrated failure: merging these
        // into a single entry with a combined `files` list silently disabled
        // approx-constant for src/diagnostics.ts, and nothing caught it —
        // unlike a widened no-console, which reddens an existing directive,
        // approx-constant has no directive anchoring it anywhere.
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
        // `include: ["src"]` agreeing is a coincidence of two independent
        // strings, so changing one without the other is the failure this
        // guards — in both directions. A directory added to tsconfig but not
        // the script goes unlinted; one added to the script but not tsconfig
        // gets type-aware rules resolved against an inferred project.
        //
        // `exclude` deliberately does not enter this: the comparison is
        // between tsconfig's `include` and the script's positional args, and
        // sw.ts being excluded from the former is a separate seam (CLAUDE.md).
        // Drops flags AND any value that follows a value-taking flag, so
        // `-c .oxlintrc.jsonc` does not read as a positional path.
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
        // A nested .oxlintrc.json REPLACES the root rule set for its subtree
        // rather than merging — an empty `{}` under src/ silences every rule
        // there and exits 0. That is the #502 accretion pattern a directory at
        // a time, and no assertion about the root config would notice.
        expect(scripts.lint).toContain('--disable-nested-config');
        expect(scripts['lint:fix']).toContain('--disable-nested-config');
        // And name the config explicitly rather than relying on discovery, so
        // an oxlint release that changes discovery cannot silently drop CI to
        // defaults while every assertion in this file stays green.
        expect(scripts.lint).toContain('-c .oxlintrc.jsonc');
        expect(scripts['lint:fix']).toContain('-c .oxlintrc.jsonc');
    });

    it('autofixes over that same scope', () => {
        expect(scripts['lint:fix']).toBe(`${scripts.lint ?? ''} --fix`);
    });

    it('runs inside the single CI job that is a required check', () => {
        // Not a new job: required-check contexts are named by hand in the
        // branch ruleset, so a separate `lint` job would be an ungated check
        // until someone edited the ruleset. Asserting the job *count* is what
        // makes the title true — moving lint into its own job would otherwise
        // leave a substring-order check green.
        const jobsBlock = ciWorkflow.slice(ciWorkflow.indexOf('\njobs:'));
        const jobs = (jobsBlock.match(/^ {2}([\w-]+):$/gm) ?? []).map((s) => s.trim());
        expect(jobs).toEqual(['test:']);

        // Scoped to the jobs block and matched against the rendered step
        // line, so a comment mentioning `npm run lint` cannot satisfy this.
        // Matched as a whole rendered line: `indexOf` would accept
        // `- run: npm run lint || true`, which is as un-gating as
        // continue-on-error and just as deliberate.
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
 * The assertions above are all *shape* proxies: they check that the config
 * says `"error"`, not that oxlint treats it as one. Every proxy is only as
 * good as the linter's current reading of those keys, and this repo merges
 * Dependabot PRs unattended — majors included.
 *
 * That gap is not hypothetical here. Two config-semantics bugs already
 * shipped on this branch and were caught by human review, not by any
 * assertion: `--report-unused-disable-directives` reports at *warning*
 * severity and exits 0, and `ignorePatterns` are gitignore-style, so an
 * unanchored `scripts/` also matched `src/**​/scripts/` and silently dropped
 * files from the linted set. The second is shape-caught now (the
 * `startsWith('/')` assertion above, added after it bit); the first never
 * could be, and neither would a change in what these keys *mean*. Running
 * the real binary is what covers that.
 */
/**
 * Fixture dirs live under `src/` so type-aware rules resolve against
 * `tsconfig.json`. `finally` does not run on SIGINT, so an interrupted
 * `npm test` can strand one inside the linted tree, where it would redden the
 * next `npm run lint` with a violation nobody wrote. Swept below rather than
 * ignored: adding the prefix to `ignorePatterns` — or to `.gitignore`, which
 * oxlint ≥1.77 honors even for explicitly passed paths (oxc-project/oxc#25133)
 * — would make every case here vacuous.
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
     * Fixtures live under `src/` rather than the OS temp dir on purpose: the
     * type-aware rules resolve against `tsconfig.json`, whose `include` is
     * `["src"]`, so a fixture outside it has no project and those rules are
     * silently unenforceable — which is the half of the linter this PR argues
     * is the reason to choose oxlint at all.
     *
     * The argv is DERIVED from `scripts.lint` rather than copied, so a flag
     * added to the shipped command is automatically exercised here. Copying it
     * left a real hole: `--allow=<rule>` appended to the script silences that
     * rule repo-wide, and every shape assertion in this file stayed green
     * because the parser skips `-`-prefixed tokens and this block ran its own
     * argv.
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
            // spawnSync, not execFileSync: it reports a spawn failure (missing
            // binary, wrong cwd) through `error` instead of throwing, so one
            // shape covers both "oxlint said no" and "oxlint never ran". The
            // latter otherwise surfaced as `expected -1 to be 1` with the real
            // message discarded — in the file whose whole job is to be the alarm.
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
        // The anti-rot mechanism, executed rather than asserted about. At the
        // default warning severity this exits 0 — how it shipped in round 1.
        //
        // Assembled rather than written literally so that grepping the tree
        // for suppression directives — the audit this whole PR is about —
        // keeps returning only real ones, not this fixture.
        const directive = ['// eslint', 'disable-next-line no-console'].join('-');
        const { status, output } = lintFixture(`${directive}\nexport const x = 1;\n`);
        expect(status, output).toBe(1);
    });

    it('fails the build on a type-aware violation', () => {
        // only-throw-error is the rule the whole type-aware decision was made
        // for. It needs a tsconfig project, which is why the fixture is under
        // src/. A peer-mismatched oxlint/oxlint-tsgolint pair installs quietly
        // under `npm ci --legacy-peer-deps`; this is what would catch it.
        const { status, output } = lintFixture('export function f(): void { throw "x"; }\n');
        expect(status, output).toBe(1);
    });

    it('ignores a nested config that would otherwise silence the subtree', () => {
        // Round 5's fix, executed rather than string-matched. Without
        // --disable-nested-config an empty {} here drops the whole directory
        // out of the rule set and this exits 0.
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
