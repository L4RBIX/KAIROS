"""KAIROS FastAPI inference service."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .assessment import build_assessment
from .config import (
    CORS_ORIGINS,
    CURVE_HOUR_END,
    CURVE_HOUR_START,
    DEEPSEEK_MODEL,
    SEGMENT_LABELS,
)
from . import copilot as copilot_mod
from .copy import risk_copy
from .features import (
    engineer_features,
    feature_row_at,
    nearest_hour_index,
    weather_frame_from_open_meteo,
)
from .model_runtime import get_runtime, load_runtime
from . import prediction_store
from .schemas import (
    AssessmentOut,
    CopilotRequest,
    CopilotResponse,
    CopilotStatusResponse,
    CurvePoint,
    HealthResponse,
    PredictRequest,
    PredictResponse,
    SeasonalState,
    SegmentOut,
)
from .seasonal import assess_winter_hazard
from .weather import fetch_hourly_weather

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("kairos.api")


@asynccontextmanager
async def lifespan(_: FastAPI):
    load_runtime()
    yield


app = FastAPI(title="KAIROS ML API", version="1.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    rt = get_runtime()
    return HealthResponse(
        status="ok",
        model_loaded=True,
        model_type=str(rt.meta.get("model_type", "LightGBM")),
        feature_count=rt.feature_count,
        segment_count=rt.segment_count,
        target=rt.meta.get("target"),
        medium_risk_threshold=rt.medium_threshold,
        high_risk_threshold=rt.high_threshold,
        copilot_configured=copilot_mod.deepseek_configured(),
    )


@app.get("/api/segments", response_model=list[SegmentOut])
def list_segments() -> list[SegmentOut]:
    rt = get_runtime()
    ordered = [sid for sid in SEGMENT_LABELS if sid in rt.segments]
    for sid in rt.segments:
        if sid not in ordered:
            ordered.append(sid)
    out: list[SegmentOut] = []
    for sid in ordered:
        seg = rt.segments[sid]
        out.append(
            SegmentOut(
                segment_id=sid,
                label=seg.label,
                km_start=seg.km_lo,
                km_end=seg.km_hi,
            )
        )
    return out


@app.get("/api/copilot/status", response_model=CopilotStatusResponse)
def copilot_status() -> CopilotStatusResponse:
    ok = copilot_mod.deepseek_configured()
    return CopilotStatusResponse(
        available=ok,
        model=DEEPSEEK_MODEL if ok else None,
    )


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

    prior = [p for p in curve if _parse_hhmm(p.time)[0] * 60 + _parse_hhmm(p.time)[1] <= dep_minutes]
    if not prior:
        return ""

    if prior[0].risk >= high_threshold:
        return ""

    last_safe_i = None
    for i, p in enumerate(prior):
        if p.risk < high_threshold:
            last_safe_i = i
        else:
            break
    if last_safe_i is None:
        return ""

    safe = prior[last_safe_i]
    if last_safe_i + 1 < len(prior):
        nxt = prior[last_safe_i + 1]
        if nxt.risk >= high_threshold and nxt.risk != safe.risk:
            t0 = _parse_hhmm(safe.time)[0] * 60 + _parse_hhmm(safe.time)[1]
            t1 = _parse_hhmm(nxt.time)[0] * 60 + _parse_hhmm(nxt.time)[1]
            frac = (high_threshold - safe.risk) / (nxt.risk - safe.risk)
            mins = int(round(t0 + frac * (t1 - t0)))
            mins = max(t0, mins - 1)
            return f"{mins // 60:02d}:{mins % 60:02d}"
    return safe.time


def _curve_point_at(curve: list[dict], hhmm: str) -> dict | None:
    """Nearest curve point to hhmm (exact hour match preferred)."""
    if not curve:
        return None
    want = _parse_hhmm(hhmm)[0] * 60 + _parse_hhmm(hhmm)[1]
    best = None
    best_d = 10**9
    for p in curve:
        m = _parse_hhmm(p["time"])[0] * 60 + _parse_hhmm(p["time"])[1]
        d = abs(m - want)
        if d < best_d:
            best_d = d
            best = p
    return best


@app.post("/api/predict", response_model=PredictResponse)
async def predict(req: PredictRequest) -> PredictResponse:
    rt = get_runtime()
    seg = rt.segments.get(req.segment_id)
    if seg is None:
        raise HTTPException(status_code=422, detail=f"unsupported segment_id: {req.segment_id}")

    try:
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

        dh, dm = _parse_hhmm(req.departure)
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
        recommended = _recommended_departure(curve, req.departure, rt.high_threshold, risk)
        headline, detail = risk_copy(
            label,
            wind_speed=wind,
            wind_gusts=gust,
            snowfall=snow,
            visibility=vis,
            recommended_departure=recommended,
        )

        # Honest copy when winter hazard is inactive — do not falsify risk.
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

        assessment_raw = build_assessment(
            risk=risk,
            risk_label=label,
            departure=req.departure,
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
        assessment = AssessmentOut(**assessment_raw)

        response = PredictResponse(
            segment_id=req.segment_id,
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

        prediction_store.put_prediction(
            req.segment_id,
            {
                **response.model_dump(),
                "segment_label": seg.label,
            },
        )
        return response
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("predict failed segment=%s", req.segment_id)
        raise HTTPException(status_code=502, detail="prediction failed") from exc


@app.post("/api/copilot", response_model=CopilotResponse)
async def copilot(req: CopilotRequest) -> CopilotResponse:
    rt = get_runtime()
    if req.segment_id not in rt.segments:
        raise HTTPException(status_code=422, detail=f"unsupported segment_id: {req.segment_id}")

    stored = prediction_store.get_prediction(req.segment_id)
    if not stored:
        raise HTTPException(
            status_code=409,
            detail="no cached prediction for segment; run /api/predict first",
        )

    # Authoritative context from server store — never trust client risk/weather.
    seasonal = stored.get("seasonal") or {}
    assessment = build_assessment(
        risk=float(stored["risk"]),
        risk_label=str(stored["risk_label"]),
        departure=req.departure,
        recommended_departure=str(stored.get("recommended_departure") or ""),
        wind_speed=float(stored["wind_speed"]),
        wind_gusts=float(stored.get("wind_gusts") or stored["wind_speed"]),
        snowfall=float(stored["snowfall"]),
        visibility=float(stored["visibility"]),
        temperature=float(stored["temperature"]),
        winter_hazard_active=bool(seasonal.get("winter_hazard_active", True)),
        seasonal_reason=str(seasonal.get("reason") or ""),
        locale=req.locale,
    )

    compare_points = []
    for t in req.compare_times:
        pt = _curve_point_at(stored.get("curve") or [], t)
        if pt:
            compare_points.append(
                {
                    "time": pt["time"],
                    "risk": pt["risk"],
                    "wind_speed": pt["wind_speed"],
                    "snowfall": pt["snowfall"],
                    "visibility": pt["visibility"],
                    "temperature": pt["temperature"],
                }
            )

    context = {
        "segment_id": stored["segment_id"],
        "segment_label": stored.get("segment_label") or req.segment_label or req.segment_id,
        "departure": req.departure,
        "risk": stored["risk"],
        "risk_label": stored["risk_label"],
        "wind_speed": stored["wind_speed"],
        "wind_gusts": stored.get("wind_gusts"),
        "snowfall": stored["snowfall"],
        "visibility": stored["visibility"],
        "temperature": stored["temperature"],
        "recommended_departure": stored.get("recommended_departure") or "",
        "headline": stored.get("headline") or "",
        "detail": stored.get("detail") or "",
        "seasonal": seasonal,
        "medium_risk_threshold": stored.get("medium_risk_threshold"),
        "high_risk_threshold": stored.get("high_risk_threshold"),
        "score_note": "Model output is a risk score, not a calibrated probability.",
    }

    if not copilot_mod.deepseek_configured():
        return CopilotResponse(
            answer="AI explanation temporarily unavailable.",
            available=False,
            locale=req.locale,
            profile=req.profile,
            risk=float(stored["risk"]),
            risk_label=str(stored["risk_label"]),
            winter_hazard_active=bool(seasonal.get("winter_hazard_active", True)),
            assessment=AssessmentOut(**assessment),
            compare_points=compare_points,
        )

    user_payload = copilot_mod.build_user_payload(
        message=req.message,
        locale=req.locale,
        profile=req.profile,
        context=context,
        compare_points=compare_points,
    )

    try:
        answer = await copilot_mod.complete_copilot(user_payload)
    except TimeoutError:
        raise HTTPException(status_code=504, detail="AI explanation temporarily unavailable.") from None
    except Exception:
        log.exception("copilot failed segment=%s", req.segment_id)
        raise HTTPException(status_code=502, detail="AI explanation temporarily unavailable.") from None

    return CopilotResponse(
        answer=answer,
        available=True,
        locale=req.locale,
        profile=req.profile,
        risk=float(stored["risk"]),
        risk_label=str(stored["risk_label"]),
        winter_hazard_active=bool(seasonal.get("winter_hazard_active", True)),
        assessment=AssessmentOut(**assessment),
        compare_points=compare_points,
    )
