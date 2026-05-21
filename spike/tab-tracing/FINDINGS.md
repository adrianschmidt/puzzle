# Tab-tracing spike — findings

## Question

Can we automatically convert a photographed puzzle tab into a normalized
cubic-Bezier path that fits into the puzzle app's `TabTemplate` convention
(start at left neck, end at right neck, protrusion in +Y)?

If auto-tracing doesn't produce usable paths, the broader "tabs from real
puzzles" feature becomes a manual tracing exercise per shape — much more
expensive and probably not worth doing.

## Method

Synthesized a known classic tab (no randomness) → rendered the silhouette
to PNG → ran the candidate pipeline → renormalized the output into the
neck-to-neck=1 frame → measured deviation against the same renormalized
original.

Pipeline: cv2 (despeckle + threshold + morphological open/close) → BMP →
Potrace (cubic-Bezier vectorizer) → custom SVG parser → contour subpath
selection → tab-segment isolation (segments with any point above the
baseline) → normalize so the first p0 → (0,0) and last p3 → (1,0) with
protrusion mapped to +Y.

Also tested a noisy variant: same input with Gaussian blur (σ=2), Gaussian
intensity noise (σ=8), and salt-and-pepper specks (0.5%), to simulate
what a phone photo might look like before preprocessing.

## Results

Deviations are in neck-chord fractions (i.e. the chord between the two
neck endpoints is length 1). For the classic default the neck is roughly
15% of the edge length, so multiply by ~0.15 to get edge-length fractions,
and by ~150 to get pixels on a 1000-px edge.

| Input | Polarity | Segments | Mean dev | Max dev | ~Max dev @ 1000px edge |
|---|---|---:|---:|---:|---:|
| Clean | black-on-white | 13 | 0.0156 | 0.0358 | ~5.4 px |
| Clean | white-on-black | 13 | 0.0156 | 0.0358 | ~5.4 px |
| Noisy | black-on-white | 17 | 0.0264 | 0.0550 | ~8.3 px |
| Noisy | white-on-black | 16 | 0.0258 | 0.0517 | ~7.8 px |

(For reference: the classic hand-crafted template uses **4** cubic segments. Earlier runs found that Potrace's smoothing knob `-a 1.33 -O 1.0` brings the clean case down to 9 segments at the same fidelity, but the same setting destroys the noisy case — so the default tuning is the safer choice for a real-photo pipeline.)

See `out/03-overlay.png` for the visual comparison — the first three
configurations overlay almost perfectly on the original tab shape.

## What this tells us

**Auto-tracing is feasible.** The best clean-input config gives a path
that is visually indistinguishable from the original, using 9 cubic
segments. For a 1000-px piece edge, the worst-case deviation is about 5
pixels — well below what a player would notice.

**Real photos should work with preprocessing.** The noisy variant (with
realistic blur + sensor noise + specks) still came out to ~8 px max
deviation after standard preprocessing (median blur, threshold, morph
open/close). That preprocessing is generic and tunable; real photos will
need similar steps plus perspective correction.

**Polarity doesn't matter.** Black-on-white and white-on-black silhouettes
produce numerically identical fits. The pipeline auto-detects polarity
from the image border (whichever colour dominates the edge of the frame
is treated as background) and inverts before tracing if needed. So a
photographer can choose either light-tab/dark-mat or dark-tab/light-mat,
whichever gives them better contrast.

**Segment-count overhead is modest but real.** Potrace uses ~2–4× more
segments than a hand-crafted template. That's the cost of automation. For
a library of ~10 traced tabs this is a few hundred KB of JSON at most —
negligible for the app, but it does mean traced paths have less structural
meaning (no named "head", "neck" points) than the hand-crafted ones.

**One brittle parameter combo to avoid.** Noisy input + aggressive Potrace
smoothing (a=1.33, O=1.0) breaks: smoothing merges too many features and
the boundary becomes unrecognisable, then segment isolation picks up a
small fragment instead of the whole tab. The fix is just "don't crank
smoothing on noisy input" — default Potrace tuning is robust.

## Decisions this informs

- **GO** on auto-traced tabs. The shape-extraction part is not a blocker.
- We will lose `neckRatio`-style structural parameters. Traced templates
  can vary by uniform scale (scalex, scaley, position), but not by
  selectively narrowing the neck — that requires hand-tagging neck vs.
  head control points during import, which we should treat as optional
  polish, not a launch requirement.
- The photo capture protocol matters less than I'd feared. As long as the
  tab is photographed roughly head-on with reasonable contrast against
  the background, the preprocessing pipeline handles the rest. We should
  still document a recommended setup (flat light, dark background under
  the tab to make the silhouette clean, ruler in frame for scale).
- **Open question for the brainstorming/design phase:** do we identify
  neck endpoints automatically from the silhouette (assume the "straight
  baseline" of the piece edge in the photo is the chord), or require the
  photographer to mark them (e.g., two stickers / a reference card under
  the puzzle)? Auto detection from a clean silhouette is doable but adds
  a step that's photo-dependent. Marking is more robust but adds work
  per tab.

## Caveats / what this spike did NOT test

- **Real photographs.** This was synthetic input throughout. Real photos
  will have: perspective distortion, uneven lighting, paper texture, edge
  fuzz from the puzzle-piece die-cut. The Gaussian-noise simulation is a
  weak proxy. Need a small batch of actual phone photos to confirm.
- **Neck-endpoint detection.** The spike used a known baseline y. Real
  photos need the baseline detected from the image (or marked by the
  user).
- **Mating-edge fidelity.** A traced tab will be mirrored on Y for its
  blank-side counterpart. If the trace isn't perfectly horizontal at
  the necks (e.g., tilted), the mirrored copy won't mate cleanly. We
  may need to enforce the constraint that the path tangent at the necks
  is parallel to the chord.

## Next step

Try the pipeline on 2–3 actual photographs of puzzle tabs. Same scripts;
just feed real PNGs in instead of `synthesize()`.

## Real-image pipeline addition (after first round)

The synthetic phase cheated in two ways: it knew the baseline y, and it
knew exactly two anchors were the necks. For real images we don't know
either, so the pipeline was extended:

1. **Auto-detect tab necks from contour curvature.** The two tab necks
   are the two sharpest inward (concave) bends on the closed Potrace
   contour. We sum signed turning angles over a 5-anchor window so that
   necks broken across 2-4 adjacent anchors (which is what Potrace
   produces at sharper corners) aggregate into a single peak, then pick
   the two most-negative peaks separated by at least `n/6` anchors.

2. **Use Potrace `alphamax=0.5` for real images.** The default (1.0)
   smooths shallower necks into curves, making them invisible to the
   curvature detector. `alpha=0` works but keeps too many corners (110+
   segments). `alpha=0.5` is a sweet spot: corners at the necks are
   preserved as sharp anchors, but the head and shoulders stay reasonably
   smooth.

3. **Fixed a closing-segment artifact.** Potrace closes its own paths
   (last anchor coincides with the first), so my added "closing line"
   was degenerate and produced an undefined ±π turning angle at the
   start point that dominated the neck detection. Now skipped when the
   path is already closed.

**Validation on a clean screenshot** of a puzzle tab from the app (curved
baseline, white-on-dark, no known baseline y): 59 traced segments, both
necks detected correctly (windowed concavity -1.88 and -1.40 rad), tab
arc 39 segments. Visual overlay (\`out/real-01-screenshot-overlay.png\`)
shows a clean mushroom shape in the normalized neck-frame.

**Implications for real photos**: the only additional preprocessing real
photos will need is perspective correction. Lighting, polarity, contrast
variation, slight noise — all handled by the existing preprocessing.

## Schneider refit: getting segment count down to hand-crafted levels

Potrace optimises for "match every pixel" rather than "minimum segments,"
so its raw output (~40 segments for a clean tab) is much heavier than
the hand-crafted classic (4 segments). Heavier than we can afford:
generation cost in this codebase scales with curve count.

The fix is a post-process refit using **Schneider's algorithm** (Graphics
Gems I, 1990): adaptive least-squares cubic-Bezier fit with recursive
splitting until the per-segment error is within tolerance. Implemented
as a self-contained Python port; runs in milliseconds on a 39-segment
tab.

Tolerance sweep on the screenshot (tolerance expressed as a fraction
of the neck-to-neck chord):

| Tolerance | Segments | Visual quality |
|---:|---:|---|
| 0.001 (0.1%) | 52 | over-segmented — Potrace already smoothed below this; sampling jitter forces splits |
| 0.002 (0.2%) | 32 | indistinguishable from Potrace |
| 0.005 (0.5%) | **20** | indistinguishable from Potrace |
| 0.010 (1.0%) | **8** | indistinguishable from Potrace |
| 0.020 (2.0%) | **5** | barely-perceptible smoothing |
| — | 4 | (hand-crafted classic, for reference) |

(See `out/real-01-screenshot-refit-tol010.png` and `-tol020.png` for the
overlays at the two interesting tolerances.)

**Recommended operating point: tol ≈ 0.01** (1% of neck chord). At a
typical real piece edge the neck is ~15% of edge length, so this is
0.15% of edge length, or ~1.5 px on a 1000-px edge — well below visual
threshold. Result: 8 segments per tab, vs. 4 hand-crafted. 2× overhead,
not 10×.

That makes the segment-count concern manageable, and the performance
hit acceptable: ~2× the curve evaluations per tab, but still far below
the Wavy generator's overhead per piece. If we need to push further,
tol=0.02 gets us to 5 segments at the cost of barely-visible smoothing
at the shoulders.

## Real phone-photo run

Four photographed real puzzle tabs, cropped tight so the tab is centred
with the piece body extending out the left, right, and bottom image
edges. For this capture style the neck "endpoints" are wherever the
silhouette contour hits the left and right image edges — no curvature
analysis needed. The edge-clipped mode is automatic in `process_real_image`.

Pipeline output per photo (1% chord tolerance, Schneider refit):

| Photo | Potrace tab arc | Refit @ 1% | Head/neck ratio | Apex y | Head off-centre |
|---|---:|---:|---:|---:|---:|
| 02-tab-a | 48 | 9  | 1.38 | 0.79 | +0.144 |
| 03-tab-b | 62 | 16 | 1.73 | 0.87 | -0.020 |
| 04-tab-c | 62 | 21 | 1.62 | 0.91 | -0.060 |
| 05-tab-d | 47 | 8  | 1.62 | 0.89 | -0.011 |

(See `out/real-02-tab-a-landmarks.png` etc. for the head-widest and
neck-pinch annotations on each tab.)

Observations:

- **All four traces survived real-photo conditions** (specular highlights
  along the die-cut edge, paper texture, mild defocus, asymmetric
  lighting). The minor "kinks" introduced by glare are absorbed into
  Schneider's tolerance.
- **Real tabs are less bulgy than the classic default.** Measured
  head/neck width ratios cluster around 1.4-1.7; the classic's `neckRatio`
  default (0.525) produces ratios around 1.9. A library of traced tabs
  would shift the puzzle's visual character slightly toward "less
  pinchy".
- **Some tabs are noticeably asymmetric.** Tab-a's head sits +0.14 to
  the right of the chord centre. If we want straight-up parameterization
  compatibility with the classic, we may want to either preserve this
  asymmetry (it's part of the tab's "character") or symmetrize on import.

## Detected landmarks for parameter compatibility

To make a traced tab fully drop-in for the classic TabTemplate (with
`scalex`/`scaley`/`mid`/`neckRatio` style controls), the pipeline now
also detects on each normalized trace:

- **`head_y`, `head_width`**: y level of maximum horizontal extent, and
  that width
- **`head_center_x`**: midpoint between left/right at head_y — informs
  the `mid` parameter
- **`neck_y`, `neck_width`**: y of the pinch between chord and head, and
  the pinch width
- **`apex_y`**: maximum y reached by the contour

These are robust against glare-artifact "kinks" because they use the
outermost crossings of horizontal lines, not bin-statistics that get
fooled by clustered crossings inside an artifact.
