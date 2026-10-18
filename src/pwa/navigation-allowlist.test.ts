import { describe, it, expect } from 'vitest';
import { appNavigationAllowlist } from './navigation-allowlist.js';

// Workbox's NavigationRoute tests its allowlist against `pathname + search`.
describe('appNavigationAllowlist', () => {
    describe('production at /', () => {
        const allowlist = appNavigationAllowlist('/');

        it.each(['/', '/?receive-move', '/?userid=adrian', '/?receive-move&x=/y'])(
            'serves the app for %s',
            (path) => {
                expect(allowlist.test(path)).toBe(true);
            },
        );

        it.each(['/dev', '/dev/', '/dev?userid=adrian', '/dev/?receive-move', '/dev/assets/index.js'])(
            'leaves the sibling deployment at %s to the network',
            (path) => {
                expect(allowlist.test(path)).toBe(false);
            },
        );
    });

    describe('preview at /dev/', () => {
        const allowlist = appNavigationAllowlist('/dev/');

        it.each(['/dev/', '/dev/?receive-move'])('serves the app for %s', (path) => {
            expect(allowlist.test(path)).toBe(true);
        });
    });

    it('treats regex metacharacters in the base literally', () => {
        const allowlist = appNavigationAllowlist('/a.b/');
        expect(allowlist.test('/a.b/')).toBe(true);
        expect(allowlist.test('/axb/')).toBe(false);
    });
});
