// Node self-test for the rPPG core — the ASSERTED correctness gate (fast; runs in CI). The old version
// proved only one thing — "72 bpm at 30/24/20/15 fps works on a single seed" — which is NOT the same as
// "heart-rate estimation works." This version validates the estimator the way it actually has to behave:
//   1) ENVELOPE: accurate across the whole heart-rate band (50..150 bpm) x frame rates x random seeds,
//      in the good-light / hold-still conditions the app asks for. This is the real correctness claim.
//   2) STABILITY: the reading locks and doesn't wildly fluctuate.
//   3) FPS-CORRECTNESS: estimates stay right at lower frame rates (FaceMesh often runs <30fps; the app
//      must pass the ACTUAL rate via setFps, or BPM scales by assumedFps/actualFps).
//
// The informational low-SNR matrix (where reliability ends, backing the README's "known limitations")
// is NOT asserted, and its slowest cases dominated runtime — it now lives in `rppg.lowsnr.js`, run on
// demand (`node rppg.lowsnr.js`) so CI feedback stays fast.
//
// Run: node rppg.test.js
require('./rppg.js');
const { run, median } = require('./rppg.synth');

let ok = true;

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

console.log(ok
  ? 'PASS ✓ — accurate across 50–150 bpm and 15–30 fps in good conditions, stable, and FPS-correct.'
  : 'FAIL — see above.');
console.log('(low-SNR limits are documented separately: `node rppg.lowsnr.js`)');
process.exit(ok ? 0 : 1);
