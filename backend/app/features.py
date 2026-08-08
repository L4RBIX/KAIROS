"""Feature engineering matching the BORAN training pipeline."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from .model_runtime import Segment

HOURLY_VARS = [
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation",
    "rain",
    "snowfall",
    "snow_depth",
    "surface_pressure",
    "visibility",
    "wind_speed_10m",
    "wind_gusts_10m",
]

WINDOWS = (3, 6, 12, 24)


def weather_frame_from_open_meteo(payload: dict[str, Any]) -> pd.DataFrame:
    """Build a sorted hourly DataFrame from an Open-Meteo forecast payload."""
    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    if not times:
        raise ValueError("Open-Meteo response missing hourly.time")

    data: dict[str, Any] = {"time": pd.to_datetime(times)}
    for col in HOURLY_VARS:
        if col not in hourly:
            raise ValueError(f"Open-Meteo response missing hourly.{col}")
        data[col] = hourly[col]

    df = pd.DataFrame(data).sort_values("time").reset_index(drop=True)
    return df


def engineer_features(df: pd.DataFrame, segment: Segment, features: list[str]) -> pd.DataFrame:
    """
    Add rolling, calendar and interaction features.

    Rolling windows use min_periods=1 to match training.
    """
    if df.empty:
        raise ValueError("empty weather frame")

    out = df.copy()
    out = out.sort_values("time").reset_index(drop=True)

    for w in WINDOWS:
        out[f"snowfall_sum_{w}h"] = out["snowfall"].rolling(w, min_periods=1).sum()
        out[f"precip_sum_{w}h"] = out["precipitation"].rolling(w, min_periods=1).sum()
        out[f"wind_max_{w}h"] = out["wind_speed_10m"].rolling(w, min_periods=1).max()
        out[f"gust_max_{w}h"] = out["wind_gusts_10m"].rolling(w, min_periods=1).max()
        out[f"visibility_min_{w}h"] = out["visibility"].rolling(w, min_periods=1).min()
        out[f"temp_min_{w}h"] = out["temperature_2m"].rolling(w, min_periods=1).min()

    out["snow_x_wind"] = out["snowfall"] * out["wind_speed_10m"]
    out["snow_x_gust"] = out["snowfall"] * out["wind_gusts_10m"]
    out["wind_visibility_ratio"] = out["wind_speed_10m"] / np.maximum(out["visibility"], 100.0)

    hours = out["time"].dt.hour.astype(float)
    doy = out["time"].dt.dayofyear.astype(float)
    out["hour_sin"] = np.sin(2 * math.pi * hours / 24.0)
    out["hour_cos"] = np.cos(2 * math.pi * hours / 24.0)
    out["doy_sin"] = np.sin(2 * math.pi * doy / 365.25)
    out["doy_cos"] = np.cos(2 * math.pi * doy / 365.25)

    out["latitude"] = float(segment.latitude)
    out["longitude"] = float(segment.longitude)
    out["km_length"] = float(segment.km_length)

    if "segment_id" in out.columns:
        out = out.drop(columns=["segment_id"])

    missing = [f for f in features if f not in out.columns]
    if missing:
        raise KeyError(f"engineered frame missing features: {missing}")

    # Keep time for indexing; model matrix is selected separately.
    return out


def feature_row_at(engineered: pd.DataFrame, idx: int, features: list[str]) -> dict[str, Any]:
    if idx < 0 or idx >= len(engineered):
        raise IndexError("feature row index out of range")
    row = engineered.iloc[idx]
    return {f: (None if pd.isna(row[f]) else float(row[f])) for f in features}


def nearest_hour_index(engineered: pd.DataFrame, ts: pd.Timestamp) -> int:
    """Index of the row closest to `ts`."""
    times = pd.to_datetime(engineered["time"])
    target = pd.Timestamp(ts)
    if times.dt.tz is not None:
        times_cmp = times.dt.tz_convert("UTC").dt.tz_localize(None)
    else:
        times_cmp = times
    if getattr(target, "tzinfo", None) is not None:
        target_cmp = target.tz_convert("UTC").tz_localize(None)
    else:
        target_cmp = target
    deltas = (times_cmp - target_cmp).abs()
    return int(deltas.to_numpy().argmin())
