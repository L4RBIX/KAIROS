"""Journey analyze — ML only on matched trained segments."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app import prediction_store
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
            "temperature_2m": [28.0 for _ in range(n)],
            "relative_humidity_2m": [40 for _ in range(n)],
            "precipitation": [0.0 for _ in range(n)],
            "rain": [0.0 for _ in range(n)],
            "snowfall": [0.0 for _ in range(n)],
            "snow_depth": [0.0 for _ in range(n)],
            "surface_pressure": [1005.0 for _ in range(n)],
            "visibility": [50000 for _ in range(n)],
            "wind_speed_10m": [4.0 for _ in range(n)],
            "wind_gusts_10m": [6.0 for _ in range(n)],
        }
    }


@pytest.fixture
def client(monkeypatch):
    load_runtime()
    prediction_store.clear()

    async def fake_fetch(segment, **kwargs):
        return _fake_open_meteo(segment.timezone)

    monkeypatch.setattr(weather_mod, "fetch_hourly_weather", fake_fetch)
    weather_mod.clear_cache()
    with TestClient(app) as c:
        yield c


def test_journey_zero_coverage_no_predictions(client):
    r = client.post(
        "/api/journey/analyze",
        json={
            "from_label": "Aktau",
            "to_label": "Atyrau",
            "departure": "16:00",
            "distance_km": 400,
            "geometry": [[51.2, 43.65], [51.9, 47.1]],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ml_available"] is False
    assert body["predictions"] == []
    assert body["highest_risk_segment"] is None
    assert 0 <= body["coverage"]["percent"] <= 100


def test_journey_with_coverage_runs_lightgbm(client):
    r = client.post(
        "/api/journey/analyze",
        json={
            "from_label": "Almaty",
            "to_label": "Shymkent",
            "departure": "16:00",
            "distance_km": 700,
            "geometry": [
                [76.85, 43.22],
                [74.63, 43.36],
                [74.70, 43.05],
                [70.77, 42.62],
                [69.59, 42.30],
            ],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["coverage"]["percent"] > 0
    assert body["ml_available"] is True
    assert len(body["predictions"]) >= 1
    for p in body["predictions"]:
        assert 0 <= p["risk"] <= 1
        assert p["segment_id"] in {
            m["segment_id"] for m in body["coverage"]["covered_segments"]
        }
    hi = body["highest_risk_segment"]
    assert hi is not None
    assert hi["risk"] == max(p["risk"] for p in body["predictions"])


def test_journey_intelligence_without_deepseek(client, monkeypatch):
    from app import copilot as copilot_mod

    monkeypatch.setattr(copilot_mod, "deepseek_configured", lambda: False)
    client.post(
        "/api/journey/analyze",
        json={
            "from_label": "Almaty",
            "to_label": "Shymkent",
            "departure": "16:00",
            "distance_km": 700,
            "geometry": [
                [76.85, 43.22],
                [74.63, 43.36],
                [69.59, 42.30],
            ],
        },
    )
    r = client.post(
        "/api/journey/intelligence",
        json={"action": "summarize", "locale": "en"},
    )
    assert r.status_code == 200
    body = r.json()
    assert "answer" in body
    # Risk not altered by intelligence layer
    if body.get("highest_risk") is not None:
        assert 0 <= body["highest_risk"] <= 1


def test_segments_include_coordinates(client):
    r = client.get("/api/segments")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 7
    assert all("latitude" in s and "longitude" in s for s in body)
