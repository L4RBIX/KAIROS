# KAIROS ML backend

FastAPI service that scores the seven trained BORAN/KAIROS road segments with
the shipped LightGBM model and live Open-Meteo weather.

## Model

- Type: LightGBM binary classifier
- Target: **CLOSE or RESTRICT within next 6 hours**
- Output: risk score in `[0, 1]` — **not** a calibrated probability
- Features: exactly 44, order from `model/BORAN_MODEL/feature_order.json`
- Coverage: only the seven segments in `segments.json`

## Run locally

Requires **Python 3.10+** (3.11/3.12 recommended).

```bash
cd backend
python3.12 -m venv .venv   # or python3.11 / python3.10

# macOS / Linux
source .venv/bin/activate

# Windows (PowerShell)
# .\.venv\Scripts\Activate.ps1

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Health check: `http://localhost:8000/health`

## DeepSeek Copilot

Optional. Copy `.env.example` → `.env` and set `DEEPSEEK_API_KEY`.

- `GET /api/copilot/status` — whether the key is configured
- `POST /api/copilot` — grounded explanation (requires a prior `/api/predict` for that segment)

The Copilot uses the server-side prediction store. It cannot change LightGBM risk.

## Tests

```bash
cd backend
source .venv/bin/activate
pytest -q
```

Open-Meteo is mocked in API tests; no live network is required for CI.
