#!/usr/bin/env python3
"""
JSON-to-JSON trace smoother.

For each *.json trace in --in, finds interior anchors that have a
neighbour (in path order) within --threshold normalized neck-frame
units, drops the entire flagged set in a single pass, then re-fits
the curve between each pair of surviving anchors using Schneider.
The two chord endpoints are always preserved.

Stretches between survivors that correspond to a single original
cubic are copied through unchanged; only collapsed clusters get
re-fit, so clean regions keep their existing geometry.

Landmarks (apex_y, head, neck) are recomputed from the new path.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import main as pipeline  # noqa: E402


def path_dicts_to_segs(path_dicts):
    """[{'x','y'}, ...] of length 3n+1 -> list of (p0,c1,c2,p3) tuples."""
    pts = [(p['x'], p['y']) for p in path_dicts]
    segs = []
    for i in range(0, len(pts) - 1, 3):
        segs.append((pts[i], pts[i + 1], pts[i + 2], pts[i + 3]))
    return segs


def segs_to_path_dicts(segs):
    """Inverse of path_dicts_to_segs."""
    out = [{'x': segs[0][0][0], 'y': segs[0][0][1]}]
    for seg in segs:
        out.append({'x': seg[1][0], 'y': seg[1][1]})
        out.append({'x': seg[2][0], 'y': seg[2][1]})
        out.append({'x': seg[3][0], 'y': seg[3][1]})
    return out


def flag_clustered_anchors(segs, threshold):
    """Return a list[bool] of length n_anchors (= len(segs)+1)."""
    anchors = [segs[0][0]] + [s[3] for s in segs]
    n = len(anchors)
    flagged = [False] * n
    for i in range(n - 1):
        d = math.hypot(anchors[i + 1][0] - anchors[i][0],
                       anchors[i + 1][1] - anchors[i][1])
        if d < threshold:
            flagged[i] = True
            flagged[i + 1] = True
    # Chord endpoints always survive.
    flagged[0] = False
    flagged[-1] = False
    return flagged


def _vnorm(v):
    n = math.hypot(v[0], v[1])
    return (v[0] / n, v[1] / n) if n > 0 else (0.0, 0.0)


def _bridge_single_cubic(segs, a, b):
    """
    Replace segs[a:b] (the collapsed cluster) with one cubic between
    anchors[a] and anchors[b], with tangents inherited from the
    *neighbour kept segments* segs[a-1] (forward) and segs[b]
    (backward). That gives C1 continuity at both ends by construction,
    without using the noisy cluster's own controls.

    Control-point magnitudes use 1/3 of the bridge's chord length, the
    standard cubic-Hermite default — short enough not to overshoot,
    long enough to round the bridge.
    """
    p0 = segs[a][0]
    p3 = segs[b - 1][3]

    # Forward tangent at p0.
    if a > 0:
        prev = segs[a - 1]
        t1 = _vnorm((prev[3][0] - prev[2][0], prev[3][1] - prev[2][1]))
    else:
        # No prior kept segment — fall back to the cluster's own forward
        # tangent at its very first anchor. (Only happens when the cluster
        # starts at anchor 0, which can't happen given we always keep the
        # chord endpoints, but guard anyway.)
        first = segs[a]
        t1 = _vnorm((first[1][0] - first[0][0], first[1][1] - first[0][1]))

    # Backward tangent at p3 (pointing back into the bridge).
    if b < len(segs):
        nxt = segs[b]
        t2 = _vnorm((nxt[0][0] - nxt[1][0], nxt[0][1] - nxt[1][1]))
    else:
        last = segs[b - 1]
        t2 = _vnorm((last[2][0] - last[3][0], last[2][1] - last[3][1]))

    chord = math.hypot(p3[0] - p0[0], p3[1] - p0[1])
    mag = chord / 3.0
    c1 = (p0[0] + t1[0] * mag, p0[1] + t1[1] * mag)
    c2 = (p3[0] + t2[0] * mag, p3[1] + t2[1] * mag)
    return (p0, c1, c2, p3)


def smooth_segs(segs, threshold):
    """Return (new_segs, n_dropped_anchors)."""
    flagged = flag_clustered_anchors(segs, threshold)
    n = len(flagged)
    kept = [i for i in range(n) if not flagged[i]]

    out_segs = []
    for a, b in zip(kept[:-1], kept[1:]):
        if b == a + 1:
            # No cluster between them — keep the original segment.
            out_segs.append(segs[a])
        else:
            # Collapsed cluster: bridge with a single cubic.
            out_segs.append(_bridge_single_cubic(segs, a, b))
    return out_segs, sum(1 for f in flagged if f)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--in', dest='in_dir', required=True,
                   type=Path, help='Directory of *.json traces to smooth.')
    p.add_argument('--threshold', type=float, default=0.045,
                   help='Cluster gap threshold in normalized neck-frame units.')
    p.add_argument('--refit-tol', type=float, default=0.02,
                   help='Schneider tolerance for refitting collapsed stretches '
                        '(fraction of chord length, same scale as the path).')
    p.add_argument('--ids', nargs='*',
                   help='Specific stems to process (default: all *.json).')
    p.add_argument('--dry-run', action='store_true',
                   help='Print summary without writing files.')
    args = p.parse_args()

    json_paths = sorted(args.in_dir.glob('*.json'))
    if args.ids:
        wanted = set(args.ids)
        json_paths = [j for j in json_paths if j.stem in wanted]

    for jp in json_paths:
        data = json.loads(jp.read_text())
        segs_in = path_dicts_to_segs(data['path'])

        # Iterate until no more anchors get flagged. With single-cubic
        # bridging, each pass collapses any new clusters into single
        # segments, so convergence is typically one or two passes.
        segs_out = segs_in
        n_dropped_total = 0
        for _ in range(20):
            new_segs, n_dropped = smooth_segs(segs_out, args.threshold)
            n_dropped_total += n_dropped
            segs_out = new_segs
            if n_dropped == 0:
                break
        n_in, n_out = len(segs_in), len(segs_out)

        new_path = segs_to_path_dicts(segs_out)
        flat_for_landmarks = [(p['x'], p['y']) for p in new_path]
        # Fail fast on the Python side: a partial / empty result would
        # serialise as `None` landmarks and then crash assertTracedTemplate
        # at TS module load. Catching it here gives a clear, immediate
        # error tied to the specific trace.
        shape = pipeline.analyze_tab_shape(flat_for_landmarks)
        required = (
            'apex_y',
            'head_y', 'head_width', 'head_center_x',
            'neck_y', 'neck_width', 'neck_center_x',
        )
        missing = [] if shape else list(required)
        if shape:
            missing = [k for k in required if shape.get(k) is None]
        if missing:
            raise SystemExit(
                f"{jp.stem}: analyze_tab_shape returned no value for "
                f"{missing} — refusing to write incomplete landmarks"
            )
        landmarks = {
            'apex_y': shape['apex_y'],
            'head': {
                'y': shape['head_y'],
                'width': shape['head_width'],
                'center_x': shape['head_center_x'],
            },
            'neck': {
                'y': shape['neck_y'],
                'width': shape['neck_width'],
                'center_x': shape['neck_center_x'],
            },
        }

        print(f"{jp.stem}: {n_in} -> {n_out} segs, "
              f"{n_dropped_total} anchor(s) removed total")

        if args.dry_run:
            continue
        data['path'] = new_path
        data['landmarks'] = landmarks
        jp.write_text(json.dumps(data, indent=2) + '\n')


if __name__ == '__main__':
    sys.exit(main())
