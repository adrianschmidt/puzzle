"""
Tests for the --clean-noise pre-processing step (issue #370).

`_keep_largest_silhouette` drops background-noise components from the
post-Otsu mask, keeping only the largest foreground (silhouette) blob.
The mask is potrace-oriented: silhouette is dark (0) on white (255).
"""

import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main  # noqa: E402

WHITE = 255
BLACK = 0


def _blank_mask(h: int = 100, w: int = 100) -> np.ndarray:
    """All-white background (no silhouette), potrace orientation."""
    return np.full((h, w), WHITE, dtype=np.uint8)


def test_drops_noise_keeps_largest_silhouette():
    mask = _blank_mask()
    mask[20:80, 20:80] = BLACK   # the silhouette (3600 px)
    mask[5:8, 5:8] = BLACK       # a disconnected noise speck (9 px)

    cleaned = main._keep_largest_silhouette(mask)

    # Noise speck removed (back to background white).
    assert (cleaned[5:8, 5:8] == WHITE).all()
    # Silhouette retained (still dark).
    assert (cleaned[20:80, 20:80] == BLACK).all()


def test_single_component_returned_unchanged():
    mask = _blank_mask()
    mask[20:80, 20:80] = BLACK

    cleaned = main._keep_largest_silhouette(mask)

    assert np.array_equal(cleaned, mask)


def test_all_background_returned_unchanged():
    mask = _blank_mask()  # no foreground at all

    cleaned = main._keep_largest_silhouette(mask)

    assert np.array_equal(cleaned, mask)


def test_keeps_only_the_biggest_of_several_blobs():
    mask = _blank_mask()
    mask[40:60, 40:90] = BLACK   # biggest blob (1000 px)
    mask[10:20, 10:20] = BLACK   # smaller blob (100 px)
    mask[80:85, 80:85] = BLACK   # smallest blob (25 px)

    cleaned = main._keep_largest_silhouette(mask)

    assert (cleaned[40:60, 40:90] == BLACK).all()   # biggest kept
    assert (cleaned[10:20, 10:20] == WHITE).all()   # others dropped
    assert (cleaned[80:85, 80:85] == WHITE).all()


def test_clean_noise_flag_registered_in_cli():
    """The CLI exposes --clean-noise (issue #370 DoD)."""
    result = subprocess.run(
        [sys.executable, str(Path(__file__).resolve().parents[1] / "main.py"), "--help"],
        capture_output=True,
        text=True,
    )
    assert "--clean-noise" in result.stdout


# A noise blob big enough to survive the 5x5 morphological open that runs
# after the (optional) cleanup, so its presence in the written mask actually
# distinguishes flag-on from flag-off. Its core stays solid through open/close.
_NOISE = (slice(2, 14), slice(2, 14))      # 12x12 blob, core well inside
_NOISE_CORE = (slice(6, 10), slice(6, 10))
_SILHOUETTE_CORE = (slice(40, 60), slice(40, 60))  # deep interior, morph-safe


def _noisy_grayscale(h: int = 100, w: int = 100) -> np.ndarray:
    """A grayscale photo whose Otsu mask has a big blob plus a noise blob."""
    img = np.full((h, w), WHITE, dtype=np.uint8)  # light background
    img[20:80, 20:80] = BLACK   # dark silhouette (largest component)
    img[_NOISE] = BLACK         # disconnected dark noise blob (smaller)
    return img


def _stub_potrace_io(monkeypatch):
    """
    Neutralize run_potrace's I/O so it can run without a potrace binary:
    cv2.imread returns a synthetic noisy photo, cv2.imwrite records the
    written mask, and subprocess.run is a no-op. Returns the list that
    captures each written mask.
    """
    written = []
    monkeypatch.setattr(main.cv2, "imread", lambda *a, **k: _noisy_grayscale())
    monkeypatch.setattr(
        main.cv2, "imwrite", lambda path, img: written.append(img.copy()) or True
    )
    monkeypatch.setattr(main.subprocess, "run", lambda *a, **k: None)
    return written


def _spy_keep_largest(monkeypatch):
    """
    Wrap _keep_largest_silhouette so the real cleanup still runs but each
    invocation is recorded. Returns the list of masks the helper was called
    with (empty when the flag never triggers it).
    """
    calls = []
    real = main._keep_largest_silhouette
    monkeypatch.setattr(
        main, "_keep_largest_silhouette",
        lambda m: calls.append(m) or real(m),
    )
    return calls


def test_run_potrace_off_leaves_mask_untouched(monkeypatch, tmp_path):
    """With the flag off, _keep_largest_silhouette is never invoked."""
    written = _stub_potrace_io(monkeypatch)
    calls = _spy_keep_largest(monkeypatch)

    main.run_potrace(tmp_path / "in.png", tmp_path / "out.svg", tmp_path)

    assert calls == []                       # helper not called when OFF
    assert len(written) == 1                  # exactly one mask written
    # The noise blob survives into the written (pre-Potrace) mask.
    assert (written[-1][_NOISE_CORE] == BLACK).all()


def test_run_potrace_on_invokes_helper_and_drops_noise(monkeypatch, tmp_path):
    """With the flag on, the helper runs and the noise speck is removed."""
    written = _stub_potrace_io(monkeypatch)
    calls = _spy_keep_largest(monkeypatch)

    main.run_potrace(tmp_path / "in.png", tmp_path / "out.svg", tmp_path,
                     clean_noise=True)

    assert len(calls) == 1                   # helper called exactly once when ON
    assert len(written) == 1                  # exactly one mask written
    # The noise blob is gone from the written (pre-Potrace) mask.
    assert (written[-1][_NOISE_CORE] == WHITE).all()
    # The silhouette is retained.
    assert (written[-1][_SILHOUETTE_CORE] == BLACK).all()


def test_run_potrace_on_reports_component_count(monkeypatch, tmp_path, capsys):
    """The opted-in cleanup prints how many components it saw."""
    _stub_potrace_io(monkeypatch)

    main.run_potrace(tmp_path / "in.png", tmp_path / "out.svg", tmp_path,
                     clean_noise=True)

    out = capsys.readouterr().out
    assert "clean-noise: kept 1 of 2 foreground components, dropped 1" in out


def test_run_potrace_off_is_silent_about_cleanup(monkeypatch, tmp_path, capsys):
    """OFF must not print the cleanup line (keeps OFF behavior unchanged)."""
    _stub_potrace_io(monkeypatch)

    main.run_potrace(tmp_path / "in.png", tmp_path / "out.svg", tmp_path)

    assert "clean-noise" not in capsys.readouterr().out
