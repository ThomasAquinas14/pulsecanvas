# PulseCanvas — Launch Kit

## One-sentence description

PulseCanvas reads your heartbeat from your webcam entirely in the browser — live BPM, pulse
waveform, and a beat-synced face heatmap, with no upload and no server.

## Suggested repo name

`pulsecanvas`

## GitHub topics

`rppg` · `photoplethysmography` · `heart-rate` · `webcam` · `mediapipe` · `computer-vision`
· `javascript` · `privacy` · `in-browser` · `signal-processing` · `pos-algorithm` · `canvas`

---

## Show HN

### Title

**Show HN: PulseCanvas – see your heartbeat in your browser, 100% local**

### Body

Every heartbeat changes the color of your skin by a fraction of a percent, and a webcam can
pick that up. PulseCanvas does exactly that, entirely in the browser: it shows your live BPM, a
blood-volume-pulse waveform, and a face heatmap that glows in time with each beat. Nothing is
uploaded — frames are processed in your tab and discarded. The only network call is loading
MediaPipe FaceMesh from a CDN.

The signal extraction uses POS (Plane-Orthogonal-to-Skin, Wang et al. 2017), a standard rPPG
method. I validated the core in Node: on a synthetic 72 bpm signal with realistic noise it
recovers a stable ~72 bpm, and there's a one-command test in the repo so you can check.

Honest scoping: it's sensitive to motion and lighting, it locks in after ~10–15 s, and it's a
demo, not a medical device. I deliberately do **not** claim to show a "pulse wave traveling
across the face" — that's below webcam SNR. What it shows robustly is the pulse amplitude and a
perfusion map. Take your wrist pulse and compare. Best in Chrome/Edge.

---

## X / Twitter thread

**1/**
Your webcam can see your heartbeat.

I built PulseCanvas: live BPM + pulse waveform + a face heatmap that beats in time with your
heart. Runs 100% in the browser. Nothing is uploaded. 🫀

**2/**
How? Every heartbeat shifts your skin color by a fraction of a percent. A camera can read it —
it's called remote photoplethysmography (rPPG).

PulseCanvas extracts it with the POS algorithm (Wang et al. 2017).

**3/**
Privacy is the whole point. There's no backend. Frames are processed in memory and thrown away.
The only network request is loading MediaPipe FaceMesh from a CDN.

**4/**
Is it real? I validated the signal core in Node — on a synthetic 72 bpm signal with noise it
recovers a stable ~72 bpm. There's a one-command test in the repo.

Best check: take your wrist pulse and compare.

**5/**
Honest about limits: sensitive to motion + lighting, locks in after ~10–15 s, and it's a demo,
not a medical device.

I do NOT claim a "pulse wave traveling across your face" — that's below webcam SNR. It shows
pulse amplitude + perfusion, done right.

**6/**
Four files, no build step. Open it, allow the camera, hold still for ~15s in Chrome/Edge.

[repo link] — MIT licensed. Try it and tell me your BPM. ⬇️
