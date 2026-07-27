/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createBlankImageDataUrl } from './blank-canvas.js';

describe('createBlankImageDataUrl', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('honors the requested dimensions and fills the whole area', () => {
        // Geometry depends on the image's dimensions, so a blank canvas that
        // ignored the requested size would silently change the cut. Assert on the
        // exact calls to verify the width, height, fill, and area covered.

        const mockCanvas = {
            width: 0,
            height: 0,
            getContext: vi.fn().mockReturnValue({
                fillStyle: '',
                fillRect: vi.fn(),
            }),
            toDataURL: vi.fn().mockReturnValue('data:image/png;base64,test'),
        };

        vi.spyOn(document, 'createElement')
            .mockReturnValue(mockCanvas as unknown as HTMLCanvasElement);

        const size = { width: 13, height: 7 };
        const url = createBlankImageDataUrl(size);

        // Assert the helper uses the requested dimensions
        expect(mockCanvas.width).toBe(13);
        expect(mockCanvas.height).toBe(7);

        // Assert it requests a 2D context
        expect(mockCanvas.getContext).toHaveBeenCalledWith('2d');

        // Assert it sets white fill
        const ctx = mockCanvas.getContext('2d');
        expect(ctx.fillStyle).toBe('#ffffff');

        // Assert it fills the entire canvas area, not a subset
        expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 13, 7);

        // Assert it exports as PNG
        expect(mockCanvas.toDataURL).toHaveBeenCalledWith('image/png');

        // Assert the helper returns the canvas's data URL
        expect(url).toBe('data:image/png;base64,test');
    });
});
