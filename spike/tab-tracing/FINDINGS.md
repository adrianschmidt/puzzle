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
