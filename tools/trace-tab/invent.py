"""
Invent new traced-tab JSONs from a parametric model of the classic-tab family.

Where synthesize.py blends existing outlines (its output reads as variations
of the library), this tool constructs tabs from structure: a tab is modeled
as a width profile and a center profile over height — chord-wide base
pinching to a neck, flaring to a head, closing in a cap — with sampled
parameters for neck/head proportions, cap roundness vs squareness, lean,
base flare, and small organic noise. Novelty comes from parameter
combinations no library tab has, not from recombining library outlines.

Sampling is stratified across five archetypes (bulb, boxy, lean, tear,
squat) so a batch is visibly varied, and a distinctiveness floor keeps every
result farther from each library tab than typical library neighbors are
from each other. Candidates finish through the same pipeline tail as a photo
trace (Schneider refit, analyze_tab_shape landmarks) and the same structural
validation as synthesize.py, against a moderately widened envelope.

Deterministic for a given --seed and library state.

Usage:
    python tools/trace-tab/invent.py --out <dir> --count 20 --start-index 22
"""

import argparse
import datetime
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from synthesize import (  # noqa: E402
    load_library,
    letter_suffix,
    mirror,
    refit,
    resample_arclen,
    shape_distance,
    validate,
    write_contact_sheet,
    write_json,
)

# Widened relative to synthesize.py's v1-measured envelope: invention is
# allowed to reach shapes the 20 photographed tabs happen not to contain,
# while staying in classic-tab territory.
ENVELOPE = {
    "apex_y": (0.68, 1.18),
    "neck_width": (0.38, 0.66),
    "head_width": (0.55, 0.95),
    "neck_y": (0.12, 0.27),
    "head_y": (0.46, 0.78),
}
SEGMENT_RANGE = (7, 14)

MIN_VS_LIBRARY = 0.055    # library's own pairwise p10 is 0.045; stay above it
MIN_MUTUAL = 0.040        # still ~3x the library's tightest real pair (0.013)

# Parameter windows per archetype. ratio = head/neck width; aratio = apex/neck
# width (the runtime scales the whole tab by 1/neck-width, so these ratios —
# not the raw sizes — decide how the tab reads in-game). cap_p flattens the
# top as it grows; cap_e sharpens the apex as it approaches 1.
ARCHETYPES = {
    "bulb":  {"neckw": (0.38, 0.45), "ratio": (1.85, 2.20), "aratio": (1.80, 2.15),
              "cap_p": (1.6, 2.2), "cap_e": (0.46, 0.54), "lean": 0.04, "heady": (0.60, 0.68)},
    "boxy":  {"neckw": (0.46, 0.56), "ratio": (1.55, 1.78), "aratio": (1.50, 1.70),
              "cap_p": (2.4, 3.2), "cap_e": (0.44, 0.50), "lean": 0.04, "heady": (0.54, 0.64)},
    "lean":  {"neckw": (0.44, 0.55), "ratio": (1.50, 1.80), "aratio": (1.62, 1.95),
              "cap_p": (1.6, 2.2), "cap_e": (0.48, 0.56), "lean": 0.11, "heady": (0.60, 0.70)},
    "tear":  {"neckw": (0.42, 0.50), "ratio": (1.48, 1.68), "aratio": (1.90, 2.15),
              "cap_p": (1.50, 1.90), "cap_e": (0.48, 0.54), "lean": 0.04, "heady": (0.58, 0.66)},
    "squat": {"neckw": (0.51, 0.64), "ratio": (1.58, 1.92), "aratio": (1.40, 1.62),
              "cap_p": (1.8, 3.4), "cap_e": (0.42, 0.54), "lean": 0.08, "heady": (0.62, 0.75)},
}


def resample_polyline(pts, m=200):
    d = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(d)])
    s /= s[-1]
    t = np.linspace(0, 1, m)
    return np.stack([np.interp(t, s, pts[:, 0]), np.interp(t, s, pts[:, 1])], axis=1)


def _hermite(t, y0, y1, m0, m1):
    t2 = t * t
    t3 = t2 * t
    return ((2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0
            + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1)


def sample_params(rng, archetype):
    a = ARCHETYPES[archetype]
    u = lambda lo_hi: float(rng.uniform(*lo_hi))  # noqa: E731
    neckw = u(a["neckw"])
    apex = float(np.clip(neckw * u(a["aratio"]), 0.70, 1.16))
    lean = a["lean"]
    neck_cx = 0.5 + float(rng.uniform(-0.04, 0.04))
    head_cx = neck_cx + float(rng.uniform(-lean, lean)) + float(rng.choice([-1, 1])) * lean * 0.5
    return {
        "neckw": neckw,
        "headw": float(np.clip(neckw * u(a["ratio"]), None, 0.94)),
        "apex": apex,
        "necky": u((0.15, 0.24)),
        "heady": apex * u(a["heady"]),
        "cap_p": u(a["cap_p"]),
        "cap_e": u(a["cap_e"]),
        "neck_cx": neck_cx,
        "head_cx": head_cx,
        "apex_x": head_cx + float(rng.uniform(-0.04, 0.04)),
        # Higher = faster initial narrowing = flatter outline departure at the chord.
        "base_flare": float(rng.uniform(2.0, 3.4)),
        "noise_amp": float(rng.uniform(0.008, 0.028)),
    }


def build_outline(rng, p, samples=260):
    """
    Horizontal-slice model: every classic tab's horizontal slices are single
    intervals, so the silhouette is width(y) and center(y); the outline is
    center ± width/2, traversed up the left side and down the right.
    """
    necky, heady, apex = p["necky"], p["heady"], p["apex"]
    neckw, headw = p["neckw"], p["headw"]

    def width_at(y):
        if y <= necky:
            t = y / necky
            return neckw + (1.0 - neckw) * (1.0 - t) ** p["base_flare"]
        if y <= heady:
            t = (y - necky) / (heady - necky)
            return _hermite(t, neckw, headw, 0.0, 0.0)
        u_cap = (y - heady) / (apex - heady)
        return headw * (1.0 - u_cap ** p["cap_p"]) ** p["cap_e"]

    def center_at(y):
        if y <= necky:
            t = y / necky
            return _hermite(t, 0.5, p["neck_cx"], 0.0, 0.0)
        if y <= heady:
            t = (y - necky) / (heady - necky)
            return _hermite(t, p["neck_cx"], p["head_cx"], 0.0, 0.0)
        t = (y - heady) / (apex - heady)
        return _hermite(t, p["head_cx"], p["apex_x"], 0.0, 0.0)

    # Cosine spacing packs samples toward both ends: the base flare at the
    # chord and the cap's vertical tangent at the apex.
    ys = apex * (1.0 - np.cos(np.pi * np.linspace(0.0, 1.0, samples))) / 2
    ys = np.clip(ys, 0.0, apex)

    phases = rng.uniform(0.0, 2 * np.pi, size=3)
    amps = p["noise_amp"] * rng.uniform(0.3, 1.0, size=3)

    def noise(y, w):
        t = y / apex
        # Fades at chord and apex, and with narrowing width, so the wobble
        # cannot fold the closing cap onto itself.
        envelope = np.sin(np.pi * t) * min(1.0, w / 0.3)
        return envelope * sum(a * np.sin((k + 1) * np.pi * t + ph)
                              for k, (a, ph) in enumerate(zip(amps, phases)))

    left = []
    right = []
    for y in ys:
        w = max(width_at(y), 0.0)
        c = center_at(y) + noise(y, w)
        left.append((c - w / 2, y))
        right.append((c + w / 2, y))
    pts = np.array(left + right[::-1][1:])
    pts[0] = (0.0, 0.0)
    pts[-1] = (1.0, 0.0)
    return pts


def invent(count, seed, start_index):
    library = load_library()
    lib_shapes = [resample_arclen([(pt["x"], pt["y"]) for pt in t["path"]]) for t in library]
    lib_all = lib_shapes + [mirror(s) for s in lib_shapes]

    rng = np.random.default_rng(seed)
    names = list(ARCHETYPES)
    per_archetype = -(-count // len(names))
    pool = {n: [] for n in names}
    rejected = {}
    attempts = 0
    # Overfill each archetype's pool so farthest-point selection has slack.
    # Cheap gates (x bounds, library distance) run on the raw outline before
    # the expensive refit.
    while attempts < count * 6000 and any(len(pool[n]) < per_archetype * 16 for n in names):
        attempts += 1
        name = names[attempts % len(names)]
        if len(pool[name]) >= per_archetype * 16:
            continue
        params = sample_params(rng, name)
        outline = build_outline(rng, params)
        if outline[:, 0].min() < -0.005 or outline[:, 0].max() > 1.005:
            rejected["x outside [0, 1] (outline)"] = rejected.get("x outside [0, 1] (outline)", 0) + 1
            continue
        rough = resample_polyline(outline)
        vs_library = min(shape_distance(rough, s) for s in lib_all)
        if vs_library < MIN_VS_LIBRARY:
            rejected["too close to library"] = rejected.get("too close to library", 0) + 1
            continue
        flat_path = refit(outline)
        shape, why = validate(flat_path, envelope=ENVELOPE, segment_range=SEGMENT_RANGE)
        if why:
            rejected[why] = rejected.get(why, 0) + 1
            continue
        resampled = resample_arclen(flat_path)
        vs_library = min(shape_distance(resampled, s) for s in lib_all)
        if vs_library < MIN_VS_LIBRARY:
            rejected["too close to library"] = rejected.get("too close to library", 0) + 1
            continue
        pool[name].append({
            "path": flat_path,
            "shape": shape,
            "resampled": resampled,
            "archetype": name,
            "vs_library": vs_library,
        })
    print(f"pool: { {n: len(c) for n, c in pool.items()} } after {attempts} attempts; rejections: {rejected}")

    # Greedy farthest-point selection, round-robin over archetypes; every pick
    # maximizes distance to everything already chosen (and its mirror). An
    # archetype whose remaining candidates all fall under the mutual floor
    # drops out and the richer archetypes fill the rest of the batch.
    chosen = []
    chosen_shapes = []
    used = set()
    exhausted = set()
    while len(chosen) < count and len(exhausted) < len(names):
        for name in names:
            if len(chosen) >= count or name in exhausted:
                continue
            best = None
            best_d = -1.0
            for idx, c in enumerate(pool[name]):
                if (name, idx) in used:
                    continue
                d = min((shape_distance(c["resampled"], s) for s in chosen_shapes),
                        default=c["vs_library"])
                d = min(d, c["vs_library"])
                if d > best_d:
                    best, best_d = (name, idx), d
            if best is None or best_d < MIN_MUTUAL:
                exhausted.add(name)
                print(f"{name} exhausted (best remaining {best_d:.3f})")
                continue
            used.add(best)
            item = pool[best[0]][best[1]]
            chosen.append(item)
            chosen_shapes.append(item["resampled"])
            chosen_shapes.append(mirror(item["resampled"]))
            print(f"picked {name} (min distance {best_d:.3f}, vs library {item['vs_library']:.3f})")
    if len(chosen) < count:
        raise RuntimeError(f"only {len(chosen)}/{count} selectable above MIN_MUTUAL={MIN_MUTUAL}")

    results = []
    for i, item in enumerate(chosen[:count]):
        index = start_index + i
        results.append((f"{index:02d}-tab-{letter_suffix(index)}", item))
    return library, results


def main():
    parser = argparse.ArgumentParser(
        prog="invent-tab",
        description="Invent new traced-tab JSONs from a parametric classic-tab model.",
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

    library, results = invent(args.count, args.seed, args.start_index)
    for trace_id, item in results:
        notes = (f"Invented in the classic-tab family "
                 f"(tools/trace-tab/invent.py, {item['archetype']}, seed {args.seed})")
        write_json(out_dir, trace_id, item, notes, args.captured)
    write_contact_sheet(out_dir / "contact-sheet.png", library, results)
    return 0


if __name__ == "__main__":
    sys.exit(main())
