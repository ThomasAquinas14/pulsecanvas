// Shared synthetic-signal harness for the rPPG self-tests. Both the asserted CI test (rppg.test.js)
// and the informational low-SNR matrix (rppg.lowsnr.js) drive the estimator through this, so the
// noise model lives in exactly one place.
//
// NOISE MODEL: a proper PRNG (mulberry32) fed through a correct Box-Muller. A weak LCG's two
// consecutive outputs are correlated; pushed through Box-Muller that produces noise with a structured
// spectral comb near ~70 bpm — which sits right on 72 and would flatter that one case. Credible,
// white-ish noise is a strictly stronger validation.
const { PulseSignal } = require('./rppg.js');

const regions = { forehead: 0.0, l_cheek: 0.02, r_cheek: 0.022, nose: 0.015, chin: 0.035 };
const base = [180, 140, 130];

// Per-run Gaussian source: deterministic from `seed`, but uncorrelated (unlike the old LCG).
function makeGauss(seed) {
  let a = seed >>> 0;
  const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  let spare = null;
  return () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    const u = Math.max(1e-12, rnd()), v = rnd(), r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

// Synthesize a realistic noisy rPPG signal of `trueBpm` sampled at `fps`, feed PulseSignal, return the
// steady-state reported-BPM statistics. `amp` is the green-channel pulse modulation depth (SNR knob:
// ~0.8% = good light/perfusion, ~0.4% = dim/poor perfusion).
function run(fps, trueBpm, seed, amp, dur = 30) {
  const HR = trueBpm / 60, N = Math.round(fps * dur), ps = new PulseSignal(fps), gauss = makeGauss(seed);
  let dR = 0, dG = 0, dB = 0; const reported = [];
  for (let i = 0; i < N; i++) {
    const t = i / fps;
    dR += gauss() * 0.25; dG += gauss() * 0.25; dB += gauss() * 0.25;       // lighting drift (random walk)
    const mo = 2.5 * Math.sin(2 * Math.PI * 0.11 * t) + 1.5 * Math.sin(2 * Math.PI * 0.27 * t);  // slow motion
    for (const [id, delay] of Object.entries(regions)) {
      const ph = 2 * Math.PI * HR * (t - delay);
      const p = Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph);   // pulse + harmonics
      const r = base[0] * (1 + amp * 0.3 * p) + dR + mo + gauss() * 1.6;
      const g = base[1] * (1 + amp * 1.0 * p) + dG + mo + gauss() * 1.6;
      const b = base[2] * (1 + amp * 0.2 * p) + dB + mo + gauss() * 1.6;
      ps.push(id, Math.round(Math.max(0, Math.min(255, r))),
                  Math.round(Math.max(0, Math.min(255, g))),
                  Math.round(Math.max(0, Math.min(255, b))));
    }
    ps.tick();
    const bpm = ps.bpm();
    if (bpm && t > 16) reported.push(bpm);                  // steady-state, after lock-in
  }
  if (!reported.length) return { m: NaN, sd: NaN, range: NaN, n: 0 };
  const m = reported.reduce((a, b) => a + b, 0) / reported.length;
  const sd = Math.sqrt(reported.reduce((a, b) => a + (b - m) * (b - m), 0) / reported.length);
  return { m, sd, range: Math.max(...reported) - Math.min(...reported), n: reported.length };
}

const median = arr => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

module.exports = { regions, base, makeGauss, run, median };
