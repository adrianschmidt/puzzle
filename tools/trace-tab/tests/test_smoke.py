"""Smoke test for the trace-tab CLI.

Not part of CI (no Python runner in this repo). Run manually:

    python -m pytest tools/trace-tab/tests/

Requires the spike screenshot to be reachable. Either fetch it from the
spike/tab-tracing branch first, or skip the test if the photo is missing.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
CLI = REPO_ROOT / 'tools' / 'trace-tab' / 'main.py'
PHOTO = Path('/tmp/screenshot.png')  # Fetched manually; see README.


@pytest.mark.skipif(not PHOTO.exists(), reason=f'fetch {PHOTO} from spike/tab-tracing first')
def test_screenshot_roundtrip(tmp_path):
    out = tmp_path / 'traces'
    out.mkdir()
    subprocess.run(
        [sys.executable, str(CLI), str(PHOTO),
         '--id', 'smoke-test',
         '--out', str(out)],
        check=True,
    )
    json_path = out / 'smoke-test.json'
    assert json_path.exists()
    data = json.loads(json_path.read_text())
    # Schneider refit at 1% chord on the screenshot consistently lands
    # in this range across the spike's runs.
    n_segments = (len(data['path']) - 1) // 3
    assert 5 <= n_segments <= 20, f'expected 5–20 cubic segments, got {n_segments}'
    # Landmarks sane.
    assert 0 < data['landmarks']['neck']['y'] < data['landmarks']['head']['y'] < 1
