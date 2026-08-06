/**
 * The handler is exercised directly rather than through a Workers runtime:
 * it takes `(request, env, fetchFn)` and uses only standard web APIs, so a
 * plain vitest run covers every routing and validation decision in it.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    ALLOWED_ORIGINS,
    handleRequest,
    resolveUpstream,
    type Env,
} from './image-proxy.js';
import wranglerSrc from '../../wrangler.jsonc?raw';
import deployWorkerSrc from '../../.github/workflows/deploy-worker.yml?raw';

const ENV: Env = { UNSPLASH_ACCESS_KEY: 'test-key' };

/**
 * Spelled out rather than read from `ALLOWED_ORIGINS[0]`: taking it from the
 * array would make every CORS assertion below self-referential, proving only
 * that *some* allowed origin works while dropping the production origin left
 * the whole suite green.
 */
const ALLOWED = 'https://adrianschmidt.github.io';

/** A `download_location` shaped like the ones Unsplash actually returns. */
const DOWNLOAD_LOCATION =
    'https://api.unsplash.com/photos/mEZ3PoFGs_k/download?ixid=abc123';

function get(path: string, origin?: string): Request {
    return new Request(`https://proxy.example${path}`, {
        headers: origin === undefined ? {} : { Origin: origin },
    });
}

/**
 * The upstream URL a resolution routes to, asserting it resolved at all — so
 * a routing regression fails by name here rather than as `Invalid URL` inside
 * whichever assertion happened to run first.
 */
function upstreamUrl(result: ReturnType<typeof resolveUpstream>): URL {
    expect(result.ok).toBe(true);

    return new URL((result as { url: string }).url);
}

/**
 * A stub upstream that records the URL it was called with. Clones per call
 * because a `Response` body is single-use, and a second read would otherwise
 * surface as a silent 502 from the handler's own catch.
 */
function stubFetch(
    response: Response = new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
    }),
) {
    return vi
        .fn<typeof fetch>()
        .mockImplementation(() => Promise.resolve(response.clone()));
}

function authHeader(call: Parameters<typeof fetch>): string | null {
    return new Headers(call[1]?.headers).get('authorization');
}

/**
 * Guard: the Worker is an island.
 *
 * Two mechanisms depend on it silently, and both fail in production rather
 * than in CI. It is type-checked against the *app's* lib set, so importing
 * app code — or reaching for `document`/`localStorage` — compiles, lints and
 * passes `wrangler deploy --dry-run`, then throws on every request in
 * workerd. And `deploy-worker.yml` redeploys only on `src/worker/**`, so the
 * moment a shared module exists, editing it ships the app and leaves the
 * Worker on old code with every check green. The reverse direction is the
 * bundle leak: an app module importing from here puts `api.unsplash.com`, and
 * potentially the routing logic, back into the artifact this PR emptied.
 */
describe('the image-proxy Worker island', () => {
    /**
     * Every `.ts` under `src/`, read as text. `import.meta.glob` rather than
     * `node:fs` because `@types/node` is not a dependency here — `vite/client`
     * types this, and it resolves the same set the bundler would.
     */
    const SOURCES = import.meta.glob('/src/**/*.ts', {
        query: '?raw',
        import: 'default',
        eager: true,
    }) as Record<string, string>;

    /**
     * Every non-test module wrangler could pull into the deployed Worker.
     *
     * The whole directory, not just `image-proxy.ts` — the outbound guard
     * below permits siblings, so it has to inspect them too. A
     * `src/worker/helpers.ts` importing app code would otherwise satisfy
     * every check while breaking both properties this block exists to keep.
     */
    const WORKER_SOURCES = Object.entries(SOURCES).filter(
        ([path]) => path.startsWith('/src/worker/') && !path.endsWith('.test.ts'),
    );

    /** Module specifiers a source names, in any form that creates an edge. */
    function specifiersIn(source: string): string[] {
        return [
            ...source.matchAll(
                /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g,
            ),
        ].map((match) => match[1]);
    }

    it('lives where deploy-worker.yml watches', () => {
        // Two independent strings: wrangler.jsonc's `main` decides what gets
        // deployed, deploy-worker.yml's path filter decides when. ci.yml's
        // `--dry-run` catches an uncoordinated rename, but not a coordinated
        // move — update both `main` and this file's location and everything
        // stays green while every SUBSEQUENT Worker edit stops triggering a
        // deploy. The move itself still deploys, because wrangler.jsonc is in
        // the filter, so the divergence begins one commit later.
        const main = (JSON.parse(
            wranglerSrc.replace(/^\s*\/\/.*$/gm, ''),
        ) as { main: string }).main;

        const watched = [
            ...deployWorkerSrc.matchAll(/^\s*-\s*'([^']+)'/gm),
        ].map((m) => m[1]);

        expect(watched).toContain('src/worker/**');
        expect(main.startsWith('src/worker/')).toBe(true);
    });

    it('has sources to scan', () => {
        // Both scans below are "no match found" assertions, so a glob that
        // silently matched nothing would leave them vacuously green forever.
        expect(WORKER_SOURCES.length).toBeGreaterThan(0);
        expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
        expect(SOURCES).toHaveProperty('/src/images/unsplash.ts');
    });

    it('imports nothing from outside its own directory', () => {
        // Not a style preference: this is the property the whole `src/worker/`
        // placement argument rests on, recorded in the module header.
        //
        // Matches `export … from`, dynamic `import(…)` and a bare side-effect
        // `import '…'` as well as a static import — each creates the same
        // edge. Scoped to specifiers that *leave* src/worker/ rather than
        // banning imports outright, because a sibling breaks neither property
        // that matters: wrangler bundles from `main`, so it cannot reach the
        // client, and editing it still trips deploy-worker.yml's path filter.
        const escaping = WORKER_SOURCES.flatMap(([path, source]) =>
            specifiersIn(source)
                .filter((s) => !s.startsWith('./') || s.includes('../'))
                .map((s) => `${path} -> ${s}`),
        );

        expect(escaping).toEqual([]);
    });

    it('reaches for no browser-only global', () => {
        // The other hazard the module header names, and the more dangerous
        // one: `document` type-checks here (the Worker is compiled against the
        // app's DOM lib), lints, and passes `wrangler deploy --dry-run`, then
        // throws on every request in workerd with every check green.
        //
        // Matches the property-access form rather than the bare identifier, so
        // that the module header can name these globals in prose without
        // tripping its own guard. `const d = document;` would slip through —
        // nobody writes that, and the alternative is stripping comments, which
        // would silently eat `https://` and turn this into a false negative.
        const hits = WORKER_SOURCES.flatMap(([path, source]) =>
            (
                source.match(
                    /\b(?:document|window|localStorage|sessionStorage|navigator)\s*[.[]/g,
                ) ?? []
            ).map((hit) => `${path} -> ${hit}`),
        );

        expect(hits).toEqual([]);
    });

    it('is imported by no shipped module', () => {
        // Matches the same edge forms as the outbound guard — dynamic
        // `import()` is how this repo code-splits (`traced-tab-loader.ts`), so
        // a `from`-only pattern would miss the most likely offender — and any
        // file under `src/worker/`, not just this one.
        const offenders = Object.entries(SOURCES)
            .filter(
                ([path]) =>
                    !path.startsWith('/src/worker/')
                    && !path.endsWith('.test.ts'),
            )
            .filter(([, source]) =>
                specifiersIn(source).some((s) => /(^|\/)worker\//.test(s)),
            )
            .map(([path]) => path);

        expect(offenders).toEqual([]);
    });
});

describe('ALLOWED_ORIGINS', () => {
    it('includes the production origin', () => {
        // The live picker fails CORS the moment this drops out, and no other
        // test in this file would notice.
        expect(ALLOWED_ORIGINS).toContain(ALLOWED);
    });
});

describe('resolveUpstream', () => {
    it('routes /random to the Unsplash random endpoint', () => {
        const url = upstreamUrl(
            resolveUpstream(new URL('https://proxy.example/random')),
        );

        expect(url.origin).toBe('https://api.unsplash.com');
        expect(url.pathname).toBe('/photos/random');
    });

    it('forwards query, orientation and count', () => {
        const url = upstreamUrl(
            resolveUpstream(
                new URL(
                    'https://proxy.example/random?query=face&orientation=portrait&count=4',
                ),
            ),
        );

        expect(url.searchParams.get('query')).toBe('face');
        expect(url.searchParams.get('orientation')).toBe('portrait');
        expect(url.searchParams.get('count')).toBe('4');
    });

    it('drops parameters outside the allowlist', () => {
        // The point of the allowlist: `collections` and `topics` would let a
        // caller reshape the search under our key, and `username` would let
        // them mine one photographer's catalogue through our quota.
        const url = upstreamUrl(
            resolveUpstream(
                new URL(
                    'https://proxy.example/random?collections=123&topics=nature&username=someone',
                ),
            ),
        );

        expect(url.searchParams.get('collections')).toBeNull();
        expect(url.searchParams.get('topics')).toBeNull();
        expect(url.searchParams.get('username')).toBeNull();
    });

    it('does not let a caller nominate the key /random is billed to', () => {
        const url = upstreamUrl(
            resolveUpstream(
                new URL('https://proxy.example/random?client_id=attacker-key'),
            ),
        );

        expect(url.searchParams.get('client_id')).toBeNull();
    });

    it('routes a valid /download URL', () => {
        const url = upstreamUrl(
            resolveUpstream(
                new URL(
                    `https://proxy.example/download?url=${encodeURIComponent(DOWNLOAD_LOCATION)}`,
                ),
            ),
        );

        expect(url.origin).toBe('https://api.unsplash.com');
        expect(url.pathname).toBe('/photos/mEZ3PoFGs_k/download');
        expect(url.searchParams.get('ixid')).toBe('abc123');
    });

    it('does not let a caller nominate the key /download is billed to', () => {
        // This route forwards the caller's query whole, so unlike /random the
        // allowlist is not doing the work — the parameter is stripped by name.
        const url = upstreamUrl(
            resolveUpstream(
                new URL(
                    `https://proxy.example/download?url=${encodeURIComponent(
                        `${DOWNLOAD_LOCATION}&client_id=attacker-key`,
                    )}`,
                ),
            ),
        );

        expect(url.searchParams.get('client_id')).toBeNull();
    });

    it('rejects a /download URL on another origin', () => {
        // Without this the Worker is an open relay that attaches our key to
        // any URL a caller names.
        const result = resolveUpstream(
            new URL(
                `https://proxy.example/download?url=${encodeURIComponent('https://evil.example/photos/x/download')}`,
            ),
        );

        expect(result).toEqual({
            ok: false,
            status: 400,
            message: 'url is not an Unsplash download location',
        });
    });

    // These all *look* like api.unsplash.com to a careless check. The first
    // two are the ones that matter most: they are the shapes a suffix match
    // (`hostname.endsWith('unsplash.com')`) would wave through, which is the
    // most plausible way this guard gets "generalized" into an open relay.
    // CLAUDE.md opens with the precedent — a lint autofix silently deleted a
    // security coercion in `share-link.ts`, and only a test caught it.
    it.each([
        ['hostname ending in unsplash.com', 'https://evil-unsplash.com/photos/x/download'],
        ['different unsplash.com subdomain', 'https://cdn.unsplash.com/photos/x/download'],
        ['userinfo before the host', 'https://api.unsplash.com@evil.example/photos/x/download'],
        ['userinfo on the real host', 'https://user:pass@api.unsplash.com/photos/x/download'],
        ['hostname suffix', 'https://api.unsplash.com.evil.example/photos/x/download'],
        ['different TLD', 'https://api.unsplash.com.co/photos/x/download'],
        ['scheme downgrade', 'http://api.unsplash.com/photos/x/download'],
        ['encoded traversal', 'https://api.unsplash.com/photos/x%2f..%2f..%2fusers%2fme/download'],
    ])('rejects a /download URL that only looks like Unsplash (%s)', (_label, hostile) => {
        const result = resolveUpstream(
            new URL(
                `https://proxy.example/download?url=${encodeURIComponent(hostile)}`,
            ),
        );

        expect(result.ok).toBe(false);
    });

    it('rejects an Unsplash URL that is not a download location', () => {
        const result = resolveUpstream(
            new URL(
                `https://proxy.example/download?url=${encodeURIComponent('https://api.unsplash.com/users/someone')}`,
            ),
        );

        expect(result.ok).toBe(false);
    });

    it('rejects a missing url parameter', () => {
        const result = resolveUpstream(
            new URL('https://proxy.example/download'),
        );

        expect(result).toEqual({
            ok: false,
            status: 400,
            message: 'Missing url parameter',
        });
    });

    it('rejects a malformed url parameter', () => {
        const result = resolveUpstream(
            new URL('https://proxy.example/download?url=not-a-url'),
        );

        expect(result).toEqual({
            ok: false,
            status: 400,
            message: 'Malformed url parameter',
        });
    });

    it('404s an unknown path', () => {
        const result = resolveUpstream(
            new URL('https://proxy.example/photos/random'),
        );

        expect(result).toEqual({
            ok: false,
            status: 404,
            message: 'Not found',
        });
    });
});

describe('handleRequest', () => {
    it('forwards to Unsplash and returns the body', async () => {
        const fetchFn = stubFetch(
            new Response('{"id":"abc"}', {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        );

        const response = await handleRequest(get('/random'), ENV, fetchFn);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('{"id":"abc"}');
        expect(fetchFn).toHaveBeenCalledOnce();
    });

    it('authenticates with a header rather than a query parameter', async () => {
        const fetchFn = stubFetch();

        await handleRequest(get('/random'), ENV, fetchFn);

        expect(authHeader(fetchFn.mock.calls[0])).toBe('Client-ID test-key');
        expect(fetchFn.mock.calls[0][0]).not.toContain('test-key');
    });

    it('pins the Unsplash API version', async () => {
        // The client can no longer send this — an extra header would make its
        // simple GET preflighted — so the Worker is the only place it can go,
        // and without it a v2 response shape would fail `isUnsplashPhoto` and
        // silently degrade every game to the bundled image.
        const fetchFn = stubFetch();

        await handleRequest(get('/random'), ENV, fetchFn);

        expect(
            new Headers(fetchFn.mock.calls[0][1]?.headers).get(
                'accept-version',
            ),
        ).toBe('v1');
    });

    it('bounds how long it will wait on Unsplash', async () => {
        // The client cannot cancel this request — the loading overlay only
        // reads its abort flag after the await (#536) — so this signal is the
        // only thing standing between a stalled upstream and a browser-length
        // wait. That makes the duration the point, not just the presence: a
        // controller signal that never fires is also an AbortSignal. The
        // literal is spelled out rather than imported, so that raising
        // UPSTREAM_TIMEOUT_MS has to be a deliberate edit here too.
        const timeout = vi.spyOn(AbortSignal, 'timeout');
        const fetchFn = stubFetch();

        await handleRequest(get('/random'), ENV, fetchFn);

        expect(fetchFn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
        expect(timeout).toHaveBeenCalledWith(10_000);

        timeout.mockRestore();
    });

    it('passes an upstream rate-limit status through unchanged', async () => {
        // The property #533 depends on: a 403 must not be flattened into a
        // 200-with-empty-body or a 500, or the client cannot tell a rate
        // limit from any other failure.
        const fetchFn = stubFetch(
            new Response('{"errors":["Rate Limit Exceeded"]}', { status: 403 }),
        );

        const response = await handleRequest(get('/random'), ENV, fetchFn);

        expect(response.status).toBe(403);
    });

    it('forwards the rate-limit headers and exposes them to the browser', async () => {
        const fetchFn = stubFetch(
            new Response('{}', {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                    'x-ratelimit-limit': '50',
                    'x-ratelimit-remaining': '11',
                },
            }),
        );

        const response = await handleRequest(
            get('/random', ALLOWED),
            ENV,
            fetchFn,
        );

        expect(response.headers.get('x-ratelimit-remaining')).toBe('11');
        expect(response.headers.get('access-control-expose-headers')).toContain(
            'x-ratelimit-remaining',
        );
    });

    it('allows a known origin to read the response', async () => {
        const response = await handleRequest(
            get('/random', ALLOWED),
            ENV,
            stubFetch(),
        );

        expect(response.headers.get('access-control-allow-origin')).toBe(
            ALLOWED,
        );
        expect(response.headers.get('vary')).toBe('Origin');
    });

    it.each([
        'http://localhost:5173',
        'http://localhost:4173',
        'http://localhost:5174',
        'http://127.0.0.1:8080',
        'http://192.168.1.42:5173',
        'http://10.0.0.7:5173',
        'http://172.16.0.3:5173',
    ])('allows any port on the developer machine (%s)', async (origin) => {
        // `vite` and `vite preview` both fall back to the next free port, so
        // pinning literal ones broke the picker for anyone running two dev
        // servers — routine here, given sibling worktrees. The private ranges
        // are `npm run dev -- --host` opened on a phone, which worked on main
        // because api.unsplash.com answers `Access-Control-Allow-Origin: *`.
        const response = await handleRequest(
            get('/random', origin),
            ENV,
            stubFetch(),
        );

        expect(response.headers.get('access-control-allow-origin')).toBe(
            origin,
        );
    });

    it.each([
        ['a hostname merely containing localhost', 'http://localhost.evil.example'],
        ['https on localhost, which is not what vite serves', 'https://localhost:5173'],
        ['a public IP that is not in a private range', 'http://8.8.8.8:5173'],
        ['a hostname merely starting like a private range', 'http://192.168.1.1.evil.example'],
        ['an unrelated origin', 'https://evil.example'],
        ['a non-URL Origin header', 'null'],
    ])('omits the CORS header for %s', async (_label, origin) => {
        const response = await handleRequest(
            get('/random', origin),
            ENV,
            stubFetch(),
        );

        expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('varies on Origin even when the origin is not allowed', async () => {
        // The response that would poison a shared cache is this one — the one
        // with no allow-origin header — so it is the one that most needs the
        // marking.
        const response = await handleRequest(
            get('/random', 'https://evil.example'),
            ENV,
            stubFetch(),
        );

        expect(response.headers.get('vary')).toBe('Origin');
    });

    it('states its own content type rather than reflecting upstream', async () => {
        // Both routes return JSON. Reflecting upstream's value is the one
        // place an upstream-controlled string reaches the browser from our own
        // origin — enough to re-serve an Unsplash HTML error page as
        // renderable HTML on a workers.dev subdomain, which `nosniff` does not
        // prevent (it stops sniffing away from a declared type, not a wrong
        // declared type).
        const fetchFn = stubFetch(
            new Response('<html>Bad Gateway</html>', {
                status: 502,
                headers: { 'content-type': 'text/html; charset=utf-8' },
            }),
        );

        const response = await handleRequest(get('/random'), ENV, fetchFn);

        expect(response.headers.get('content-type')).toBe('application/json');
    });

    it('tells caches not to store a photo response', async () => {
        // `/random` must return different photos each time; Unsplash's own
        // directives do not survive the hop, so without this the response
        // reaches the client with no cache policy at all.
        const response = await handleRequest(
            get('/random', ALLOWED),
            ENV,
            stubFetch(),
        );

        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    });

    it('answers a preflight without calling upstream', async () => {
        const fetchFn = stubFetch();
        const request = new Request('https://proxy.example/random', {
            method: 'OPTIONS',
            headers: { Origin: ALLOWED },
        });

        const response = await handleRequest(request, ENV, fetchFn);

        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-methods')).toBe(
            'GET, OPTIONS',
        );
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('rejects a non-GET method without calling upstream', async () => {
        const fetchFn = stubFetch();
        const request = new Request('https://proxy.example/random', {
            method: 'POST',
        });

        const response = await handleRequest(request, ENV, fetchFn);

        expect(response.status).toBe(405);
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('does not call upstream when validation fails', async () => {
        // A rejected request must cost nothing against the Unsplash quota.
        const fetchFn = stubFetch();

        const response = await handleRequest(
            get('/download?url=https%3A%2F%2Fevil.example%2Fx'),
            ENV,
            fetchFn,
        );

        expect(response.status).toBe(400);
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('reports an unreachable upstream as a readable 502', async () => {
        // Letting the exception escape would hand the browser Cloudflare's own
        // HTML error page, which carries no CORS header and so surfaces as an
        // opaque TypeError rather than a status.
        const fetchFn = vi
            .fn<typeof fetch>()
            .mockRejectedValue(new Error('connection reset'));

        const response = await handleRequest(
            get('/random', ALLOWED),
            ENV,
            fetchFn,
        );

        expect(response.status).toBe(502);
        expect(response.headers.get('access-control-allow-origin')).toBe(
            ALLOWED,
        );
    });

    it('does not report the upstream failure back to the caller', async () => {
        // The cause is dropped deliberately. Asserting the body is exactly the
        // fixed message pins that decision — a `String(error)` in the catch
        // hands an anonymous caller whatever the runtime knows about our
        // network, and is the mutation this test exists to redden.
        const fetchFn = vi
            .fn<typeof fetch>()
            .mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:443'));

        const response = await handleRequest(get('/random'), ENV, fetchFn);

        expect(await response.text()).toBe(
            '{"error":"Upstream request failed"}',
        );
    });

    it('passes a null-body upstream status through without throwing', async () => {
        // `new Response('', { status: 204 })` throws: an empty string is still
        // a body. Flattening 204 into a 502 instead would break the
        // pass-through-status property #533 is built on.
        const fetchFn = stubFetch(new Response(null, { status: 204 }));

        const response = await handleRequest(get('/random'), ENV, fetchFn);

        expect(response.status).toBe(204);
    });

    // deploy.yml and deploy-preview.yml probe `GET {base}/download` with no
    // `url`, reading 400 as "live, routed, and has a key set" and 500 as "the
    // secret is unset". That discrimination holds only while the config guard
    // runs BEFORE routing and validation — swap them, which is the more
    // conventional order, and an unkeyed Worker answers 400, so both deploys
    // report themselves healthy while every real request 500s. Nothing else in
    // the repo states this contract, so it is pinned on the exact request CI
    // issues rather than on a request that merely resembles it.
    it('answers the deploy probe with 500 when no key is set', async () => {
        const fetchFn = stubFetch();

        const response = await handleRequest(get('/download'), {}, fetchFn);

        expect(response.status).toBe(500);
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('answers the deploy probe with 400 once configured', async () => {
        const fetchFn = stubFetch();

        const response = await handleRequest(get('/download'), ENV, fetchFn);

        expect(response.status).toBe(400);
        // Still free: a rejected probe must never cost Unsplash quota, which
        // is why this route was chosen over /random.
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('reports an unrouted path as 404 once configured', async () => {
        const response = await handleRequest(get('/nope'), ENV, stubFetch());

        expect(response.status).toBe(404);
    });

    it('names missing configuration rather than forwarding an unauthorized request', async () => {
        // `{}` is the real never-set shape — `wrangler secret put` is a step
        // separate from the deploy, so the binding is absent rather than
        // empty. Unsplash answers an unauthorized call with an opaque 401,
        // which sends the operator hunting the wrong problem.
        const fetchFn = stubFetch();

        const response = await handleRequest(get('/random'), {}, fetchFn);

        expect(response.status).toBe(500);
        expect(fetchFn).not.toHaveBeenCalled();
    });
});
