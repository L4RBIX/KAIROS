"""Open-Meteo forecast client with a short in-memory TTL cache."""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from .config import OPEN_METEO_TIMEOUT, OPEN_METEO_URL, WEATHER_TTL_SECONDS
from .features import HOURLY_VARS
from .model_runtime import Segment

log = logging.getLogger("kairos.weather")

_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


async def fetch_hourly_weather(
    segment: Segment,
    *,
    client: httpx.AsyncClient | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """
    Fetch hourly weather for a trained segment.

    Uses past_days=1 and forecast_days=2 so rolling 24h features have history
    and the same-day scrubber curve has future hours.
    """
    now = time.time()
    hit = _CACHE.get(segment.segment_id)
    if not force and hit and (now - hit[0]) < WEATHER_TTL_SECONDS:
        return hit[1]

    params = {
        "latitude": segment.latitude,
        "longitude": segment.longitude,
        "hourly": ",".join(HOURLY_VARS),
        "timezone": segment.timezone,
        "wind_speed_unit": "ms",
        "precipitation_unit": "mm",
        "past_days": 1,
        "forecast_days": 2,
    }

    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=OPEN_METEO_TIMEOUT)
    try:
        resp = await client.get(OPEN_METEO_URL, params=params)
        resp.raise_for_status()
        payload = resp.json()
    finally:
        if owns_client:
            await client.aclose()

    hourly = payload.get("hourly") or {}
    for col in ["time", *HOURLY_VARS]:
        if col not in hourly:
            raise RuntimeError(f"Open-Meteo missing hourly.{col}")

    _CACHE[segment.segment_id] = (now, payload)
    log.info(
        "weather fetched segment=%s hours=%d tz=%s",
        segment.segment_id,
        len(hourly["time"]),
        segment.timezone,
    )
    return payload


def clear_cache() -> None:
    _CACHE.clear()
