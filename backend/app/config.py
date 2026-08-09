"""Runtime configuration for the KAIROS inference service."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Load backend/.env if present (never commit secrets). Safe no-op when missing.
try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env", override=False)
except ImportError:
    pass

MODEL_DIR = Path(os.environ.get("KAIROS_MODEL_DIR", ROOT / "model" / "BORAN_MODEL"))

OPEN_METEO_URL = os.environ.get(
    "OPEN_METEO_URL", "https://api.open-meteo.com/v1/forecast"
)
WEATHER_TTL_SECONDS = float(os.environ.get("KAIROS_WEATHER_TTL", "720"))  # 12 min
OPEN_METEO_TIMEOUT = float(os.environ.get("KAIROS_WEATHER_TIMEOUT", "20"))

CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "KAIROS_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if o.strip()
]

# Human-readable labels for the seven trained segments.
SEGMENT_LABELS: dict[str, str] = {
    "KAZ06__KM_1240_1362": "KAZ-06 · км 1240–1362",
    "ALMATY_TASHKENT_TERMEZ__KM_159_238": "Алматы–Ташкент–Термез · км 159–238",
    "ALMATY_TASHKENT_TERMEZ__KM_534_593": "Алматы–Ташкент–Термез · км 534–593",
    "ALMATY_TASHKENT_TERMEZ__KM_143_214": "Алматы–Ташкент–Термез · км 143–214",
    "KAZ14__KM_12_216": "KAZ-14 · км 12–216",
    "MOMYSHULY_KOLTOGAN__KM_10_76": "Б. Момышулы–Кольтоган · км 10–76",
    "KAZ06__KM_1474_1806": "KAZ-06 · км 1474–1806",
}

# Demo coverage: synthetic corridor midpoints so every city pair resolves to a
# route. Real weather + real LightGBM, but these are NOT surveyed training
# segments — see demo_segments.py. Set KAIROS_DEMO_COVERAGE=0 to ship only the
# seven trained segments.
DEMO_COVERAGE = os.environ.get("KAIROS_DEMO_COVERAGE", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
DEMO_SPACING_KM = float(os.environ.get("KAIROS_DEMO_SPACING_KM", "60"))

# Departure scrubber window used by the product UI.
CURVE_HOUR_START = 10
CURVE_HOUR_END = 20

# DeepSeek Copilot (server-side only). App starts without a key.
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "").strip()
DEEPSEEK_BASE_URL = os.environ.get(
    "DEEPSEEK_BASE_URL", "https://api.deepseek.com"
).strip()
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat").strip()
DEEPSEEK_TIMEOUT = float(os.environ.get("DEEPSEEK_TIMEOUT", "25"))
DEEPSEEK_MAX_TOKENS = int(os.environ.get("DEEPSEEK_MAX_TOKENS", "450"))
