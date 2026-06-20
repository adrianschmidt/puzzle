/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initAnalytics, track } from './umami.js';

describe('initAnalytics', () => {
    beforeEach(() => {
        document.head.replaceChildren();
        vi.unstubAllEnvs();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('does nothing when VITE_UMAMI_WEBSITE_ID is unset', () => {
        vi.stubEnv('VITE_UMAMI_WEBSITE_ID', '');

        initAnalytics();

        expect(document.head.querySelectorAll('script').length).toBe(0);
    });

    it('injects the Umami script with website id and default URL when env var is set', () => {
        vi.stubEnv('VITE_UMAMI_WEBSITE_ID', 'abc-123');
        vi.stubEnv('VITE_UMAMI_SCRIPT_URL', '');

        initAnalytics();

        const scripts = document.head.querySelectorAll('script');
        expect(scripts.length).toBe(1);
        expect(scripts[0].src).toBe('https://cloud.umami.is/script.js');
        expect(scripts[0].dataset.websiteId).toBe('abc-123');
        expect(scripts[0].defer).toBe(true);
    });

    it('honours VITE_UMAMI_SCRIPT_URL override when provided', () => {
        vi.stubEnv('VITE_UMAMI_WEBSITE_ID', 'abc-123');
        vi.stubEnv('VITE_UMAMI_SCRIPT_URL', 'https://my-proxy.example/script.js');

        initAnalytics();

        const script = document.head.querySelector('script')!;
        expect(script.src).toBe('https://my-proxy.example/script.js');
    });
});

describe('track', () => {
    beforeEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
    });

    it('calls window.umami.track with name and data when umami is defined', () => {
        const umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = {
            track: umamiTrack,
        };

        track('new-game-started', {
            source: 'fresh',
            cutStyle: 'classic',
            rotationMode: 'none',
            cols: 8,
            rows: 6,
            pieceCount: 48,
            imageSource: 'unsplash',
        });

        expect(umamiTrack).toHaveBeenCalledOnce();
        expect(umamiTrack).toHaveBeenCalledWith('new-game-started', {
            source: 'fresh',
            cutStyle: 'classic',
            rotationMode: 'none',
            cols: 8,
            rows: 6,
            pieceCount: 48,
            imageSource: 'unsplash',
        });
    });

    it('forwards a Wavy traceSetVersion on new-game-started', () => {
        const umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = {
            track: umamiTrack,
        };

        track('new-game-started', {
            source: 'fresh',
            cutStyle: 'wavy',
            traceSetVersion: 1,
            rotationMode: 'none',
            cols: 8,
            rows: 6,
            pieceCount: 48,
        });

        expect(umamiTrack).toHaveBeenCalledWith('new-game-started', {
            source: 'fresh',
            cutStyle: 'wavy',
            traceSetVersion: 1,
            rotationMode: 'none',
            cols: 8,
            rows: 6,
            pieceCount: 48,
        });
    });

    it('is silent when window.umami is undefined', () => {
        expect(() => {
            track('puzzle-shared', {
                source: 'completion-overlay',
                includesProgress: false,
            });
        }).not.toThrow();
    });

    it('forwards traced-chunk-preload-started with the typed payload', () => {
        const umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = {
            track: umamiTrack,
        };

        track('traced-chunk-preload-started', { attempt: 1 });

        expect(umamiTrack).toHaveBeenCalledWith('traced-chunk-preload-started', { attempt: 1 });
    });

    it('forwards traced-chunk-loaded with the typed payload', () => {
        const umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = {
            track: umamiTrack,
        };

        track('traced-chunk-loaded', { durationMs: 42, cacheState: 'warm', attempt: 1 });

        expect(umamiTrack).toHaveBeenCalledWith('traced-chunk-loaded', {
            durationMs: 42,
            cacheState: 'warm',
            attempt: 1,
        });
    });

    it('forwards traced-chunk-load-failed with the typed payload', () => {
        const umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = {
            track: umamiTrack,
        };

        track('traced-chunk-load-failed', { reason: 'offline', kind: 'network', attempt: 2 });

        expect(umamiTrack).toHaveBeenCalledWith('traced-chunk-load-failed', {
            reason: 'offline',
            kind: 'network',
            attempt: 2,
        });
    });

    it('forwards unhandled-error with the typed payload', () => {
        const umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = {
            track: umamiTrack,
        };

        track('unhandled-error', { source: 'rejection', name: 'Error', reason: 'boom' });

        expect(umamiTrack).toHaveBeenCalledWith('unhandled-error', {
            source: 'rejection',
            name: 'Error',
            reason: 'boom',
        });
    });

    it('forwards shared-load-failed with the typed payload', () => {
        const umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };

        track('shared-load-failed', { reason: 'topology unsupported' });

        expect(umamiTrack).toHaveBeenCalledWith('shared-load-failed', { reason: 'topology unsupported' });
    });

    it('forwards image-fetch-failed with the typed payload', () => {
        const umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };

        track('image-fetch-failed', { reason: 'network down' });

        expect(umamiTrack).toHaveBeenCalledWith('image-fetch-failed', { reason: 'network down' });
    });

    it('forwards new-game-failed with the typed payload', () => {
        const umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };

        track('new-game-failed', { reason: 'chunk load failed' });

        expect(umamiTrack).toHaveBeenCalledWith('new-game-failed', { reason: 'chunk load failed' });
    });

    it('forwards share-failed with source and reason', () => {
        const umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };

        track('share-failed', { source: 'completion-overlay', reason: 'No share mechanism available' });

        expect(umamiTrack).toHaveBeenCalledWith('share-failed', {
            source: 'completion-overlay',
            reason: 'No share mechanism available',
        });
    });
});
