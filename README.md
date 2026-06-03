# PulseCanvas

**Your webcam can see your heartbeat — live, in your browser, 100% local.**

PulseCanvas reads the tiny color changes your pulse pushes through your skin and turns them
into a live BPM, a blood-volume-pulse waveform, a beating heart, and a face heatmap that
glows in time with each beat. No app, no upload, no server — the video never leaves your tab.

It uses **remote photoplethysmography (rPPG)**: every heartbeat shifts the color of your skin
by a fraction of a percent. A camera can pick that up. PulseCanvas extracts it with the
**POS algorithm** (Plane-Orthogonal-to-Skin, Wang et al. 2017).

## Run it

It needs a **secure context** (the camera API only works on `localhost` or `https`), so serve
the folder — don't just open the file.

```bash
# pick one
python -m http.server 8000
npx serve .            # then use the port it prints
```

Then open **http://localhost:8000** in **Chrome or Edge** (MediaPipe FaceMesh works best there),
click **Start camera**, and allow the camera prompt.

- Hold still, face the camera, sit in even light.
- The reading **locks in after ~10–15 s** as it gathers enough signal.
- Watch the waveform, the BPM, and the face heatmap pulse together.

## How it works

1. **MediaPipe FaceMesh** tracks your face and gives stable skin landmarks (forehead, cheeks).
2. PulseCanvas averages the RGB at each region every frame and feeds it to the **POS rPPG core**
   (`rppg.js`), which projects the color trace onto a plane orthogonal to the skin-tone direction
   to isolate the pulse and suppress lighting/motion artifacts.
3. It estimates heart rate from the dominant frequency of that pulse signal and renders the live
   blood-volume-pulse waveform.
4. The **face heatmap** colors each region by its local **perfusion strength** — how strong the
   pulse signal is there — and brightens on every detected beat. It's an *amplitude* map, synced
   to your heartbeat.

**Privacy:** everything runs in your browser with JavaScript and Canvas. There is no backend.
Frames are processed in memory and discarded. The only network calls are loading the MediaPipe
library from a CDN.

## Is it real?

Yes — and here's how to trust it instead of taking our word for it:

- The algorithm is **POS (Wang et al. 2017)**, a peer-reviewed, widely-used rPPG method.
- The signal core is **Node-validated and CI-tested on every push**: on a synthetic 72 bpm signal
  with realistic noise it recovers a stable ~72 bpm — and stays correct at 24/20/15 fps, not just 30
  (`node rppg.test.js` → `PASS`).
- **Verify it yourself:** take your pulse at your wrist or neck for 15 seconds and compare. It
  should land close.

**Known limitations:**

- It's sensitive to **motion and lighting**. Moving, talking, or uneven/flickering light degrades
  the reading — the UI tells you to hold still or when signal is low, and **discards motion-contaminated
  frames** rather than letting them corrupt the BPM.
- **Frame rate matters.** Browser face-tracking often runs below 30 fps; PulseCanvas measures the
  *actual* rate so the BPM stays correct, but accuracy degrades a little at very low fps.
- This is a **demo, not a medical device.** Don't use it for any health decision.
- We do **not** claim a "pulse wave traveling across your face." That signal is below webcam SNR;
  PulseCanvas robustly shows the pulse *amplitude* and its perfusion map, not wave propagation.
- **Third-party dependency:** face tracking uses MediaPipe FaceMesh from a **pinned (immutable)** CDN
  version. For a stricter setup, self-host those two files — the rPPG code itself sends nothing.

## Files

| File | What it is |
|------|------------|
| `rppg.js` | The validated POS rPPG signal core (BPM, waveform, per-region strength). |
| `heatmap.js` | The perfusion-heatmap renderer (colormap, blob/field math). |
| `app.js` | Browser glue: webcam, FaceMesh, render loop, BPM/heart/waveform/spark/record. |
| `index.html` | The page, styles, and script includes. |

That's the whole shipped app — four files plus these docs. No build step.

## Deploy

Any static host works (it's just files over HTTPS). See **[DEPLOY.md](DEPLOY.md)** for pointers.

## Credits

- **POS rPPG**: Wang, den Brinker, Stuijk, de Haan — *Algorithmic Principles of Remote PPG*,
  IEEE TBME, 2017.
- Face tracking: **[MediaPipe FaceMesh](https://github.com/google-ai-edge/mediapipe)** by Google.

## License

MIT — see [LICENSE](LICENSE).
