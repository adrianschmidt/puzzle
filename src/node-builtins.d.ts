/**
 * Minimal ambient decls for the Node builtins `lint-config.test.ts` shells out
 * with. Deliberately not `@types/node`: `tsconfig.json` pins `types` to
 * `vite/client` + `vite-plugin-pwa/client`, so the app's type surface is a
 * browser's — pulling in Node's would let `process`/`Buffer`/`__dirname`
 * typecheck in client code that has none at runtime. Keep to what's imported.
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
