"""
Tab-tracing spike.

Question: can we automatically convert a (synthesized for now, photographed
later) puzzle-tab silhouette into a normalized cubic-Bezier path that
matches the puzzle app's TabTemplate convention?

Pipeline:
  1. Synthesize a reference tab silhouette PNG from the classic template.
  2. Run Potrace on the PNG to get vectorized cubic Beziers.
  3. Parse the SVG, isolate the tab portion of the contour, normalize
     to the (0,0)->(1,0) convention with the tab protruding in +Y.
  4. Render original vs. traced overlay and compute a deviation metric.

Outputs (next to this script):
  out/01-reference.png        synthesized input
  out/02-traced.svg           raw potrace output
  out/03-overlay.png          original (blue) vs traced (red)
  out/04-metrics.txt          deviation numbers
  out/05-normalized.json      traced path in normalized (0,0)->(1,0) space
"""

import json
import re
import subprocess
from pathlib import Path

import cv2
import numpy as np
import matplotlib.pyplot as plt


OUT = Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)


# ---------------------------------------------------------------------------
# Classic tab template — direct port of classicTabTemplate in
# src/puzzle/composable/tab-shapes.ts. Returns 13 points: start anchor
# followed by (cp1, cp2, anchor) triples for 4 cubic segments.
# ---------------------------------------------------------------------------

def classic_tab(scalex=0.825, scaley=0.9, mid=0.5, neck_ratio=0.525):
    halfWidth = 0.17 * scalex
    neckHalfWidth = halfWidth * neck_ratio
    yShift = 0.08 * scaley

    def pt(h, v):
        return (h, v - yShift)

    pb = pt(mid - halfWidth * 0.9, 0.25 * scaley)
    pc = pt(mid, 0.33 * scaley)
    pd = pt(mid + halfWidth * 0.9, 0.25 * scaley)

    cp2_1 = pt(mid - neckHalfWidth * 0.7, 0.12 * scaley)
    cp2_2 = pt(mid - halfWidth * 1.1, 0.20 * scaley)
    cp3_1 = pt(mid - halfWidth * 0.6, 0.32 * scaley)
    cp3_2 = pt(mid - halfWidth * 0.3, 0.33 * scaley)
    cp4_1 = pt(mid + halfWidth * 0.3, 0.33 * scaley)
    cp4_2 = pt(mid + halfWidth * 0.6, 0.32 * scaley)
    cp5_1 = pt(mid + halfWidth * 1.1, 0.20 * scaley)
    cp5_2 = pt(mid + neckHalfWidth * 0.7, 0.12 * scaley)

    return [
        pt(mid - neckHalfWidth, 0.08 * scaley),
        cp2_1, cp2_2, pb,
        cp3_1, cp3_2, pc,
        cp4_1, cp4_2, pd,
        cp5_1, cp5_2,
        pt(mid + neckHalfWidth, 0.08 * scaley),
    ]


def sample_bezier_path(path, samples_per_seg=200):
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


# ---------------------------------------------------------------------------
# Synthesize the input PNG.
# Template space: x in [0,1] runs along the edge, y >= 0 is the protrusion.
# Image space: x maps to pixels along width, y in template maps to upward
# protrusion (smaller image-y). The piece body fills the area below the
# baseline so the contour is a closed silhouette.
# ---------------------------------------------------------------------------

EDGE_LEN_PX = 1000
PADDING = 100
BASELINE_Y = 500  # image-y where the straight piece edge sits


def synthesize(bez_path, png_out):
    width = PADDING * 2 + EDGE_LEN_PX
    height = BASELINE_Y + PADDING
    img = np.full((height, width), 255, dtype=np.uint8)

    samples = sample_bezier_path(bez_path, samples_per_seg=200)
    px = (samples[:, 0] * EDGE_LEN_PX + PADDING).astype(np.int32)
    py = (BASELINE_Y - samples[:, 1] * EDGE_LEN_PX).astype(np.int32)

    poly = np.column_stack([px, py])
    poly = np.vstack([
        poly,
        [width - 1, BASELINE_Y],
        [width - 1, height - 1],
        [0, height - 1],
        [0, BASELINE_Y],
        poly[0],
    ])
    cv2.fillPoly(img, [poly], 0)
    cv2.imwrite(str(png_out), img)
    return img


# ---------------------------------------------------------------------------
# Run potrace on the PNG. Potrace reads BMP, so convert first.
# Output: SVG with cubic Beziers.
# ---------------------------------------------------------------------------

def run_potrace(png_path, svg_out, alphamax=1.0, opttolerance=0.2):
    bmp_path = png_path.with_suffix(".bmp")
    img = cv2.imread(str(png_path), cv2.IMREAD_GRAYSCALE)
    # Despeckle: median blur kills salt-and-pepper, morphological open/close
    # closes tiny holes/specks. Real photos need this too.
    img = cv2.medianBlur(img, 5)
    _, img_bin = cv2.threshold(img, 127, 255, cv2.THRESH_BINARY)
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


def add_photo_noise(img, blur_sigma=2.0, gauss_noise_std=8.0, sp_amount=0.005, seed=42):
    """
    Simulate what a tab photographed under decent conditions might look like
    before threshold: Gaussian blur (defocus / paper-pulp fuzz at the edge),
    Gaussian intensity noise (sensor), and a few salt-and-pepper specks
    (dust / paper fibres).
    """
    rng = np.random.default_rng(seed)
    out = cv2.GaussianBlur(img, ksize=(0, 0), sigmaX=blur_sigma)
    noise = rng.normal(0, gauss_noise_std, size=out.shape)
    out = np.clip(out.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    mask = rng.random(out.shape)
    out[mask < sp_amount] = 0
    out[mask > 1 - sp_amount] = 255
    return out


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
# Identify the tab portion of the traced outer contour.
# Strategy: the silhouette is "piece body + tab protrusion". On the contour
# in image coords, the piece body sits at y >= BASELINE_Y, and the tab is
# the only portion that pokes above BASELINE_Y (y < BASELINE_Y, since image
# y points down). So we find the longest contiguous run of anchors with
# y < BASELINE_Y - eps, and extend by one anchor on each side so we include
# the on-baseline neck endpoints.
# ---------------------------------------------------------------------------

def isolate_tab_segments(subpath, baseline_y, eps=2.0):
    """
    Build the segment list for a closed subpath and pick the contiguous
    run of segments belonging to the tab.

    A segment "belongs to the tab" if any of its 4 points (p0, c1, c2, p3)
    sits above the baseline (image-y < baseline - eps, since image y is
    down). This includes the boundary segments where one endpoint is on
    the baseline (the neck endpoints).
    """
    n_anchors = (len(subpath) - 1) // 3 + 1
    anchors = [subpath[i * 3] for i in range(n_anchors)]

    # Build all closing-loop segments. For a closed subpath the last
    # segment goes from anchors[n-1] back to anchors[0]; potrace's Z
    # makes it a straight line, but we treat all segments uniformly.
    segs = []
    for i in range(n_anchors - 1):
        p0 = anchors[i]
        c1 = subpath[i * 3 + 1]
        c2 = subpath[i * 3 + 2]
        p3 = anchors[i + 1]
        segs.append((p0, c1, c2, p3))
    # Closing segment (straight line back to start)
    p0 = anchors[-1]
    p3 = anchors[0]
    c1 = (p0[0] + (p3[0] - p0[0]) / 3, p0[1] + (p3[1] - p0[1]) / 3)
    c2 = (p0[0] + 2 * (p3[0] - p0[0]) / 3, p0[1] + 2 * (p3[1] - p0[1]) / 3)
    segs.append((p0, c1, c2, p3))

    n = len(segs)
    above = [
        any(pt[1] < baseline_y - eps for pt in seg)
        for seg in segs
    ]

    # Longest contiguous run with wrap-around.
    doubled = above + above
    best_start = 0
    best_len = 0
    run_start = None
    for i, v in enumerate(doubled):
        if v:
            if run_start is None:
                run_start = i
            cur_len = i - run_start + 1
            if cur_len > best_len and cur_len <= n:
                best_len = cur_len
                best_start = run_start
        else:
            run_start = None

    if best_len == 0:
        raise RuntimeError("no tab segments above baseline")

    out = []
    for k in range(best_len):
        out.append(segs[(best_start + k) % n])
    return out


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
# Compare original vs traced: render overlay and compute deviation.
# Deviation is the mean and max nearest-point distance from densely sampled
# traced points to densely sampled original points, both in template space.
# ---------------------------------------------------------------------------

def deviation(original_path, traced_path):
    a = sample_bezier_path(original_path, samples_per_seg=500)
    b = sample_bezier_path(traced_path, samples_per_seg=500)
    # For each b, nearest distance to a
    from scipy.spatial import cKDTree
    tree = cKDTree(a)
    d, _ = tree.query(b)
    return float(np.mean(d)), float(np.max(d))


def plot_overlay(original_path, traced_path, png_out):
    fig, ax = plt.subplots(figsize=(12, 4))
    a = sample_bezier_path(original_path, samples_per_seg=400)
    b = sample_bezier_path(traced_path, samples_per_seg=400)
    ax.plot(a[:, 0], a[:, 1], "b-", lw=2.5, label="original (classic template)")
    ax.plot(b[:, 0], b[:, 1], "r--", lw=1.5, label="traced (potrace, normalized)")

    # Anchors
    for i in range(0, len(original_path), 3):
        ax.plot(original_path[i][0], original_path[i][1], "bo", markersize=5)
    for i in range(0, len(traced_path), 3):
        ax.plot(traced_path[i][0], traced_path[i][1], "rs", markersize=4, fillstyle="none")

    ax.axhline(0, color="gray", lw=0.5)
    ax.set_aspect("equal")
    ax.legend()
    ax.set_title("Tab tracing spike: original vs Potrace-traced (normalized template space)")
    ax.set_xlabel("x (edge-length fraction)")
    ax.set_ylabel("y (edge-length fraction, +Y = protrusion)")
    fig.tight_layout()
    fig.savefig(png_out, dpi=120)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def renormalize_original_to_neck_frame(original):
    """
    The classic template returns a path from left-neck to right-neck where
    the necks live somewhere inside [0,1]. To compare against the traced
    result (which we renormalize to put the necks at (0,0) and (1,0)), we
    apply the same neck-frame transform to the original.
    """
    left = np.array(original[0])
    right = np.array(original[-1])
    chord = right - left
    chord_len = np.linalg.norm(chord)
    ux = chord / chord_len
    perp = np.array([-ux[1], ux[0]])
    # In template space, the protrusion is in +y, so perp should point in +y.
    # Sample: a mid-path anchor should have positive y after transform.
    mid_anchor = np.array(original[len(original) // 2])
    if np.dot(mid_anchor - left, perp) < 0:
        perp = -perp

    def to_neck(p):
        v = np.array(p) - left
        return (np.dot(v, ux) / chord_len, np.dot(v, perp) / chord_len)

    return [to_neck(p) for p in original]


def run_pipeline(png_path, svg_out, original_neck_frame, label, alphamax=1.0, opt=0.2):
    run_potrace(png_path, svg_out, alphamax=alphamax, opttolerance=opt)
    subpaths = parse_potrace_svg(svg_out)
    # Pick the largest subpath by bounding-box area; that's the piece body.
    def bbox_area(sp):
        xs = [p[0] for p in sp]
        ys = [p[1] for p in sp]
        return (max(xs) - min(xs)) * (max(ys) - min(ys))
    candidates = [sp for sp in subpaths if any(p[1] < BASELINE_Y - 2 for p in sp[::3])]
    if not candidates:
        raise RuntimeError(f"{label}: no traced subpath contains the tab")
    chosen = max(candidates, key=bbox_area)
    segs = isolate_tab_segments(chosen, BASELINE_Y)
    normalized_segs = normalize_to_template(segs)
    traced_path = flatten_segments_to_path(normalized_segs)
    mean_d, max_d = deviation(original_neck_frame, traced_path)
    return {
        "label": label,
        "segments": len(normalized_segs),
        "mean_dev": mean_d,
        "max_dev": max_d,
        "path": traced_path,
    }


def main():
    original = classic_tab()
    OUT.mkdir(exist_ok=True)

    print("step 1: synthesizing reference PNG ...")
    png_clean = OUT / "01-reference.png"
    synthesize(original, png_clean)

    print("step 1b: synthesizing noisy variant (photo simulation) ...")
    clean_img = cv2.imread(str(png_clean), cv2.IMREAD_GRAYSCALE)
    noisy_img = add_photo_noise(clean_img)
    png_noisy = OUT / "01b-reference-noisy.png"
    cv2.imwrite(str(png_noisy), noisy_img)

    original_neck_frame = renormalize_original_to_neck_frame(original)

    print("step 2-4: running pipeline under several configurations ...")
    configs = [
        ("clean,  default potrace (a=1.0,  O=0.2)", png_clean, OUT / "02-traced-clean-default.svg", 1.0, 0.2),
        ("clean,  high smoothing  (a=1.33, O=1.0)", png_clean, OUT / "02-traced-clean-smooth.svg", 1.33, 1.0),
        ("noisy,  default potrace (a=1.0,  O=0.2)", png_noisy, OUT / "02-traced-noisy-default.svg", 1.0, 0.2),
        ("noisy,  high smoothing  (a=1.33, O=1.0)", png_noisy, OUT / "02-traced-noisy-smooth.svg", 1.33, 1.0),
    ]

    results = []
    for label, png_in, svg_out, alpha, opt in configs:
        r = run_pipeline(png_in, svg_out, original_neck_frame, label, alpha, opt)
        results.append(r)
        print(f"  {label}: {r['segments']:3d} segs, mean={r['mean_dev']:.5f}, max={r['max_dev']:.5f}")

    print("step 5: rendering comparison plot ...")
    fig, axes = plt.subplots(2, 2, figsize=(14, 7))
    a_orig = sample_bezier_path(original_neck_frame, samples_per_seg=400)
    for ax, r in zip(axes.flat, results):
        b = sample_bezier_path(r["path"], samples_per_seg=400)
        ax.plot(a_orig[:, 0], a_orig[:, 1], "b-", lw=2.5, label="original")
        ax.plot(b[:, 0], b[:, 1], "r--", lw=1.5, label="traced")
        for i in range(0, len(r["path"]), 3):
            ax.plot(r["path"][i][0], r["path"][i][1], "rs", markersize=4, fillstyle="none")
        ax.axhline(0, color="gray", lw=0.5)
        ax.set_aspect("equal")
        ax.set_title(f"{r['label']}\n{r['segments']} segs, mean={r['mean_dev']:.4f}, max={r['max_dev']:.4f}")
        ax.legend(loc="lower center", fontsize=8)
    fig.suptitle("Tab tracing spike — original (blue) vs Potrace-traced (red)", y=0.995)
    fig.tight_layout()
    overlay = OUT / "03-overlay.png"
    fig.savefig(overlay, dpi=110)
    plt.close(fig)

    # Save the best-quality clean result as the "winning" normalized path.
    norm_json = OUT / "05-normalized.json"
    best = min(results[:2], key=lambda r: r["max_dev"])
    norm_json.write_text(json.dumps(
        [{"x": p[0], "y": p[1]} for p in best["path"]],
        indent=2,
    ))

    metrics = OUT / "04-metrics.txt"
    lines = [
        f"original segments: {(len(original) - 1) // 3}",
        "frame: neck-to-neck chord = 1.0",
        "",
    ]
    for r in results:
        lines.append(
            f"{r['label']}: segments={r['segments']:3d}  mean_dev={r['mean_dev']:.6f}  max_dev={r['max_dev']:.6f}"
        )
    lines.append("")
    lines.append("Translation to a real puzzle edge:")
    lines.append("  At neck-width ≈ 15% of edge length (classic-default), 1 neck-fraction = ~150 px on a 1000-px edge.")
    lines.append("  Deviations above scale to roughly 0.15 × the listed neck-fraction values in edge-px.")
    metrics.write_text("\n".join(lines) + "\n")

    print(f"done. outputs in {OUT}")


if __name__ == "__main__":
    main()
