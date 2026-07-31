/**
 * Umami analytics wrapper.
 *
 * Injects the Umami tracking script at startup (when configured) and
 * exposes a typed `track()` function for custom events. Both functions
 * are no-ops when:
 * - `VITE_UMAMI_WEBSITE_ID` is unset (e.g. localhost), or
 * - the Umami script hasn't loaded / has been blocked by an ad-blocker.
 *
 * Event schema lives here as the single source of truth.
 */

import type { Orientation } from '../model/types.js';

declare global {
    interface Window {
        umami?: {
            track: (eventName: string, eventData?: Record<string, unknown>) => void;
        };
    }
}

const DEFAULT_SCRIPT_URL = 'https://cloud.umami.is/script.js';

/**
 * Data attached to `new-game-started`.
 *
 * `source` records how the puzzle started (fresh new-game vs. opening a
 * shared link). The image-related fields and the share-recipient fields
 * are conditionally populated — see the spec for details.
 *
 * `'shared'` also covers a `__reproPuzzle` console replay, which runs the
 * same `loadSharedPuzzle` path. Only the failure event separates the two
 * ({@link SharedLoadFailedData}'s `source`), so a share-link success rate
 * computed from `new-game-started[source=shared]` against
 * `shared-load-failed[source=shared]` has dev-console traffic in the
 * numerator only and reads slightly high. Dev-console volume, accepted.
 */
export interface NewGameData {
    source: 'fresh' | 'shared';
    cutStyle: string;
    /**
     * Trace-set version backing a puzzle's hand-traced tabs, read off the
     * per-style config the puzzle was generated with. Present for traced-tab
     * Wavy games, Triangles games, and sine-based Classic games; omitted for
     * Fractal, Composable, legacy (classic-tab) Wavy links, pre-upgrade
     * Classic links/saves, Classic games degraded to the legacy generator by
     * a failed chunk fetch (see `tracedChunkDegraded`), boot-fallback games
     * (see `bootFallback`), and any link whose
     * per-style config the decoder dropped as invalid — a `tf`-less Triangles
     * link still generates with traced tabs, but at a version substituted
     * during generation that the state never records. Lets analytics follow
     * trace-set versions once a v2 ships.
     *
     * For `cutStyle: 'classic'` it carries a SECOND meaning: presence is the
     * generator discriminator (sine + traced tabs vs. the legacy
     * straight-grid generator), so `cutStyle === 'classic'` + absent
     * `traceSetVersion` approximates the pre-upgrade tail. Consequence for
     * queries: "has traceSetVersion" is no longer a proxy for
     * "Wavy/Triangles" — filter on `cutStyle` explicitly.
     *
     * Three confounds sit in that bucket, all separable:
     * - degraded new games (a failed chunk fetch) land in it — exclude
     *   `tracedChunkDegraded`;
     * - boot-fallback games (#488) land in it too, with no chunk failure of
     *   their own — exclude `bootFallback`;
     * - during a rollout window, clients still on the pre-upgrade build
     *   (PWA caches especially) start Classic games without the field too.
     *   Those are `source: 'fresh'`; a genuine pre-upgrade Classic *link*
     *   arrives as `source: 'shared'`.
     *
     * So the query on `new-game-started` is: `cutStyle: 'classic'`, no
     * `traceSetVersion`, neither `tracedChunkDegraded` nor `bootFallback` —
     * then split on `source`. None of the three exclusions is a negated
     * filter; all are subtractions. For the two flags that is the absence
     * reason each flag's own doc spells out; `traceSetVersion` is likewise
     * omitted rather than null on `new-game-started`, so
     * `traceSetVersion != <n>` joins on the key and matches only rows that
     * have one.
     * Both halves count the same one thing: a Classic game that rendered
     * legacy geometry. `'fresh'` is the stale-build population and falls to
     * zero as the fleet turns over. `'shared'` is the link tail, and it is
     * not only pre-upgrade links — anything that reaches a recipient without
     * a usable `clf` lands here too. While the rollout lasts that includes
     * stale builds opening a *new* link: `isValidPayload` checks known fields
     * only, so an unknown `clf` passes validation and is then ignored.
     * Permanently, it includes links shared from a game that had no sine
     * config of its own to pass on (a degraded start, a resumed pre-upgrade
     * save, a boot-fallback game). That last one is not excludable
     * recipient-side the way a boot fallback's own start is: `bootFallback`
     * rides on the originator's `new-game-started` only, and nothing about
     * it is encoded in the link. All of them genuinely ran the legacy
     * generator, so every extra population inflates the tail in the safe
     * direction — toward keeping that generator, never toward retiring it
     * early.
     */
    traceSetVersion?: number;
    /**
     * True when a new Classic game fell back to the legacy straight-grid
     * generator because the traced-tab chunk failed to load. Only ever set
     * for fresh Classic games — every other style fails the start outright,
     * and the shared-link path never degrades. Absent otherwise, so on
     * `new-game-started` the degraded volume is a single filter and can be
     * subtracted from the "Classic without traceSetVersion" bucket above.
     *
     * On `puzzle-completed` that guarantee holds only within the session
     * that started the game: the flag rides along in the cached new-game
     * payload but is not persisted, so a degraded game completed after a
     * reload reads as pre-upgrade traffic. Deliberate — the completion event
     * is still correct about the *geometry regime* (it genuinely is legacy
     * geometry), and `new-game-started` is the right denominator for the
     * retire-the-legacy-generator question and stays clean. Not worth
     * persisting a telemetry-only failure flag onto the saved state.
     *
     * A boot fallback sets `bootFallback` instead — it never attempts the
     * fetch, so there is no failure to record.
     */
    tracedChunkDegraded?: boolean;
    /**
     * True when the boot path's preferred start failed and the app
     * recovered by starting a last-resort puzzle instead (#488): legacy
     * Classic cut, lazy chunk never fetched, every other preference kept.
     * The player's cut-style preference is untouched, so this is a
     * per-boot recovery and not a permanent switch — the next New Game
     * offers their style again.
     *
     * Never set on the dialog path: there a rejection leaves the previous
     * puzzle on screen and the player retries, so there is nothing to
     * substitute. The matching `new-game-failed { phase: 'boot' }` carries
     * why the preferred start failed. That event has three possible
     * outcomes, not one: recovery succeeded (this flag follows), recovery
     * was attempted and also failed (a second `new-game-failed
     * { phase: 'boot-fallback' }` follows), or recovery was skipped because
     * a puzzle had already reached the screen before the failure (nothing
     * follows at all — see `phase`'s doc).
     *
     * Nor is the flag a clean stand-in for outcome 1 even when recovery
     * did work: it rides on `new-game-started`, which the fallback tracks
     * last, after its puzzle has rendered and persisted. A fallback that
     * throws in that tail emits the `phase: 'boot-fallback'` event with no
     * flag behind it, yet leaves the player a playable puzzle — the same
     * rare case `phase`'s doc bounds from the other side. So flag-absence
     * does not imply recovery failed. Don't treat this flag's count as the
     * numerator over `new-game-failed[phase='boot']`'s count for a recovery
     * rate: the skipped-recovery outcome and that tail both deflate it.
     *
     * Like `tracedChunkDegraded`, these games ran legacy geometry with no
     * `traceSetVersion`, so they have to come out of the pre-upgrade-tail
     * query described above — by subtracting this flag's own count, not by
     * negating a filter: the flag is absent rather than `false` when it
     * doesn't apply, so `bootFallback = true` is the only filter that
     * expresses it. The two flags never co-occur (a boot fallback never
     * starts the chunk fetch, so it cannot also be degraded), so
     * subtracting both double-counts nothing. Unlike `tracedChunkDegraded`,
     * the cause need not be the chunk at all — a saved config the build
     * cannot generate lands here too.
     *
     * Also like `tracedChunkDegraded`, it isn't persisted onto the saved
     * puzzle, so the same `puzzle-completed`-after-reload caveat documented
     * there applies here too.
     */
    bootFallback?: boolean;
    rotationMode: 'none' | 'quarter-turn' | 'free';
    /**
     * Puzzle orientation. Derivable from `rows > cols` (both paths store the
     * post-transpose grid), but broken out as a first-class low-cardinality
     * dimension so portrait adoption — the point of this feature — is a plain
     * segment filter in the dashboard rather than a computed comparison.
     */
    orientation: Orientation;
    cols: number;
    rows: number;
    pieceCount: number;
    imageSource?: string;
    imageCategory?: string;
    vibrant?: boolean;
    /**
     * Fresh unsplash games only: true when the player tapped a specific
     * candidate thumbnail, false for "Surprise me". Measures picker
     * adoption. Absent for shared/resumed games and non-photo sources.
     */
    imagePicked?: boolean;
    includesProgress?: boolean;
    recipientHadSavedState?: boolean;
    /**
     * Share-link background color outcome: 'adopted' (recipient had no
     * color preference; the link's color was applied and saved),
     * 'kept-own' (link carried a color, recipient has their own),
     * 'invalid' (link carried a `bgc` that isn't a valid palette id —
     * e.g. palette drift dropped a once-live color), or 'none' (link
     * predates the feature and carried no `bgc` at all). Only present
     * when source === 'shared'.
     */
    sharedColor?: 'adopted' | 'kept-own' | 'invalid' | 'none';
}

/**
 * Data attached to `puzzle-completed`.
 *
 * Same field names as `NewGameData`, but every field outside the
 * puzzle-shape core is optional — for resumed-then-completed games we
 * only know the puzzle's geometry, not how it was originally started.
 */
export type PuzzleCompletedData = Pick<
    NewGameData,
    'cutStyle' | 'rotationMode' | 'cols' | 'rows' | 'pieceCount'
> &
    Partial<NewGameData>;

/** Data attached to `puzzle-shared`. */
export interface PuzzleSharedData {
    source: 'completion-overlay' | 'info-modal';
    includesProgress: boolean;
}

/** Data attached to `background-color-changed`. */
export interface BackgroundColorChangedData {
    /** Swatch id before the switch. */
    from: string;
    /** Swatch id after the switch. */
    to: string;
}

/**
 * Data attached to `traced-chunk-preload-started`.
 *
 * Fired once per real import attempt (cached-promise calls don't
 * re-emit), so it's the denominator for the loaded/failed funnel and
 * makes abandonment observable — a started event with no matching
 * settle means the user left mid-fetch. `attempt` matches the counter
 * on the settling event.
 */
export interface TracedChunkPreloadStartedData {
    attempt: number;
}

/**
 * Data attached to `traced-chunk-loaded`.
 *
 * `durationMs` is the wall-clock time between the initiating call that
 * started the in-flight import (not necessarily the very first call —
 * the cache resets per attempt after a failure) and the import
 * settling, i.e. real-user preload latency. Rounded to 0.1 ms so warm
 * sub-millisecond hits don't all collapse to `0`.
 *
 * `cacheState` separates the latency populations so the metric isn't an
 * average across them: `cold` (full network fetch), `warm` (served from
 * cache, no network), and `revalidated` (a 304 round trip — headers
 * only, body from cache). Derived from the chunk's Resource Timing
 * entry; `'unknown'` when no usable entry is available (API absent or
 * the entry was evicted from a full buffer — the two aren't separable).
 *
 * `attempt` is the 1-based attempt counter for this client session, so
 * a retry after a failure is distinguishable from an unrelated cold
 * load.
 */
export interface TracedChunkLoadedData {
    durationMs: number;
    cacheState: 'cold' | 'warm' | 'revalidated' | 'unknown';
    attempt: number;
}

/**
 * Data attached to `traced-chunk-load-failed`.
 *
 * `reason` is the rejection's message with URLs and extension origins
 * redacted (so per-deploy chunk hashes and ad-blocker extension IDs
 * don't ship to analytics) and truncated to a bounded length; empty
 * messages fall back to `'unknown'`.
 *
 * `kind` buckets the failure (network / parse / unknown) so events
 * aggregate cleanly in Umami despite the raw `reason` being
 * high-cardinality.
 *
 * `attempt` is the 1-based attempt counter for this client session.
 */
export interface TracedChunkLoadFailedData {
    reason: string;
    kind: 'network' | 'parse' | 'unknown';
    attempt: number;
}

/**
 * Data attached to `unhandled-error` — the app-wide backstop for async
 * failures that no local `try/catch` handled.
 *
 * `source` is the channel that caught it. The page realm reports a rejected
 * promise (`'rejection'`) or a thrown exception (`'error'`); the
 * service-worker backstop reports the same two channels from inside the
 * worker scope as `'sw-rejection'` / `'sw-error'`, so an operator can tell a
 * worker-scope failure from a page-scope one. (Named `source`, not `kind`, to
 * avoid colliding with the failure-class `kind` on
 * {@link TracedChunkLoadFailedData} — the two carry different semantics.)
 *
 * `name` is the low-cardinality bucket for aggregation/alerting: the
 * thrown value's constructor name (`TypeError`, `RangeError`, …), or
 * `'unknown'` when the rejection/error value isn't an `Error`.
 *
 * `reason` is the sanitized message (URLs/extension origins redacted,
 * empty falls back to `'unknown'`, length-capped); see
 * {@link import('./sanitize-error-reason.js').sanitizeErrorReason}.
 *
 * Coverage caveat for the `sw-*` sources: the worker backstop only sees
 * synchronous throws and unhandled promise rejections in the worker scope.
 * It does NOT capture `FetchEvent.respondWith` / precache / `waitUntil`
 * failures (those surface as the event's own failure, not a global error),
 * and a report is dropped when no window client is open to relay it. So
 * absence of `sw-rejection`/`sw-error` events is not proof the worker is
 * healthy. See `pwa/sw.ts` for the full rationale.
 */
export interface UnhandledErrorData {
    source: 'rejection' | 'error' | 'sw-rejection' | 'sw-error';
    name: string;
    reason: string;
}

/**
 * Data attached to `shared-load-failed` — a puzzle payload satisfied
 * surface-shape validation but failed while building the puzzle (e.g. a
 * config combination the current build's topology pipeline doesn't support).
 * `reason` is the sanitized error message.
 *
 * `source` separates the two producers, whose base rates differ sharply.
 * `'shared'` is a real recipient opening a `#p=` link and seeing a
 * "Couldn't load shared puzzle" toast — the signal that watches for
 * share-format regressions. `'repro'` is a developer replaying an info-modal
 * repro block through `__reproPuzzle` in the console, where a generation
 * failure is often the very thing being investigated, so it is an expected
 * outcome rather than user-facing breakage. Without the discriminator the
 * two are indistinguishable, since the differing warn/toast messages never
 * reach analytics. (Named `source` to match {@link ShareFailedData} and
 * {@link UnhandledErrorData}.)
 *
 * Read an ABSENT `source` as `'shared'`: every row predating the
 * discriminator is a real share link, and during the rollout window
 * PWA-cached clients on the previous build keep emitting source-less real
 * failures (the same stale-client confound the `traceSetVersion` note above
 * describes). No property filter can express that, negated or not: event
 * properties are key/value rows, so `source != 'repro'` still joins on the
 * key and matches exactly the rows `source = 'shared'` does. The
 * share-format signal is arithmetic — total `shared-load-failed` minus
 * `source = 'repro'`.
 */
export interface SharedLoadFailedData {
    reason: string;
    source: 'shared' | 'repro';
}

/**
 * Data attached to `image-fetch-failed` — fetching a random Unsplash image
 * threw (network/parse failure). This is NOT the "no image found" case:
 * `fetchRandomImage` returns `undefined` (and is untracked) on a 4xx/5xx
 * response, so this event only fires on a genuine throw. The new game still
 * proceeds with the fallback image. `reason` is the sanitized error message.
 *
 * `orientation` and `imageCategory` describe the request that failed, so a
 * portrait-specific or category-specific fetch problem is distinguishable
 * from a generic one rather than being aggregated away.
 */
export interface ImageFetchFailedData {
    reason: string;
    orientation: Orientation;
    imageCategory: string;
}

/**
 * Data attached to `new-game-failed` — starting a fresh puzzle rejected. The
 * most likely cause (the traced-tab lazy chunk import) ALSO emits
 * `traced-chunk-load-failed` one layer down, so a single failure can produce
 * both events; there is no guaranteed 1-to-1 correlation (topology and other
 * errors reach this catch without a chunk event). This event captures the
 * outcome that the inner event does not. `reason` is the sanitized error
 * message.
 *
 * What the player saw depends on `phase`, and only the dialog path shows the
 * "Couldn't start new game" toast this event used to be synonymous with. A
 * `phase: 'boot'` event shows nothing at all — the boot path stays quiet
 * until its recovery attempt has settled — and its most common visible
 * outcome is a substitution notice over a working puzzle. So a pre-existing
 * `count(new-game-failed)` dashboard stopped counting user-facing new-game
 * failures when #488 landed: it now also counts boot failures that mostly
 * ended in a playable puzzle.
 *
 * Recovering the old metric — or any dialog-path-only figure — is
 * arithmetic, not a filter. Same absence problem {@link SharedLoadFailedData}'s
 * `source` has, for the same reason: event properties are key/value rows, so
 * `phase != 'boot'` still joins on the key and matches only rows that HAVE a
 * `phase`. Dialog-path failures are total `new-game-failed` minus
 * `phase = 'boot'` minus `phase = 'boot-fallback'`.
 */
export interface NewGameFailedData {
    reason: string;
    /**
     * Cut style the failed attempt asked for — the same attribution
     * {@link SaveFailedData}, {@link SaveCompressedData} and
     * {@link ProgressSaveSkippedData} carry, for the same stated reason:
     * without it a failure arrives as an unattributable count. (The
     * principle is {@link ImageFetchFailedData}'s too, but with the
     * dimensions that matter there — it carries `orientation` and
     * `imageCategory`, not a cut style.)
     * It is what makes the #488 question answerable at all, namely
     * whether a Wavy or Triangles preference is what dead-ends a boot. The
     * recovered `new-game-started` cannot answer it — that one reports
     * `'classic'`, the style the fallback substituted.
     *
     * The *requested* style, so on `phase: 'boot-fallback'` it is always
     * `'classic'`: the fallback's own forced cut, not the preference that
     * failed. The preference is on the paired `phase: 'boot'` event.
     *
     * Absent on rows recorded before the field existed.
     */
    cutStyle: string;
    /**
     * Which start attempt failed. Absent on the new-game dialog path,
     * where a rejection leaves the previous puzzle on screen and the
     * player can simply retry — so absence is also every event recorded
     * before this field existed.
     *
     * `'boot'` is the boot path's preferred start, the failure that used
     * to leave a dead app (#488); `'boot-fallback'` is the last-resort
     * Classic puzzle that recovers from it failing too. A `phase: 'boot'`
     * event has three possible follow-ups, not a guaranteed one: a
     * `bootFallback` game (recovery succeeded, see its doc above), a
     * `phase: 'boot-fallback'` event (recovery attempted and also failed —
     * that pair is one incident, not two), or nothing at all (recovery
     * skipped because a puzzle had already reached the screen before the
     * failure). Reading "no boot-fallback event" as "it recovered" collapses
     * the last two cases, which are opposites.
     *
     * Nor is a `'boot-fallback'` event quite "the player was left with
     * nothing": the fallback runs the same setup the preferred start does,
     * so it can reject *after* its puzzle rendered, and that player keeps
     * the puzzle and reads the substitution notice. Rare, but it makes this
     * event an upper bound on the dead-app population rather than a
     * measurement of it.
     */
    phase?: 'boot' | 'boot-fallback';
}

/**
 * Data attached to `piece-count-mismatch` — generation produced a different
 * number of pieces than the base cut declared it would (#512). Three
 * historical fused-piece bugs shipped undetected before this event existed.
 *
 * The event exists to be ACTED on, not just counted: `seed`, `cols`, `rows`,
 * `imageWidth`, `imageHeight`, `rotationMode` and `styleConfig` are exactly
 * the repro params the info modal prints, so a row here can normally be
 * replayed locally through `__reproPuzzle` and turned into a regression
 * test — the exception is the rare row where the per-style config didn't
 * fit and `styleConfig` was replaced by
 * {@link PieceCountMismatchData.styleConfigOmitted}.
 *
 * `expected` and `actual` are PRE-STRIP, GENERATION-GRID counts, while
 * `cols`/`rows` are the USER grid. For a borderless puzzle these legitimately
 * disagree: a borderless 16x12 oversizes to 18x14 = 252 faces before the outer
 * ring is stripped, so `expected: 252` alongside `cols: 16, rows: 12` is
 * correct, not a contradiction. The user grid is what a replay needs.
 *
 * No `delta` property: it is `actual - expected` and both are here, so the
 * CSV export computes it.
 *
 * `imageUrl` is deliberately absent. Cut geometry is a function of the seed,
 * the grid, the image SIZE, the style and the style config — the image bytes
 * do not enter it, and `reproParamsToPayload` defaults a missing image to the
 * blank canvas, so a replay is geometrically identical without it. Shipping
 * it in any form would also be the first exception to the redaction rule
 * {@link TracedChunkLoadFailedData} follows.
 *
 * `imageUrl` and `styleConfig` are the two fields this schema treats as
 * capable of running long, and each is handled by the mechanism that fits
 * it: `imageUrl` cannot be usefully shortened — a truncated URL is a broken
 * one — so it is dropped unconditionally, at build time. `styleConfig` is
 * usually a handful of numbers but occasionally unbounded (see
 * {@link PieceCountMismatchData.styleConfigOmitted}), so it is checked and
 * dropped only at runtime, only on the rows that actually cross Umami's
 * 500-char string limit. Both follow the same principle: never ship
 * something that looks replayable and isn't.
 *
 * `source` separates real players from developer investigation: replaying a
 * known-bad puzzle through `__reproPuzzle` re-runs generation and re-fires
 * this event, so `source = 'repro'` rows must be excluded when counting
 * incidents. As everywhere else in this schema, absence cannot be filtered —
 * event properties are key/value rows, so the player-facing population is
 * total `piece-count-mismatch` minus `source = 'repro'`, arithmetic rather
 * than a negated filter (the rule {@link SharedLoadFailedData} documents).
 *
 * Not every row is a bug: exotic composable configs (e.g. sine `hf`/`vf` = 10
 * on a small grid) can self-intersect and carve genuine island faces, so the
 * real face count legitimately exceeds the declared one without a fused- or
 * dropped-piece defect behind it. Treat this event as a lead to replay and
 * inspect, not an automatic incident count.
 */
export interface PieceCountMismatchData {
    /** The cut style the player chose. */
    cutStyle: string;
    /**
     * The base-cut generator that declared the expectation — `'sine'` today.
     * NOT derivable from `cutStyle`: classic, wavy, triangles and composable
     * all sit on the sine base cut, so the mismatch is a property of the base
     * cut rather than the style.
     */
    baseCut: string;
    /** Faces the base cut intended to produce. Pre-strip, generation-grid. */
    expected: number;
    /** Faces the pipeline actually yielded. Pre-strip, generation-grid. */
    actual: number;
    /** Repro param: the puzzle's PRNG seed (uint32). */
    seed: number;
    /** Repro param: the USER grid — see the note above. */
    cols: number;
    /** Repro param: the USER grid — see the note above. */
    rows: number;
    /** Repro param: image width. Part of the geometry contract, not decoration. */
    imageWidth: number;
    /** Repro param: image height. Part of the geometry contract, not decoration. */
    imageHeight: number;
    /** Repro param: rotation mode. */
    rotationMode: string;
    /**
     * Repro param: compact JSON of whichever per-style config block the puzzle
     * carries. One property rather than four mutually-exclusive flattened
     * shapes, and exactly what `reproParamsToPayload` needs to rebuild the
     * payload. Absent when the puzzle carries no per-style block (e.g. legacy
     * Classic, whose absence is itself load-bearing — it selects the legacy
     * generator), and also absent — in favor of
     * {@link PieceCountMismatchData.styleConfigOmitted} — when the
     * serialized block would exceed Umami's 500-char string limit.
     * Mutually exclusive with `styleConfigOmitted`: at most one of the two is
     * ever present, so the event never carries more than the 12 documented
     * properties.
     */
    styleConfig?: string;
    /**
     * Set instead of `styleConfig` when the puzzle's per-style config
     * serializes past Umami's 500-char string limit. A row with this flag is
     * **not** replayable as-is through `__reproPuzzle` — the config needed to
     * regenerate the exact cut is missing — but every other repro field
     * (`seed`, `cols`, `rows`, `imageWidth`, `imageHeight`, `rotationMode`) is
     * still valid and the `expected`/`actual` counts are unaffected.
     *
     * In practice this means `cutStyle: 'composable'`: `composableConfig`'s
     * `baseCutConfig`/`tabConfig` are opaque `Record<string, unknown>`
     * (`model/types.ts`), and the share-link decoder only checks that they
     * are non-null objects — no size or shape bound — so a crafted share
     * link can produce a config large enough to cross the limit. None of the
     * other four per-style config blocks are open-ended enough to approach
     * it. Truncating instead of omitting was rejected: truncated JSON does
     * not parse, so a truncated `styleConfig` would look replayable and not
     * be — the same reasoning that keeps `imageUrl` off this event entirely.
     *
     * Never `false`; absent when the config fit. As everywhere else in this
     * schema, absence is what a query filters on, not a boolean value.
     */
    styleConfigOmitted?: true;
    /** How the puzzle started. See the note above on excluding `'repro'`. */
    source: 'fresh' | 'shared' | 'repro';
}

/**
 * Data attached to `share-failed` — the share flow fell through to its error
 * path (clipboard write failed, or no share mechanism was available) and the
 * user saw a "Couldn't share" toast. User cancellation of the native share
 * sheet (`AbortError`) is NOT a failure and is never tracked. `source` mirrors
 * `puzzle-shared`: the info-modal share section or the completion overlay.
 */
export interface ShareFailedData {
    source: 'info-modal' | 'completion-overlay';
    reason: string;
}

/**
 * Data attached to `save-failed` — a `localStorage` write failed even after
 * the lz-string compression fallback (typically quota exhaustion).
 *
 * On `main` this surfaced incidentally as an `unhandled-error`; the persistence
 * layer now catches it, so this is the explicit replacement signal.
 *
 * `op` distinguishes the per-move progress write from the one-time new-puzzle
 * (geometry) write, so an operator can tell whether a save failed at creation
 * (nothing persisted) or mid-play (only the latest moves were dropped).
 *
 * `cutStyle`/`pieceCount`/`traceSetVersion` match its `save-compressed` and
 * `progress-save-skipped` siblings, so a failure can be attributed to the
 * geometry regime that caused it instead of arriving as an unattributable
 * count. `cutStyle: 'classic'` alone no longer identifies a regime — it spans
 * both the light legacy straight-grid geometry and the ~14×-larger sine
 * geometry — so `traceSetVersion` presence is what separates them.
 */
export interface SaveFailedData {
    op: 'progress' | 'new-puzzle';
    cutStyle: string;
    pieceCount: number;
    /** See {@link NewGameData.traceSetVersion} — same derivation, from the saved state. */
    traceSetVersion?: number;
}

/**
 * Data attached to `save-compressed` — a write exceeded the plain-write quota
 * and fell back to the lz-string-compressed payload. Emitted once per created
 * puzzle, so an operator can see a puzzle crossing into the near-quota regime
 * (one growth step from total failure) before it tips into `save-failed`.
 *
 * Scope is the whole one-time new-puzzle save, not the geometry write alone:
 * `saveNewPuzzle` writes geometry and the initial progress and reports the
 * worse of the two, so an initial *progress* write that compressed produces
 * the same event. Geometry dominates the payload by orders of magnitude, so in
 * practice this reads as a geometry signal — but unlike its `save-failed`
 * sibling there is no `op` dimension to prove it, and adding one means
 * widening `saveNewPuzzle`'s return type to report per-key outcomes.
 */
export interface SaveCompressedData {
    cutStyle: string;
    pieceCount: number;
    /** See {@link SaveFailedData.traceSetVersion} — separates the two Classic regimes. */
    traceSetVersion?: number;
}

/**
 * Data attached to `save-unreadable` — a saved game was present but could not
 * be restored, so the player was offered the recovery dialog instead of having
 * their puzzle silently regenerated over.
 *
 * `reason` distinguishes the failure class (the persistence layer already
 * separates these internally): a parse/deserialize failure, a geometry/progress
 * seed mismatch, or a torn write with no usable progress. Low cardinality, so
 * it groups cleanly in the dashboard.
 */
export interface SaveUnreadableData {
    reason: 'parse-error' | 'seed-mismatch' | 'torn-write';
}

/**
 * Data attached to `progress-save-skipped` — a debounced progress autosave was
 * refused because the recorded owner of the save slot is a different puzzle
 * than the one being saved (see `saveProgress`). `cutStyle`/`pieceCount`
 * describe the puzzle whose progress was dropped.
 *
 * **Not a synonym for "cross-tab takeover".** It counts three distinct causes,
 * and the takeover may well be the smallest:
 *
 * 1. **The cross-tab race** (#404) — another tab started a puzzle over this
 *    one. This is what the guard was built for, and what previously produced a
 *    torn save and a false "corrupt" dialog. Every later autosave of this
 *    tab's puzzle mismatches too, so it shows up as a *run*.
 * 2. **A new puzzle too large to store.** When `saveNewPuzzle`'s geometry
 *    write fails on quota (the #487/#399 large-save regime), the *previous*
 *    puzzle's geometry stays in the slot and the token correctly still names
 *    it — so every autosave of the new puzzle mismatches and skips, for the
 *    rest of the session, with no second tab involved at all. Note this
 *    produces exactly the shape a sustained takeover would: a long run of this
 *    event from one user.
 * 3. **A debounced save that straddled a new game.** A progress save queued
 *    for the outgoing puzzle can still be pending when the new puzzle's
 *    geometry (and token) replace it, and nothing cancels it — `SaveCoordinator`
 *    never calls `cancel()`. The flush then names the old puzzle against the
 *    new slot and skips. Starting a new game *while a multi-select selection is
 *    active* hits this every time rather than on a race: `GameSession.install`
 *    clears the selection before assigning the new state, so bootstrap's
 *    selection listener autosaves the state that is still current — the
 *    outgoing one. Single tab, no quota, and exactly **one** event per new
 *    game: the next autosave carries the new state, which matches. The skip
 *    is correct — that progress had already been superseded. Pre-existing and
 *    deliberately not changed here; tracked as #514.
 *
 * Discriminating them is per-session inspection, not arithmetic on the totals.
 * `save-failed` with `op: 'new-puzzle'` is the useful marker but it neither
 * counts nor filters: cause 2 emits *one* of it ahead of a run of *many*
 * skips, so the two counts are at different granularities and differencing
 * them is meaningless; and `op: 'new-puzzle'` also fires when the geometry
 * write succeeded and only the initial *progress* write hit quota
 * (`saveNewPuzzle` reports the worse of the two), which produces no skipped
 * run at all. Absence is not filterable here either (see
 * {@link NewGameFailedData}). So read sessions: a `save-failed{op:'new-puzzle'}`
 * followed by a long run is cause 2; a long run with no `save-failed` is
 * cause 1; an isolated event around a new game is cause 3.
 *
 * Since #490 the comparison reads the derived `puzzle-geometry-seed` token
 * instead of decoding the geometry blob. That does not add a cause: every path
 * the app can take keeps the token equal to the seed of the blob in the slot —
 * it is re-anchored on load, dropped on a foreign geometry write and on a
 * bfcache restore, and left alone on a failed geometry write (which is what
 * makes cause 2 a correct skip rather than a bug). A token written by foreign
 * same-origin script is the one thing that could make it lie, and no dimension
 * separates that case.
 */
export interface ProgressSaveSkippedData {
    cutStyle: string;
    pieceCount: number;
    /** See {@link SaveFailedData.traceSetVersion} — separates the two Classic regimes. */
    traceSetVersion?: number;
}

/**
 * Data attached to `save-recovery` — emitted once when the player closes the
 * unreadable-save dialog. `downloaded` records whether they took a copy of the
 * raw data before starting over, so an operator can tell whether the recovery
 * affordance is actually used.
 */
export interface SaveRecoveryData {
    downloaded: boolean;
}

/**
 * Data attached to `pwa-update-detected` — a freshly-built service worker is
 * waiting and the persistent "update ready" indicator was shown. This is the
 * funnel denominator: every applied/fallback/failed event below should trace
 * back to one of these. The gap between detected and applied is the
 * stuck-indicator field signal.
 */
export type PwaUpdateDetectedData = Record<string, never>;

/**
 * Data attached to `pwa-update-check-failed` — a background update *check*
 * (`registration.update()` on a visibility regain) rejected. This is distinct
 * from `pwa-update-apply-failed`: nothing was being applied, the check itself
 * failed (typically offline or a server error), and it self-heals on the next
 * visibility change. It labels the check-failure leg of the funnel
 * (`pwa-update-detected` → check failures → `pwa-update-applied` /
 * `pwa-update-apply-failed`) that would otherwise only surface as a generic
 * `unhandled-error`.
 *
 * Checks fire on every visibility regain, so an offline session would reject on
 * every return to the tab. To avoid flooding, each distinct sanitized `reason`
 * is reported at most once per session and the number of distinct reasons is
 * capped (see `setupUpdateChecks`). `reason` is the sanitized rejection
 * message.
 */
export interface PwaUpdateCheckFailedData {
    reason: string;
}

/**
 * Data attached to `pwa-update-applied` — a deferred service-worker update was
 * applied (the page committed to reloading into the new version).
 *
 * `trigger` records what caused the apply, so an operator can see the split
 * between the three safe-moment paths:
 * - `focus-regain` — auto-applied when the app became visible again with an
 *   update pending.
 * - `manual` — the user tapped the persistent indicator.
 * - `share-link-rescue` — an undecodable `#p=` link forced an update check
 *   that found a newer build; applied automatically so the reload can
 *   re-parse the link.
 * This is the numerator against `pwa-update-detected` — the gap between the two
 * is the stuck-indicator signal (detected but never applied).
 *
 * The pwa update-controller derives its `UpdateApplyTrigger` union from this
 * payload, so the set of triggers has a single source of truth here.
 */
export interface PwaUpdateAppliedData {
    trigger: 'focus-regain' | 'manual' | 'share-link-rescue';
}

/**
 * Data attached to `pwa-update-fallback-reload` — the service-worker-driven
 * reload did not navigate the page away in time, so the fallback hard reload
 * fired (the #404 shared-origin case, where the new worker was already
 * activated by another tab so skip-waiting is a no-op and no `controlling`
 * event arrives). Tells an operator whether this fallback path is actually
 * load-bearing in the field.
 */
export type PwaUpdateFallbackReloadData = Record<string, never>;

/**
 * Data attached to `pwa-update-apply-failed` — `updateSW(true)` rejected while
 * trying to activate the waiting worker. The scheduled fallback reload still
 * covers recovery; this event makes a consistently-failing apply path visible
 * instead of silent. `reason` is the sanitized rejection message.
 */
export interface PwaUpdateApplyFailedData {
    reason: string;
}

/**
 * Data attached to `pwa-register-failed` — `registerSW`'s `onRegisterError`
 * fired: the service worker could not be registered at all (script 404,
 * security error, or the browser blocking registration). This is the
 * registration *precondition*, conceptually upstream of the
 * `pwa-update-detected` → applied funnel: when it fires there is no
 * registration, so no update checks run and the PWA update mechanism is dead
 * for the session. That makes it the most severe update-related failure — a
 * failed *check* (`pwa-update-check-failed`) self-heals on the next visibility
 * regain, whereas a failed registration does not recover until the next page
 * load.
 *
 * `registerSW` is called exactly once per page load, so `onRegisterError` fires
 * at most once; unlike `pwa-update-check-failed` this needs no per-reason dedup
 * or cardinality guard. `reason` is the sanitized rejection message.
 */
export interface PwaRegisterFailedData {
    reason: string;
}

/**
 * Data attached to `share-link-rescue-attempted` — a `#p=` share link failed
 * to decode, and since the payload format has historically grown without
 * bumping `v`, the client may simply be a stale cached build. The app ran the
 * rescue: one forced service-worker update check, guarded per link.
 *
 * `outcome` records how it ended: `updated` (a newer build was found and
 * applied — a reload with the hash intact is imminent, and the follow-up
 * `share-link-rescue-result` event on the next page load closes the funnel),
 * `no-update` (the check completed and this client is already current), or
 * `unavailable` (no service-worker registration, e.g. the dev server; the
 * check rejected while offline; or the deadline expired). The `no-update` /
 * `unavailable` legs fall straight through to the invalid-link toast.
 *
 * The pwa share-link-rescue module derives its `RescueOutcome` union from
 * this payload, so the set of outcomes has a single source of truth here
 * (same pattern as `PwaUpdateAppliedData` / `UpdateApplyTrigger`).
 */
export interface ShareLinkRescueAttemptedData {
    outcome: 'updated' | 'no-update' | 'unavailable';
}

/**
 * Data attached to `share-link-rescue-result` — the page load after a rescue
 * reload re-parsed the same link. `decoded` records whether the updated build
 * understood it (`true`) or it still fell through to the invalid-link toast
 * (`false`). Paired with `share-link-rescue-attempted` outcome `updated`,
 * this measures whether the rescue actually fixes links in the wild.
 */
export interface ShareLinkRescueResultData {
    decoded: boolean;
}

/**
 * Inject the Umami tracking script if a website ID is configured.
 *
 * Call exactly once, early in app startup, before any rendering.
 * Calling more than once would inject duplicate script tags.
 */
export function initAnalytics(): void {
    const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID as string | undefined;
    if (!websiteId) {
        return;
    }

    const scriptUrl =
        (import.meta.env.VITE_UMAMI_SCRIPT_URL as string | undefined) ||
        DEFAULT_SCRIPT_URL;

    const script = document.createElement('script');
    script.defer = true;
    script.src = scriptUrl;
    script.dataset.websiteId = websiteId;
    // Opt into Umami's tracker-side Core Web Vitals collection (LCP/INP/
    // CLS/FCP/TTFB). Without this attribute those native event columns
    // stay null. Collection happens in the browser and is reported
    // straight to Umami, so it's independent of the (Pro-gated) REST API.
    script.dataset.performance = 'true';
    document.head.appendChild(script);
}

/**
 * Send a typed analytics event.
 *
 * Drops the call silently in non-browser environments where there is
 * no `window` (server-side rendering, node-based unit tests) and when
 * `window.umami` is undefined (the script hasn't loaded, is blocked, or
 * analytics aren't configured for this build). Never throws.
 */
export function track(name: 'new-game-started', data: NewGameData): void;
export function track(name: 'puzzle-completed', data: PuzzleCompletedData): void;
export function track(name: 'puzzle-shared', data: PuzzleSharedData): void;
export function track(name: 'background-color-changed', data: BackgroundColorChangedData): void;
export function track(name: 'traced-chunk-preload-started', data: TracedChunkPreloadStartedData): void;
export function track(name: 'traced-chunk-loaded', data: TracedChunkLoadedData): void;
export function track(name: 'traced-chunk-load-failed', data: TracedChunkLoadFailedData): void;
export function track(name: 'unhandled-error', data: UnhandledErrorData): void;
export function track(name: 'shared-load-failed', data: SharedLoadFailedData): void;
export function track(name: 'image-fetch-failed', data: ImageFetchFailedData): void;
export function track(name: 'new-game-failed', data: NewGameFailedData): void;
export function track(name: 'piece-count-mismatch', data: PieceCountMismatchData): void;
export function track(name: 'share-failed', data: ShareFailedData): void;
export function track(name: 'save-failed', data: SaveFailedData): void;
export function track(name: 'save-compressed', data: SaveCompressedData): void;
export function track(name: 'save-unreadable', data: SaveUnreadableData): void;
export function track(name: 'save-recovery', data: SaveRecoveryData): void;
export function track(name: 'progress-save-skipped', data: ProgressSaveSkippedData): void;
export function track(name: 'pwa-update-detected', data: PwaUpdateDetectedData): void;
export function track(name: 'pwa-update-check-failed', data: PwaUpdateCheckFailedData): void;
export function track(name: 'pwa-update-applied', data: PwaUpdateAppliedData): void;
export function track(name: 'pwa-update-fallback-reload', data: PwaUpdateFallbackReloadData): void;
export function track(name: 'pwa-update-apply-failed', data: PwaUpdateApplyFailedData): void;
export function track(name: 'pwa-register-failed', data: PwaRegisterFailedData): void;
export function track(name: 'share-link-rescue-attempted', data: ShareLinkRescueAttemptedData): void;
export function track(name: 'share-link-rescue-result', data: ShareLinkRescueResultData): void;
export function track(name: string, data: object): void {
    if (typeof window === 'undefined') return;
    window.umami?.track(name, data as Record<string, unknown>);
}
