"""
Tab-tracing CLI.

Given a cropped photo of a single puzzle tab (the silhouette must clip the
left and right image edges below the tab; the tab itself protrudes upward
into open background), produce:

  - <id>.json         normalized cubic-Bezier path + landmark metadata
  - <id>-review.png   overlay of the trace on top of the source photo

Pipeline:
  1. Load + greyscale + median blur + Otsu threshold + auto polarity detect
     + morphological open/close.
  2. Run Potrace on the cleaned binary image.
  3. Parse the resulting SVG into cubic-Bezier subpaths.
  4. Pick the largest subpath; detect the left/right neck endpoints as the
     topmost contour anchors on the image edges.
  5. Walk the closed contour between the necks along the side that bulges
     furthest from the neck chord; that arc is the tab.
  6. Normalize the tab arc into the (0,0)->(1,0) chord frame with +Y as
     protrusion.
  7. Refit with Schneider's algorithm to a small number of cubic segments.
  8. Compute head/neck/apex landmarks.

Use --help for the full flag set.
"""

import argparse
import datetime
import json
import math
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
import matplotlib.pyplot as plt


# ---------------------------------------------------------------------------
# Run potrace on the PNG. Potrace reads BMP, so convert first.
# Output: SVG with cubic Beziers.
# ---------------------------------------------------------------------------

def run_potrace(png_path, svg_out, work_dir, alphamax=1.0, opttolerance=0.2,
                clean_noise=False):
    bmp_path = Path(work_dir) / (png_path.stem + ".bmp")
    img = cv2.imread(str(png_path), cv2.IMREAD_GRAYSCALE)
    # Despeckle: median blur kills salt-and-pepper, morphological open/close
    # closes tiny holes/specks. Real photos need this too.
    img = cv2.medianBlur(img, 5)
    # Otsu's threshold picks the cutoff automatically from the histogram.
    # Better than a fixed 127 for real photos where glare/shadow at the
    # die-cut edges shifts the foreground/background brightness.
    _, img_bin = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Auto-detect polarity: potrace expects the silhouette to be dark. If
    # the background turned out darker than the foreground (i.e. we have
    # white-on-black input), invert before tracing so the rest of the
    # pipeline can stay polarity-agnostic.
    polarity = _detect_polarity(img_bin)
    if polarity == "white_on_black":
        img_bin = cv2.bitwise_not(img_bin)
    # Optionally drop background-noise blobs that Otsu mistakenly thresholded
    # as foreground, keeping only the largest silhouette component. Off by
    # default so existing photos re-trace bit-identically; turn on when a
    # noisy mask makes the trace fail (see #370 and the README).
    if clean_noise:
        img_bin = _keep_largest_silhouette(img_bin)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    img_bin = cv2.morphologyEx(img_bin, cv2.MORPH_OPEN, kernel)
    img_bin = cv2.morphologyEx(img_bin, cv2.MORPH_CLOSE, kernel)
    cv2.imwrite(str(bmp_path), img_bin)
    # potrace also has --turdsize for despeckling at the vector level
    subprocess.run(
        [
            "potrace", str(bmp_path),
            "-b", "svg",
            "-o", str(svg_out),
            "-a", str(alphamax),
            "-O", str(opttolerance),
            "-t", "100",  # ignore traced regions smaller than 100 px²
        ],
        check=True,
    )


def _detect_polarity(img):
    """
    Auto-detect: is the foreground (piece silhouette) dark or light?

    Heuristic: the background touches the image border, so the dominant
    border colour is the background. Whichever is foreground is the other.
    Returns "black_on_white" or "white_on_black".
    """
    border = np.concatenate([
        img[0, :], img[-1, :], img[:, 0], img[:, -1],
    ])
    border_mean = float(border.mean())
    return "black_on_white" if border_mean > 127 else "white_on_black"


def _keep_largest_silhouette(img_bin):
    """
    Drop background-noise components: keep only the largest foreground
    (silhouette) connected component, blanking everything else.

    `img_bin` is potrace-oriented — the silhouette is dark (0) on a white
    (255) background — so the silhouette is the *inverted* mask's
    foreground. Returns a mask in the same orientation. If there is no
    foreground at all, the input is returned unchanged.

    Otsu occasionally thresholds stray bright/dark patches in the photo
    background as extra foreground blobs; Potrace then traces them too,
    which can derail `find_edge_anchors`. See issue #370.

    Caveat: this keeps the single largest component by area, assuming the
    silhouette is that component. If the silhouette were ever split into
    two large blobs (e.g. by a glare strip), the smaller real fragment
    would be discarded along with the noise.
    """
    fg = cv2.bitwise_not(img_bin)  # silhouette -> 255 so it's the CC foreground
    n, labels, stats, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
    if n <= 1:
        print("clean-noise: no foreground found")
        return img_bin  # no foreground component to keep
    # Report what the opted-in cleanup saw (n - 1 excludes the background
    # label). Only reached behind --clean-noise, so this is silent by default.
    # Distinguish "dropped real noise" from "nothing to drop" so a single
    # foreground component doesn't read like filtering happened.
    print(f"clean-noise: kept 1 of {n - 1} foreground components, "
          f"dropped {n - 2}")
    # Label 0 is the background; pick the largest of the real components.
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    # Kept silhouette -> dark (0), everything else -> white (255), in one
    # pass (no separate mask + bitwise_not allocation).
    return np.where(labels == biggest, 0, 255).astype(np.uint8)


# ---------------------------------------------------------------------------
# Parse potrace SVG and extract cubic-Bezier control points.
# Potrace emits a path like:
#   M x y C cx1 cy1 cx2 cy2 x y C ... z
# We split it into anchor+control-point lists.
# Note: potrace flips Y (SVG coords are top-down) and may apply a scaling
# transform on the parent <g>. We resolve that by reading the <g transform>.
# ---------------------------------------------------------------------------

def parse_potrace_svg(svg_path):
    text = svg_path.read_text()

    # potrace wraps its path in <g transform="translate(...) scale(...)">.
    tm = re.search(r'<g\s+transform="translate\(([-\d.]+),([-\d.]+)\)\s+scale\(([-\d.]+),([-\d.]+)\)"', text)
    if not tm:
        raise RuntimeError("could not parse potrace <g> transform")
    tx, ty, sx, sy = map(float, tm.groups())

    pm = re.search(r'<path[^>]*\bd="([^"]+)"', text)
    if not pm:
        raise RuntimeError("could not find <path d=...>")
    d = pm.group(1)

    # Tokenise: split on whitespace and commas after inserting spaces around commands.
    d_norm = re.sub(r"([MmLlCcZz])", r" \1 ", d).replace(",", " ")
    tokens = d_norm.split()

    paths = []
    current = None
    cursor = (0.0, 0.0)

    def is_number(s):
        return bool(re.match(r"^-?[\d.]", s))

    i = 0
    cmd = None
    while i < len(tokens):
        t = tokens[i]
        if t in ("M", "m", "L", "l", "C", "c", "Z", "z"):
            cmd = t
            i += 1
            if cmd in ("Z", "z"):
                continue
        elif not is_number(t):
            i += 1
            continue
        # else: t is a number → implicit repeat of the previous command
        # (note: after M/m, repeated numbers are implicit L/l per SVG spec).

        if cmd in ("M", "m"):
            x = float(tokens[i]); y = float(tokens[i + 1]); i += 2
            if cmd == "m" and current is not None:
                x += cursor[0]; y += cursor[1]
            cursor = (x, y)
            current = [cursor]
            paths.append(current)
            # Subsequent implicit numbers become L/l per SVG spec.
            cmd = "L" if cmd == "M" else "l"
        elif cmd in ("L", "l"):
            x = float(tokens[i]); y = float(tokens[i + 1]); i += 2
            if cmd == "l":
                x += cursor[0]; y += cursor[1]
            p0 = cursor
            p3 = (x, y)
            c1 = (p0[0] + (p3[0] - p0[0]) / 3, p0[1] + (p3[1] - p0[1]) / 3)
            c2 = (p0[0] + 2 * (p3[0] - p0[0]) / 3, p0[1] + 2 * (p3[1] - p0[1]) / 3)
            current.extend([c1, c2, p3])
            cursor = p3
        elif cmd in ("C", "c"):
            c1x = float(tokens[i]); c1y = float(tokens[i + 1]); i += 2
            c2x = float(tokens[i]); c2y = float(tokens[i + 1]); i += 2
            x = float(tokens[i]); y = float(tokens[i + 1]); i += 2
            if cmd == "c":
                c1x += cursor[0]; c1y += cursor[1]
                c2x += cursor[0]; c2y += cursor[1]
                x += cursor[0]; y += cursor[1]
            current.extend([(c1x, c1y), (c2x, c2y), (x, y)])
            cursor = (x, y)
        else:
            i += 1

    # Apply transform: world = (tx + sx*x, ty + sy*y)
    transformed = []
    for sub in paths:
        transformed.append([(tx + sx * x, ty + sy * y) for (x, y) in sub])

    return transformed  # in image coordinates (y down)


# ---------------------------------------------------------------------------
# Normalize traced tab to (0,0)->(1,0), Y up.
# We take the first segment's start as the left neck and the last segment's
# end as the right neck. Then apply an affine transform that maps left->
# (0,0), right->(1,0), and flips Y so positive Y is the protrusion direction.
# ---------------------------------------------------------------------------

def normalize_to_template(segs):
    left = np.array(segs[0][0])
    right = np.array(segs[-1][-1])
    chord = right - left
    chord_len = np.linalg.norm(chord)
    ux = chord / chord_len             # along-chord unit
    # In image coords, +y is down. Protrusion is in -y. We want template +y = protrusion.
    # The perpendicular pointing toward the protrusion is (-uy_x, uy_y) rotated... easier:
    # We pick the perpendicular such that the midpoint of the tab is at positive template y.
    perp = np.array([-ux[1], ux[0]])   # 90° CCW; could be wrong sign
    # Sample-check: a known anchor (e.g. middle anchor) should have positive y after transform.
    mid_anchor = np.array(segs[len(segs) // 2][-1])
    test = mid_anchor - left
    if np.dot(test, perp) < 0:
        perp = -perp

    def to_template(p):
        v = np.array(p) - left
        return (np.dot(v, ux) / chord_len, np.dot(v, perp) / chord_len)

    normalized = []
    for seg in segs:
        normalized.append([to_template(p) for p in seg])
    return normalized


def flatten_segments_to_path(segs):
    out = [segs[0][0]]
    for s in segs:
        out.extend([s[1], s[2], s[3]])
    return out


# ---------------------------------------------------------------------------
# Contour helpers.
# ---------------------------------------------------------------------------

def _tangent_at_start(seg):
    p0, c1, _, _ = seg
    return (c1[0] - p0[0], c1[1] - p0[1])


def _tangent_at_end(seg):
    _, _, c2, p3 = seg
    return (p3[0] - c2[0], p3[1] - c2[1])


def _signed_angle(v1, v2):
    a1 = math.atan2(v1[1], v1[0])
    a2 = math.atan2(v2[1], v2[0])
    d = a2 - a1
    while d > math.pi:
        d -= 2 * math.pi
    while d < -math.pi:
        d += 2 * math.pi
    return d


def subpath_to_segments(subpath):
    """
    Convert a Potrace subpath (anchor + (c1,c2,anchor) triples ...) to a
    list of (p0, c1, c2, p3) cubic tuples forming a closed contour. If the
    last anchor coincides with the first (Potrace closes its own paths),
    skip adding an explicit closing segment to avoid a degenerate cubic
    that would produce undefined tangents at the junction.
    """
    n_anchors = (len(subpath) - 1) // 3 + 1
    anchors = [subpath[i * 3] for i in range(n_anchors)]
    segs = []
    for i in range(n_anchors - 1):
        p0 = anchors[i]
        c1 = subpath[i * 3 + 1]
        c2 = subpath[i * 3 + 2]
        p3 = anchors[i + 1]
        segs.append((p0, c1, c2, p3))
    dx = anchors[0][0] - anchors[-1][0]
    dy = anchors[0][1] - anchors[-1][1]
    if math.hypot(dx, dy) > 1e-6:
        p0 = anchors[-1]
        p3 = anchors[0]
        c1 = (p0[0] + dx / 3, p0[1] + dy / 3)
        c2 = (p0[0] + 2 * dx / 3, p0[1] + 2 * dy / 3)
        segs.append((p0, c1, c2, p3))
    return segs


def _reverse_segment(seg):
    p0, c1, c2, p3 = seg
    return (p3, c2, c1, p0)


def tab_arc_between_anchors(segs, a_start, a_end):
    """
    Pick the arc from a_start to a_end whose midpoint sits on the
    "protrusion" side of the neck chord — i.e. the arc going OVER the
    tab, not around the rest of the silhouette.

    The protrusion direction is whichever side of the chord has the
    larger perpendicular offset to the arc midpoint (the tab head sticks
    out further than the opposite arc does). Works for cropped photos
    where the "opposite arc" is the image-edge wrap-around.
    """
    n = len(segs)

    def walk(direction):
        arc = []
        cur = a_start
        guard = 0
        while cur != a_end:
            arc.append(segs[cur] if direction > 0 else _reverse_segment(segs[(cur - 1) % n]))
            cur = (cur + direction) % n
            guard += 1
            if guard > n:
                raise RuntimeError("runaway arc walk")
        return arc

    fwd = walk(+1)
    bwd = walk(-1)

    p_start = segs[a_start][0]
    p_end = segs[a_end][0]
    chord_mid = ((p_start[0] + p_end[0]) / 2, (p_start[1] + p_end[1]) / 2)
    chord_dx = p_end[0] - p_start[0]
    chord_dy = p_end[1] - p_start[1]
    chord_len = math.hypot(chord_dx, chord_dy) or 1.0

    def perpendicular_offset(arc):
        """Signed perpendicular distance from chord midpoint to arc midpoint."""
        mid = arc[len(arc) // 2]
        t = 0.5
        mt = 1 - t
        midpt = (
            mt**3 * mid[0][0] + 3*mt**2*t * mid[1][0] + 3*mt*t**2 * mid[2][0] + t**3 * mid[3][0],
            mt**3 * mid[0][1] + 3*mt**2*t * mid[1][1] + 3*mt*t**2 * mid[2][1] + t**3 * mid[3][1],
        )
        # Perpendicular distance: chord-cross-(midpt - chord_mid) / chord_len
        return (chord_dx * (midpt[1] - chord_mid[1])
                - chord_dy * (midpt[0] - chord_mid[0])) / chord_len

    return fwd if abs(perpendicular_offset(fwd)) > abs(perpendicular_offset(bwd)) else bwd


def find_edge_anchors(segs, img_width, img_height, edge_tol=4):
    """
    For cropped tab photos (tab roughly centred, piece body extending to
    image edges), the contour leaves the image on the left and right
    edges. The two "neck" endpoints are the topmost contour anchors that
    lie on those edges.
    """
    n_anchors = len(segs)  # one anchor per segment (the start anchor)
    candidates_left = []
    candidates_right = []
    for i in range(n_anchors):
        x, y = segs[i][0]
        if x <= edge_tol:
            candidates_left.append((i, x, y))
        if x >= img_width - edge_tol:
            candidates_right.append((i, x, y))
    if not candidates_left or not candidates_right:
        raise RuntimeError(
            f"could not find anchors on both image edges (left={len(candidates_left)}, right={len(candidates_right)})")
    left = min(candidates_left, key=lambda c: c[2])[0]   # topmost = smallest y
    right = min(candidates_right, key=lambda c: c[2])[0]
    return left, right


# ---------------------------------------------------------------------------
# Tab shape analysis: locate the neck pinch and head widest point on a
# normalized tab path. Needed if the eventual TabTemplate is to support
# neckRatio-style parameterization (uniform scale alone doesn't reproduce
# the classic's ability to narrow the neck while keeping the head wide).
# ---------------------------------------------------------------------------

def analyze_tab_shape(normalized_path, n_samples_per_seg=40):
    """
    Sample the normalized tab path and locate:
      - head_y, head_width: y level of maximum horizontal extent
      - neck_y, neck_width: y level of minimum width BELOW head_y
      - apex_y: maximum y reached by the path

    The "width" at a given y is the distance between the LEFTMOST and
    RIGHTMOST points where the polyline crosses a horizontal line at y.
    Using outermost crossings (rather than max - min of all samples in a
    slab) makes the measurement robust against small "kinks" caused by
    e.g. glare highlights along the real-photo silhouette.
    """
    pts = _sample_bezier_path(normalized_path, samples_per_seg=n_samples_per_seg)
    ys = pts[:, 1]
    apex_y = float(ys.max())

    def extent_at(y_target):
        crossings = []
        for i in range(len(pts) - 1):
            y0 = pts[i, 1]
            y1 = pts[i + 1, 1]
            if y0 == y1:
                continue
            if (y0 - y_target) * (y1 - y_target) <= 0:
                t = (y_target - y0) / (y1 - y0)
                x = pts[i, 0] + t * (pts[i + 1, 0] - pts[i, 0])
                crossings.append(x)
        if len(crossings) < 2:
            return None
        return min(crossings), max(crossings)

    n_bins = 200
    y_levels = np.linspace(0, apex_y, n_bins + 1)[1:]
    widths = []
    extents = {}
    for y in y_levels:
        result = extent_at(float(y))
        if result is None:
            continue
        left, right = result
        widths.append((float(y), right - left))
        extents[float(y)] = (left, right)

    if not widths:
        return None

    # The chord (y=0) is by definition width 1.0. For cropped photos that
    # chord is wider than the tab head, so a naive global max-width returns
    # the chord. Instead, look at the y range ABOVE a small initial skip,
    # find the neck pinch first, then the head widest point above it.
    skip_y = 0.05 * apex_y
    above_chord = [(y, w) for y, w in widths if y > skip_y]
    if not above_chord:
        return None

    # Neck pinch: minimum width in the lower portion of the tab (between
    # the chord and the head). Cap the search at 60% of apex height so we
    # don't accidentally pick a low value near the apex where the curve
    # comes back in.
    lower = [(y, w) for y, w in above_chord if y < 0.6 * apex_y]
    if lower:
        neck_y, neck_width = min(lower, key=lambda w: w[1])
    else:
        neck_y, neck_width = skip_y, above_chord[0][1]

    # Head widest: max width above the neck pinch.
    above_neck = [(y, w) for y, w in above_chord if y > neck_y]
    if above_neck:
        head_y, head_width = max(above_neck, key=lambda w: w[1])
    else:
        head_y, head_width = neck_y, neck_width

    head_left, head_right = extents.get(head_y, (None, None))
    neck_left, neck_right = extents.get(neck_y, (None, None))

    return {
        "head_y": head_y,
        "head_width": head_width,
        "head_left_x": head_left,
        "head_right_x": head_right,
        "head_center_x": (head_left + head_right) / 2 if head_left is not None else None,
        "neck_y": neck_y,
        "neck_width": neck_width,
        "neck_left_x": neck_left,
        "neck_right_x": neck_right,
        "neck_center_x": (neck_left + neck_right) / 2 if neck_left is not None else None,
        "apex_y": apex_y,
    }


# ---------------------------------------------------------------------------
# Schneider's algorithm — fit a polyline with the minimum number of cubic
# Beziers that stays within a given error tolerance. Direct port of the
# Graphics Gems I "FitCurves" routine by Philip J. Schneider.
# ---------------------------------------------------------------------------

def _vsub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def _vadd(a, b):
    return (a[0] + b[0], a[1] + b[1])


def _vscale(v, s):
    return (v[0] * s, v[1] * s)


def _vdot(a, b):
    return a[0] * b[0] + a[1] * b[1]


def _vnorm(v):
    n = math.hypot(v[0], v[1])
    return (v[0] / n, v[1] / n) if n > 1e-12 else (0.0, 0.0)


def _bez_at(b, t):
    mt = 1 - t
    return (
        mt ** 3 * b[0][0] + 3 * mt ** 2 * t * b[1][0]
        + 3 * mt * t ** 2 * b[2][0] + t ** 3 * b[3][0],
        mt ** 3 * b[0][1] + 3 * mt ** 2 * t * b[1][1]
        + 3 * mt * t ** 2 * b[2][1] + t ** 3 * b[3][1],
    )


def _sample_bezier_path(path, samples_per_seg=200):
    """Densely sample a flat cubic-Bezier path into a numpy point array."""
    pts = []
    n_segs = (len(path) - 1) // 3
    for i in range(n_segs):
        p0 = np.array(path[i * 3])
        p1 = np.array(path[i * 3 + 1])
        p2 = np.array(path[i * 3 + 2])
        p3 = np.array(path[i * 3 + 3])
        last = (i == n_segs - 1)
        ts = np.linspace(0, 1, samples_per_seg, endpoint=last)
        for t in ts:
            p = (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + \
                3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3
            pts.append(p)
    return np.array(pts)


def _chord_length_parameterize(d, first, last):
    u = [0.0]
    for i in range(first + 1, last + 1):
        u.append(u[-1] + math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]))
    total = u[-1]
    if total > 0:
        u = [x / total for x in u]
    return u


def _generate_bezier(d, first, last, u, tHat1, tHat2):
    """Least-squares fit of a cubic Bezier given fixed endpoints and tangent directions."""
    nPts = last - first + 1
    A = [(_vscale(tHat1, 3 * (1 - u[i]) ** 2 * u[i]),
          _vscale(tHat2, 3 * (1 - u[i]) * u[i] ** 2)) for i in range(nPts)]

    C = [[0.0, 0.0], [0.0, 0.0]]
    X = [0.0, 0.0]
    for i in range(nPts):
        C[0][0] += _vdot(A[i][0], A[i][0])
        C[0][1] += _vdot(A[i][0], A[i][1])
        C[1][1] += _vdot(A[i][1], A[i][1])

        t = u[i]
        mt = 1 - t
        # Bezier with b1=b0 and b2=b3 (i.e. control points at endpoints):
        # used to compute the residual that the (alpha1, alpha2) factors must close.
        BezAtT = (
            (mt ** 3 + 3 * mt ** 2 * t) * d[first][0] + (3 * mt * t ** 2 + t ** 3) * d[last][0],
            (mt ** 3 + 3 * mt ** 2 * t) * d[first][1] + (3 * mt * t ** 2 + t ** 3) * d[last][1],
        )
        tmp = _vsub(d[first + i], BezAtT)
        X[0] += _vdot(A[i][0], tmp)
        X[1] += _vdot(A[i][1], tmp)
    C[1][0] = C[0][1]

    det_C0_C1 = C[0][0] * C[1][1] - C[1][0] * C[0][1]
    if abs(det_C0_C1) < 1e-12:
        # Fall back to the Wu/Barsky heuristic.
        dist = math.hypot(d[last][0] - d[first][0], d[last][1] - d[first][1]) / 3
        return [
            d[first],
            _vadd(d[first], _vscale(tHat1, dist)),
            _vadd(d[last], _vscale(tHat2, dist)),
            d[last],
        ]
    det_C0_X = C[0][0] * X[1] - C[1][0] * X[0]
    det_X_C1 = X[0] * C[1][1] - X[1] * C[0][1]
    alpha_l = det_X_C1 / det_C0_C1
    alpha_r = det_C0_X / det_C0_C1

    segLength = math.hypot(d[last][0] - d[first][0], d[last][1] - d[first][1])
    epsilon = 1e-6 * segLength
    if alpha_l < epsilon or alpha_r < epsilon:
        dist = segLength / 3
        return [
            d[first],
            _vadd(d[first], _vscale(tHat1, dist)),
            _vadd(d[last], _vscale(tHat2, dist)),
            d[last],
        ]
    return [
        d[first],
        _vadd(d[first], _vscale(tHat1, alpha_l)),
        _vadd(d[last], _vscale(tHat2, alpha_r)),
        d[last],
    ]


def _newton_raphson_root_find(Q, P, u):
    Q1 = [_vscale(_vsub(Q[1], Q[0]), 3),
          _vscale(_vsub(Q[2], Q[1]), 3),
          _vscale(_vsub(Q[3], Q[2]), 3)]
    Q2 = [_vscale(_vsub(Q1[1], Q1[0]), 2),
          _vscale(_vsub(Q1[2], Q1[1]), 2)]
    mt = 1 - u
    Q_u = _bez_at(Q, u)
    Q1_u = (mt ** 2 * Q1[0][0] + 2 * mt * u * Q1[1][0] + u ** 2 * Q1[2][0],
            mt ** 2 * Q1[0][1] + 2 * mt * u * Q1[1][1] + u ** 2 * Q1[2][1])
    Q2_u = (mt * Q2[0][0] + u * Q2[1][0],
            mt * Q2[0][1] + u * Q2[1][1])
    diff = _vsub(Q_u, P)
    num = _vdot(diff, Q1_u)
    den = _vdot(Q1_u, Q1_u) + _vdot(diff, Q2_u)
    if abs(den) < 1e-12:
        return u
    return u - num / den


def _compute_max_error(d, first, last, bez, u):
    maxDist = 0.0
    splitPoint = (last + first) // 2
    for i in range(1, last - first):
        P = _bez_at(bez, u[i])
        dist = math.hypot(P[0] - d[first + i][0], P[1] - d[first + i][1])
        if dist > maxDist:
            maxDist = dist
            splitPoint = first + i
    return maxDist, splitPoint


def _fit_cubic(d, first, last, tHat1, tHat2, error, max_iters=4):
    iterationError = error * error
    nPts = last - first + 1
    if nPts == 2:
        dist = math.hypot(d[last][0] - d[first][0], d[last][1] - d[first][1]) / 3
        return [[
            d[first],
            _vadd(d[first], _vscale(tHat1, dist)),
            _vadd(d[last], _vscale(tHat2, dist)),
            d[last],
        ]]
    u = _chord_length_parameterize(d, first, last)
    bez = _generate_bezier(d, first, last, u, tHat1, tHat2)
    maxError, splitPoint = _compute_max_error(d, first, last, bez, u)
    if maxError < error:
        return [bez]
    if maxError < iterationError:
        for _ in range(max_iters):
            uPrime = [_newton_raphson_root_find(bez, d[first + i], u[i])
                      for i in range(nPts)]
            bez = _generate_bezier(d, first, last, uPrime, tHat1, tHat2)
            maxError, splitPoint = _compute_max_error(d, first, last, bez, uPrime)
            if maxError < error:
                return [bez]
            u = uPrime
    # Split at worst point and recurse.
    v1 = _vsub(d[splitPoint - 1], d[splitPoint])
    v2 = _vsub(d[splitPoint], d[splitPoint + 1])
    tHatCenter = _vnorm(((v1[0] + v2[0]) / 2, (v1[1] + v2[1]) / 2))
    left = _fit_cubic(d, first, splitPoint, tHat1, tHatCenter, error, max_iters)
    right = _fit_cubic(d, splitPoint, last, (-tHatCenter[0], -tHatCenter[1]),
                       tHat2, error, max_iters)
    return left + right


def schneider_fit(points, error):
    """Fit a polyline with a piecewise cubic Bezier. Returns list of 4-tuple segments."""
    if len(points) < 2:
        return []
    tHat1 = _vnorm(_vsub(points[1], points[0]))
    tHat2 = _vnorm(_vsub(points[-2], points[-1]))
    return _fit_cubic(points, 0, len(points) - 1, tHat1, tHat2, error)


def refit_arc(tab_arc, max_error, samples_per_seg=20):
    """Densely sample an existing piecewise-Bezier arc, then refit with Schneider."""
    pts = []
    for i, seg in enumerate(tab_arc):
        endpoint = (i == len(tab_arc) - 1)
        ts = np.linspace(0, 1, samples_per_seg, endpoint=False)
        if endpoint:
            ts = np.append(ts, 1.0)
        for t in ts:
            pts.append(_bez_at(seg, float(t)))
    fitted_tuples = schneider_fit(pts, max_error)
    return [tuple(seg) for seg in fitted_tuples]


# ---------------------------------------------------------------------------
# Per-photo orchestrator.
# ---------------------------------------------------------------------------

@dataclass
class TraceResult:
    """Everything `write_review_png` and the JSON writer need."""
    photo_path: Path
    # Normalized neck-frame outputs:
    path: list                         # [{"x": ..., "y": ...}, ...] flat cubic-Bezier path
    landmarks: dict                    # head/neck/apex landmarks
    # Image-space intermediates for the review PNG:
    raw_contour_segs: list = field(default_factory=list)   # full Potrace contour, in image px
    raw_tab_arc: list = field(default_factory=list)        # tab portion of contour, image px
    refit_segs_image: list = field(default_factory=list)   # Schneider refit, image px (re-projected)
    neck_left: tuple = (0.0, 0.0)      # image-px coords of left neck endpoint
    neck_right: tuple = (0.0, 0.0)
    refit_segment_count: int = 0
    potrace_segment_count: int = 0


def _bbox_area(sp):
    xs = [p[0] for p in sp]
    ys = [p[1] for p in sp]
    return (max(xs) - min(xs)) * (max(ys) - min(ys))


def _denormalize_segs(normalized_segs, neck_left, neck_right):
    """
    Inverse of normalize_to_template: map points in the neck-frame back
    into the photo's image-pixel coordinate space, so we can draw the
    refit overlay on top of the source photo.
    """
    left = np.array(neck_left, dtype=float)
    right = np.array(neck_right, dtype=float)
    chord = right - left
    chord_len = np.linalg.norm(chord)
    ux = chord / chord_len
    perp = np.array([-ux[1], ux[0]])

    # Match the sign convention picked in normalize_to_template: the
    # protrusion side gives +Y. Re-derive it from any normalized point
    # with y > 0 (there are plenty; the tab apex is at y ~= 0.3-0.4).
    sample = None
    for seg in normalized_segs:
        for p in seg:
            if p[1] > 0.05:
                sample = p
                break
        if sample is not None:
            break

    # If for some reason every point sits at y<=0 the perp sign is
    # ambiguous; default to image-up (-y in image coords). Most tabs
    # have a clear apex.
    if sample is None:
        perp = -perp
    else:
        # The forward mapping in normalize_to_template chose perp so that
        # the protrusion side gets positive y. In image space, the
        # protrusion points up (smaller image-y, i.e. -y in image coords).
        # We need: world = left + x*chord + y*chord_len*perp.
        # The perp here is 90° CCW from chord (in image space, with y
        # down, that points "into" the image). We need to ensure it
        # points toward the protrusion side. We can check by seeing
        # which sign of perp puts the sample's normalized coordinates
        # back near where the original lay above the chord.
        # Simpler: try one sign, see if the resulting image-y is on the
        # "above the chord" side (smaller image-y than midpoint of
        # left/right). Flip if not.
        chord_mid_y = (left[1] + right[1]) / 2
        test_img = left + sample[0] * chord + sample[1] * chord_len * perp
        if test_img[1] > chord_mid_y:  # below chord (image-y down) → wrong side
            perp = -perp

    def to_image(p):
        return tuple(left + p[0] * chord + p[1] * chord_len * perp)

    return [[to_image(pt) for pt in seg] for seg in normalized_segs]


def trace_photo(photo_path: Path,
                alphamax: float = 0.5,
                refit_tol_chord_frac: float = 0.01,
                clean_noise: bool = False) -> TraceResult:
    """
    Trace a single cropped tab photo into the normalized neck-frame
    cubic-Bezier representation plus landmark metadata.

    Pre-processing (median blur + Otsu + polarity-aware + morphology) is
    handled inside `run_potrace`, lifted unchanged from the spike.
    """
    img = cv2.imread(str(photo_path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise RuntimeError(f"could not read {photo_path}")
    img_h, img_w = img.shape

    # Keep the intermediate BMP and SVG out of the user's photo directory.
    # They're only needed during this call, so a TemporaryDirectory that
    # cleans itself up on exit is the right scope.
    with tempfile.TemporaryDirectory(prefix="trace-tab-") as tmp:
        work_dir = Path(tmp)
        svg_out = work_dir / (photo_path.stem + ".trace.svg")
        run_potrace(photo_path, svg_out, work_dir, alphamax=alphamax,
                    clean_noise=clean_noise)
        subpaths = parse_potrace_svg(svg_out)
    if not subpaths:
        raise RuntimeError("no contours from potrace")
    chosen = max(subpaths, key=_bbox_area)
    segs = subpath_to_segments(chosen)

    anchor_left, anchor_right = find_edge_anchors(segs, img_w, img_h)
    tab_arc = tab_arc_between_anchors(segs, anchor_left, anchor_right)

    normalized_segs = normalize_to_template(tab_arc)
    normalized_path = flatten_segments_to_path(normalized_segs)

    # Schneider refit. The --refit-tol flag is a fraction of the neck-chord
    # length; in the normalized frame the chord is unit-length, so the
    # fraction is also the absolute tolerance. Refitting in normalized
    # space avoids carrying a separate image-pixel tolerance around.
    refit_segs_norm = refit_arc(normalized_segs, refit_tol_chord_frac)
    refit_path = flatten_segments_to_path(refit_segs_norm)

    shape = analyze_tab_shape(refit_path) or {}
    landmarks = {
        "apex_y": shape.get("apex_y"),
        "head": {
            "y": shape.get("head_y"),
            "width": shape.get("head_width"),
            "center_x": shape.get("head_center_x"),
        },
        "neck": {
            "y": shape.get("neck_y"),
            "width": shape.get("neck_width"),
            "center_x": shape.get("neck_center_x"),
        },
    }

    path_json = [{"x": float(p[0]), "y": float(p[1])} for p in refit_path]

    refit_segs_image = _denormalize_segs(refit_segs_norm,
                                         tab_arc[0][0],
                                         tab_arc[-1][-1])

    return TraceResult(
        photo_path=photo_path,
        path=path_json,
        landmarks=landmarks,
        raw_contour_segs=segs,
        raw_tab_arc=tab_arc,
        refit_segs_image=refit_segs_image,
        neck_left=tuple(tab_arc[0][0]),
        neck_right=tuple(tab_arc[-1][-1]),
        refit_segment_count=len(refit_segs_norm),
        potrace_segment_count=len(normalized_segs),
    )


# ---------------------------------------------------------------------------
# Review PNG: overlay raw contour, refit curve, control points, neck
# endpoints on top of the source photo.
# ---------------------------------------------------------------------------

def _segs_to_flat_path(segs):
    if not segs:
        return []
    out = [segs[0][0]]
    for s in segs:
        out.extend([s[1], s[2], s[3]])
    return out


def write_review_png(out_path: Path, result: TraceResult) -> None:
    """Render an overlay: photo background + raw contour + refit + neck markers."""
    img = cv2.imread(str(result.photo_path))
    if img is None:
        raise RuntimeError(f"could not read {result.photo_path}")
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    h, w = img_rgb.shape[:2]

    fig, ax = plt.subplots(figsize=(w / 100, h / 100), dpi=100)
    ax.imshow(img_rgb)

    # Thin grey: full Potrace contour.
    full_path = _segs_to_flat_path(result.raw_contour_segs)
    if full_path:
        full_pts = _sample_bezier_path(full_path, samples_per_seg=20)
        ax.plot(full_pts[:, 0], full_pts[:, 1], color="#bbbbbb", lw=1.0, label="potrace contour")

    # Blue: raw Potrace tab arc (pre-refit).
    arc_path = _segs_to_flat_path(result.raw_tab_arc)
    if arc_path:
        arc_pts = _sample_bezier_path(arc_path, samples_per_seg=40)
        ax.plot(arc_pts[:, 0], arc_pts[:, 1], color="#3a8dde", lw=2.0,
                label=f"raw tab arc ({result.potrace_segment_count} segs)")

    # Red: Schneider-refit curve, with control points.
    refit_path_img = _segs_to_flat_path(result.refit_segs_image)
    if refit_path_img:
        refit_pts = _sample_bezier_path(refit_path_img, samples_per_seg=60)
        ax.plot(refit_pts[:, 0], refit_pts[:, 1], color="#e23a3a", lw=2.0,
                label=f"refit ({result.refit_segment_count} segs)")
        anchors_x = [refit_path_img[i][0] for i in range(0, len(refit_path_img), 3)]
        anchors_y = [refit_path_img[i][1] for i in range(0, len(refit_path_img), 3)]
        ax.plot(anchors_x, anchors_y, "s", mfc="none", mec="#e23a3a", ms=8,
                label="anchors")
        # Control points + control-polygon segments
        cp_xs = []
        cp_ys = []
        for i in range(0, len(refit_path_img) - 1, 3):
            p0 = refit_path_img[i]
            c1 = refit_path_img[i + 1]
            c2 = refit_path_img[i + 2]
            p3 = refit_path_img[i + 3]
            ax.plot([p0[0], c1[0]], [p0[1], c1[1]], color="#e23a3a", lw=0.7, ls=":")
            ax.plot([p3[0], c2[0]], [p3[1], c2[1]], color="#e23a3a", lw=0.7, ls=":")
            cp_xs.extend([c1[0], c2[0]])
            cp_ys.extend([c1[1], c2[1]])
        ax.plot(cp_xs, cp_ys, ".", color="#e23a3a", ms=4, label="control points")

    # Green: neck endpoints.
    nl = result.neck_left
    nr = result.neck_right
    ax.plot([nl[0], nr[0]], [nl[1], nr[1]], "o", color="#2ec27e", ms=12, mew=2,
            mfc="none", label="neck endpoints")

    ax.set_xlim(0, w)
    ax.set_ylim(h, 0)
    ax.set_aspect("equal")
    ax.axis("off")
    # Anchor the legend *below* the axes rather than inside it. The legend is
    # wider than a narrow portrait crop, so leaving it inside and tight-cropping
    # let it dominate the saved bbox and clipped the photo away entirely. With
    # the legend outside the axes and passed as an extra artist, the tight bbox
    # is the union of the image and the legend, so both stay visible.
    legend = ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.02),
                       fontsize=8, ncol=3, framealpha=0.9)

    fig.savefig(out_path, dpi=100, bbox_inches="tight",
                bbox_extra_artists=(legend,))
    plt.close(fig)


# ---------------------------------------------------------------------------
# CLI entry point.
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        prog="trace-tab",
        description="Trace a cropped puzzle-tab photo into a normalized cubic-Bezier JSON.",
    )
    parser.add_argument("photo", help="Path to the cropped tab photo.")
    parser.add_argument("--id", required=True,
                        help="Trace id, used as the output filename stem (e.g. tab-12-blue-cat).")
    parser.add_argument("--out", default="src/puzzle/composable/traces/",
                        help="Output directory for the JSON and review PNG.")
    parser.add_argument("--notes", default="",
                        help="Free-text note saved into source.notes.")
    parser.add_argument("--alphamax", type=float, default=0.5,
                        help="Potrace alphamax (corner threshold).")
    parser.add_argument("--refit-tol", type=float, default=0.01,
                        help="Schneider refit tolerance as fraction of chord length.")
    parser.add_argument("--clean-noise", action="store_true",
                        help="Keep only the largest foreground component after "
                             "Otsu, dropping background-noise blobs before "
                             "Potrace. Try this if the trace fails with "
                             "'could not find anchors on both image edges'.")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    result = trace_photo(
        photo_path=Path(args.photo),
        alphamax=args.alphamax,
        refit_tol_chord_frac=args.refit_tol,
        clean_noise=args.clean_noise,
    )

    today = datetime.date.today().isoformat()
    source = {
        "photo": Path(args.photo).name,
        "captured": today,
    }
    if args.notes:
        source["notes"] = args.notes

    payload = {
        "id": args.id,
        "source": source,
        "path": result.path,
        "landmarks": result.landmarks,
    }

    json_path = out_dir / f"{args.id}.json"
    review_path = out_dir / f"{args.id}-review.png"
    json_path.write_text(json.dumps(payload, indent=2) + "\n")
    write_review_png(review_path, result)
    print(f"wrote {json_path}")
    print(f"wrote {review_path}")
    print(f"refit segments: {result.refit_segment_count}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
