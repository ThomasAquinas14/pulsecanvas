# Deploying PulseCanvas

PulseCanvas is a static site (`index.html` + `rppg.js`, `heatmap.js`, `app.js`).
No build step. The webcam requires a **secure context**, so it must be served over
**HTTPS** (or `localhost`). All three options below give you HTTPS automatically.

Pick any one.

## 1. GitHub Pages

```bash
git init
git add .
git commit -m "PulseCanvas"
git branch -M main
git remote add origin https://github.com/<you>/pulsecanvas.git
git push -u origin main
```

Then in the GitHub repo: **Settings -> Pages -> Build and deployment -> Source:
"Deploy from a branch" -> Branch: `main` / `/ (root)` -> Save.**

Your site appears at:

```
https://<you>.github.io/pulsecanvas/
```

(A workflow at `.github/workflows/pages.yml` is also included; if you prefer it, set
the Pages **Source** to "GitHub Actions" instead — it publishes the repo root on every
push to `main`.)

## 2. Netlify (drag & drop)

1. Go to https://app.netlify.com/drop
2. Drag the **project folder** onto the page.
3. Done — Netlify gives you an `https://<random-name>.netlify.app` URL instantly.

## 3. Vercel

From the project folder:

```bash
npx vercel
```

Answer the prompts (accept defaults; it's a static site). Vercel returns an
`https://<project>.vercel.app` URL. Run `npx vercel --prod` to promote to production.

---

**Note:** HTTPS is automatic on all three, which is exactly what the webcam needs.
Best experienced in Chrome/Edge (MediaPipe FaceMesh). Video never leaves the browser —
the rPPG runs 100% locally.
