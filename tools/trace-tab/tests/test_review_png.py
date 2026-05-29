"""Regression test for the review-PNG overlay renderer.

Run manually (no Python runner in CI):

    python -m pytest tools/trace-tab/tests/test_review_png.py

Guards against the legend-only collapse from issue #369: on a narrow
portrait crop the 3-column legend is wider than the image, and tight-
cropping used to drop the photo entirely, leaving a ~448x60 legend strip
with nothing to eyeball. The renderer must keep the image in the saved
PNG, so the output height must stay close to the input height (the legend
only ever *adds* height below the image).
"""
import sys
from pathlib import Path

import cv2
import numpy as np

# Import the CLI module sitting one directory up.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main  # noqa: E402


def _make_narrow_photo(path: Path, w: int = 120, h: int = 220) -> None:
    """A tall, narrow crop — the aspect ratio that triggered #369."""
    img = np.full((h, w, 3), 30, dtype=np.uint8)            # dark background
    cv2.ellipse(img, (w // 2, h // 2), (w // 3, h // 3),     # light tab blob
                0, 0, 360, (235, 235, 235), -1)
    cv2.imwrite(str(path), img)


def test_review_png_keeps_image(tmp_path):
    photo = tmp_path / "narrow.png"
    _make_narrow_photo(photo)
    in_img = cv2.imread(str(photo))
    in_h, in_w = in_img.shape[:2]

    # One cubic segment is enough to exercise every overlay artist.
    seg = [(10.0, 200.0), (40.0, 40.0), (80.0, 40.0), (110.0, 200.0)]
    result = main.TraceResult(
        photo_path=photo,
        path=[],
        landmarks={},
        raw_tab_arc=[seg],
        refit_segs_image=[seg],
        neck_left=(10.0, 200.0),
        neck_right=(110.0, 200.0),
        refit_segment_count=1,
        potrace_segment_count=1,
    )

    out = tmp_path / "narrow-review.png"
    main.write_review_png(out, result)
    assert out.exists()

    out_img = cv2.imread(str(out))
    out_h, out_w = out_img.shape[:2]

    # The image must survive: the legend adds height below it, so the output
    # is at least as tall as the source (the bug collapsed it to ~60 px).
    assert out_h >= 0.9 * in_h, (
        f"review PNG collapsed: {out_w}x{out_h} for a {in_w}x{in_h} source "
        f"(issue #369 regression)"
    )
