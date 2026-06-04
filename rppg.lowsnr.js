// LOW-SNR characterization for the rPPG core — INFORMATIONAL, not a pass/fail gate, and intentionally
// kept out of CI (its slowest cases dominated test runtime). Run on demand: `node rppg.lowsnr.js`.
//
// At ~0.4% modulation (dim light / poor perfusion) the per-frame SNR is ~-9 dB and mid-to-high rates
// become genuinely unrecoverable. We show the full per-seed SPREAD (min..max across 6 seeds): a tight
// spread near the true rate = still reliable; a wide spread = the estimate has become seed-dependent
// noise. This is exactly the degradation the README documents — printed, not asserted, so it can't go
// stale. (The confidence gate withholds entirely when it's worse than this, rather than guessing.)
const { run } = require('./rppg.synth');

console.log('LOW-SNR  (informational — documents the limit, not a pass/fail gate; 0.4% modulation)');
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
console.log('   wide spread at higher rates = seed-dependent ⇒ unreliable (see README → Known Limitations)');
