// app.js — webcam + MediaPipe FaceMesh -> per-region rPPG -> face glow + beating heart + live
// plethysmograph waveform + BPM. The rPPG math (rppg.js) is validated in Node (rppg.test.js);
// this file is browser glue + rendering.

const video = document.createElement('video');
video.setAttribute('playsinline', '');
document.body.appendChild(video);

const view = document.getElementById('view');
const ctx = view.getContext('2d');
const wave = document.getElementById('wave');
const wctx = wave.getContext('2d');
const bpmEl = document.getElementById('bpm');
const heartEl = document.getElementById('heart');
const statusEl = document.getElementById('status');
const qEl = document.getElementById('quality');
const noteEl = document.getElementById('note');

function showNote(msg) { if (noteEl) { noteEl.textContent = msg; noteEl.classList.add('show'); } }

// Secure-context hint: getUserMedia needs https or localhost. Warn early if neither.
(function secureContextHint() {
  const host = location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
  const isSecure = location.protocol === 'https:' || (typeof isSecureContext !== 'undefined' ? isSecureContext : false);
  if (!isSecure && !isLocal) {
    showNote('Heads up: the webcam needs a secure page. Open this over https, or on localhost / 127.0.0.1.');
  }
})();

// MediaRecorder feature-detect: if missing, disable Record with an explanatory tooltip.
const recordSupported = (typeof MediaRecorder !== 'undefined') &&
  (typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function');

// diagnostic line: the estimator's top spectral candidates (so you can see what it's choosing)
const diag = document.createElement('div');
diag.className = 'diag';
// place it right under the waveform (it's the frequency analysis of that pulse), not at page end
const _wc = document.querySelector('.wave-card');
_wc.parentNode.insertBefore(diag, _wc.nextSibling);

const spark = document.getElementById('spark');
const sparkctx = spark.getContext('2d');
const recordBtn = document.getElementById('record');
let beatFlash = 0, prevNose = null, motion = 0, recording = false, heatAlpha = 0.62;
let lastFrameT = 0, measFps = 30, lastSparkT = 0;
const MOTION_THRESH = 0.02;
const bpmHist = [];

// Skin-region landmark indices (shared with heatmap.js so sampling + rendering stay in sync).
const ROIS = PulseHeatmap.ROIS;

const ps = new PulseSignal(30);
let off, offctx, running = false, heartScale = 1;

function sampleRGB(data, w, h, cx, cy, rad = 6) {
  let r = 0, g = 0, b = 0, n = 0;
  const x0 = Math.max(0, cx - rad), x1 = Math.min(w - 1, cx + rad);
  const y0 = Math.max(0, cy - rad), y1 = Math.min(h - 1, cy + rad);
  for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
    const i = (y * w + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
}

function drawWave() {
  const w = wave.width, h = wave.height;
  wctx.clearRect(0, 0, w, h);
  wctx.strokeStyle = '#191b29'; wctx.lineWidth = 1;
  for (let gx = 0; gx < w; gx += 40) { wctx.beginPath(); wctx.moveTo(gx, 0); wctx.lineTo(gx, h); wctx.stroke(); }

  const data = ps.waveform(Math.max(40, Math.floor(w / 2)));
  if (data.length < 3) {
    wctx.fillStyle = '#52546a'; wctx.font = '13px system-ui';
    wctx.fillText('listening for your pulse…', 14, h / 2);
    return;
  }
  let mn = Infinity, mx = -Infinity;
  for (const v of data) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const rng = (mx - mn) || 1;
  const X = i => (i / (data.length - 1)) * w;
  const Y = i => h - ((data[i] - mn) / rng) * (h * 0.74) - h * 0.13;

  // soft fill under the curve
  wctx.beginPath(); wctx.moveTo(0, h);
  for (let i = 0; i < data.length; i++) wctx.lineTo(X(i), Y(i));
  wctx.lineTo(w, h); wctx.closePath();
  const fill = wctx.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, 'rgba(255,59,107,0.16)'); fill.addColorStop(1, 'rgba(255,59,107,0)');
  wctx.fillStyle = fill; wctx.fill();

  // line: dim on the left, bright at the leading edge
  const grad = wctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'rgba(255,59,107,0.22)'); grad.addColorStop(0.7, '#ff3b6b'); grad.addColorStop(1, '#ff86a8');
  wctx.beginPath();
  for (let i = 0; i < data.length; i++) (i ? wctx.lineTo(X(i), Y(i)) : wctx.moveTo(X(i), Y(i)));
  wctx.strokeStyle = grad; wctx.lineWidth = 2.4; wctx.lineJoin = 'round';
  wctx.shadowColor = '#ff3b6b'; wctx.shadowBlur = 10; wctx.stroke(); wctx.shadowBlur = 0;

  // glowing leading dot (pops on each beat)
  const lx = X(data.length - 1), ly = Y(data.length - 1);
  wctx.beginPath(); wctx.arc(lx, ly, 3.5 + 2.5 * beatFlash, 0, 7);
  wctx.fillStyle = '#fff'; wctx.shadowColor = '#ff3b6b'; wctx.shadowBlur = 14; wctx.fill(); wctx.shadowBlur = 0;
}

function drawSpark(bpm) {
  // P3: sample by TIME (2 Hz) so "last 60s" is actually 60s regardless of the real frame rate
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (bpm && now - lastSparkT >= 500) { lastSparkT = now; bpmHist.push(bpm); if (bpmHist.length > 120) bpmHist.shift(); }
  const w = spark.width, h = spark.height;
  sparkctx.clearRect(0, 0, w, h);
  if (bpmHist.length < 2) return;
  const mn = Math.min(...bpmHist) - 2, mx = Math.max(...bpmHist) + 2, rng = (mx - mn) || 1;
  sparkctx.beginPath();
  for (let i = 0; i < bpmHist.length; i++) {
    const x = (i / (bpmHist.length - 1)) * w, y = h - ((bpmHist[i] - mn) / rng) * (h - 4) - 2;
    i ? sparkctx.lineTo(x, y) : sparkctx.moveTo(x, y);
  }
  sparkctx.strokeStyle = '#ff7aa0'; sparkctx.lineWidth = 1.5; sparkctx.stroke();
}

function recReset() { recording = false; recordBtn.classList.remove('rec'); recordBtn.textContent = '● Record 12s clip'; }
function recFail() { recReset(); recordBtn.disabled = true; recordBtn.title = 'Recording is not available in this browser'; recordBtn.textContent = 'recording unavailable'; }

function startRecording() {
  if (recording || !view.width) return;
  let stream;
  try { stream = view.captureStream(30); } catch (e) { recFail(); return; }
  // pick a container the browser actually accepts (some expose MediaRecorder but reject video/webm)
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  const supports = window.MediaRecorder && MediaRecorder.isTypeSupported;
  const mime = supports ? (types.find(t => MediaRecorder.isTypeSupported(t)) || '') : '';
  let rec;
  try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
  catch (e) { recFail(); return; }
  recording = true; recordBtn.classList.add('rec'); recordBtn.textContent = '● Recording…';
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onerror = () => recReset();
  rec.onstop = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type: mime || 'video/webm' }));
    a.download = 'pulsecanvas.' + (mime.indexOf('mp4') >= 0 ? 'mp4' : 'webm'); a.click();
    recReset();
  };
  try { rec.start(); } catch (e) { recReset(); return; }
  setTimeout(() => { try { if (rec.state !== 'inactive') rec.stop(); } catch (e) {} }, 12000);
}
if (recordSupported) {
  recordBtn.addEventListener('click', startRecording);
} else {
  recordBtn.disabled = true;
  recordBtn.title = 'Recording isn’t supported in this browser';
  recordBtn.textContent = 'recording unsupported';
}

// live tuning (no round-trips): [ and ] adjust heatmap intensity
window.addEventListener('keydown', e => {
  if (e.key === ']') heatAlpha = Math.min(1, heatAlpha + 0.08);
  else if (e.key === '[') heatAlpha = Math.max(0.08, heatAlpha - 0.08);
  else return;
  statusEl.textContent = `heatmap ${Math.round(heatAlpha * 100)}%  ([ / ] to adjust)`;
});

function onResults(res) {
  const w = view.width, h = view.height;
  ctx.save(); ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(res.image, 0, 0, w, h); ctx.restore();

  // P1: estimate the ACTUAL processing frame rate — FaceMesh often runs below 30fps, and the BPM
  // frequency conversion uses it. Hard-coding 30 made BPM scale by assumedFps/actualFps.
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (lastFrameT) {
    const inst = 1000 / Math.max(1, now - lastFrameT);
    measFps = measFps * 0.9 + Math.min(60, Math.max(5, inst)) * 0.1;
    ps.fps = measFps;
  }
  lastFrameT = now;

  const lms = res.multiFaceLandmarks && res.multiFaceLandmarks[0];
  if (lms) {
    // motion gating (computed BEFORE sampling): nose-tip displacement normalized by face width
    const nose = lms[1], fw = Math.abs(lms[454].x - lms[234].x) || 0.2;
    if (prevNose) motion = motion * 0.7 + (Math.hypot(nose.x - prevNose.x, nose.y - prevNose.y) / fw) * 0.3;
    prevNose = { x: nose.x, y: nose.y };

    // P2: only feed CLEAN (low-motion) frames into the estimator — motion-contaminated samples would
    // corrupt the pulse signal and the BPM. While moving, the displayed BPM holds (and is marked stale).
    if (motion <= MOTION_THRESH) {
      offctx.drawImage(res.image, 0, 0, off.width, off.height);
      const img = offctx.getImageData(0, 0, off.width, off.height).data;
      for (const idx of ROIS) {
        const lm = lms[idx];
        const cx = Math.round(lm.x * off.width), cy = Math.round(lm.y * off.height);
        const [r, g, b] = sampleRGB(img, off.width, off.height, cx, cy);
        ps.push(idx, r, g, b);
      }
      ps.tick();
      if (ps.consumeBeat()) {
        beatFlash = 1;
        heartEl.classList.remove('beat'); void heartEl.offsetWidth; heartEl.classList.add('beat');  // re-trigger ring
      }
    }

    // perfusion heatmap overlay (verified module; non-critical: never let a glitch kill BPM/waveform)
    try {
      PulseHeatmap.draw(ctx, w, h, lms, {
        rois: ROIS, faceOval: PulseHeatmap.FACE_OVAL,
        strength: id => ps.regionStrength(id), pulse: ps.pulseNow(),
        alpha: heatAlpha, quality: ps.quality(), motion,
      });
    } catch (e) { /* ignore */ }
  } else {
    statusEl.textContent = 'show your face to the camera';
  }

  // beating heart: continuous throb (synced to the pulse) + a strong pop/flash on each detected beat
  beatFlash *= 0.84;
  const beat = Math.max(0, ps.pulseNow());
  const target = 1 + 0.22 * beat + 0.42 * beatFlash;
  heartScale += (target - heartScale) * 0.55;
  heartEl.style.transform = `scale(${heartScale.toFixed(3)})`;
  const glow = 14 + 44 * beatFlash + 16 * beat;
  heartEl.style.filter = `drop-shadow(0 0 ${glow.toFixed(0)}px rgba(255,75,120,${(0.55 + 0.45 * beatFlash).toFixed(2)})) brightness(${(1 + 0.55 * beatFlash).toFixed(2)})`;

  const bpm = ps.bpm();
  const q = ps.quality();
  qEl.style.width = Math.max(4, Math.min(100, q * 900)) + '%';
  if (bpm) bpmEl.textContent = bpm;
  bpmEl.style.opacity = (lms && motion > MOTION_THRESH) ? '0.45' : '1';   // visibly stale while moving
  if (!lms) {
    statusEl.textContent = 'show your face to the camera';
  } else if (motion > MOTION_THRESH) {
    statusEl.textContent = '○ hold still';
  } else if (bpm) {
    statusEl.textContent = q > 0.045 ? '● live' : '○ low signal — even light';
    if (recordSupported && recordBtn.disabled && !recording) recordBtn.disabled = false;
  } else {
    statusEl.textContent = `locking… ${Math.round(ps.lockProgress() * 100)}%`;
  }
  drawWave();
  drawSpark(bpm);

  // only surface the frequency candidates when there's a genuinely dominant peak; at low signal the
  // spectrum is flat noise (all ~4%) and showing it looks like garbage + contradicts the locked BPM.
  const peaks = ps.topPeaks(3);
  diag.textContent = (peaks.length && peaks[0][1] >= 0.08)
    ? 'candidates:  ' + peaks.map(p => `${p[0]} (${(p[1] * 100).toFixed(0)}%)`).join('   ·   ')
    : '';
}

function setSizes() {
  view.width = video.videoWidth || 640;
  view.height = video.videoHeight || 480;
  off = document.createElement('canvas');
  off.width = Math.round(view.width / 2);
  off.height = Math.round(view.height / 2);
  offctx = off.getContext('2d', { willReadFrequently: true });
  wave.width = wave.clientWidth || 760;
  wave.height = wave.clientHeight || 120;
}

// Sentinel error for "MediaPipe globals never loaded" so the click handler can show a tailored message.
class FaceTrackerUnavailable extends Error {
  constructor() { super('face tracker unavailable'); this.name = 'FaceTrackerUnavailable'; }
}

// Map a thrown start()/getUserMedia error to a clear, human status message.
function cameraErrorMessage(e) {
  if (e instanceof FaceTrackerUnavailable) {
    return 'couldn’t load the face tracker — check your connection';
  }
  const name = e && e.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return 'camera permission denied — allow camera access and click the video to retry';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return 'no camera found — connect a webcam and click the video to retry';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'camera is busy — close other apps using it, then click the video to retry';
  }
  // getUserMedia is undefined / blocked on insecure origins.
  if (name === 'TypeError' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return 'camera needs a secure page (https or localhost) — see the note below';
  }
  return 'camera error: ' + (e && e.message ? e.message : 'unknown');
}

async function start() {
  statusEl.textContent = 'starting camera…';

  // The MediaPipe scripts load from a CDN; if they failed (offline/blocked), the globals are undefined.
  if (typeof FaceMesh === 'undefined' || typeof Camera === 'undefined') {
    throw new FaceTrackerUnavailable();
  }

  // pinned to an exact (immutable) version so the runtime assets can't silently change under us
  const faceMesh = new FaceMesh({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${f}` });
  faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  faceMesh.onResults(onResults);
  const cam = new Camera(video, { onFrame: async () => { await faceMesh.send({ image: video }); }, width: 640, height: 480 });
  await cam.start();
  if (video.videoWidth) setSizes(); else video.addEventListener('loadedmetadata', setSizes, { once: true });
  window.addEventListener('resize', () => { if (running) { wave.width = wave.clientWidth; wave.height = wave.clientHeight; } });
  running = true;
}

// Lightweight consent affordance: click the "Enable camera" prompt (or the video) to start.
const enableBtn = document.getElementById('enable');
let launching = false;
function launch() {
  if (running || launching) return;
  launching = true;
  statusEl.textContent = 'starting camera…';
  start()
    .then(() => enableBtn.classList.add('hide'))
    .catch(e => { const msg = cameraErrorMessage(e); statusEl.textContent = msg; showNote(msg); })
    .finally(() => { launching = false; });
}
enableBtn.addEventListener('click', launch);
document.querySelector('.stage').addEventListener('click', () => { if (!running) launch(); });
