"""API tests with mocked Open-Meteo weather."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app import weather as weather_mod
from app.main import app
from app.model_runtime import load_runtime


def _fake_open_meteo(segment_tz: str = "Asia/Almaty") -> dict:
    tz = ZoneInfo(segment_tz)
    start = datetime.now(tz).replace(minute=0, second=0, microsecond=0) - timedelta(hours=30)
    n = 72
    times = [(start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(n)]
    return {
        "hourly": {
            "time": times,
            "temperature_2m": [-8 + (i % 5) * 0.2 for i in range(n)],
            "relative_humidity_2m": [75 for _ in range(n)],
            "precipitation": [0.1 if i % 4 == 0 else 0.0 for i in range(n)],
            "rain": [0.0 for _ in range(n)],
            "snowfall": [0.3 if i % 3 == 0 else 0.0 for i in range(n)],
            "snow_depth": [0.04 for _ in range(n)],
            "surface_pressure": [985.0 for _ in range(n)],
            "visibility": [2500 - (i % 10) * 50 for i in range(n)],
            "wind_speed_10m": [6 + (i % 6) for i in range(n)],
            "wind_gusts_10m": [10 + (i % 7) for i in range(n)],
        }
    }


@pytest.fixture(scope="module")
def client():
    load_runtime()
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["model_loaded"] is True
    assert body["feature_count"] == 44
    assert body["segment_count"] == 7


def test_segments(client):
    r = client.get("/api/segments")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 7
    assert all("segment_id" in s and "label" in s for s in body)


def test_unsupported_segment_rejected(client):
    r = client.post(
        "/api/predict",
        json={"segment_id": "ASTANA_KARAGANDA", "departure": "16:00"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_predict_with_mocked_weather(client, monkeypatch):
    async def fake_fetch(segment, **kwargs):
        return _fake_open_meteo(segment.timezone)

    monkeypatch.setattr(weather_mod, "fetch_hourly_weather", fake_fetch)
    weather_mod.clear_cache()

    r = client.post(
        "/api/predict",
        json={
            "segment_id": "ALMATY_TASHKENT_TERMEZ__KM_159_238",
            "departure": "16:00",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert 0.0 <= body["risk"] <= 1.0
    assert body["risk_label"] in ("low", "moderate", "high")
    assert "curve" in body and len(body["curve"]) >= 10
    for pt in body["curve"]:
        assert 0.0 <= pt["risk"] <= 1.0
        assert isinstance(pt["wind_speed"], (int, float))
    # Frontend contract fields
    for key in (
        "wind_speed",
        "wind_gusts",
        "snowfall",
        "visibility",
        "temperature",
        "recommended_departure",
        "headline",
        "detail",
        "seasonal",
        "assessment",
    ):
        assert key in body
    assert "winter_hazard_active" in body["seasonal"]
