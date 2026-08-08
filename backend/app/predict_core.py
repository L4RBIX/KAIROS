"""Shared LightGBM prediction for a single trained segment."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd

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
from .seasonal import assess_winter_hazard
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
        score = rt.predict_score(feats)
        row = engineered.iloc[idx]
        curve.append(
            CurvePoint(
                time=f"{hour:02d}:00",
                risk=score,
                wind_speed=float(row["wind_speed_10m"]) if pd.notna(row["wind_speed_10m"]) else 0.0,
                snowfall=float(row["snowfall"]) if pd.notna(row["snowfall"]) else 0.0,
                visibility=float(row["visibility"]) if pd.notna(row["visibility"]) else 0.0,
                temperature=float(row["temperature_2m"]) if pd.notna(row["temperature_2m"]) else 0.0,
            )
        )

    dh, dm = _parse_hhmm(departure)
    dep_ts = datetime(day.year, day.month, day.day, dh, dm, tzinfo=tz)
    dep_idx = nearest_hour_index(engineered, pd.Timestamp(dep_ts))
    dep_feats = feature_row_at(engineered, dep_idx, rt.features)
    risk = rt.predict_score(dep_feats)
    dep_row = engineered.iloc[dep_idx]
    wind = float(dep_row["wind_speed_10m"]) if pd.notna(dep_row["wind_speed_10m"]) else 0.0
    gust = float(dep_row["wind_gusts_10m"]) if pd.notna(dep_row["wind_gusts_10m"]) else wind
    snow = float(dep_row["snowfall"]) if pd.notna(dep_row["snowfall"]) else 0.0
    vis = float(dep_row["visibility"]) if pd.notna(dep_row["visibility"]) else 0.0
    temp = float(dep_row["temperature_2m"]) if pd.notna(dep_row["temperature_2m"]) else 0.0
    snow_depth = float(dep_row["snow_depth"]) if pd.notna(dep_row["snow_depth"]) else 0.0
    precip = float(dep_row["precipitation"]) if pd.notna(dep_row["precipitation"]) else 0.0
    snow_24 = float(dep_row["snowfall_sum_24h"]) if pd.notna(dep_row["snowfall_sum_24h"]) else 0.0

    seasonal_raw = assess_winter_hazard(
        temperature=temp,
        snowfall=snow,
        snow_depth=snow_depth,
        visibility=vis,
        precipitation=precip,
        snowfall_sum_24h=snow_24,
    )
    seasonal = SeasonalState(**seasonal_raw)
    label = rt.risk_label(risk)
    recommended = _recommended_departure(curve, departure, rt.high_threshold, risk)
    headline, detail = risk_copy(
        label,
        wind_speed=wind,
        wind_gusts=gust,
        snowfall=snow,
        visibility=vis,
        recommended_departure=recommended,
    )
    if not seasonal.winter_hazard_active:
        headline = "Winter hazard inactive under current conditions."
        detail = (
            f"{seasonal.reason} Live weather: wind {wind:.0f} m/s, "
            f"snowfall {snow:.1f} mm/h, visibility ~{vis / 1000:.0f} km, "
            f"{temp:.0f}°C. KAIROS model score remains {round(risk * 100)}% "
            f"(risk score, not a calibrated probability)."
        )
        if seasonal.ood_caution and risk >= rt.medium_threshold:
            detail += (
                " Elevated model scores during non-winter weather may reflect "
                "out-of-distribution behaviour."
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
        risk_label=label,  # type: ignore[arg-type]
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
