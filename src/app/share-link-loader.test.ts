/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

vi.mock('../ui/toast.js', () => ({ showToast: vi.fn() }));

import { showToast } from '../ui/toast.js';
import { encodePayload, type SharePayload } from '../sharing/index.js';
import {
    wasRescueAttempted,
    recordRescueAttempt,
    type RescueOutcome,
} from '../pwa/share-link-rescue.js';
import { loadState, saveNewPuzzle } from '../persistence/index.js';
import { makeSavedGameState } from '../test-helpers/fixtures.js';
import { createShareLinkLoader } from './share-link-loader.js';

/**
 * Minimal payload that satisfies the share codec, matching the base literal
 * used across `src/sharing/share-link.test.ts`. Encoded fresh per call so
 * each test that needs a real decodable `#p=` link gets its own hash body.
 */
function decodablePayload(): SharePayload {
    return { v: 1, i: 'x', is: [1, 1], g: [2, 2], c: 'classic', s: 42, r: 'none' };
}

describe('createShareLinkLoader', () => {
    let umamiTrack: ReturnType<typeof vi.fn>;
    let loadShared: Mock<(payload: SharePayload, recipientHadSavedState: boolean) => Promise<void>>;
    let attemptRescue: Mock<() => Promise<RescueOutcome>>;

    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
        loadShared = vi.fn(async () => {});
        attemptRescue = vi.fn(async () => 'no-update' as const);
        history.replaceState(null, '', '/');
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
        vi.mocked(showToast).mockClear();
        vi.restoreAllMocks();
        // The loading overlay is real DOM, not mocked; strip any leftover
        // between tests so a prior test's overlay can't be mistaken for this
        // one's.
        document.querySelectorAll('.loading-overlay').forEach((el) => el.remove());
    });

    function make(confirmResult = true) {
        return createShareLinkLoader({
            loadShared,
            attemptRescue,
            confirm: () => confirmResult,
        });
    }

    it('reports not handled when there is no hash', async () => {
        expect(await make().tryLoad()).toBe(false);
        expect(loadShared).not.toHaveBeenCalled();
    });

    it('ignores a hash that is not a share link', async () => {
        history.replaceState(null, '', '/#something-else');
        expect(await make().tryLoad()).toBe(false);
        expect(attemptRescue).not.toHaveBeenCalled();
    });

    it('attempts one rescue for an undecodable share link', async () => {
        history.replaceState(null, '', '/#p=not-a-real-payload');
        await make().tryLoad();
        expect(attemptRescue).toHaveBeenCalledTimes(1);
        expect(umamiTrack).toHaveBeenCalledWith(
            'share-link-rescue-attempted',
            expect.objectContaining({ outcome: 'no-update' }),
        );
    });

    it('halts the boot flow when a rescue update is pending', async () => {
        // The update controller reloads the page; starting a puzzle underneath
        // it would flash and then be thrown away.
        history.replaceState(null, '', '/#p=not-a-real-payload');
        attemptRescue.mockResolvedValue('updated');
        const loader = make();

        expect(await loader.tryLoad()).toBe(true);
        expect(loader.isRescueReloadPending()).toBe(true);
    });

    it('toasts and strips the hash when no update fixes the link', async () => {
        history.replaceState(null, '', '/#p=not-a-real-payload');
        await make().tryLoad();
        expect(showToast).toHaveBeenCalledWith('Invalid share link');
        expect(window.location.hash).toBe('');
        // The hashchange listener has no `finally` backstop the way the boot
        // flow does, so the overlay put up for the rescue check must be torn
        // down explicitly by this path itself.
        expect(document.querySelector('.loading-overlay')).toBeNull();
    });

    it('does not retry the rescue for the same link after a reload', async () => {
        // The guard survives the reload; a second attempt would loop forever.
        // First pass: the rescue applies an update and a reload becomes
        // imminent — the guard is left in place, not cleared, for the
        // reload's own load to find.
        history.replaceState(null, '', '/#p=not-a-real-payload');
        attemptRescue.mockResolvedValueOnce('updated');
        expect(await make().tryLoad()).toBe(true);

        attemptRescue.mockClear();

        // Second pass simulates the reload landing on the same still-broken
        // link: the guard already names it, so no new rescue is attempted.
        const handled = await make().tryLoad();

        expect(handled).toBe(false);
        expect(attemptRescue).not.toHaveBeenCalled();
        expect(umamiTrack).toHaveBeenCalledWith(
            'share-link-rescue-result',
            expect.objectContaining({ decoded: false }),
        );
    });

    it('skips the rescue entirely when the guard cannot be persisted', async () => {
        // A guard that can't be verified as written would let a still-invalid
        // link reload forever if the rescue proceeded anyway.
        history.replaceState(null, '', '/#p=not-a-real-payload');
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('storage unavailable');
        });

        const handled = await make().tryLoad();

        setItemSpy.mockRestore();
        expect(handled).toBe(false);
        expect(attemptRescue).not.toHaveBeenCalled();
        // Falls through to the ordinary invalid-link handling instead.
        expect(showToast).toHaveBeenCalledWith('Invalid share link');
    });

    it('lets a newer link supersede the toast/strip decision after the rescue await', async () => {
        // A hashchange lands mid-rescue: a different, decodable link now sits
        // in the address bar. The stale invocation's rescue still resolves,
        // but it must not steal the toast/strip decision from the newer one.
        // This simulates the *state* a concurrent hashchange/tryLoad would
        // leave behind (hash mutated mid-await) rather than dispatching a
        // real `hashchange` and running a second `tryLoad()` concurrently —
        // `history.replaceState` deliberately doesn't fire that event.
        history.replaceState(null, '', '/#p=not-a-real-payload');
        attemptRescue.mockImplementation(async () => {
            history.replaceState(null, '', '/#p=superseded-elsewhere');
            return 'no-update';
        });

        const handled = await make().tryLoad();

        expect(handled).toBe(false);
        expect(showToast).not.toHaveBeenCalled();
        expect(window.location.hash).toBe('#p=superseded-elsewhere');
    });

    it('leaves the guard and overlay alone when a newer rescue supersedes this one', async () => {
        // A concurrent hashchange started its own rescue for a different,
        // still-undecodable link while this one was in flight. That newer
        // rescue's guard entry (and its loading overlay) must survive — this
        // stale invocation is no longer the one that owns either. As above,
        // this simulates the state a concurrent rescue would leave (guard
        // overwritten, hash mutated) rather than running a second `tryLoad()`
        // concurrently via a real dispatched `hashchange`.
        history.replaceState(null, '', '/#p=stale-link');
        attemptRescue.mockImplementation(async () => {
            history.replaceState(null, '', '/#p=newer-undecodable-link');
            recordRescueAttempt('newer-undecodable-link');
            return 'no-update';
        });

        const handled = await make().tryLoad();

        expect(handled).toBe(false);
        expect(wasRescueAttempted('newer-undecodable-link')).toBe(true);
        expect(document.querySelector('.loading-overlay')).not.toBeNull();
        expect(showToast).not.toHaveBeenCalled();
    });

    it('closes the rescue funnel when the updated build decodes the link', async () => {
        const payload = decodablePayload();
        const hashBody = encodePayload(payload);
        // Simulate the guard a pre-reload rescue attempt left behind for this
        // exact link — this load is the post-reload re-check.
        recordRescueAttempt(hashBody);
        history.replaceState(null, '', '/#p=' + hashBody);

        const handled = await make().tryLoad();

        expect(handled).toBe(true);
        expect(loadShared).toHaveBeenCalledWith(payload, false);
        expect(umamiTrack).toHaveBeenCalledWith(
            'share-link-rescue-result',
            expect.objectContaining({ decoded: true }),
        );
        // The guard is cleared once the link decodes, win or not.
        expect(wasRescueAttempted(hashBody)).toBe(false);
    });

    it('does not report a rescue-funnel result for an ordinary share-link load', async () => {
        // No prior recordRescueAttempt: this load is a plain, first-time
        // visit to a decodable link, not the back half of a rescue reload.
        // The `share-link-rescue-result` event must stay scoped to actual
        // rescues, or its funnel numerator silently inflates.
        const payload = decodablePayload();
        const hashBody = encodePayload(payload);
        history.replaceState(null, '', '/#p=' + hashBody);

        await make().tryLoad();

        expect(umamiTrack).not.toHaveBeenCalledWith(
            'share-link-rescue-result',
            expect.anything(),
        );
    });

    it('asks before discarding existing progress and honors a decline', async () => {
        const payload = decodablePayload();
        const hashBody = encodePayload(payload);
        saveNewPuzzle(makeSavedGameState());
        history.replaceState(null, '', '/#p=' + hashBody);

        const handled = await make(false).tryLoad();

        expect(handled).toBe(false);
        expect(loadShared).not.toHaveBeenCalled();
        // Declining leaves the hash in place so the user can reload to retry.
        expect(window.location.hash).toBe('#p=' + hashBody);
        // The existing save survives the decline.
        expect(loadState()).toBeDefined();
    });

    it('accepts discarding existing progress and loads the shared puzzle', async () => {
        const payload = decodablePayload();
        const hashBody = encodePayload(payload);
        saveNewPuzzle(makeSavedGameState());
        history.replaceState(null, '', '/#p=' + hashBody);
        // Production's `loadShared` is `loadSharedPuzzle`, which persists the
        // new puzzle itself (via `persistNewPuzzle`) once generation succeeds
        // — `share-link-loader.ts` no longer clears storage on its own, so
        // the stub has to model that side effect to exercise "replaced".
        loadShared.mockImplementation(async () => {
            saveNewPuzzle({ ...makeSavedGameState(), imageUrl: 'shared-puzzle.jpg' });
        });

        const handled = await make(true).tryLoad();

        expect(handled).toBe(true);
        // `recipientHadSavedState` — true here — feeds shared-load analytics,
        // so it has to be the real "had progress" reading, not a hardcoded
        // constant.
        expect(loadShared).toHaveBeenCalledWith(payload, true);
        // The previous save is gone, replaced by the shared puzzle's own —
        // not merely cleared: `loadShared`'s own persist is what did it.
        expect(loadState()?.imageUrl).toBe('shared-puzzle.jpg');
    });

    it('leaves the previous save intact when the shared load is cancelled', async () => {
        // The loading overlay's Cancel affordance (#489) makes `loadShared`
        // (real `loadSharedPuzzle`) resolve normally without ever calling
        // `persistNewPuzzle` — cancelling means "return to your current
        // puzzle", so its save must still be there afterwards. The default
        // `loadShared` stub (a no-op `async () => {}`) models exactly that:
        // it resolves without touching storage.
        const payload = decodablePayload();
        const hashBody = encodePayload(payload);
        saveNewPuzzle(makeSavedGameState());
        history.replaceState(null, '', '/#p=' + hashBody);

        const handled = await make(true).tryLoad();

        expect(handled).toBe(true);
        expect(loadState()?.imageUrl).toBe('test-image.jpg');
    });

    it('reports a generation failure and toasts, leaving the previous save intact', async () => {
        // A link can satisfy the schema and still trip the topology pipeline.
        const payload = decodablePayload();
        const hashBody = encodePayload(payload);
        saveNewPuzzle(makeSavedGameState());
        loadShared.mockRejectedValue(new Error('topology boom'));
        history.replaceState(null, '', '/#p=' + hashBody);

        const handled = await make().tryLoad();

        expect(handled).toBe(false);
        expect(showToast).toHaveBeenCalledWith("Couldn't load shared puzzle");
        expect(umamiTrack).toHaveBeenCalledWith(
            'shared-load-failed',
            expect.objectContaining({ source: 'shared' }),
        );
        // The hash is stripped before the load is attempted, regardless of
        // whether generation goes on to succeed.
        expect(window.location.hash).toBe('');
        // A throw never reaches `persistNewPuzzle`, so the previous save
        // survives — matching the previous puzzle still on screen.
        expect(loadState()?.imageUrl).toBe('test-image.jpg');
    });
});
