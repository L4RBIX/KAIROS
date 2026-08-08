# Stage 1 — Baseline verification

The reference point every later stage is measured against. Captured from the
unmodified project at tag `stage0-baseline` (`5450397`), before any migration
work.

**Nothing under `src/` was changed in this stage.** Visual parity with the
original is guaranteed by construction, not by comparison: the runtime code is
byte-identical to the tagged baseline. The only additions are a verification
harness and this document.

## How to reproduce

```bash
npm install
npm run dev                  # vite, :5173, strictPort
npm run smoke -- <label>     # in a second shell
```

The harness writes `shot-<label>.png` and `smoke-<label>.json` into
`.snapshots/`, which is git-ignored — the repo is source only. Keep the stage-1
capture locally and diff later stages against it.

`CHROME_PATH` overrides the browser binary. The run is deliberately **headed**:
WebGPU on macOS/Metal needs a real surface, and a headless run reports no
adapter regardless of whether the app works.

## Machine

Whatever a result is compared against has to come from the same machine — these
numbers are not portable.

| | |
|---|---|
| Platform | macOS (Darwin 24.6.0), Apple Silicon |
| Node | v24.14.1 |
| npm | 11.11.0 |
| Browser | Google Chrome (system), headed, `--enable-unsafe-webgpu` |
| Viewport | 1600 × 900 |
| Preset | `ultra`, `resolutionScale` 1.0 |

## Verified

| Check | Result |
|---|---|
| `npm install` | clean |
| `npm run build` | succeeds, ~1.4 s, one >500 kB chunk warning (pre-existing) |
| `npm run dev` | serves on :5173 |
| `navigator.gpu` / `requestAdapter()` | adapter acquired |
| Engine | `Babylon.js v9.18.0 — WebGPU1 engine` |
| Boot completes | `globalThis.SNOWFLOW` published |
| Render | terrain, sastrugi, aerial perspective, distant range, raking shadows, sun bloom, DoF, character + cloth + fur all present |
| Critical console errors | none |

## Numbers

Two runs, to separate signal from startup noise:

| | run 1 | run 2 |
|---|---|---|
| median frame | 21.8 ms | 20.1 ms |
| fps (from median) | 45.9 | 49.8 |
| 1% low fps | 24.2 | 44.1 |
| p99 frame | 41.4 ms | 22.7 ms |
| triangles | 353,310 | 353,310 |
| draw calls | 26 | 26 |

Triangles and draw calls are identical across runs — the scene is deterministic
at rest, which makes them the sharpest regression signal available. Watch those
first.

**Median frame time is the metric to track: ~20–22 ms, so roughly 45–50 fps.**
The 1% low differs wildly between runs because run 1's history still contained
warm-up frames at sample time; run 2 is the more representative figure.

This is **below the 60 fps target** on this machine at 1600×900 / ultra / scale
1.0. Not a defect and not something to fix now — the character, cloth solver,
fur shells, wake and spell pipelines are all still resident, and Stage 2 removes
most of that work. Worth re-measuring after Stage 2 rather than optimising
against a configuration that is about to change.

## Known pre-existing issues

These are present in the untouched baseline. They are **not** regressions, and
seeing them again later is not a Stage failure.

1. **`GET /favicon.ico` → 404.** The single console `[error]`. Harmless; will be
   resolved by BORAN branding.
2. **WebGPU validation warning on frame 1–2:** `Destroyed texture [...
   WebgpuSwapChainTexture ...] used in a submit`. Fires once during the initial
   resize, before the loading screen clears, and does not recur. Reproduced on
   both runs at the baseline commit.
3. **`stats.gpuMs` is not trustworthy on this machine** — it reports 0.14–0.27
   ms, which is implausible for this scene. `engine.captureGPUFrameTime(true)`
   is enabled but the `timestamp-query` counter is not returning useful values
   on this adapter. Use CPU median frame time instead; ignore the GPU row.
4. **`npm audit`: 1 high, `nanoid <3.3.17`**, reached transitively through vite.
   Pre-existing and unrelated to the devDependency added here. `npm audit fix`
   was deliberately **not** run — it would perturb vite's tree underneath an
   established baseline for no demo benefit.

## How to judge visual parity

Two screenshots of this scene are **never** identical, even from the same build
with a frozen camera. Two things guarantee it:

- **Animated film grain.** `S.grain` is on and the display transform keys its
  noise off `time`, so every frame carries a fresh grain field. At
  `grainStrength` 0.022 that is roughly ±5 levels per channel on its own.
- **The TAA jitter cycle.** The projection is offset by one of eight Halton
  positions per frame. The resolved image oscillates slightly with that period,
  most visibly wherever detail is finest — which here is the near-field
  sastrugi in the lower third of the frame.

Measured on a static camera, consecutive frames inside a single session differ
by a **mean of ~3.0/255 overall and ~4.2/255 in the lower-left quadrant**. That
is the floor. Anything at or below it is noise, not a change.

So a single screenshot pair proves nothing. Comparing two frames captured from
*identical* code has produced whole-frame means anywhere from 2.2 to 4.5
depending only on where each landed in the grain and jitter cycles — a spread
wider than most real regressions.

To judge a change, compare **distributions, not frames**:

1. Capture the same build several times and diff consecutive frames *within one
   session* to get that build's own floor.
2. Diff across builds.
3. A regression is a difference that is **structured** — concentrated in a
   region, and consistently above the floor across repeated captures. A
   difference that is diffuse, or that sits inside the floor, or that appears in
   one capture pair and not the next, is the grain and the jitter.

Stage 2 was cleared this way: its frame-to-frame floor (mean 2.4–3.6, lower-left
2.7–5.7) brackets Stage 1's (mean 3.0–3.1, lower-left 4.1–4.3), and the
cross-build diff was flat at the floor everywhere except the region the
character and its shadow used to occupy.

## Restoring the baseline

```bash
git checkout stage0-baseline    # detached HEAD at the untouched original
```

The tag is annotated and must not be moved.
