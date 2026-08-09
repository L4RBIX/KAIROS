"""KAIROS FastAPI inference service."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .assessment import build_assessment
from .config import CORS_ORIGINS, DEEPSEEK_MODEL, SEGMENT_LABELS
from . import copilot as copilot_mod
from .coverage import analyze_route_coverage, coverage_radius_km
from .journey import build_journey_summary, empty_prediction_note
from .model_runtime import get_runtime, load_runtime
from . import prediction_store
from .predict_core import predict_segment
from .schemas import (
    AssessmentOut,
    CopilotRequest,
    CopilotResponse,
    CopilotStatusResponse,
    HealthResponse,
    JourneyAnalyzeRequest,
    JourneyAnalyzeResponse,
    JourneyIntelligenceRequest,
    JourneyIntelligenceResponse,
    PredictRequest,
    PredictResponse,
    SegmentOut,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("kairos.api")

JOURNEY_KEY = "__journey__"


@asynccontextmanager
async def lifespan(_: FastAPI):
    load_runtime()
    yield


app = FastAPI(title="KAIROS ML API", version="1.2.0", lifespan=lifespan)
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
        trained_segment_count=rt.trained_segment_count,
        demo_coverage=rt.segment_count > rt.trained_segment_count,
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
                latitude=seg.latitude,
                longitude=seg.longitude,
                km_length=seg.km_length,
                geo_method="midpoint_buffer" if seg.trained else "demo_corridor_midpoint",
                trained=seg.trained,
                coverage_note=(
                    f"Approximate corridor ~{coverage_radius_km(seg):.0f} km "
                    "around a representative midpoint — not a surveyed polyline."
                ),
            )
        )
    return out


@app.get("/api/copilot/status", response_model=CopilotStatusResponse)
def copilot_status() -> CopilotStatusResponse:
    ok = copilot_mod.deepseek_configured()
    return CopilotStatusResponse(available=ok, model=DEEPSEEK_MODEL if ok else None)


def _parse_hhmm(hhmm: str) -> tuple[int, int]:
    h, m = hhmm.split(":")
    return int(h), int(m)


def _curve_point_at(curve: list[dict], hhmm: str) -> dict | None:
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
        response = await predict_segment(req.segment_id, req.departure)
        prediction_store.put_prediction(
            req.segment_id,
            {**response.model_dump(), "segment_label": seg.label},
        )
        return response
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("predict failed segment=%s", req.segment_id)
        raise HTTPException(status_code=502, detail="prediction failed") from exc


def _select_segments_to_score(matches: list[dict], limit: int = 3) -> list[str]:
    """Trained matches first, then demo corridors spread across the route."""
    trained = [m for m in matches if m.get("trained")]
    picked = [m["segment_id"] for m in trained[:limit]]
    if len(picked) >= limit:
        return picked

    others = sorted(
        (m for m in matches if not m.get("trained")),
        key=lambda m: m.get("route_position", 0.0),
    )
    if not others:
        return picked

    slots = limit - len(picked)
    # Evenly spaced samples including both ends of the corridor list.
    for k in range(slots):
        idx = 0 if slots == 1 else round(k * (len(others) - 1) / (slots - 1))
        sid = others[idx]["segment_id"]
        if sid not in picked:
            picked.append(sid)
    return picked


@app.post("/api/journey/analyze", response_model=JourneyAnalyzeResponse)
async def journey_analyze(req: JourneyAnalyzeRequest) -> JourneyAnalyzeResponse:
    """
    Match route geometry to trained midpoints, then run LightGBM ONLY on matches.
    Arbitrary roads never receive fabricated ML risk.
    """
    rt = get_runtime()
    coverage = analyze_route_coverage(
        req.geometry,
        rt.segments,
        total_km=req.distance_km,
    )

    # Cap ML calls (hackathon latency). Surveyed segments go first; the rest of
    # the budget is spread along the route so the "highest risk" section is not
    # sampled from one cluster near the origin.
    matches = coverage.get("matches") or []
    predict_ids = _select_segments_to_score(matches, limit=3)

    predictions: list[dict] = []
    for sid in predict_ids:
        try:
            pred = await predict_segment(sid, req.departure)
            payload = {
                **pred.model_dump(),
                "segment_label": rt.segments[sid].label,
                "trained": bool(rt.segments[sid].trained),
            }
            prediction_store.put_prediction(sid, payload)
            predictions.append(payload)
        except Exception:
            log.exception("journey predict failed segment=%s", sid)

    summary = build_journey_summary(
        from_label=req.from_label,
        to_label=req.to_label,
        departure=req.departure,
        coverage=coverage,
        predictions=predictions,
        rt=rt,
    )
    note = "" if summary["ml_available"] else empty_prediction_note()
    summary["note"] = note
    prediction_store.put_prediction(JOURNEY_KEY, summary)

    assessment = summary.get("assessment")
    return JourneyAnalyzeResponse(
        journey=summary["journey"],
        coverage=summary["coverage"],
        predictions=summary["predictions"],
        highest_risk_segment=summary.get("highest_risk_segment"),
        assessment=AssessmentOut(**assessment) if assessment else None,
        safest_window=summary["safest_window"],
        wait_compare=summary.get("wait_compare"),
        ml_available=summary["ml_available"],
        note=note,
    )


@app.post("/api/journey/intelligence", response_model=JourneyIntelligenceResponse)
async def journey_intelligence(req: JourneyIntelligenceRequest) -> JourneyIntelligenceResponse:
    stored = prediction_store.get_prediction(JOURNEY_KEY)
    if not stored:
        raise HTTPException(
            status_code=409,
            detail="no journey analysis cached; run /api/journey/analyze first",
        )

    highest = stored.get("highest_risk_segment")
    coverage = stored.get("coverage") or {}
    journey = stored.get("journey") or {}
    wait = stored.get("wait_compare")
    safest = stored.get("safest_window") or {}

    prompts = {
        "summarize": (
            "Write a concise KAIROS Route Intelligence briefing for this journey. "
            "Lead with coverage %, highest-risk matched section (note surveyed vs demo), "
            "recommended departure, and what is uncovered (weather-only). Do not invent scores."
        ),
        "why": (
            "Explain WHY the highest-risk matched section has its current score, "
            "using only supplied weather and risk curve facts. No SHAP; no invented causality. "
            "If trained=false, say it is a demo corridor midpoint, not surveyed training geometry."
        ),
        "wait": (
            "Explain what changes if the driver waits about 2 hours, using wait_compare numbers only."
        ),
        "safest": (
            "Explain the deterministic safest_window using only supplied numbers. "
            "Do not recalculate a different window."
        ),
        "ask": req.message or "Answer the driver's journey question using only supplied context.",
    }
    message = prompts.get(req.action, prompts["summarize"])
    if req.action == "ask" and req.message.strip():
        message = req.message.strip()

    context = {
        "product": "KAIROS Route Intelligence",
        "journey": journey,
        "coverage": coverage,
        "highest_risk_segment": highest,
        "safest_window": safest,
        "wait_compare": wait,
        "ml_available": stored.get("ml_available", False),
        "rules": [
            "LightGBM risk is scored on matched corridor midpoints (surveyed trained=true, or demo trained=false).",
            "Do not call demo corridor midpoints surveyed training geometry.",
            "Uncovered sections are weather-only.",
            "Risk scores are not calibrated probabilities.",
            "Do not invent closures, accidents, or scores.",
        ],
        "score_note": "Model output is a risk score, not a calibrated probability.",
    }

    highest_risk = float(highest["risk"]) if highest else None
    cov_pct = coverage.get("percent")

    if not copilot_mod.deepseek_configured():
        # Deterministic fallback briefing — still useful without DeepSeek.
        if not stored.get("ml_available"):
            answer = (
                f"Journey {journey.get('from')} → {journey.get('to')} "
                f"({journey.get('distance_km')} km). "
                f"KAIROS ML coverage {cov_pct}% under conservative matching. "
                "No corridor matched — weather monitoring only; no LightGBM risk invented."
            )
        else:
            kind = "surveyed" if highest.get("trained") else "demo corridor"
            answer = (
                f"Journey {journey.get('from')} → {journey.get('to')}. "
                f"Model coverage ~{cov_pct}%. "
                f"Highest-risk {kind}: {highest.get('segment_label') or highest.get('segment_id')} "
                f"at {round((highest_risk or 0) * 100)}% ({highest.get('risk_label')}). "
                f"Recommended departure: {highest.get('recommended_departure') or 'current window acceptable'}. "
                "Uncovered sections remain weather-only."
            )
        return JourneyIntelligenceResponse(
            answer=answer,
            available=False,
            action=req.action,
            locale=req.locale,
            ml_available=bool(stored.get("ml_available")),
            highest_risk=highest_risk,
            coverage_percent=cov_pct,
        )

    user_payload = copilot_mod.build_user_payload(
        message=message,
        locale=req.locale,
        profile=req.profile,
        context=context,
        compare_points=[],
    )
    try:
        answer = await copilot_mod.complete_copilot(user_payload)
    except TimeoutError:
        raise HTTPException(status_code=504, detail="AI explanation temporarily unavailable.") from None
    except Exception:
        log.exception("journey intelligence failed")
        raise HTTPException(status_code=502, detail="AI explanation temporarily unavailable.") from None

    return JourneyIntelligenceResponse(
        answer=answer,
        available=True,
        action=req.action,
        locale=req.locale,
        ml_available=bool(stored.get("ml_available")),
        highest_risk=highest_risk,
        coverage_percent=cov_pct,
    )


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
                    "raw_model_risk": pt.get("raw_model_risk", pt["risk"]),
                    "applicability": pt.get("applicability"),
                    "wind_speed": pt["wind_speed"],
                    "snowfall": pt["snowfall"],
                    "visibility": pt["visibility"],
                    "temperature": pt["temperature"],
                }
            )

    context = {
        "mode": req.mode,
        "segment_id": stored["segment_id"],
        "segment_label": stored.get("segment_label") or req.segment_label or req.segment_id,
        "departure": req.departure,
        "risk": stored["risk"],
        "raw_model_risk": stored.get("raw_model_risk", stored["risk"]),
        "risk_label": stored["risk_label"],
        "applicability": stored.get("applicability")
        or seasonal.get("applicability")
        or ("active" if seasonal.get("winter_hazard_active", True) else "inactive"),
        "applicability_reason": stored.get("applicability_reason")
        or seasonal.get("applicability_reason")
        or seasonal.get("reason")
        or "",
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
        "score_note": (
            "risk is actionable winter risk after the physical applicability gate; "
            "raw_model_risk is the LightGBM score retained for diagnostics. "
            "Neither is a calibrated probability."
        ),
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
