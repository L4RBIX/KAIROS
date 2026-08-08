"""Copilot tests with mocked DeepSeek HTTP."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app import copilot as copilot_mod
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
    copilot_mod.clear_cache()

    async def fake_fetch(segment, **kwargs):
        return _fake_open_meteo(segment.timezone)

    monkeypatch.setattr(weather_mod, "fetch_hourly_weather", fake_fetch)
    weather_mod.clear_cache()

    with TestClient(app) as c:
        yield c


def _seed_predict(client):
    r = client.post(
        "/api/predict",
        json={
            "segment_id": "ALMATY_TASHKENT_TERMEZ__KM_159_238",
            "departure": "16:00",
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_predict_includes_seasonal_and_assessment(client):
    body = _seed_predict(client)
    assert body["seasonal"]["winter_hazard_active"] is False
    assert "assessment" in body
    assert body["assessment"]["verdict"] == "live_calm"
    assert "risk" in body
    # Risk is preserved (not forced to 0).
    assert 0.0 <= body["risk"] <= 1.0


def test_copilot_status_without_key(client, monkeypatch):
    monkeypatch.setattr(copilot_mod, "deepseek_configured", lambda: False)
    r = client.get("/api/copilot/status")
    assert r.status_code == 200
    assert r.json()["available"] is False


def test_copilot_missing_key_graceful(client, monkeypatch):
    body = _seed_predict(client)
    risk_before = body["risk"]
    monkeypatch.setattr(copilot_mod, "deepseek_configured", lambda: False)
    r = client.post(
        "/api/copilot",
        json={
            "message": "Should I leave at 16:00?",
            "segment_id": "ALMATY_TASHKENT_TERMEZ__KM_159_238",
            "departure": "16:00",
            "locale": "en",
        },
    )
    assert r.status_code == 200
    out = r.json()
    assert out["available"] is False
    assert "unavailable" in out["answer"].lower()
    assert out["risk"] == risk_before


def test_copilot_with_mocked_deepseek(client, monkeypatch):
    body = _seed_predict(client)
    risk_before = body["risk"]

    async def fake_complete(payload):
        assert payload["kairos_context"]["risk"] == risk_before
        assert payload["locale"] == "ru"
        return "KAIROS показывает спокойные условия. Оценка модели не изменена."

    monkeypatch.setattr(copilot_mod, "deepseek_configured", lambda: True)
    monkeypatch.setattr(copilot_mod, "complete_copilot", fake_complete)

    r = client.post(
        "/api/copilot",
        json={
            "message": "Стоит ли выезжать?",
            "segment_id": "ALMATY_TASHKENT_TERMEZ__KM_159_238",
            "departure": "16:00",
            "locale": "ru",
            "profile": "truck",
            "compare_times": ["14:00", "16:00"],
        },
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["available"] is True
    assert out["risk"] == risk_before
    assert out["locale"] == "ru"
    assert len(out["compare_points"]) == 2
    assert "KAIROS" in out["answer"]


def test_copilot_timeout_handled(client, monkeypatch):
    _seed_predict(client)

    async def boom(_payload):
        raise TimeoutError("DeepSeek request timed out")

    monkeypatch.setattr(copilot_mod, "deepseek_configured", lambda: True)
    monkeypatch.setattr(copilot_mod, "complete_copilot", boom)

    r = client.post(
        "/api/copilot",
        json={
            "message": "Why is risk high?",
            "segment_id": "ALMATY_TASHKENT_TERMEZ__KM_159_238",
            "departure": "16:00",
        },
    )
    assert r.status_code == 504


def test_copilot_rejects_bad_segment(client):
    r = client.post(
        "/api/copilot",
        json={
            "message": "hello",
            "segment_id": "NOT_A_SEGMENT",
            "departure": "16:00",
        },
    )
    assert r.status_code == 422


def test_copilot_requires_prior_predict(client, monkeypatch):
    prediction_store.clear()
    monkeypatch.setattr(copilot_mod, "deepseek_configured", lambda: True)
    r = client.post(
        "/api/copilot",
        json={
            "message": "hello",
            "segment_id": "ALMATY_TASHKENT_TERMEZ__KM_159_238",
            "departure": "16:00",
        },
    )
    assert r.status_code == 409


def test_assessment_no_deepseek_needed(client):
    body = _seed_predict(client)
    assert body["assessment"]["quick_prompts"]
    assert body["assessment"]["primary_concerns"]
