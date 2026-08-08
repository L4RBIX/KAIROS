# KAIROS

**Kairos (Καιρός)** — the right moment; the ideal time to act.

**Know the road before it closes.**

An AI-assisted road-safety decision tool for Kazakhstan's winter highway
network, with a real-time WebGPU environment that *is* the explanation rather
than a backdrop to it.

A driver enters a route and a departure time. KAIROS answers the question they
actually have — *should I leave now, later, or not at all?* — and then shows
them the road they would be driving on, in the conditions predicted for the
moment they chose. Drag the departure slider and the road disappears under
drifting snow in front of you.

```
KAZ-06 · км 1240–1362
62%   HIGH CLOSURE RISK
High risk of closure or restriction.
Recommended departure  before 14:00
```

## Running it

```bash
npm install
cp .env.example .env   # optional: point at the live ML API
npm run dev            # vite dev server on :5173
npm run build          # production build into dist/
npm run preview        # serve the production build
```

### Real ML backend

Live Analyse scores one of seven trained road segments with LightGBM (44
features from Open-Meteo). The departure scrubber stays smooth: **one HTTP call
on Analyse**, then local interpolation of the cached risk curve — never a fetch
per slider tick.

```bash
cd backend
python3.12 -m venv .venv   # Python 3.10+ required
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

With `VITE_ML_API_URL=http://localhost:8000` in `.env`, the UI talks to that
API. If the API is down or unset, Analyse falls back to the demo mock and shows
**Live ML temporarily unavailable · demo fallback** — it never silently pretends
the mock is LightGBM.

In summer / non-winter weather the product stays calm on purpose: **Winter
hazard inactive** from live Open-Meteo conditions. The LightGBM score is still
shown (not overwritten to zero). Use **See KAIROS in winter conditions** for the
illustrative winter scenario — not claimed as a real labelled closure.

### Journey map

The product opens on an interactive Kazakhstan map (MapLibre). Choose From/To
cities, analyze the journey, and see **approximate** model coverage around the
seven trained corridor midpoints. Only matched trained segments receive
LightGBM risk — arbitrary roads stay weather-only / not yet trained.

**Explore conditions** opens the existing WebGPU scene as a representative
conditions view for the highest-risk covered segment (not a geographic twin of
the whole route).

### KAIROS Copilot (DeepSeek)

Optional server-side assistant. Put the key only in `backend/.env`:

```bash
# backend/.env
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

Without a key, Analyse / scrubber / WebGPU still work; Ask KAIROS shows
unavailable. The LLM never sets the risk score.

See [backend/README.md](backend/README.md) for the model bundle layout and API.

WebGPU is required for the 3D environment — Chrome 113+ on a desktop GPU. On a
browser without it the product still runs: forecasts, departure advice and the
historical replay all work against a static background. That is deliberate; the
answer to "is the road closing" does not depend on whether your browser can
rasterise snow.

```bash
npm run smoke -- <label>   # boot check + perf sample + screenshot, needs `npm run dev`
```

Captures land in `.snapshots/` (git-ignored). See [docs/BASELINE.md](docs/BASELINE.md)
— in particular the section on judging visual parity, because two frames of this
scene are never identical and a single screenshot pair proves nothing.

## What it does

### The decision, not the weather

Most tools show you `wind 27 m/s, snowfall 4.2 mm/h` and leave the inference to
you. KAIROS's output is a departure recommendation solved from its own risk
curve, so the advisory time and the percentage come from one model rather than
being authored beside each other.

### The environment is the argument

Risk drives a single weather layer that controls fog, visibility, cloud cover,
ambient light, exposure, contrast, bloom, sun shafts, wind, airborne blizzard
and how buried the carriageway is. Every parameter eases at its own rate — air
clears in seconds, lying snow does not — so a change reads as weather arriving
rather than as a crossfade.

At 21% the asphalt is dark and the markings are crisp. At 96% the road has gone.

### Historical replay

Plays a recorded closure through the *same* weather layer the live forecast
drives, and ends on the gap that is the whole proposition: the road was shut at
19:40; KAIROS crossed its advisory threshold at 15:21, **4h 19m earlier**.

## Architecture

```
src/
  app/        product state: weather data, the render mapping, cinematic camera,
              the subject the scene is composed around, demo data
  product/    the interface: shell, analyse flow, replay, no-WebGPU fallback
  services/   the prediction boundary — live LightGBM or explicit demo fallback
  road/       the highway corridor: layout, geometry, materials
  terrain/    heightfield, clipmap, deformation state buffer
  render/     sky + IBL, shadow cascades, depth prepass
  post/       the post-processing chain
  vfx/        GPU blizzard + pooled spray field
  ui/         the development tuning overlay (?dev)
  shaders/    all WGSL; lib/ holds the shared includes
```

Two boundaries matter more than the rest:

**`services/predictionService.js`** is the only prediction contract.
Normalisation from the backend's wire format happens there, so exactly one file
changes when the endpoint lands and nothing in `product/` or `app/` ever sees a
raw response. `setPredictionService()` swaps the implementation.

**`app/weatherDirector.js`** is the only code that turns weather into pixels.
Nothing else in the project reads a risk value and no shader carries a hardcoded
storm state. That is what lets the model change without the environment noticing.

Every fabricated number lives in `app/demoData.js`, so it can be deleted rather
than hunted for.

## Built on SNOWFLOW

The snow rendering is not ours. KAIROS is built on
[SNOWFLOW](https://github.com/Noniv/snowflow_demo), a real-time procedural snow
tech demo (Babylon.js + WebGPU + hand-written WGSL), and the reason it looks the
way it does is that its terrain, snow shading, atmosphere, shadows and post chain
were already excellent.

What we kept, unchanged where possible: the GPU-baked heightfield and its CPU
mirror, the clipmap terrain, the snow material, the analytic Nishita sky and its
SH ambient solve, the three-cascade PCSS shadows, the depth prepass, and the
nine-pass post chain.

What we removed: the game. The player character, cloth and fur simulation, the
snow-surf wake, the five spells and every input binding. Those modules are still
on disk and simply unreachable from the entry point.

What we added: the graded highway corridor (carved into the heightfield bake, so
the road sits on ground the CPU and GPU agree about), the road material, the
cinematic camera, the weather layer, the GPU blizzard, and the product.

Babylon.js is used as engine, scene, material and render-target plumbing. All
shading is custom WGSL — no stock materials, no stock lights, no stock particles.

## Status

Hackathon MVP. The cinematic route view, departure scrubber, historical replay,
no-WebGPU fallback, GPU blizzard, and live LightGBM backend (seven corridors)
are in place. Without `VITE_ML_API_URL`, Analyse uses the demo mock with an
explicit fallback banner.

## Licence

MIT. See [LICENSE](LICENSE).

There are no third-party assets. Every texture, environment map and piece of
geometry is generated at load time on the GPU: the sky is an atmosphere
integral, the terrain and snow grain are noise, and the road markings, wheel
ruts and lying snow are evaluated procedurally in the fragment shader.

Runtime dependency: `@babylonjs/core` (Apache-2.0). Build dependencies: Vite and
playwright-core (MIT), neither of which ships in the output.
