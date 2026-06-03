// Node self-test for the rPPG core. Two things:
//   1) accuracy + STABILITY on a realistic noisy 72bpm signal at 30fps (the wild-fluctuation guard)
//   2) FPS-CORRECTNESS: BPM stays ~72 at lower frame rates (FaceMesh often runs <30fps; the app must
//      pass the ACTUAL rate, not assume 30, or BPM scales by assumedFps/actualFps).
// Run: node rppg.test.js
const { PulseSignal } = require('./rppg.js');

const regions = { forehead: 0.0, l_cheek: 0.02, r_cheek: 0.022, nose: 0.015, chin: 0.035 };
const base = [180, 140, 130], amp = 0.004, HR = 1.2;     // true 72 bpm

function gauss(s) {
  s.v = (1103515245 * s.v + 12345) & 0x7fffffff; const a = s.v / 0x7fffffff;
  s.v = (1103515245 * s.v + 12345) & 0x7fffffff; const b = s.v / 0x7fffffff;
  return Math.sqrt(-2 * Math.log(a + 1e-12)) * Math.cos(2 * Math.PI * b);
}

// Generate a realistic noisy 72bpm signal sampled at `fps`, feed PulseSignal(fps), return stats.
function run(fps, dur = 30) {
  const N = Math.round(fps * dur), s = { v: 7 }, ps = new PulseSignal(fps);
  let dR = 0, dG = 0, dB = 0; const reported = [];
  for (let i = 0; i < N; i++) {
    const t = i / fps;
    dR += gauss(s) * 0.25; dG += gauss(s) * 0.25; dB += gauss(s) * 0.25;       // lighting drift
    const mo = 2.5 * Math.sin(2 * Math.PI * 0.11 * t) + 1.5 * Math.sin(2 * Math.PI * 0.27 * t);
    for (const [id, delay] of Object.entries(regions)) {
      const ph = 2 * Math.PI * HR * (t - delay);
      const p = Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph);
      const r = base[0] * (1 + amp * 0.3 * p) + dR + mo + gauss(s) * 1.6;
      const g = base[1] * (1 + amp * 1.0 * p) + dG + mo + gauss(s) * 1.6;
      const b = base[2] * (1 + amp * 0.2 * p) + dB + mo + gauss(s) * 1.6;
      ps.push(id, Math.round(Math.max(0, Math.min(255, r))),
                  Math.round(Math.max(0, Math.min(255, g))),
                  Math.round(Math.max(0, Math.min(255, b))));
    }
    ps.tick();
    const bpm = ps.bpm();
    if (bpm && t > 16) reported.push(bpm);                  // steady-state, after lock-in
  }
  const m = reported.reduce((a, b) => a + b, 0) / reported.length;
  const sd = Math.sqrt(reported.reduce((a, b) => a + (b - m) * (b - m), 0) / reported.length);
  return { m, sd, range: Math.max(...reported) - Math.min(...reported) };
}

let ok = true;

// 1) accuracy + stability at 30fps
const r = run(30);
const acc = Math.abs(r.m - 72) <= 6, stable = r.sd <= 4 && r.range <= 14;
console.log(`[30fps] mean=${r.m.toFixed(1)} (true 72)  std=${r.sd.toFixed(1)}  range=${r.range}  ` +
            `${acc && stable ? 'PASS' : 'FAIL'}`);
ok = ok && acc && stable;

// 2) FPS-correctness across realistic lower frame rates
for (const fps of [24, 20, 15]) {
  const x = run(fps);
  const a = Math.abs(x.m - 72) <= 7;
  console.log(`[${fps}fps] mean=${x.m.toFixed(1)} (true 72)  ${a ? 'PASS' : 'FAIL'}`);
  ok = ok && a;
}

console.log(ok
  ? 'PASS ✓ — accurate, stable, and FPS-correct across frame rates.'
  : 'FAIL — see above.');
process.exit(ok ? 0 : 1);
