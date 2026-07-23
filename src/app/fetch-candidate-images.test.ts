/**
 * Tests for the candidate-image fetch wrapper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../images/index.js', () => ({ fetchRandomImages: vi.fn() }));

import { fetchRandomImages } from '../images/index.js';
import { fetchCandidateImages, CANDIDATE_IMAGE_COUNT } from './fetch-candidate-images.js';

function makeResult(n: number) {
    return {
        imageUrl: `https://images.unsplash.com/photo-${n}?w=1080`,
        thumbUrl: `https://images.unsplash.com/photo-${n}?w=400`,
        width: 4000,
        height: 2667,
        photographerName: `Photographer ${n}`,
        photographerUrl: `https://unsplash.com/@p${n}`,
        photoUrl: `https://unsplash.com/photos/${n}`,
        downloadLocation: `https://api.unsplash.com/photos/${n}/download`,
        description: `photo ${n}`,
    };
}

describe('fetchCandidateImages', () => {
    beforeEach(() => {
        vi.mocked(fetchRandomImages).mockReset();
    });

    it('maps results into candidates with 1080-scaled display size', async () => {
        vi.mocked(fetchRandomImages).mockResolvedValue([makeResult(1), makeResult(2)]);

        const candidates = await fetchCandidateImages('key', 'nature', false, 'landscape');

        expect(candidates).toHaveLength(2);
        expect(candidates![0]).toEqual({
            imageUrl: 'https://images.unsplash.com/photo-1?w=1080',
            thumbUrl: 'https://images.unsplash.com/photo-1?w=400',
            imageSize: { width: 1080, height: Math.round(1080 * (2667 / 4000)) },
            attribution: {
                photographerName: 'Photographer 1',
                photographerUrl: 'https://unsplash.com/@p1',
                photoUrl: 'https://unsplash.com/photos/1',
            },
            downloadLocation: 'https://api.unsplash.com/photos/1/download',
            description: 'photo 1',
        });
    });

    it('passes the category query, count, and orientation through', async () => {
        vi.mocked(fetchRandomImages).mockResolvedValue([makeResult(1)]);

        await fetchCandidateImages('key', 'nature', true, 'portrait');

        expect(fetchRandomImages).toHaveBeenCalledWith(
            'key',
            CANDIDATE_IMAGE_COUNT,
            fetch,
            'nature landscape vibrant colorful',
            'portrait',
        );
    });

    it('returns null when the fetch yields nothing', async () => {
        vi.mocked(fetchRandomImages).mockResolvedValue(undefined);

        expect(await fetchCandidateImages('key', 'any', false, 'landscape')).toBeNull();
    });

    it('returns null when the fetch returns an empty array', async () => {
        vi.mocked(fetchRandomImages).mockResolvedValue([]);

        expect(await fetchCandidateImages('key', 'any', false, 'landscape')).toBeNull();
    });

    it('returns null and warns when the fetch throws', async () => {
        vi.mocked(fetchRandomImages).mockRejectedValue(new Error('network down'));

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await fetchCandidateImages('key', 'any', false, 'landscape')).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});
