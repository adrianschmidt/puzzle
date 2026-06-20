import { describe, it, expect, vi } from 'vitest';
import {
    createSwErrorReporter,
    SW_ERROR_MESSAGE_TYPE,
    type SwErrorReport,
} from './sw-error-reporter.js';

function makeReporter() {
    const post = vi.fn<(report: SwErrorReport) => void>();
    return { post, reporter: createSwErrorReporter({ post }) };
}

describe('createSwErrorReporter', () => {
    it('posts an error with the sw-error source, name and reason', () => {
        const { post, reporter } = makeReporter();

        reporter.report('sw-error', new TypeError('boom in the worker'));

        expect(post).toHaveBeenCalledWith({
            type: SW_ERROR_MESSAGE_TYPE,
            source: 'sw-error',
            name: 'TypeError',
            reason: 'boom in the worker',
        });
    });

    it('posts a rejection with the sw-rejection source', () => {
        const { post, reporter } = makeReporter();

        reporter.report('sw-rejection', new RangeError('rejected in the worker'));

        expect(post).toHaveBeenCalledWith({
            type: SW_ERROR_MESSAGE_TYPE,
            source: 'sw-rejection',
            name: 'RangeError',
            reason: 'rejected in the worker',
        });
    });

    it('uses name "unknown" for a non-Error value', () => {
        const { post, reporter } = makeReporter();

        reporter.report('sw-rejection', 'a bare string rejection');

        expect(post).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'unknown', reason: 'a bare string rejection' }),
        );
    });

    it('sanitizes the reason (redacts URLs) before posting', () => {
        const { post, reporter } = makeReporter();

        reporter.report('sw-error', new Error('Failed to fetch https://cdn.example/chunk-abc.js'));

        expect(post).toHaveBeenCalledWith(
            expect.objectContaining({ reason: 'Failed to fetch <url>' }),
        );
    });

    it('reports each distinct reason at most 5 times per session', () => {
        const { post, reporter } = makeReporter();

        for (let i = 0; i < 8; i++) {
            reporter.report('sw-error', new Error('looping boom'));
        }

        const reported = post.mock.calls.filter(
            ([report]) => report.reason === 'looping boom',
        );
        expect(reported).toHaveLength(5);
        // Per-reason dedup must NOT emit a cap notice — that's reserved for
        // the global cap — so 5 reports is the only thing posted.
        expect(post).toHaveBeenCalledTimes(5);
    });

    it('caps total reports per session and posts one RateLimited notice', () => {
        const { post, reporter } = makeReporter();

        for (let i = 0; i < 60; i++) {
            reporter.report('sw-error', new Error(`distinct error ${i}`));
        }

        // 50 genuine reports + a single cap notice.
        expect(post).toHaveBeenCalledTimes(51);
        expect(post.mock.calls.at(-1)![0]).toMatchObject({ name: 'RateLimited' });
    });
});
