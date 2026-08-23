# trace-tab — extract puzzle-tab Bezier paths from photos

Offline pipeline that turns a cropped photograph of a single puzzle tab
into a normalized cubic-Bezier path JSON, suitable for committing into
`src/puzzle/composable/traces/`.

## Setup

```bash
brew install potrace                              # macOS; apt-get on Linux
conda create -n trace-tab python=3.11 -y
conda activate trace-tab
pip install -r tools/trace-tab/requirements.txt
```

## Use

```bash
python tools/trace-tab/main.py photos/tab-12.jpg \
    --id tab-12-blue-cat \
    --notes "blue cat puzzle, top edge" \
    --out src/puzzle/composable/traces/
```

Writes:

- `src/puzzle/composable/traces/tab-12-blue-cat.json`
- `src/puzzle/composable/traces/tab-12-blue-cat-review.png`

If the trace fails with `could not find anchors on both image edges`, the
photo's background likely thresholded into stray foreground blobs — add
`--clean-noise` to keep only the largest silhouette component before Potrace.

## Photo conventions

- Cropped so the neck endpoints fall on the left and right image edges.
- Tab protrudes upward in the photo (Potrace's polarity detection handles
  light-on-dark vs dark-on-light automatically).
- Good lighting, minimal glare. If glare confuses the trace, reshoot.

## Manual acceptance gate

Eyeball the `*-review.png` before committing the JSON. If neck endpoints,
chord, or refit curve look wrong, discard.

## Generate new tabs without photographs

Two generators, different purposes:

- `invent.py` constructs tabs from a parametric model of the classic-tab
  family (width/center profiles over height, stratified across five
  archetypes), producing shapes the library doesn't contain. Use it to
  expand the library with genuinely new silhouettes.
- `synthesize.py` blends existing traces (Dirichlet blends of exemplars plus
  PCA jitter). Its output reads as variations of the library, so it is not
  suited for library expansion — it exists for producing many mild
  variations of the shapes already there.

```bash
python tools/trace-tab/invent.py \
    --out /tmp/invented --count 20 --start-index 22
```

Both are deterministic for a given `--seed`, load every JSON in
`src/puzzle/composable/traces/` (a later batch builds on all shipped traces,
generated ones included), and finish candidates through the same pipeline
tail as a photo trace. Eyeball the generated `contact-sheet.png` (grey =
library, blue = new) before committing; shipping a batch means a new frozen
`TRACE_SETS` entry and a `CURRENT_TRACE_SET_VERSION` bump, never an edit to
an existing set.
