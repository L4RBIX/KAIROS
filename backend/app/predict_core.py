"""Shared LightGBM prediction for a single trained segment."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd

from .applicability import assess_physical_applicability, effective_risk
from .assessment import build_assessment
from .config import CURVE_HOUR_END, CURVE_HOUR_START
from .copy import risk_copy
from .features import (
    engineer_features,
    feature_row_at,
    nearest_hour_index,
    weather_frame_from_open_meteo,
)
from .model_runtime import ModelRuntime, Segment, get_runtime
from .schemas import AssessmentOut, CurvePoint, PredictResponse, SeasonalState
from .weather import fetch_hourly_weather


def _parse_hhmm(hhmm: str) -> tuple[int, int]:
    h, m = hhmm.split(":")
    return int(h), int(m)


def _recommended_departure(
    curve: list[CurvePoint],
    departure: str,
    high_threshold: float,
    requested_risk: float,
) -> str:
    """Uses effective (gated) curve risks — never raw summer scores alone."""
    if requested_risk < high_threshold:
        return ""
    dep_h, dep_m = _parse_hhmm(departure)
    dep_minutes = dep_h * 60 + dep_m
    prior = [
        p
        for p in curve
        if _parse_hhmm(p.time)[0] * 60 + _parse_hhmm(p.time)[1] <= dep_minutes
    ]
    if not prior or prior[0].risk >= high_threshold:
        return ""
    last_safe_i = None
    for i, p in enumerate(prior):
        if p.risk < high_threshold:
            last_safe_i = i
        else:
            break
    if last_safe_i is None:
        return ""
    return prior[last_safe_i].time


def _row_applicability(row: pd.Series) -> dict:
    wind = float(row["wind_speed_10m"]) if pd.notna(row["wind_speed_10m"]) else 0.0
    gust = float(row["wind_gusts_10m"]) if pd.notna(row["wind_gusts_10m"]) else wind
    return assess_physical_applicability(
        temperature=float(row["temperature_2m"]) if pd.notna(row["temperature_2m"]) else 0.0,
        snowfall=float(row["snowfall"]) if pd.notna(row["snowfall"]) else 0.0,
        snow_depth=float(row["snow_depth"]) if pd.notna(row["snow_depth"]) else 0.0,
        visibility=float(row["visibility"]) if pd.notna(row["visibility"]) else 0.0,
        precipitation=float(row["precipitation"]) if pd.notna(row["precipitation"]) else 0.0,
        snowfall_sum_24h=float(row["snowfall_sum_24h"]) if pd.notna(row["snowfall_sum_24h"]) else 0.0,
        wind_speed=wind,
        wind_gusts=gust,
    )


async def predict_segment(segment_id: str, departure: str) -> PredictResponse:
    rt = get_runtime()
    seg = rt.segments.get(segment_id)
    if seg is None:
        raise KeyError(segment_id)
    return await _predict_for_segment(rt, seg, departure)


async def _predict_for_segment(
    rt: ModelRuntime, seg: Segment, departure: str
) -> PredictResponse:
    payload = await fetch_hourly_weather(seg)
    raw = weather_frame_from_open_meteo(payload)
    tz = ZoneInfo(seg.timezone)
    if raw["time"].dt.tz is None:
        raw["time"] = raw["time"].dt.tz_localize(tz)
    else:
        raw["time"] = raw["time"].dt.tz_convert(tz)

    engineered = engineer_features(raw, seg, rt.features)
    now_local = datetime.now(tz)
    day = now_local.date()
    curve: list[CurvePoint] = []
    for hour in range(CURVE_HOUR_START, CURVE_HOUR_END + 1):
        ts = datetime(day.year, day.month, day.day, hour, 0, tzinfo=tz)
        idx = nearest_hour_index(engineered, pd.Timestamp(ts))
        feats = feature_row_at(engineered, idx, rt.features)
        raw_score = rt.predict_score(feats)
        row = engineered.iloc[idx]
        app = _row_applicability(row)
        eff = effective_risk(raw_score, app["applicability"])
        curve.append(
            CurvePoint(
                time=f"{hour:02d}:00",
                risk=eff,
                raw_model_risk=raw_score,
                wind_speed=float(row["wind_speed_10m"]) if pd.notna(row["wind_speed_10m"]) else 0.0,
                snowfall=float(row["snowfall"]) if pd.notna(row["snowfall"]) else 0.0,
                visibility=float(row["visibility"]) if pd.notna(row["visibility"]) else 0.0,
                temperature=float(row["temperature_2m"]) if pd.notna(row["temperature_2m"]) else 0.0,
                applicability=app["applicability"],
                applicability_reason=app["applicability_reason"],
                winter_hazard_active=app["winter_hazard_active"],
            )
        )

    dh, dm = _parse_hhmm(departure)
    dep_ts = datetime(day.year, day.month, day.day, dh, dm, tzinfo=tz)
    dep_idx = nearest_hour_index(engineered, pd.Timestamp(dep_ts))
    dep_feats = feature_row_at(engineered, dep_idx, rt.features)
    raw_risk = rt.predict_score(dep_feats)
    dep_row = engineered.iloc[dep_idx]
    wind = float(dep_row["wind_speed_10m"]) if pd.notna(dep_row["wind_speed_10m"]) else 0.0
    gust = float(dep_row["wind_gusts_10m"]) if pd.notna(dep_row["wind_gusts_10m"]) else wind
    snow = float(dep_row["snowfall"]) if pd.notna(dep_row["snowfall"]) else 0.0
    vis = float(dep_row["visibility"]) if pd.notna(dep_row["visibility"]) else 0.0
    temp = float(dep_row["temperature_2m"]) if pd.notna(dep_row["temperature_2m"]) else 0.0

    app_raw = _row_applicability(dep_row)
    seasonal = SeasonalState(**app_raw)
    risk = effective_risk(raw_risk, app_raw["applicability"])
    label = rt.risk_label(risk)
    recommended = _recommended_departure(curve, departure, rt.high_threshold, risk)

    if app_raw["applicability"] == "inactive":
        headline = "No active winter-weather hazard detected."
        detail = (
            "Current conditions do not indicate snow, ice or blizzard-related "
            "road restrictions. Live weather is connected; KAIROS keeps the "
            "scene calm on purpose."
        )
    else:
        headline, detail = risk_copy(
            label,
            wind_speed=wind,
            wind_gusts=gust,
            snowfall=snow,
            visibility=vis,
            recommended_departure=recommended,
        )

    assessment = AssessmentOut(
        **build_assessment(
            risk=risk,
            risk_label=label,
            departure=departure,
            recommended_departure=recommended,
            wind_speed=wind,
            wind_gusts=gust,
            snowfall=snow,
            visibility=vis,
            temperature=temp,
            winter_hazard_active=seasonal.winter_hazard_active,
            seasonal_reason=seasonal.reason,
            locale="en",
        )
    )

    return PredictResponse(
        segment_id=seg.segment_id,
        risk=risk,
        raw_model_risk=raw_risk,
        risk_label=label,  # type: ignore[arg-type]
        applicability=app_raw["applicability"],
        applicability_reason=app_raw["applicability_reason"],
        wind_speed=wind,
        wind_gusts=gust,
        snowfall=snow,
        visibility=vis,
        temperature=temp,
        recommended_departure=recommended,
        headline=headline,
        detail=detail,
        target_horizon_hours=int(rt.meta.get("horizon_hours", 6)),
        medium_risk_threshold=rt.medium_threshold,
        high_risk_threshold=rt.high_threshold,
        seasonal=seasonal,
        assessment=assessment,
        curve=curve,
    )
