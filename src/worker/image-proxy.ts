/**
 * Cloudflare Worker: Unsplash API proxy.
 *
 * The app is a static site, so a build-time `VITE_`-prefixed key is inlined
 * into the bundle and readable by every visitor (#534). This Worker holds the
 * key instead and forwards the only two Unsplash calls the app makes.
 *
 * Deliberately not a passthrough relay: a `/*` proxy would expose the whole
 * Unsplash API under our key. Only the two routes below are reachable. On
 * `/random` only the parameters named in `RANDOM_PARAMS` survive the hop;
 * `/download` is the exception and forwards the caller's query whole, minus
 * `client_id` — see the reason at that branch.
 *
 * Lives under `src/` rather than a top-level `worker/` so it stays inside the
 * one tree `tsconfig.json` includes and `npm run lint` scopes to — a pairing
 * `lint-config.test.ts` asserts as an equality. A module-format Worker uses
 * only standard web APIs, which the DOM lib already provides, so unlike
 * `src/pwa/sw.ts` it needs no separate tsconfig and does not end up outside
 * the linter's type universe.
 *
 * That placement is only safe while this file imports nothing, and nothing
 * imports it — `image-proxy.test.ts` pins both. It is type-checked against
 * the *app's* lib set, so a `document` or `localStorage` reference here would
 * compile, lint and pass `wrangler deploy --dry-run`, then fail in production
 * on every request; and `deploy-worker.yml` only redeploys on `src/worker/**`,
 * so a shared module would be edited without the Worker being republished.
 *
 * **Routes are additive.** `registerType: 'prompt'` means a returning player
 * keeps running whatever bundle they precached until they accept an update,
 * so one deployed Worker serves every client generation that ever shipped.
 * Renaming or removing a route 404s those clients — they degrade to the
 * bundled image, but silently. Add the new route, wait, then remove the old.
 */

/**
 * Set with `wrangler secret put`. Optional because that is a separate step
 * from the deploy: until it runs the binding is absent, not empty. Typing it
 * as a required `string` would make the guard in `handleRequest` read as
 * dead code.
 */
export interface Env {
    UNSPLASH_ACCESS_KEY?: string;
}

const UNSPLASH_API_ORIGIN = 'https://api.unsplash.com';

/** How long to wait on Unsplash before giving the client a 502. */
const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Origins allowed to read a response, beyond localhost (see
 * {@link isAllowedOrigin}).
 *
 * Not a security boundary — CORS is enforced by browsers, so a non-browser
 * caller ignores it entirely. It only stops the proxy being casually embedded
 * in someone else's page and spending our quota.
 *
 * A fork deploying its own Worker has to add its own Pages origin here.
 * `main` needed no such step, because `api.unsplash.com` answers
 * `Access-Control-Allow-Origin: *` — so the symptom is a picker that works on
 * localhost and fails with only a console error once deployed.
 */
export const ALLOWED_ORIGINS: readonly string[] = [
    'https://adrianschmidt.github.io',
];

/**
 * Parameters forwarded to `/photos/random`. An allowlist rather than a copy:
 * forwarding everything would let a caller add `collections`, `topics` or
 * `username` and reshape the search under our key.
 *
 * Exported so `unsplash.test.ts` can assert the client emits exactly this set
 * — the two lists are otherwise independent, and a parameter added on the
 * client side would be dropped here in silence.
 */
export const RANDOM_PARAMS: readonly string[] = [
    'query',
    'orientation',
    'count',
];

/**
 * Shape of a legitimate `download_location` path. Unsplash returns these as
 * absolute URLs, so the client hands one back verbatim; without this check the
 * Worker would fetch any URL a caller named, with our key attached.
 */
const DOWNLOAD_PATH = /^\/photos\/[\w-]+\/download$/;

/** Rate-limit headers forwarded so the client can see the remaining budget. */
const FORWARDED_HEADERS: readonly string[] = [
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
];

/**
 * Statuses the `Response` constructor refuses to pair with a body — and an
 * empty string is still a body, so passing one through here throws.
 */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304]);

/**
 * Headers common to every response.
 *
 * `no-store` because neither route is reusable — `/random` must return
 * different photos each time, `/download` is a usage report — and Unsplash's
 * own directives do not survive the hop, since the header set below is rebuilt
 * from an allowlist rather than copied.
 *
 * `vary` is unconditional. The response that would poison a shared cache is
 * the one *without* an allow-origin header, so emitting `Vary` only on the
 * allowed branch would leave exactly the dangerous case unmarked.
 */
const BASE_HEADERS: Readonly<Record<string, string>> = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    vary: 'Origin',
};

/**
 * Hosts a dev server can be reached on: loopback, plus the RFC 1918 ranges so
 * `npm run dev -- --host` opened on a phone still gets a working picker —
 * which `api.unsplash.com` allowed before this Worker existed, since it sends
 * `Access-Control-Allow-Origin: *`.
 */
const DEV_HOSTNAME =
    /^(?:localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

/**
 * Whether an origin may read a response.
 *
 * Any port counts, because none of them is knowable: `npm run dev` and
 * `npm run preview` are bare `vite` commands and Vite's `strictPort` defaults
 * to false, so with 5173 or 4173 taken — routine here, since contributors keep
 * sibling worktrees — the server silently binds the next one up.
 *
 * Widening this costs nothing. CORS is not the boundary: the upstream call and
 * the quota spend happen before any of it is consulted, so `curl` with no
 * Origin at all is already strictly more capable than a malicious page. The
 * list exists only to stop the proxy being casually embedded in someone else's
 * site, and no such site is served from a visitor's own private network.
 */
function isAllowedOrigin(origin: string): boolean {
    if (ALLOWED_ORIGINS.includes(origin)) {
        return true;
    }

    let parsed: URL;
    try {
        parsed = new URL(origin);
    } catch {
        return false;
    }

    return parsed.protocol === 'http:' && DEV_HOSTNAME.test(parsed.hostname);
}

function corsHeaders(origin: string | null): Record<string, string> {
    if (origin === null || !isAllowedOrigin(origin)) {
        return { ...BASE_HEADERS };
    }

    return {
        ...BASE_HEADERS,
        'access-control-allow-origin': origin,
        'access-control-expose-headers': FORWARDED_HEADERS.join(', '),
    };
}

function errorResponse(
    status: number,
    message: string,
    origin: string | null,
): Response {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'content-type': 'application/json', ...corsHeaders(origin) },
    });
}

type Resolution =
    | { ok: true; url: string }
    | { ok: false; status: number; message: string };

/**
 * The key is deliberately *not* added here — it travels as an `Authorization`
 * header instead, so no URL this function returns is secret. That is what lets
 * the caller log or report a failing upstream URL, and what keeps the key out
 * of Cloudflare's subrequest cache key and out of any upstream error page that
 * echoes back the request it received.
 *
 * Exported for testing: this is where every routing and validation decision
 * lives, and it is pure.
 */
export function resolveUpstream(url: URL): Resolution {
    if (url.pathname === '/random') {
        const target = new URL(`${UNSPLASH_API_ORIGIN}/photos/random`);

        for (const name of RANDOM_PARAMS) {
            const value = url.searchParams.get(name);
            if (value !== null) {
                target.searchParams.set(name, value);
            }
        }

        return { ok: true, url: target.toString() };
    }

    if (url.pathname === '/download') {
        const raw = url.searchParams.get('url');

        if (raw === null) {
            return { ok: false, status: 400, message: 'Missing url parameter' };
        }

        let parsed: URL;
        try {
            parsed = new URL(raw);
        } catch {
            return { ok: false, status: 400, message: 'Malformed url parameter' };
        }

        // `origin` compares scheme, host and port exactly — a suffix match
        // would readmit `evil-unsplash.com` as an open relay. It ignores
        // userinfo, though, so `https://u:p@api.unsplash.com/...` reaches the
        // real host but with credentials `fetch` refuses outright; rejecting
        // it here keeps the accepted set equal to the intended one.
        if (
            parsed.origin !== UNSPLASH_API_ORIGIN
            || parsed.username !== ''
            || parsed.password !== ''
            || !DOWNLOAD_PATH.test(parsed.pathname)
        ) {
            return {
                ok: false,
                status: 400,
                message: 'url is not an Unsplash download location',
            };
        }

        // Unlike /random this forwards the caller's query whole, so that a
        // parameter Unsplash later adds to `download_location` keeps working.
        // `client_id` is the one that must not survive: left in place it would
        // sit alongside our Authorization header and let a caller nominate
        // which key Unsplash bills.
        parsed.searchParams.delete('client_id');

        return { ok: true, url: parsed.toString() };
    }

    return { ok: false, status: 404, message: 'Not found' };
}

/**
 * Upstream status codes pass through unchanged — a 403 from Unsplash reaches
 * the client as a 403, which is what makes the rate-limit telemetry in #533
 * implementable without touching this Worker again.
 */
export async function handleRequest(
    request: Request,
    env: Env,
    fetchFn: typeof fetch = fetch,
): Promise<Response> {
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                ...corsHeaders(origin),
                'access-control-allow-methods': 'GET, OPTIONS',
                'access-control-max-age': '86400',
            },
        });
    }

    if (request.method !== 'GET') {
        return errorResponse(405, 'Method not allowed', origin);
    }

    // The secret is set separately from the deploy, so a Worker can be live
    // before it has a key. Without this the request goes upstream unauthorized
    // and comes back as Unsplash's opaque 401, which reads as a bad key or a
    // rate limit rather than as missing setup.
    const accessKey = env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
        return errorResponse(500, 'Proxy not configured', origin);
    }

    const resolved = resolveUpstream(new URL(request.url));

    if (!resolved.ok) {
        return errorResponse(resolved.status, resolved.message, origin);
    }

    let upstream: Response;
    let body: string;

    try {
        upstream = await fetchFn(resolved.url, {
            headers: {
                Authorization: `Client-ID ${accessKey}`,
                // How Unsplash versions its API. The client cannot send this
                // any more — an extra header would make its simple GET
                // preflighted — so this is now the only place it can be set,
                // and without it a v2 response shape would fail
                // `isUnsplashPhoto` and silently fall back to bundled images.
                'Accept-Version': 'v1',
            },
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
        body = await upstream.text();
    } catch {
        // Keeps every failure on the one shape `errorResponse` produces — JSON
        // plus CORS headers — instead of letting the exception escape to the
        // runtime, which answers with a headerless HTML error page the browser
        // cannot read across origins.
        return errorResponse(502, 'Upstream request failed', origin);
    }

    const headers: Record<string, string> = {
        // Stated, not copied. Both routes return JSON, and reflecting
        // upstream's value is the one place an upstream-controlled string
        // would reach the browser from our own origin — enough to re-serve an
        // Unsplash HTML error page as renderable HTML on a `workers.dev`
        // subdomain. `nosniff` does not help: it stops sniffing away from a
        // declared type, not a declared type that is wrong.
        'content-type': 'application/json',
        ...corsHeaders(origin),
    };

    for (const name of FORWARDED_HEADERS) {
        const value = upstream.headers.get(name);
        if (value !== null) {
            headers[name] = value;
        }
    }

    return new Response(
        NULL_BODY_STATUSES.has(upstream.status) ? null : body,
        { status: upstream.status, headers },
    );
}

export default {
    fetch(request: Request, env: Env): Promise<Response> {
        return handleRequest(request, env);
    },
};
