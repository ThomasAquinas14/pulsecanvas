// rppg.js — the validated rPPG core (faithful port of pulsecanvas/probe_rppg.py's POS pipeline,
// including OVERLAP-ADD, which the first JS draft skipped). Pure, dependency-free, testable in Node.
//
// Per frame:
//   for each region: ps.push(regionId, r, g, b)
//   ps.tick()                            // refreshes the continuous pulse signals (throttled)
//   intensity = ps.value(regionId)       // ~[-1,1] instantaneous pulse -> heatmap glow
//   ps.bpm()                             // smoothed, confidence-gated heart rate (locks, no hopping)
//   ps.quality()                         // 0..1 signal confidence for a UI indicator

function mean(a) { let s = 0; for (const x of a) s += x; return s / a.length; }
function std(a) { const m = mean(a); let s = 0; for (const x of a) s += (x - m) * (x - m); return Math.sqrt(s / a.length); }

// Plane-Orthogonal-to-Skin (Wang et al. 2017) on one window. win: array of [r,g,b] -> pulse[win].
function posWindow(win) {
  const L = win.length;
  const mr = mean(win.map(c => c[0])), mg = mean(win.map(c => c[1])), mb = mean(win.map(c => c[2]));
  const s1 = new Array(L), s2 = new Array(L);
  for (let i = 0; i < L; i++) {
    const rn = win[i][0] / (mr + 1e-9), gn = win[i][1] / (mg + 1e-9), bn = win[i][2] / (mb + 1e-9);
    s1[i] = gn - bn;            // [0, 1, -1] . Cn
    s2[i] = -2 * rn + gn + bn;  // [-2, 1, 1] . Cn
  }
  const alpha = std(s1) / (std(s2) + 1e-9);
  const h = new Array(L);
  for (let i = 0; i < L; i++) h[i] = s1[i] + alpha * s2[i];
  const mh = mean(h);
  for (let i = 0; i < L; i++) h[i] -= mh;
  return h;
}

// Overlap-add POS over a whole rolling buffer -> one continuous, normalized pulse signal.
// This is what probe_rppg.py validated (H[n:n+win] += h - mean(h)), NOT a per-frame last sample.
//
// WEIGHTED overlap-add: each window's contribution is tapered by a Hann window and we divide by the
// summed weights (WOLA). A naive rectangular overlap-add of mean-subtracted segments leaves a
// hard discontinuity at every window edge; those edges beat against the hop to plant a spurious
// spectral bump near ~2/windowSec (≈75 bpm for a 1.6 s window) that sits right in the pulse band and,
// at low frame rates, can out-vote the real peak for ANY true heart rate. Tapering removes it.
function posOverlapAdd(rgbBuf, win) {
  const L = rgbBuf.length;
  const H = new Array(L).fill(0);
  if (L < win) return H;
  const wnd = new Array(win), wsum = new Array(L).fill(0);
  for (let i = 0; i < win; i++) wnd[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1));
  for (let n = 0; n <= L - win; n++) {
    const h = posWindow(rgbBuf.slice(n, n + win));
    for (let i = 0; i < win; i++) { H[n + i] += h[i] * wnd[i]; wsum[n + i] += wnd[i]; }
  }
  for (let i = 0; i < L; i++) if (wsum[i] > 1e-9) H[i] /= wsum[i];
  const m = mean(H), s = std(H) + 1e-9;
  for (let i = 0; i < L; i++) H[i] = (H[i] - m) / s;
  return H;
}

class PulseSignal {
  constructor(fps = 30, windowSec = 1.6, bufSec = 11) {
    this.windowSec = windowSec; this.bufSec = bufSec;
    this.buffers = new Map();   // regionId -> array of [r,g,b]
    this.pulses = new Map();    // regionId -> continuous pulse array (latest recompute)
    this.combined = [];         // mean pulse across regions, for the BPM FFT
    this._frame = 0;
    this._hist = []; this._cachedBpm = null; this._conf = 0;
    this._prevV = null; this._lastBeatFrame = -999; this._beats = []; this._beatFlag = false;
    this.setFps(fps);           // sets fps + ALL fps-derived constants (win, bufLen, cadences)
  }

  // Update the frame rate AND everything derived from it. The browser app can't know the true rate up
  // front (FaceMesh runs below 30fps and varies), so it measures and calls this each frame. Mutating a
  // bare `fps` field is NOT enough: win/bufLen/_recomputeEvery/_bpmEvery are all functions of fps, and
  // a stale `win` (e.g. 48 from an assumed 30fps while really at 15fps) makes the POS window cover the
  // wrong span and the BPM scale by assumedFps/actualFps. (Cheap; safe to call every frame.)
  setFps(fps) {
    if (!(fps > 0)) return;
    this.fps = fps;
    this.win = Math.max(12, Math.round(fps * this.windowSec));
    this.bufLen = Math.round(fps * this.bufSec);
    this._recomputeEvery = Math.max(1, Math.round(fps / 10));   // refresh pulses ~10x/sec
    this._bpmEvery = Math.max(1, Math.round(fps * 0.4));        // refresh BPM ~2.5x/sec
  }

  push(regionId, r, g, b) {
    let buf = this.buffers.get(regionId);
    if (!buf) { buf = []; this.buffers.set(regionId, buf); }
    buf.push([r, g, b]);
    if (buf.length > this.bufLen) buf.shift();
  }

  tick() {
    this._frame++;
    if (this.combined.length === 0 || this._frame % this._recomputeEvery === 0) this._recompute();
    // beat detection: rising-edge threshold crossing on the instantaneous pulse, with a refractory
    // period (caps at ~200 bpm) -> one event per systolic upstroke, drives the visual beat flash.
    const v = this.pulseNow();
    if (this._prevV === null) this._prevV = v;
    const minGap = this.fps * 0.3;
    if (this._prevV < 0.15 && v >= 0.15 && (this._frame - this._lastBeatFrame) > minGap) {
      this._lastBeatFrame = this._frame; this._beatFlag = true;
      this._beats.push(this._frame); if (this._beats.length > 24) this._beats.shift();
    }
    this._prevV = v;
  }

  _recompute() {
    let L = Infinity;
    for (const b of this.buffers.values()) L = Math.min(L, b.length);
    if (!isFinite(L) || L < this.win) return;
    if (!this.strengths) this.strengths = new Map();

    // 1) per-region pulse via overlap-add POS
    const ids = [], hs = [];
    for (const [id, buf] of this.buffers) {
      const h = posOverlapAdd(buf.slice(buf.length - L), this.win);
      this.pulses.set(id, h); ids.push(id); hs.push(h);
    }
    // 2) QUALITY-WEIGHTED combine: noisy regions (low prior strength) contribute less -> better SNR
    const sums = new Array(L).fill(0); let wsum = 0;
    for (let r = 0; r < ids.length; r++) {
      const w = 0.2 + (this.strengths.get(ids[r]) || 0);
      wsum += w; const h = hs[r];
      for (let i = 0; i < L; i++) sums[i] += w * h[i];
    }
    if (wsum) for (let i = 0; i < L; i++) sums[i] /= wsum;
    this.combined = sums;

    // 3) per-region PERFUSION STRENGTH = correlation with the combined pulse (0..1). Clean skin
    //    (forehead/cheeks) correlates strongly -> hot; noisy edges -> cool. Drives the heatmap.
    const cm = mean(sums), cs = std(sums) + 1e-9;
    const cN = new Array(L);
    for (let i = 0; i < L; i++) cN[i] = (sums[i] - cm) / cs;
    for (let r = 0; r < ids.length; r++) {
      let acc = 0; const h = hs[r]; for (let i = 0; i < L; i++) acc += h[i] * cN[i];
      acc /= L;
      const prev = this.strengths.get(ids[r]) || 0;
      this.strengths.set(ids[r], prev * 0.6 + Math.max(0, Math.min(1, acc)) * 0.4);
    }
  }

  value(regionId) {
    const h = this.pulses.get(regionId);
    if (!h || !h.length) return 0;
    return Math.max(-1, Math.min(1, h[h.length - 1] / 3));
  }

  quality() { return this._conf; }
  regionStrength(id) { return (this.strengths && this.strengths.get(id)) || 0; }   // 0..1 perfusion
  consumeBeat() { const b = this._beatFlag; this._beatFlag = false; return b; }     // true once per beat
  lockProgress() { return Math.min(1, this.combined.length / (this.fps * 12)); }    // 0..1 warmup

  // For the UI: the latest combined pulse value (drives the global glow + beating heart), and the
  // recent combined waveform (the scrolling plethysmograph trace).
  pulseNow() { const x = this.combined; return x.length ? Math.max(-1, Math.min(1, x[x.length - 1])) : 0; }
  waveform(n = 220) { const x = this.combined; return x.length ? x.slice(Math.max(0, x.length - n)) : []; }

  // Diagnostic: top-k spectral candidates as [bpm, fractionOfBandEnergy]. Lets you SEE what the
  // estimator is choosing between (a clear dominant peak = trustworthy; a flat spread = noise).
  topPeaks(k = 3) {
    if (!this._spec) return [];
    return [...this._spec].sort((a, b) => b[1] - a[1]).slice(0, k)
      .map(s => [s[0], s[1] / (this._total + 1e-9)]);
  }

  _powerAt(bpm) {                                   // spectral power near a given bpm (for octave check)
    if (!this._spec) return 0;
    let best = 0;
    for (const s of this._spec) if (Math.abs(s[0] - bpm) <= 2 && s[1] > best) best = s[1];
    return best;
  }

  // Is `bpm` a genuine local spectral maximum (a real peak), not just incidental shoulder/drift power?
  // Compares the power AT bpm to the power in the shoulders ~6 bpm out on each side.
  _isLocalPeak(bpm) {
    if (!this._spec) return false;
    const at = this._powerAt(bpm);
    let shoulder = 0;
    for (const s of this._spec) {
      const d = Math.abs(s[0] - bpm);
      if (d >= 5 && d <= 8 && s[1] > shoulder) shoulder = s[1];
    }
    return at > shoulder * 1.15;
  }

  // High-pass detrend: subtract a GAUSSIAN-smoothed copy (a clean low-pass) to kill lighting/motion
  // drift below ~0.6 Hz while keeping the whole 46-180 bpm pulse band. A boxcar moving-average has
  // spectral sidelobes that plant spurious in-band peaks (and a hard cutoff that eats true ~50 bpm);
  // a Gaussian kernel has no sidelobes, so the residual is a ripple-free high-pass. sigma ~0.5 s puts
  // the −3 dB corner near 0.6 Hz (~36 bpm): drift dies, true rates from 46 up survive intact.
  _detrend(x) {
    const sigma = Math.max(1, this.fps * 0.5);
    const rad = Math.ceil(sigma * 3);
    const ker = new Array(2 * rad + 1);
    for (let j = -rad; j <= rad; j++) ker[j + rad] = Math.exp(-(j * j) / (2 * sigma * sigma));
    const N = x.length, out = new Array(N);
    for (let i = 0; i < N; i++) {
      let s = 0, wsum = 0;
      const a = Math.max(0, i - rad), b = Math.min(N - 1, i + rad);
      for (let j = a; j <= b; j++) { const w = ker[j - i + rad]; s += x[j] * w; wsum += w; }
      out[i] = x[i] - s / (wsum || 1);
    }
    return out;
  }

  bpm() {
    if (this.combined.length < this.fps * 6) return null;          // ~6s before a first lock
    if (this._cachedBpm !== null && this._frame % this._bpmEvery !== 0) return this._cachedBpm;

    const x = this._detrend(this.combined);
    const N = x.length;
    const spec = [];
    let peakBpm = 0, peakP = -1, total = 0;
    for (let bpm = 46; bpm <= 180; bpm++) {     // floor 46: below this is almost always drift, not pulse
      const f = bpm / 60;
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1));
        const ang = (2 * Math.PI * f * n) / this.fps;
        re += x[n] * w * Math.cos(ang);
        im += x[n] * w * Math.sin(ang);
      }
      const p = re * re + im * im;
      spec.push([bpm, p]);
      total += p;
      if (p > peakP) { peakP = p; peakBpm = bpm; }
    }
    this._spec = spec; this._total = total;
    this._conf = peakP / (total + 1e-9);

    // CONFIDENCE GATE: when no single frequency clearly dominates the band (a flat, noisy spectrum),
    // this cycle's "peak" is just the tallest noise bin — folding it into the median would drag the
    // estimate toward a wrong rate. So skip the update: hold the existing lock if we have one, or
    // withhold a number entirely until real signal returns (better an honest "locking…" than a
    // confident wrong BPM). The band has 135 one-bpm bins, so pure noise sits near 1/135 ≈ 0.007;
    // MIN_CONF is several times that floor, and matches the app's existing "low signal" UI cutoff.
    const MIN_CONF = 0.05;
    if (this._conf < MIN_CONF) {
      this._cachedBpm = (this._disp != null) ? Math.round(this._disp) : null;
      return this._cachedBpm;
    }

    // Robust estimate: MEDIAN of recent per-recompute spectral peaks (~6s @ 2.5 Hz). The dominant
    // pulse frequency wins; transient noise peaks are outvoted. No EMA seed-lock, no freeze.
    // continuity bias: once locked, prefer the spectral peak NEAR the current estimate; jump to a
    // far-off peak only if it is much stronger. Kills harmonic/noise hops (the 53<->73 wobble).
    let chosen = peakBpm;
    if (this._disp != null) {
      let lb = 0, lp = -1;
      for (const s of spec) if (Math.abs(s[0] - this._disp) <= 14 && s[1] > lp) { lp = s[1]; lb = s[0]; }
      if (lb && peakP < lp * 1.6) chosen = lb;
    }
    // octave correction: a pulse's 2nd harmonic can dominate early -> prefer the fundamental if it
    // also has strong power. Stops the "starts at 120, settles to 60" transient. ONLY fold down when
    // the half-rate is a GENUINE local peak of comparable strength (a real fundamental we missed) —
    // otherwise a true high heart rate (120/150) gets wrongly halved by incidental drift power at f/2.
    if (chosen > 90) {
      const half = Math.round(chosen / 2);
      if (half >= 46 && this._isLocalPeak(half) && this._powerAt(half) > 0.85 * this._powerAt(chosen)) chosen = half;
    }
    this._hist.push(chosen);
    if (this._hist.length > 25) this._hist.shift();
    const sorted = [...this._hist].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    // light EMA on the robust median -> kills integer-bin jitter without re-introducing freeze
    this._disp = (this._disp == null) ? med : 0.7 * this._disp + 0.3 * med;
    this._cachedBpm = Math.round(this._disp);
    return this._cachedBpm;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { PulseSignal, posWindow, posOverlapAdd, mean, std };
