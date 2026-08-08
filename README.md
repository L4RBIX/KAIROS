# KAIROS

**Καιρός** — the right moment to leave.

> Know the road before it closes.

Kazakhstan winters shut highways with little warning. Drivers get wind speed and
a vague “bad weather” banner. **KAIROS answers the real question:** leave now,
leave later, or don’t go — then puts you on that road in a live WebGPU storm
driven by the same risk score.

```
ALMATY → SHYMKENT
63%   HIGH RISK
Best departure: before 13:40
```

Drag the departure scrubber. Snow thickens. Fog closes in. The road starts to
disappear. That is the forecast — not a chart next to it.

---

## Why this exists

On the M-36 / republican corridors, a closure is not an inconvenience. It is
hours of waiting, diverted freight, and people stranded between cities.

Existing apps show meteorology. They do not show **closure risk for a specific
segment at a specific departure**, and they never make you *feel* what 63%
means on asphalt.

KAIROS is a decision product with a cinematic proof layer:

| Layer | Job |
| --- | --- |
| **LightGBM** | Score trained winter corridors (CLOSE/RESTRICT in 6h) |
| **Open-Meteo** | Live features for the model |
| **WebGPU scene** | Same score → fog, blizzard, burial, light |
| **Copilot** | Explain the score — never overwrite it |

---

## Demo flow (2 minutes)

This is the product hierarchy. Do not skip to the map.

1. **Landing** — cinematic snowy highway. Brand. One line. **Plan journey**.
2. **Map** — pick From / To (e.g. Almaty → Shymkent). Coverage markers = trained
   midpoints only.
3. **Analyze journey** — route + ML coverage. Then return to the 3D road.
4. **Result** — risk %, band, best departure, live weather mets.
5. **Scrubber** — move departure; storm intensity follows the risk curve
   (local lerp — no fetch spam).
6. **Why this risk? / Ask KAIROS** — DeepSeek grounded on the prediction.
7. **Change route** — map opens again. WebGPU pauses while you plan.

Optional: **Illustrative winter scenario** — recorded closure replay through the
same weather director (not claimed as a labelled LightGBM event).

---

## What judges should notice

- **The environment is the explanation.** Risk is not a badge over a static
  hero image. One weather director drives atmosphere, wind, blizzard, and how
  buried the carriageway is.
- **Honest ML coverage.** Only seven trained corridors get LightGBM. Arbitrary
  roads stay weather-only — labelled as such. No fake national model.
- **One HTTP predict on Analyse.** Scrubber interpolates the cached curve.
- **LLM never sets the score.** Copilot explains; LightGBM decides.
- **Seasonal honesty.** If live winter hazard is inactive, visuals stay calm
  while the real score remains on screen.
- **Fallback without lying.** API down → demo mock + explicit banner.

---

## Stack

| | |
| --- | --- |
| **Frontend** | Vite, Babylon.js, custom WGSL, MapLibre (planner only) |
| **Backend** | FastAPI, LightGBM (BORAN model bundle), Open-Meteo |
| **Copilot** | DeepSeek (server-side key only) |
| **Rendering** | Clipmap terrain, Nishita sky, PCSS cascades, GPU blizzard |

Built on the [SNOWFLOW](https://github.com/Noniv/snowflow_demo) WebGPU snow
engine. We removed the game loop and added the highway, weather director,
journey planner, and product shell.

---

## Quick start

### Frontend

```bash
npm install
cp .env.example .env          # set VITE_ML_API_URL=http://localhost:8000
npm run dev                   # http://localhost:5173
```

WebGPU: Chrome 113+ / desktop GPU. Without WebGPU, forecasts still run against
the fallback shell — the decision does not require snow pixels.

### Backend

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env          # optional: DEEPSEEK_API_KEY=...
uvicorn app.main:app --reload --port 8000
```

```bash
pytest -q                     # 27 tests, Open-Meteo mocked
curl http://localhost:8000/health
```

Model details, endpoints, and feature contract:
[backend/README.md](backend/README.md)

---

## Architecture (the two boundaries that matter)

```
Browser                         API
───────                         ───
Plan journey (MapLibre)
        │
Analyze journey ─────────────► /api/journey/analyze
        │                         coverage + LightGBM on matches
        ▼
Cinematic WebGPU ◄─────────── /api/predict (one shot + curve)
  weatherDirector                 Open-Meteo → 44 features
  scrubber → predictLocal()
  Ask KAIROS ────────────────► /api/copilot | /api/journey/intelligence
```

**`services/predictionService.js`** — only prediction contract. Live or explicit
demo fallback. Nothing in the shell talks to raw HTTP shapes.

**`app/weatherDirector.js`** — only path from weather → pixels. No shader owns
a hardcoded storm; risk changes ease at different rates (air clears fast, lying
snow does not).

```
src/
  product/    shell, route flow, journey map, replay
  services/   predict, journey, routing, copilot
  app/        weather state, director, cinematic camera
  terrain/    heightfield, clipmap, deformation
  road/       corridor geometry + materials
  vfx/        GPU blizzard, spray
  shaders/    all WGSL
backend/
  app/        FastAPI, features, coverage, journey, copilot
  model/      BORAN_MODEL (immutable artifacts)
```

---

## Model (straight talk)

- **Target:** CLOSE or RESTRICT within the next 6 hours
- **Output:** risk in `[0, 1]` — useful ranking score, **not** a calibrated
  probability for insurers
- **Coverage:** seven republican corridor midpoints in `segments.json`
- **Journey map:** OSRM geometry for any From/To; LightGBM only where the route
  intersects trained buffers

That constraint is a feature. Judges can trust the labels.

---

## Status

Hackathon MVP. Live path: plan → analyze → cinematic risk → scrubber → Copilot.
Ship-ready locally; point `VITE_ML_API_URL` at the API for LightGBM.

---

## Licence

MIT — [LICENSE](LICENSE).

No third-party art packs. Sky, terrain grain, ruts, and lying snow are
procedural / GPU-evaluated. Runtime: `@babylonjs/core` (Apache-2.0).
SNOWFLOW origin credited above.
