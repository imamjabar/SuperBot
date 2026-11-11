---
name: motion-video
description: "Create short motion graphics, explainers, reels, and kinetic typography videos using HyperFrames in the Private desktop. Use when asked for video, motion, animation, animasi, explainer, promo video, reel, title card, or mp4."
---

# HyperFrames Motion Video

Without vm_exec in this conversation, first call select_computer with surface "vm" to move to the Private desktop; SuperBot resumes you there.

Create short, high-fidelity motion graphics, explainers, promo clips, and kinetic typography videos using the HyperFrames CLI (version 0.9.26) inside the Local VM (`Private desktop`).

All operations run locally inside `/home/cua/workspace`. No cloud rendering, no HeyGen sign-in, and telemetry is disabled.

## Defaults & Standards

| Parameter | Standard / Landscape | Reel / Portrait | Square |
|---|---|---|---|
| **Resolution** | `1920x1080` (`landscape`) | `1080x1920` (`portrait`) | `1080x1080` (`square`) |
| **Duration** | 15–45 seconds | 15–30 seconds | 15–30 seconds |
| **Frame rate** | 30 fps | 30 fps | 30 fps |
| **Safe margin** | 80 px all sides | 120 px top/bottom, 60 px sides | 60 px all sides |
| **Typography** | Headlines >= 48 px, body >= 28 px | Headlines >= 56 px, body >= 32 px | Headlines >= 44 px, body >= 26 px |

- Audio: Use royalty-free synthesized audio or sound effects. Never use copyrighted commercial tracks.
- Size limit: Chat `attach_file` accepts up to 25 MB. If the output exceeds 24 MB, compress it with the helper script before attaching.

---

## Step-by-Step Workflow

```
Brief ──> hyperframes init ──> Read Docs & Author HTML ──> check ──> snapshot QA ──> Render ──> attach_file
```

### 1. Brief & Project Scaffold
Choose resolution (`landscape`, `portrait`, or `square`) and run `hyperframes init` non-interactively via `vm_exec`:
```bash
hyperframes init promo-video --non-interactive --skip-skills --example blank --resolution landscape
cd promo-video
```

### 2. Read HyperFrames Documentation Before Authoring
Before writing the HTML composition, consult the built-in reference topics for syntax and rules:
```bash
hyperframes docs data-attributes
hyperframes docs compositions
hyperframes docs gsap
hyperframes docs rendering
```

### 3. Author the Composition (`index.html`)
Edit `index.html` with clean HTML, CSS, and GSAP animations:
- Define timeline timing on the root container:
  `<div id="app" data-duration="15" data-fps="30">`
- Sequence visual scenes using `data-start` and `data-duration`:
  `<section class="scene" data-start="0" data-duration="5">`
  `<section class="scene" data-start="5" data-duration="5">`
- Keep animations deterministic:
  - Animate strictly via GSAP timelines tied to composition progress.
  - Do not use non-deterministic sources like `Math.random()`, unseeded noise, or unbounded `setInterval`.
  - Ensure fonts and assets are loaded locally or packaged with the composition.

### 4. Validate Composition Structure
Run `hyperframes check` to lint the timeline, verify scene boundaries, and catch missing assets:
```bash
hyperframes check
```
If errors are reported (e.g. invalid attribute syntax, clip overlap, missing selector), fix `index.html` and rerun `hyperframes check`.

### 5. Visual QA via Snapshots
Capture key frames to verify composition styling, alignment, and legibility before full rendering:
```bash
hyperframes snapshot --times 0,3,7,11,14 -o snapshots/
```
Inspect the output paths in the CLI log. If needed, attach a sample snapshot to the chat with `attach_file` to confirm visual layout.

### 6. Render the Video
For quick iteration, run a draft render first:
```bash
hyperframes render -o draft.mp4 --quality draft --workers 1
```

For the final render, run detached in the background with log redirection so long jobs do not block:
```bash
bash -c 'set -m; HYPERFRAMES_RENDER_DETACHED=1 hyperframes render -o final.mp4 --quality looks --workers 1 < /dev/null > render.log 2>&1 &'
```
Poll the progress by reading `render.log`:
```bash
tail -n 10 render.log
```
Wait until the log reports render completion and output file creation.

### 7. Size Check and Compression
Check output file size:
```bash
ls -lh final.mp4
```
If `final.mp4` exceeds 24 MB (chat attachment cap is 25 MB), compress it with the helper script:
```bash
/opt/superbot/skills/motion-video/encode_for_chat.sh final.mp4 chat_final.mp4
```
This applies H.264 constrained bitrate encoding, AAC audio, and `+faststart` metadata for instant playback.

### 8. Deliver to Chat
Attach the finished `.mp4` file:
`attach_file` with `path: "/home/cua/workspace/promo-video/final.mp4"` (or `chat_final.mp4`).

In your message, summarize the video topic, duration, resolution, and key scenes created.

---

## Example Composition Skeleton

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Promo Video</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f172a; color: #f8fafc; font-family: sans-serif; overflow: hidden; }
    #app { width: 1920px; height: 1080px; position: relative; display: flex; align-items: center; justify-content: center; }
    .scene { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0; padding: 80px; }
    .headline { font-size: 64px; font-weight: 800; color: #38bdf8; margin-bottom: 24px; text-align: center; }
    .subline { font-size: 32px; color: #94a3b8; text-align: center; max-width: 1200px; }
  </style>
</head>
<body>
  <div id="app" data-duration="12" data-fps="30">
    <section class="scene scene-1" data-start="0" data-duration="6">
      <h1 class="headline">Autonomous Workflow Engine</h1>
      <p class="subline">Execute tasks in isolated, hardened sandboxes.</p>
    </section>
    <section class="scene scene-2" data-start="6" data-duration="6">
      <h1 class="headline">Fast. Reliable. Private.</h1>
      <p class="subline">Everything runs in your private desktop.</p>
    </section>
  </div>
  <script src="node_modules/gsap/dist/gsap.min.js"></script>
  <script>
    const tl = gsap.timeline();
    tl.to(".scene-1", { opacity: 1, duration: 0.8, ease: "power2.out" })
      .to(".scene-1", { opacity: 0, duration: 0.8, ease: "power2.in", delay: 3.5 })
      .to(".scene-2", { opacity: 1, duration: 0.8, ease: "power2.out" })
      .to(".scene-2", { opacity: 0, duration: 0.8, ease: "power2.in", delay: 3.5 });
  </script>
</body>
</html>
```
