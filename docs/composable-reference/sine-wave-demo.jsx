import { useState, useRef, useEffect, useCallback } from "react";

const CANVAS_PAD = 40;
const GLOW_COLOR = "#00ffc8";
const BG = "#0a0e17";
const GRID_COLOR = "rgba(0,255,200,0.06)";
const AXIS_COLOR = "rgba(0,255,200,0.15)";

export default function SineWave() {
  const [frequency, setFrequency] = useState(1);
  const [amplitude, setAmplitude] = useState(0.7);
  const [tabPosition, setTabPosition] = useState(0.5);
  const canvasRef = useRef(null);

  const draw = useCallback(
    () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);

      // Clear
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const drawW = w - CANVAS_PAD * 2;
      const drawH = h - CANVAS_PAD * 2;
      const maxAmp = drawH / 2;

      // Grid
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
      const gridSpacing = 40;
      for (let x = CANVAS_PAD; x <= w - CANVAS_PAD; x += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(x, CANVAS_PAD);
        ctx.lineTo(x, h - CANVAS_PAD);
        ctx.stroke();
      }
      for (let y = CANVAS_PAD; y <= h - CANVAS_PAD; y += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(CANVAS_PAD, y);
        ctx.lineTo(w - CANVAS_PAD, y);
        ctx.stroke();
      }

      // Axes
      ctx.strokeStyle = AXIS_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(CANVAS_PAD, cy);
      ctx.lineTo(w - CANVAS_PAD, cy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, CANVAS_PAD);
      ctx.lineTo(cx, h - CANVAS_PAD);
      ctx.stroke();

      // Axis labels
      ctx.fillStyle = "rgba(0,255,200,0.3)";
      ctx.font = "11px 'DM Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("0", cx, cy + 16);
      ctx.fillText("+1", cx, CANVAS_PAD + 14);
      ctx.fillText("−1", cx, h - CANVAS_PAD - 6);

      // Sine wave — build path
      const points = [];
      const steps = Math.floor(drawW);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = CANVAS_PAD + t * drawW;
        const angle = t * Math.PI * 2 * frequency;
        const y = cy - Math.sin(angle) * amplitude * maxAmp;
        points.push({ x, y });
      }

      // Glow layers (outer to inner)
      const glowLayers = [
        { width: 14, alpha: 0.04 },
        { width: 8, alpha: 0.08 },
        { width: 4, alpha: 0.2 },
        { width: 2.2, alpha: 0.7 },
        { width: 1.2, alpha: 1 },
      ];

      for (const layer of glowLayers) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.strokeStyle =
          layer.alpha === 1
            ? GLOW_COLOR
            : `rgba(0,255,200,${layer.alpha})`;
        ctx.lineWidth = layer.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
      }

      // Fill under curve
      ctx.beginPath();
      ctx.moveTo(points[0].x, cy);
      for (const p of points) ctx.lineTo(p.x, p.y);
      ctx.lineTo(points[points.length - 1].x, cy);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, cy - maxAmp, 0, cy + maxAmp);
      grad.addColorStop(0, "rgba(0,255,200,0.07)");
      grad.addColorStop(0.5, "rgba(0,255,200,0.0)");
      grad.addColorStop(1, "rgba(0,255,200,0.07)");
      ctx.fillStyle = grad;
      ctx.fill();

      // --- Puzzle tab ---
      const tabW = drawW / 8;
      const tCenter = tabPosition;

      // Helper: get canvas coords for a parametric t on the wave
      const wavePoint = (t) => {
        const px = CANVAS_PAD + t * drawW;
        const py = cy - Math.sin(t * Math.PI * 2 * frequency) * amplitude * maxAmp;
        return { x: px, y: py };
      };

      // Bisect to find delta such that chord length == tabW
      // dist(wavePoint(tCenter - delta), wavePoint(tCenter + delta)) == tabW
      let lo = 0;
      let hi = 0.5; // max half-span in t
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        const pL = wavePoint(Math.max(0, Math.min(1, tCenter - mid)));
        const pR = wavePoint(Math.max(0, Math.min(1, tCenter + mid)));
        const dx = pR.x - pL.x;
        const dy = pR.y - pL.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < tabW) lo = mid;
        else hi = mid;
      }
      const delta = (lo + hi) / 2;
      const tL = Math.max(0, Math.min(1, tCenter - delta));
      const tR = Math.max(0, Math.min(1, tCenter + delta));

      // Anchor points on the sine wave
      const pL = wavePoint(tL);
      const pR = wavePoint(tR);
      const lx = pL.x, ly = pL.y;
      const rx = pR.x, ry = pR.y;

      // Local coordinate system: tangent + normal
      const tdx = rx - lx;
      const tdy = ry - ly;
      const span = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
      const ttx = tdx / span;
      const tty = tdy / span;
      const tnx = tty;   // normal x
      const tny = -ttx;  // normal y — points "up" for flat wave

      const mx = (lx + rx) / 2;
      const my = (ly + ry) / 2;

      // Transform local (lx, ly) to canvas coords
      // local x: along tangent, local y: along normal (protrusion)
      const toC = (plx, ply) => ({
        x: mx + plx * ttx + ply * tnx,
        y: my + plx * tty + ply * tny,
      });

      const s = span / 2;
      const th = tabW * 0.65; // protrusion height

      // Build puzzle tab outline using cubic beziers
      // Profile: flange → neck → bulb → neck → flange
      const tabPoints = [];

      // Helper to push a bezier segment as sampled points
      const bezier = (p0, c1, c2, p1, n = 16) => {
        for (let i = 1; i <= n; i++) {
          const t2 = i / n;
          const u = 1 - t2;
          const x2 =
            u * u * u * p0[0] +
            3 * u * u * t2 * c1[0] +
            3 * u * t2 * t2 * c2[0] +
            t2 * t2 * t2 * p1[0];
          const y2 =
            u * u * u * p0[1] +
            3 * u * u * t2 * c1[1] +
            3 * u * t2 * t2 * c2[1] +
            t2 * t2 * t2 * p1[1];
          tabPoints.push(toC(x2, y2));
        }
      };

      // Start at left anchor
      tabPoints.push(toC(-s, 0));
      // Left flange
      tabPoints.push(toC(-s * 0.62, 0));
      // Left neck going inward then up
      bezier(
        [-s * 0.62, 0],
        [-s * 0.52, 0],
        [-s * 0.48, th * 0.25],
        [-s * 0.35, th * 0.32],
        12
      );
      // Left side of head — sweeping up
      bezier(
        [-s * 0.35, th * 0.32],
        [-s * 0.15, th * 0.42],
        [-s * 0.35, th * 0.95],
        [0, th],
        14
      );
      // Right side of head — sweeping down
      bezier(
        [0, th],
        [s * 0.35, th * 0.95],
        [s * 0.15, th * 0.42],
        [s * 0.35, th * 0.32],
        14
      );
      // Right neck going down
      bezier(
        [s * 0.35, th * 0.32],
        [s * 0.48, th * 0.25],
        [s * 0.52, 0],
        [s * 0.62, 0],
        12
      );
      // Right flange
      tabPoints.push(toC(s, 0));

      // Draw tab with glow
      const tabGlow = [
        { width: 10, alpha: 0.06 },
        { width: 5, alpha: 0.15 },
        { width: 2.5, alpha: 0.5 },
        { width: 1.5, alpha: 1 },
      ];

      for (const gl of tabGlow) {
        ctx.beginPath();
        ctx.moveTo(tabPoints[0].x, tabPoints[0].y);
        for (let i = 1; i < tabPoints.length; i++) {
          ctx.lineTo(tabPoints[i].x, tabPoints[i].y);
        }
        ctx.strokeStyle =
          gl.alpha === 1 ? "#ff6be6" : `rgba(255,107,230,${gl.alpha})`;
        ctx.lineWidth = gl.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
      }

      // Anchor dots
      for (const pt of [tabPoints[0], tabPoints[tabPoints.length - 1]]) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#ff6be6";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,107,230,0.3)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

    },
    [frequency, amplitude, tabPosition]
  );

  useEffect(() => {
    draw();
  }, [draw]);

  const sliderTrack = {
    WebkitAppearance: "none",
    appearance: "none",
    width: "100%",
    height: 6,
    borderRadius: 3,
    background: "rgba(0,255,200,0.12)",
    outline: "none",
    cursor: "pointer",
  };

  const sliderThumbCSS = `
    input[type=range]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #00ffc8;
      box-shadow: 0 0 12px rgba(0,255,200,0.5);
      cursor: pointer;
      border: 2px solid #0a0e17;
    }
    input[type=range]::-moz-range-thumb {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #00ffc8;
      box-shadow: 0 0 12px rgba(0,255,200,0.5);
      cursor: pointer;
      border: 2px solid #0a0e17;
    }
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Space+Grotesk:wght@400;600&display=swap');
    .pink-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #ff6be6;
      box-shadow: 0 0 12px rgba(255,107,230,0.5);
      cursor: pointer;
      border: 2px solid #0a0e17;
    }
    .pink-slider::-moz-range-thumb {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #ff6be6;
      box-shadow: 0 0 12px rgba(255,107,230,0.5);
      cursor: pointer;
      border: 2px solid #0a0e17;
    }
  `;

  return (
    <div
      style={{
        background: BG,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
        fontFamily: "'DM Mono', monospace",
        color: GLOW_COLOR,
      }}
    >
      <style>{sliderThumbCSS}</style>

      <h1
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: "clamp(18px, 3vw, 28px)",
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: GLOW_COLOR,
          textShadow: `0 0 30px rgba(0,255,200,0.3)`,
          marginBottom: 24,
          textAlign: "center",
        }}
      >
        Sine Wave
      </h1>

      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          maxWidth: 720,
          height: "clamp(220px, 40vh, 360px)",
          borderRadius: 12,
          border: "1px solid rgba(0,255,200,0.1)",
          background: "rgba(0,0,0,0.3)",
        }}
      />

      <div
        style={{
          width: "100%",
          maxWidth: 720,
          marginTop: 32,
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* Frequency slider */}
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
              fontSize: 13,
              opacity: 0.7,
            }}
          >
            <span>FREQUENCY</span>
            <span
              style={{
                color: "#fff",
                opacity: 0.9,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {frequency.toFixed(1)} Hz
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={frequency}
            onChange={(e) => setFrequency(parseFloat(e.target.value))}
            style={sliderTrack}
          />
        </div>

        {/* Amplitude slider */}
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
              fontSize: 13,
              opacity: 0.7,
            }}
          >
            <span>AMPLITUDE</span>
            <span
              style={{
                color: "#fff",
                opacity: 0.9,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {amplitude.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={amplitude}
            onChange={(e) => setAmplitude(parseFloat(e.target.value))}
            style={sliderTrack}
          />
        </div>

        {/* Tab position slider */}
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
              fontSize: 13,
              opacity: 0.7,
              color: "#ff6be6",
            }}
          >
            <span>TAB POSITION</span>
            <span
              style={{
                color: "#fff",
                opacity: 0.9,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {(tabPosition * 100).toFixed(0)}%
            </span>
          </div>
          <input
            type="range"
            className="pink-slider"
            min="0.06"
            max="0.94"
            step="0.005"
            value={tabPosition}
            onChange={(e) => setTabPosition(parseFloat(e.target.value))}
            style={{
              ...sliderTrack,
              background: "rgba(255,107,230,0.15)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
