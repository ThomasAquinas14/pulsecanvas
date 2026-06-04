// Node self-test for the rPPG core. The old version proved only one thing — "72 bpm at 30/24/20/15
// fps works on a single seed" — which is NOT the same as "heart-rate estimation works." This version
// validates the estimator the way it actually has to behave:
//   1) ENVELOPE: accurate across the whole heart-rate band (50..150 bpm) x frame rates x random seeds,
//      in the good-light / hold-still conditions the app asks for. This is the real correctness claim.
//   2) STABILITY: the reading locks and doesn't wildly fluctuate.
//   3) FPS-CORRECTNESS: estimates stay right at lower frame rates (FaceMesh often runs <30fps; the app
//      must pass the ACTUAL rate via setFps, or BPM scales by assumedFps/actualFps).
//   4) LOW-SNR (informational): documents where the estimator stops being reliable, so the README's
//      "known limitations" are backed by reproducible numbers rather than guesswork.
//
// NOISE MODEL: a proper PRNG (mulberry32) fed through a correct Box-Muller. The previous test used a
// weak LCG whose two consecutive outputs are correlated; pushed through Box-Muller that produces noise
// with a structured spectral comb near ~70 bpm — which happens to sit right on 72 and flattered the
// single case the old test checked. Credible, white-ish noise is a strictly stronger validation.
// Run: node rppg.test.js
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

let ok = true;
const median = arr => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// In even light with good perfusion the green pulse modulates ~0.5-2%; we validate at 0.8% with full
// camera noise + lighting drift + slow motion. This is the regime the app instructs users to be in.
const GOOD_AMP = 0.008;
const FPS = [30, 24, 20, 15], BPMS = [50, 60, 72, 90, 120, 150], SEEDS = [11, 23, 37];
const TOL = 8;   // bpm; spectral bin is 1 bpm, so this is a few bins of slack

// ---- 1) ENVELOPE: accurate across the band x frame rates x seeds ----
console.log('1) ENVELOPE  (good light, ' + (GOOD_AMP * 100).toFixed(1) + '% modulation; tol ±' + TOL + ' bpm)');
let envFails = 0, envWorst = 0;
for (const fps of FPS) {
  let line = `   ${String(fps).padStart(2)}fps  `;
  for (const trueBpm of BPMS) {
    const means = SEEDS.map(s => run(fps, trueBpm, s, GOOD_AMP).m);
    const errs = means.map(m => Math.abs(m - trueBpm));
    const worst = Math.max(...errs);
    envWorst = Math.max(envWorst, worst);
    const pass = means.every(m => Number.isFinite(m) && Math.abs(m - trueBpm) <= TOL);
    if (!pass) envFails++;
    line += `t${trueBpm}->${median(means).toFixed(0).padStart(3)}${pass ? '  ' : '✗ '} `;
  }
  console.log(line);
}
console.log(`   ${envFails === 0 ? 'PASS' : 'FAIL (' + envFails + ' cells)'} — worst single-seed error ${envWorst.toFixed(1)} bpm\n`);
ok = ok && envFails === 0;

// ---- 2) STABILITY: locks without wild fluctuation ----
const st = run(30, 72, 11, GOOD_AMP);
const stable = st.sd <= 4 && st.range <= 14;
console.log('2) STABILITY  [30fps t72]  mean=' + st.m.toFixed(1) + '  std=' + st.sd.toFixed(1) +
            '  range=' + st.range + '  ' + (stable ? 'PASS' : 'FAIL') + '\n');
ok = ok && stable;

// ---- 3) FPS-CORRECTNESS: same true rate, no assumedFps/actualFps scaling across frame rates ----
let fpsOk = true;
let fl = '3) FPS-CORRECTNESS  [t72, median of seeds]  ';
for (const fps of FPS) {
  const m = median(SEEDS.map(s => run(fps, 72, s, GOOD_AMP).m));
  const a = Math.abs(m - 72) <= TOL; fpsOk = fpsOk && a;
  fl += `${fps}->${m.toFixed(0)}${a ? '' : '✗'}  `;
}
console.log(fl + ' ' + (fpsOk ? 'PASS' : 'FAIL') + '\n');
ok = ok && fpsOk;

// ---- 4) LOW-SNR (informational, not asserted): where reliability ends ----
// At ~0.4% modulation (dim light / poor perfusion) the per-frame SNR is ~-9 dB and mid-to-high rates
// become genuinely unrecoverable. We show the full per-seed SPREAD (min..max across 6 seeds): a tight
// spread near the true rate = still reliable; a wide spread = the estimate has become seed-dependent
// noise. This is exactly the degradation the README documents — printed, not asserted, so it can't go
// stale. (The confidence gate withholds entirely when it's worse than this, rather than guessing.)
console.log('4) LOW-SNR  (informational — documents the limit, not a pass/fail gate; 0.4% modulation)');
const LOW_SEEDS = [11, 23, 37, 52, 64, 88];
for (const fps of [30, 15]) {
  let line = `   ${String(fps).padStart(2)}fps  `;
  for (const trueBpm of [60, 90, 120]) {
    const means = LOW_SEEDS.map(s => run(fps, trueBpm, s, 0.004).m).filter(Number.isFinite);
    if (!means.length) { line += `t${trueBpm}-> n/a        `; continue; }
    const lo = Math.min(...means).toFixed(0), hi = Math.max(...means).toFixed(0);
    line += `t${trueBpm}->[${String(lo).padStart(3)}..${String(hi).padStart(3)}]  `;
  }
  console.log(line);
}
console.log('   wide spread at higher rates = seed-dependent ⇒ unreliable (see README → Known Limitations)\n');

console.log(ok
  ? 'PASS ✓ — accurate across 50–150 bpm and 15–30 fps in good conditions, stable, and FPS-correct.'
  : 'FAIL — see above.');
process.exit(ok ? 0 : 1);
