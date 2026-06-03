// heatmap.js — perfusion heatmap renderer. Shared by app.js (live) and _shot.js (headless render
// test), so what I verify in screenshots is exactly what ships. Tunables are grouped at the top.
(function (global) {
  const HW = 64, HH = 64;                 // low-res field -> smooth on upscale
  let heat, heatctx, heatColor, hcctx;

  // skin-region landmark indices (forehead + cheeks + nose + chin = best rPPG signal)
  const ROIS = [
    10, 109, 338, 67, 297, 151, 9, 8, 107, 336,
    50, 101, 118, 117, 123, 147, 205, 36, 142,
    280, 330, 347, 346, 352, 376, 425, 266, 371,
    4, 5, 195, 197, 45, 275,
    152, 175, 199, 200, 18, 83, 313,
  ];
  // MediaPipe FACEMESH_FACE_OVAL, ordered around the boundary (for masking the heatmap)
  const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
    400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

  // ---- tunables (iterate here, verify with: node _shot.js) ----
  const BLOB_ALPHA = 0.2;                 // per-region additive contribution (low -> gradient, no white-out)
  const BLOB_RAD = 0.26;                  // blob radius as a fraction of HW
  const PULSE_FLOOR = 0.4;                // baseline brightness; the rest pulses with the beat
  const BLUR_FRAC = 0.03;                 // blur radius as a fraction of face width

  // luminance -> pure RED glow colormap. Red across the whole range; white-hot ONLY at the extreme
  // peak (t>0.9). No yellow/green plateau -> can never look cream/gold.
  const LUT = (() => {
    const cl = x => Math.max(0, Math.min(1, x));
    const l = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      l[i * 4]     = 200 + cl(t) * 55;            // 200..255, always strongly red
      l[i * 4 + 1] = cl(t - 0.9) * 255 * 5;       // green only at the extreme peak -> hot core
      l[i * 4 + 2] = cl(t - 0.92) * 255 * 5;      // blue only at the very peak
      l[i * 4 + 3] = cl((t - 0.05) * 1.6) * 255;  // fade in from transparent
    }
    return l;
  })();

  function ensureHeat() {
    if (heat) return;
    heat = document.createElement('canvas'); heat.width = HW; heat.height = HH;
    heatctx = heat.getContext('2d', { willReadFrequently: true });
    heatColor = document.createElement('canvas'); heatColor.width = HW; heatColor.height = HH;
    hcctx = heatColor.getContext('2d');
  }

  // ctx: target 2d context (already has the mirrored video drawn). w,h: target size.
  // lms: landmark map (lms[idx] = {x,y} normalized, UNMIRRORED). cfg: see destructure below.
  function draw(ctx, w, h, lms, cfg) {
    ensureHeat();
    const { rois, faceOval, strength, pulse = 0, alpha = 0.6, quality = 0.1, motion = 0 } = cfg;

    let minx = 1, miny = 1, maxx = 0, maxy = 0;     // face bbox in DISPLAY (mirrored) coords
    for (const idx of faceOval) {
      const x = 1 - lms[idx].x, y = lms[idx].y;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
    const bw = maxx - minx, bh = maxy - miny;
    minx -= bw * 0.04; maxx += bw * 0.04; miny -= bh * 0.08; maxy += bh * 0.04;
    const bbw = (maxx - minx) || 1e-3, bbh = (maxy - miny) || 1e-3;

    // 1) accumulate the smooth scalar field (white additive blobs): strength * beat envelope
    heatctx.clearRect(0, 0, HW, HH);
    heatctx.globalCompositeOperation = 'lighter';
    const env = PULSE_FLOOR + (1 - PULSE_FLOOR) * Math.max(0, pulse);
    // base wash so the WHOLE face-oval glows cohesively (not just at the ROI points), brightest at
    // the strong regions which the blobs add on top.
    heatctx.fillStyle = `rgba(255,255,255,${(0.2 * env).toFixed(3)})`;
    heatctx.fillRect(0, 0, HW, HH);
    for (const idx of rois) {
      const lm = lms[idx];
      const hx = ((1 - lm.x) - minx) / bbw * HW, hy = (lm.y - miny) / bbh * HH;
      const mag = 0.45 + 0.55 * Math.sqrt(Math.max(0, strength(idx)));  // baseline + boost: vivid even at low signal
      const val = Math.max(0, Math.min(1, mag * env)) * BLOB_ALPHA;
      if (val <= 0.005) continue;
      const rad = HW * BLOB_RAD;
      const g = heatctx.createRadialGradient(hx, hy, 0, hx, hy, rad);
      g.addColorStop(0, `rgba(255,255,255,${val})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      heatctx.fillStyle = g; heatctx.beginPath(); heatctx.arc(hx, hy, rad, 0, 7); heatctx.fill();
    }
    heatctx.globalCompositeOperation = 'source-over';

    // 2) map field luminance -> colormap
    const fld = heatctx.getImageData(0, 0, HW, HH).data;
    const out = hcctx.createImageData(HW, HH);
    for (let i = 0; i < HW * HH; i++) {
      const Lv = fld[i * 4];
      out.data[i * 4] = LUT[Lv * 4]; out.data[i * 4 + 1] = LUT[Lv * 4 + 1];
      out.data[i * 4 + 2] = LUT[Lv * 4 + 2]; out.data[i * 4 + 3] = LUT[Lv * 4 + 3];
    }
    hcctx.putImageData(out, 0, 0);

    // 3) composite onto the view, clipped to the face oval, blurred + tinted (source-over)
    ctx.save();
    ctx.beginPath();
    for (let k = 0; k < faceOval.length; k++) {
      const lm = lms[faceOval[k]], x = (1 - lm.x) * w, y = lm.y * h;
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.clip();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha * Math.max(0.4, Math.min(1, 0.45 + quality * 8)) * (1 - Math.min(0.7, motion * 18));
    ctx.imageSmoothingEnabled = true;
    ctx.filter = `blur(${Math.max(3, Math.round(bbw * w * BLUR_FRAC))}px)`;
    ctx.drawImage(heatColor, minx * w, miny * h, bbw * w, bbh * h);
    ctx.filter = 'none';
    ctx.restore();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  global.PulseHeatmap = { draw, ROIS, FACE_OVAL };
})(typeof window !== 'undefined' ? window : globalThis);
