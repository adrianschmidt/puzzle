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

    it('is silent when window.umami is undefined', () => {
        expect(() => {
            track('puzzle-shared', {
                source: 'completion-overlay',
                includesProgress: false,
            });
        }).not.toThrow();
    });

    it('forwards traced-chunk-loaded with the typed payload', () => {
        const umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = {
            track: umamiTrack,
        };

        track('traced-chunk-loaded', { durationMs: 42 });

        expect(umamiTrack).toHaveBeenCalledWith('traced-chunk-loaded', { durationMs: 42 });
    });

    it('forwards traced-chunk-load-failed with the typed payload', () => {
        const umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = {
            track: umamiTrack,
        };

        track('traced-chunk-load-failed', { reason: 'network' });

        expect(umamiTrack).toHaveBeenCalledWith('traced-chunk-load-failed', { reason: 'network' });
    });
});
