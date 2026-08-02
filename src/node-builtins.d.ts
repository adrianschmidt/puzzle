/**
 * Minimal ambient declarations for the three Node builtins used by
 * `lint-config.test.ts`, which shells out to the real oxlint binary.
 *
 * Deliberately not `@types/node`. `tsconfig.json` pins `types` to
 * `vite/client` and `vite-plugin-pwa/client`, so the app's type surface is a
 * browser's — adding Node's would let `process`, `Buffer`, `__dirname` and
 * friends typecheck inside client code that has none of them at runtime. This
 * is a browser app; the only Node-flavoured code in the tree is a test that
 * runs under vitest, so the surface it needs is declared here rather than
 * widened globally.
 *
 * Keep this file to what is actually imported. If it starts growing, that is
 * the signal to reconsider `@types/node` on its merits instead.
 */

declare module 'node:child_process' {
    export function spawnSync(
        file: string,
        args: readonly string[],
        options?: { encoding?: 'utf8' },
    ): {
        status: number | null;
        stdout: string | null;
        stderr: string | null;
        error?: { message: string };
    };
}

declare module 'node:fs' {
    export function mkdtempSync(prefix: string): string;
    export function readdirSync(path: string): string[];
    export function writeFileSync(path: string, data: string): void;
    export function rmSync(
        path: string,
        options?: { recursive?: boolean; force?: boolean },
    ): void;
}


declare module 'node:path' {
    export function join(...parts: string[]): string;
}
