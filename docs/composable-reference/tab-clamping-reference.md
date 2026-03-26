# Clamping Puzzle Tabs to Arbitrary Curves — Technical Reference

> **Audience**: You are a Claude instance building a puzzle app where puzzle piece edges are defined by arbitrary curves, and puzzle tabs (the protruding/indented connectors) must be attached to those curves. This document explains the geometry, the key pitfalls, and gives you concrete algorithms. The working proof-of-concept code is in `sine-wave.jsx` (attached separately).

---

## 1. The Core Problem

You have:
- A **base curve** `C(t)` parameterised by `t ∈ [0, 1]`, mapping to 2D canvas coordinates `(x, y)`. This could be a sine wave, a spline, a Bézier, anything.
- A **puzzle tab shape** — an open path (not closed) shaped like a horseshoe with flanged ends. Think: flange → neck → bulbous head → neck → flange.
- The tab must be **clamped** to the curve: both endpoints of the tab sit exactly on `C`, and the tab's orientation follows the curve's local slope.

The goal: place the tab at an arbitrary position along `C`, and have it rotate, tilt, and scale naturally with the curve's geometry.

---

## 2. The Coordinate Frame

This is the single most important concept. Everything else follows from it.

### 2.1 Anchors

Pick two points on the curve:
```
P_L = C(t_center - δ)   // left anchor
P_R = C(t_center + δ)   // right anchor
```

These are the endpoints of the tab. The tab shape will be drawn in a **local coordinate system** defined by the line segment `P_L → P_R`.

### 2.2 Tangent and Normal

```
T = (P_R - P_L) / |P_R - P_L|      // unit tangent (along the chord)
N = (T.y, -T.x)                      // unit normal (perpendicular, pointing "outward")
```

**Critical**: The normal `N = (T.y, -T.x)` points to the left of the tangent direction. In screen coordinates (y-down), this means it points "upward" when the chord is horizontal. This is the direction the tab bulge will protrude. If you want the tab to protrude downward (for an indentation/socket), negate N or negate the local y-coordinates of your tab profile.

### 2.3 The Local → Global Transform

Define the midpoint `M = (P_L + P_R) / 2` and the span `s = |P_R - P_L| / 2`.

Any point in local coordinates `(lx, ly)` — where `lx` runs along the chord from `-s` to `+s` and `ly` runs along the normal — maps to canvas coordinates:

```
canvas_x = M.x + lx * T.x + ly * N.x
canvas_y = M.y + lx * T.y + ly * N.y
```

Or equivalently:
```javascript
const toCanvas = (lx, ly) => ({
  x: mx + lx * tx + ly * nx,
  y: my + lx * ty + ly * ny,
});
```

**This is the entire trick.** You define the tab shape once in local coordinates (as if it were sitting on a horizontal line), and the transform handles all rotation automatically. There is no explicit rotation angle, no `Math.atan2`, no rotation matrix. The tangent/normal vectors *are* the rotation.

---

## 3. Fixed Chord Length (The Hypotenuse Problem)

### 3.1 The Naive Approach (Wrong)

The obvious first attempt:
```
t_L = t_center - halfWidth / curveLength
t_R = t_center + halfWidth / curveLength
```

This fixes the **parametric distance** (or, if your parameterisation is uniform in x, the x-distance). But the **chord length** `|P_R - P_L|` varies depending on slope. On steep parts of the curve, the y-delta inflates the chord; on flat parts, it's purely horizontal. This makes the tab visually grow and shrink as you slide it along the curve.

### 3.2 The Fix: Bisection

Solve for `δ` such that `|C(t_center + δ) - C(t_center - δ)| = desired_chord_length`.

```javascript
const DESIRED_CHORD = drawWidth / 8;

let lo = 0, hi = 0.5;
for (let i = 0; i < 30; i++) {  // 30 iterations ≈ 1e-9 precision, overkill but cheap
  const mid = (lo + hi) / 2;
  const pL = curvePoint(clamp(tCenter - mid, 0, 1));
  const pR = curvePoint(clamp(tCenter + mid, 0, 1));
  const dist = Math.hypot(pR.x - pL.x, pR.y - pL.y);
  if (dist < DESIRED_CHORD) lo = mid; else hi = mid;
}
const delta = (lo + hi) / 2;
```

**Why bisection works**: The chord length is monotonically increasing with `δ` (for any reasonable curve without self-intersections in the local region). Bisection is dead simple, converges fast, and has no edge cases.

**Why not Newton's method**: You'd need the derivative of chord length w.r.t. δ, which requires the curve's derivative. Bisection doesn't need any derivatives and is more than fast enough for real-time rendering.

### 3.3 Clamping

Clamp `t_L` and `t_R` to `[0, 1]` so the tab doesn't walk off the curve. You may also want to limit `tCenter` to `[margin, 1-margin]` in the UI.

---

## 4. The Tab Shape Profile

### 4.1 Definition in Local Coordinates

The tab is defined as a sequence of cubic Bézier segments in `(lx, ly)` space, where:
- `lx ∈ [-s, +s]` (s = half the chord length)
- `ly = 0` is the base curve (the chord line)
- `ly > 0` is the protrusion direction

The profile (left-to-right):

```
1. Left flange:     straight from (-s, 0) to (-0.62s, 0)
2. Left neck:       Bézier curving inward then up — narrower than the flanges
3. Left head:       Bézier sweeping up to the apex
4. Right head:      Mirror of left head, sweeping down
5. Right neck:      Mirror of left neck
6. Right flange:    straight to (+s, 0)
```

### 4.2 Concrete Bézier Control Points

Here's the full profile from the working implementation. All coordinates are relative to `s` (half-chord) and `h` (protrusion height, e.g. `0.65 * chord_length`):

```
Segment         P0              C1              C2              P1
─────────────────────────────────────────────────────────────────
Left neck       (-0.62s, 0)     (-0.52s, 0)     (-0.48s, 0.25h) (-0.35s, 0.32h)
Left head       (-0.35s, 0.32h) (-0.15s, 0.42h) (-0.35s, 0.95h) (0, h)
Right head      (0, h)          (0.35s, 0.95h)  (0.15s, 0.42h)  (0.35s, 0.32h)
Right neck      (0.35s, 0.32h)  (0.48s, 0.25h)  (0.52s, 0)      (0.62s, 0)
```

The flanges are just straight lines from `(±s, 0)` to `(±0.62s, 0)`.

**Key shape characteristics**:
- The neck (0.62s → 0.35s) is narrower than the head, creating the locking shape
- The head's control points create the classic mushroom/bulb profile
- The cross-over in the head Béziers (C1 at -0.15s but C2 at -0.35s) creates the rounded mushroom cap — the curve swings outward past the apex before coming back
- `h ≈ 0.65 * chord_length` gives a good visual proportion

### 4.3 Sampling Béziers

Convert each Bézier to polyline points via De Casteljau / direct evaluation:

```javascript
const bezier = (p0, c1, c2, p1, n = 16) => {
  const points = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    points.push(toCanvas(
      u*u*u*p0[0] + 3*u*u*t*c1[0] + 3*u*t*t*c2[0] + t*t*t*p1[0],
      u*u*u*p0[1] + 3*u*u*t*c1[1] + 3*u*t*t*c2[1] + t*t*t*p1[1]
    ));
  }
  return points;
};
```

12-16 samples per segment is enough for smooth rendering.

---

## 5. Generalisation to Arbitrary Curves

The sine wave in the demo is just one instance. For the puzzle app, `C(t)` will be a general curve (Bézier spline, Catmull-Rom, etc.). The algorithm is **identical** — you only need to change the `curvePoint(t)` function.

### 5.1 Interface

```typescript
type CurvePoint = (t: number) => { x: number; y: number };
```

That's it. The tab-clamping code takes a `CurvePoint` function and a `tCenter` value. Everything else is the same.

### 5.2 Parameterisation Matters

If your curve is a cubic Bézier, `t` is the Bézier parameter, which is **not** uniform in arc length. This means:
- The bisection still works perfectly (it doesn't care about parameterisation)
- But `tCenter = 0.5` won't be the visual midpoint of the curve
- If you want tabs evenly spaced visually, you need arc-length reparameterisation (or just accept the non-uniformity, which is fine for random puzzle cuts)

### 5.3 Multiple Tabs on One Edge

A puzzle edge might have one tab (classic) or multiple features. For multiple tabs:
1. Divide the curve into regions
2. Place each tab's `tCenter` within its region
3. Run the bisection independently for each tab
4. The flanges between tabs are just the bare curve segments between adjacent tab endpoints

---

## 6. Tab Direction (Protrusion vs. Socket)

Each puzzle edge has one piece with a protruding tab and the adjacent piece with the matching socket. Control this by flipping the sign of `ly` in the tab profile:

```javascript
// Protrusion (outward): use profile as-is, ly > 0 goes outward
// Socket (inward): negate all ly values in the profile
const sign = isSocket ? -1 : 1;
const toCanvas = (lx, ly) => ({
  x: mx + lx * tx + (ly * sign) * nx,
  y: my + lx * ty + (ly * sign) * ny,
});
```

---

## 7. Putting It All Together — Algorithm Summary

```
INPUT:
  curvePoint(t) → {x, y}     // the base curve
  tCenter                      // where on the curve (0–1)
  chordLength                  // desired fixed chord length in pixels
  direction                    // +1 for protrusion, -1 for socket

STEP 1: Find anchor delta via bisection
  Solve for δ such that |curvePoint(tCenter+δ) - curvePoint(tCenter-δ)| = chordLength

STEP 2: Compute anchors
  P_L = curvePoint(tCenter - δ)
  P_R = curvePoint(tCenter + δ)

STEP 3: Build coordinate frame
  M = midpoint(P_L, P_R)
  T = normalize(P_R - P_L)          // tangent
  N = (T.y, -T.x) * direction       // normal (flipped for sockets)
  s = chordLength / 2                // half-span

STEP 4: Define tab profile in local coords
  (series of Bézier segments as described in Section 4)

STEP 5: Transform to canvas coords
  For each local point (lx, ly):
    canvas = M + lx * T + ly * N

STEP 6: Render
  Draw as polyline/path with whatever styling you want
```

---

## 8. Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Fixed x-delta instead of fixed chord | Tab grows/shrinks on steep curves | Use bisection (Section 3) |
| Wrong normal direction | Tab protrudes into the piece instead of outward | Check sign of N; in y-down coords, `(T.y, -T.x)` points left of travel direction |
| Explicit rotation angles | Messy trig, gimbal-like edge cases | Use tangent/normal frame directly — no angles needed |
| Non-monotonic chord function | Bisection fails | Only happens with self-intersecting curves or wildly oscillating ones in the local region; keep tab chord length smaller than the curve's local features |
| Tab walks off curve ends | Crash or visual glitch | Clamp tCenter and δ; limit slider range |
| Bézier parameterisation non-uniform | Tabs bunch up on one end of a Bézier edge | Use arc-length reparameterisation, or just accept it for aesthetic randomness |

---

## 9. Reference Implementation

The attached `sine-wave.jsx` is a complete, working React component demonstrating all of the above. Key sections:

- **Lines 124–153**: Bisection solver for fixed chord length
- **Lines 155–170**: Coordinate frame construction (tangent, normal, midpoint)
- **Lines 172–176**: `toC()` — the local-to-canvas transform
- **Lines 178–213**: Tab profile defined as Bézier segments
- **Lines 215–240**: Rendering with glow layers

The curve function is trivially swappable — replace `wavePoint(t)` with any `(t) → {x, y}` and everything else works unchanged.
