"""Journey analysis: coverage + LightGBM only on matched trained segments."""

from __future__ import annotations

import logging
from typing import Any

from .assessment import build_assessment
from .coverage import analyze_route_coverage
from .model_runtime import ModelRuntime
from .seasonal import assess_winter_hazard

log = logging.getLogger("kairos.journey")


def pick_highest_risk(predictions: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not predictions:
        return None
    return max(predictions, key=lambda p: float(p.get("risk", 0.0)))


def safest_window_from_curve(
    curve: list[dict[str, Any]],
    high_threshold: float,
) -> dict[str, Any]:
    if not curve:
        return {"start": "", "end": "", "min_risk": None, "note": "No curve available."}
    best = min(curve, key=lambda p: float(p["risk"]))
    below = [p for p in curve if float(p["risk"]) < high_threshold]
    if not below:
        return {
            "start": best["time"],
            "end": best["time"],
            "min_risk": float(best["risk"]),
            "note": "No hour stays below the high-risk threshold; earliest lowest score shown.",
        }
    # Contiguous window containing the minimum among below-threshold points.
    times = [p["time"] for p in below]
    return {
        "start": times[0],
        "end": times[-1],
        "min_risk": float(min(float(p["risk"]) for p in below)),
        "note": "Deterministic window from the cached risk curve (not LLM).",
    }


def wait_delta(
    curve: list[dict[str, Any]],
    departure: str,
    hours: float = 2.0,
) -> dict[str, Any] | None:
    if not curve:
        return None

    def to_min(hhmm: str) -> int:
        h, m = hhmm.split(":")
        return int(h) * 60 + int(m)

    want = to_min(departure)
    later = want + int(hours * 60)

    def nearest(mins: int) -> dict[str, Any]:
        return min(curve, key=lambda p: abs(to_min(p["time"]) - mins))

    a = nearest(want)
    b = nearest(later)
    return {
        "now": a,
        "later": b,
        "hours": hours,
        "risk_delta": float(b["risk"]) - float(a["risk"]),
    }


def build_journey_summary(
    *,
    from_label: str,
    to_label: str,
    departure: str,
    coverage: dict[str, Any],
    predictions: list[dict[str, Any]],
    rt: ModelRuntime,
) -> dict[str, Any]:
    highest = pick_highest_risk(predictions)
    seasonal = None
    assessment = None
    safest = {"start": "", "end": "", "min_risk": None, "note": "No covered segment."}
    wait = None

    if highest:
        seasonal = highest.get("seasonal")
        assessment = build_assessment(
            risk=float(highest["risk"]),
            risk_label=str(highest["risk_label"]),
            departure=departure,
            recommended_departure=str(highest.get("recommended_departure") or ""),
            wind_speed=float(highest["wind_speed"]),
            wind_gusts=float(highest.get("wind_gusts") or highest["wind_speed"]),
            snowfall=float(highest["snowfall"]),
            visibility=float(highest["visibility"]),
            temperature=float(highest["temperature"]),
            winter_hazard_active=bool((seasonal or {}).get("winter_hazard_active", True)),
            seasonal_reason=str((seasonal or {}).get("reason") or ""),
            locale="en",
        )
        curve = highest.get("curve") or []
        safest = safest_window_from_curve(curve, rt.high_threshold)
        wait = wait_delta(curve, departure, 2.0)

    return {
        "journey": {
            "from": from_label,
            "to": to_label,
            "departure": departure,
            "distance_km": coverage.get("total_km", 0),
        },
        "coverage": {
            "percent": coverage.get("percent", 0),
            "covered_km": coverage.get("covered_km", 0),
            "total_km": coverage.get("total_km", 0),
            "coverage_quality": coverage.get("coverage_quality"),
            "note": coverage.get("note"),
            "covered_segments": [
                {
                    "segment_id": m["segment_id"],
                    "label": m["label"],
                    "coverage_type": m["coverage_type"],
                    "trained": m["trained"],
                    "approx_covered_km": m["approx_covered_km"],
                }
                for m in coverage.get("matches", [])
            ],
        },
        "predictions": predictions,
        "highest_risk_segment": highest,
        "assessment": assessment,
        "safest_window": safest,
        "wait_compare": wait,
        "ml_available": bool(predictions),
    }


def empty_prediction_note() -> str:
    return (
        "Live weather may still be available regionally, but KAIROS ML coverage "
        "is not yet available on this route under conservative matching."
    )
