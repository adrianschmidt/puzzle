# Tab-tracing spike

Standalone Python script that tests whether we can auto-vectorize puzzle
tab silhouettes into normalized cubic-Bezier paths usable by the puzzle
app's `TabTemplate` system.

This is a spike, not production code. See `FINDINGS.md` for results.

## Setup

Requires Potrace (CLI) and a conda env with OpenCV + scikit-image + scipy:

```sh
brew install potrace
conda create -n puzzle-tab-spike -y --override-channels -c conda-forge \
    python=3.12 opencv scikit-image numpy matplotlib scipy
```

## Run

```sh
conda activate puzzle-tab-spike
python spike.py
```

Outputs land in `out/`:

- `01-reference.png` — synthesized clean tab silhouette
- `01b-reference-noisy.png` — same with blur + noise + specks (photo sim)
- `02-traced-*.svg` — raw Potrace output for each config
- `03-overlay.png` — side-by-side original vs traced for 4 configs
- `04-metrics.txt` — segment counts and deviation numbers
- `05-normalized.json` — best traced path, ready for the TabTemplate convention
