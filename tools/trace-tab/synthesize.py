"""
Synthesize new traced-tab JSONs from the existing photographed library.

Instead of photographing more real pieces, new tabs are drawn from the shape
space the existing traces span: each candidate is a Dirichlet-weighted blend
of three exemplars (the library plus its X-mirrors, resampled to a common
arc-length parameterization) with small jitter along the top PCA components.
Blending keeps candidates inside the photographed style envelope; the jitter
and a distinctiveness gate keep them from collapsing onto existing tabs or
onto each other.

Candidates then go through the same tail of the photo pipeline as a real
trace — Schneider refit at the same tolerance, landmarks via
analyze_tab_shape — so the output JSONs are indistinguishable in kind from
photographed ones. Validation gates hold every candidate inside the envelopes
measured over the v1 library (landmark ranges, x/y bounds, segment counts,
no self-intersection).

Deterministic for a given --seed and library state.

Usage:
    python tools/trace-tab/synthesize.py --out <dir> --count 20 --start-index 22
"""

import argparse
import datetime
import json
import sys
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt

sys.path.insert(0, str(Path(__file__).resolve().parent))
from main import _sample_bezier_path, analyze_tab_shape, schneider_fit  # noqa: E402

TRACES_DIR = Path(__file__).resolve().parents[2] / "src/puzzle/composable/traces"

RESAMPLE_POINTS = 200
REFIT_TOL = 0.01          # same fraction-of-chord tolerance as main.py's default
BLEND_EXEMPLARS = 3
DIRICHLET_ALPHA = 0.45    # < 1 keeps one exemplar dominant, preserving its character
JITTER_COMPONENTS = 6
JITTER_SCALE = 0.25
MIN_DISTANCE = 0.028      # vs. the v1 library's NN spacing: min 0.013, median 0.032

# Envelopes measured over the v1 library, widened ~5% relative.
ENVELOPE = {
    "apex_y": (0.75, 1.13),
    "neck_width": (0.41, 0.63),
    "head_width": (0.58, 0.90),
    "neck_y": (0.145, 0.24),
    "head_y": (0.50, 0.74),
}
SEGMENT_RANGE = (7, 13)


def load_library():
    out = []
    for f in sorted(TRACES_DIR.glob("*.json")):
        out.append(json.loads(f.read_text()))
    return out


def resample_arclen(flat_path, m=RESAMPLE_POINTS):
    dense = _sample_bezier_path(flat_path, samples_per_seg=120)
    d = np.linalg.norm(np.diff(dense, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(d)])
    s /= s[-1]
    t = np.linspace(0, 1, m)
    return np.stack([np.interp(t, s, dense[:, 0]), np.interp(t, s, dense[:, 1])], axis=1)


def mirror(pts):
    out = pts[::-1].copy()
    out[:, 0] = 1.0 - out[:, 0]
    return out


def shape_distance(a, b):
    return float(np.linalg.norm(a - b, axis=1).mean())


def has_self_intersection(pts):
    p = pts[:-1]
    q = pts[1:]
    n = len(p)
    d = q - p
    for i in range(n):
        # Skip adjacent segments; they share an endpoint.
        js = np.arange(i + 2, n if i > 0 else n - 1)
        if len(js) == 0:
            continue
        r = d[i]
        s = d[js]
        qp = p[js] - p[i]
        rxs = r[0] * s[:, 1] - r[1] * s[:, 0]
        qpxr = qp[:, 0] * r[1] - qp[:, 1] * r[0]
        with np.errstate(divide="ignore", invalid="ignore"):
            t = (qp[:, 0] * s[:, 1] - qp[:, 1] * s[:, 0]) / rxs
            u = -qpxr / rxs
        hit = (rxs != 0) & (t > 1e-9) & (t < 1 - 1e-9) & (u > 1e-9) & (u < 1 - 1e-9)
        if hit.any():
            return True
    return False


def refit(pts):
    segs = schneider_fit([tuple(p) for p in pts], REFIT_TOL)
    flat = [segs[0][0]]
    for s in segs:
        flat.extend([tuple(s[1]), tuple(s[2]), tuple(s[3])])
    flat[0] = (0.0, 0.0)
    flat[-1] = (1.0, 0.0)
    return flat


def in_range(v, lo_hi):
    return lo_hi[0] <= v <= lo_hi[1]


def validate(flat_path, envelope=ENVELOPE, segment_range=SEGMENT_RANGE):
    n_segs = (len(flat_path) - 1) // 3
    if not (segment_range[0] <= n_segs <= segment_range[1]):
        return None, f"segment count {n_segs}"

    dense = _sample_bezier_path(flat_path, samples_per_seg=60)
    if dense[:, 0].min() < -0.01 or dense[:, 0].max() > 1.01:
        return None, "x outside [0, 1]"
    if dense[:, 1].min() < -0.01:
        return None, "dips below chord"
    if has_self_intersection(dense[::3]):
        return None, "self-intersection"

    shape = analyze_tab_shape(flat_path)
    if not shape:
        return None, "no landmarks"
    checks = [
        ("apex_y", shape["apex_y"]),
        ("neck_width", shape["neck_width"]),
        ("head_width", shape["head_width"]),
        ("neck_y", shape["neck_y"]),
        ("head_y", shape["head_y"]),
    ]
    for key, value in checks:
        if not in_range(value, envelope[key]):
            return None, f"{key}={value:.3f} outside envelope"
    if shape["neck_y"] >= shape["head_y"]:
        return None, "neck not below head"
    for key in ("neck_center_x", "head_center_x"):
        if shape[key] is None or not (0.0 <= shape[key] <= 1.0):
            return None, f"{key} outside [0, 1]"
    return shape, None


def letter_suffix(index):
    n = index - 2  # 02-tab-a starts the sequence
    if n < 26:
        return chr(ord("a") + n)
    return chr(ord("a") + (n - 26) // 26) + chr(ord("a") + n % 26)


def synthesize(count, seed, start_index):
    library = load_library()
    base = np.stack([resample_arclen([(p["x"], p["y"]) for p in t["path"]]) for t in library])
    exemplars = np.concatenate([base, np.stack([mirror(p) for p in base])])

    flat = exemplars.reshape(len(exemplars), -1)
    mean = flat.mean(axis=0)
    _, singular, components = np.linalg.svd(flat - mean, full_matrices=False)
    score_std = singular / np.sqrt(len(exemplars) - 1)

    rng = np.random.default_rng(seed)
    accepted = []
    rejected = {}
    attempts = 0
    while len(accepted) < count and attempts < count * 200:
        attempts += 1
        picks = rng.choice(len(exemplars), size=BLEND_EXEMPLARS, replace=False)
        weights = rng.dirichlet([DIRICHLET_ALPHA] * BLEND_EXEMPLARS)
        blend = np.tensordot(weights, exemplars[picks], axes=1)

        jitter = rng.normal(0.0, JITTER_SCALE * score_std[:JITTER_COMPONENTS])
        blend = blend + (jitter @ components[:JITTER_COMPONENTS]).reshape(-1, 2)
        blend[0] = (0.0, 0.0)
        blend[-1] = (1.0, 0.0)

        flat_path = refit(blend)
        shape, why = validate(flat_path)
        if why:
            rejected[why] = rejected.get(why, 0) + 1
            continue

        resampled = resample_arclen(flat_path)
        others = [exemplars[i] for i in range(len(exemplars))]
        others += [a["resampled"] for a in accepted]
        others += [mirror(a["resampled"]) for a in accepted]
        nearest = min(shape_distance(resampled, o) for o in others)
        if nearest < MIN_DISTANCE:
            rejected["too close"] = rejected.get("too close", 0) + 1
            continue

        accepted.append({
            "path": flat_path,
            "shape": shape,
            "resampled": resampled,
            "nearest": nearest,
        })
        print(f"accepted {len(accepted)}/{count} "
              f"(attempt {attempts}, segs {(len(flat_path) - 1) // 3}, NN {nearest:.3f})")

    if len(accepted) < count:
        raise RuntimeError(f"only {len(accepted)}/{count} accepted after {attempts} attempts: {rejected}")
    print(f"rejections: {rejected}")

    results = []
    for i, item in enumerate(accepted):
        index = start_index + i
        results.append((f"{index:02d}-tab-{letter_suffix(index)}", item))
    return library, results


def write_json(out_dir, trace_id, item, notes, captured):
    payload = {
        "id": trace_id,
        "source": {
            "photo": "synthetic",
            "captured": captured,
            "notes": notes,
        },
        "path": [{"x": float(x), "y": float(y)} for x, y in item["path"]],
        "landmarks": {
            "apex_y": item["shape"]["apex_y"],
            "head": {
                "y": item["shape"]["head_y"],
                "width": item["shape"]["head_width"],
                "center_x": item["shape"]["head_center_x"],
            },
            "neck": {
                "y": item["shape"]["neck_y"],
                "width": item["shape"]["neck_width"],
                "center_x": item["shape"]["neck_center_x"],
            },
        },
    }
    path = out_dir / f"{trace_id}.json"
    path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {path}")


def write_contact_sheet(out_path, library, results):
    cells = [(t["id"], resample_arclen([(p["x"], p["y"]) for p in t["path"]]), "#9a9a9a")
             for t in library]
    cells += [(trace_id, item["resampled"], "#3a8dde") for trace_id, item in results]

    cols = 8
    rows = (len(cells) + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(cols * 2.0, rows * 2.2))
    for ax in axes.flat:
        ax.axis("off")
    for ax, (trace_id, pts, color) in zip(axes.flat, cells):
        ax.fill(pts[:, 0], pts[:, 1], color=color, alpha=0.25)
        ax.plot(pts[:, 0], pts[:, 1], color=color, lw=1.6)
        ax.plot([0, 1], [0, 0], color="#444444", lw=0.8)
        ax.set_xlim(-0.15, 1.15)
        ax.set_ylim(-0.12, 1.18)
        ax.set_aspect("equal")
        ax.set_title(trace_id, fontsize=8)
    fig.tight_layout()
    fig.savefig(out_path, dpi=110)
    plt.close(fig)
    print(f"wrote {out_path}")


def main():
    parser = argparse.ArgumentParser(
        prog="synthesize-tab",
        description="Synthesize new traced-tab JSONs from the existing library.",
    )
    parser.add_argument("--out", required=True, help="Output directory.")
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--seed", type=int, default=20260823)
    parser.add_argument("--start-index", type=int, default=22,
                        help="First file index; ids continue the NN-tab-<letters> sequence.")
    parser.add_argument("--captured", default=datetime.date.today().isoformat(),
                        help="Value for source.captured (defaults to today).")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    library, results = synthesize(args.count, args.seed, args.start_index)
    notes = f"Synthesized from the v1 traced library (tools/trace-tab/synthesize.py, seed {args.seed})"
    for trace_id, item in results:
        write_json(out_dir, trace_id, item, notes, args.captured)
    write_contact_sheet(out_dir / "contact-sheet.png", library, results)
    return 0


if __name__ == "__main__":
    sys.exit(main())
