"""Pydantic request/response schemas."""

from __future__ import annotations

import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

HHMM = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


class PredictRequest(BaseModel):
    segment_id: str = Field(..., min_length=3)
    departure: str = Field(..., description="HH:MM")

    @field_validator("departure")
    @classmethod
    def validate_departure(cls, v: str) -> str:
        m = HHMM.match((v or "").strip())
        if not m:
            raise ValueError("departure must be HH:MM")
        return f"{int(m.group(1)):02d}:{m.group(2)}"


class CurvePoint(BaseModel):
    time: str
    risk: float
    raw_model_risk: float = 0.0
    wind_speed: float
    snowfall: float
    visibility: float
    temperature: float
    applicability: Literal["active", "inactive"] = "active"
    applicability_reason: str = ""
    winter_hazard_active: bool = True


class SeasonalState(BaseModel):
    winter_hazard_active: bool
    seasonal_context: str
    reason: str
    ood_caution: bool = False
    applicability: Literal["active", "inactive"] = "active"
    applicability_reason: str = ""


class AssessmentOut(BaseModel):
    verdict: str
    title: str
    summary: str
    best_window: str
    primary_concerns: list[str]
    quick_prompts: list[str]
    risk: float
    risk_label: str


class PredictResponse(BaseModel):
    segment_id: str
    risk: float
    raw_model_risk: float = 0.0
    risk_label: Literal["low", "moderate", "high"]
    applicability: Literal["active", "inactive"] = "active"
    applicability_reason: str = ""
    wind_speed: float
    wind_gusts: float
    snowfall: float
    visibility: float
    temperature: float
    recommended_departure: str
    headline: str
    detail: str
    target_horizon_hours: int = 6
    medium_risk_threshold: float
    high_risk_threshold: float
    seasonal: SeasonalState
    assessment: AssessmentOut
    curve: list[CurvePoint]


class SegmentOut(BaseModel):
    segment_id: str
    label: str
    km_start: float
    km_end: float
    latitude: float = 0.0
    longitude: float = 0.0
    km_length: float = 0.0
    geo_method: str = "midpoint"
    coverage_note: str = "Representative midpoint — not a surveyed polyline."


class JourneyAnalyzeRequest(BaseModel):
    from_label: str = Field(..., min_length=1, max_length=80)
    to_label: str = Field(..., min_length=1, max_length=80)
    departure: str
    geometry: list[list[float]] = Field(..., min_length=2, max_length=5000)
    distance_km: Optional[float] = None

    @field_validator("departure")
    @classmethod
    def validate_departure(cls, v: str) -> str:
        m = HHMM.match((v or "").strip())
        if not m:
            raise ValueError("departure must be HH:MM")
        return f"{int(m.group(1)):02d}:{m.group(2)}"

    @field_validator("geometry")
    @classmethod
    def validate_geometry(cls, v: list[list[float]]) -> list[list[float]]:
        out: list[list[float]] = []
        for pt in v:
            if not isinstance(pt, (list, tuple)) or len(pt) < 2:
                raise ValueError("geometry points must be [lon, lat]")
            lon, lat = float(pt[0]), float(pt[1])
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise ValueError("invalid lon/lat")
            out.append([lon, lat])
        return out


class JourneyIntelligenceRequest(BaseModel):
    action: Literal["summarize", "why", "wait", "safest", "ask"] = "summarize"
    message: str = Field(default="", max_length=600)
    locale: Literal["en", "ru", "kk"] = "en"
    profile: Literal["car", "truck", "family"] = "car"


class JourneyAnalyzeResponse(BaseModel):
    journey: dict[str, Any]
    coverage: dict[str, Any]
    predictions: list[dict[str, Any]]
    highest_risk_segment: Optional[dict[str, Any]] = None
    assessment: Optional[AssessmentOut] = None
    safest_window: dict[str, Any]
    wait_compare: Optional[dict[str, Any]] = None
    ml_available: bool
    note: str = ""


class JourneyIntelligenceResponse(BaseModel):
    answer: str
    available: bool = True
    action: str
    locale: str
    ml_available: bool
    highest_risk: Optional[float] = None
    coverage_percent: Optional[float] = None


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    model_type: str
    feature_count: int
    segment_count: int
    target: Optional[str] = None
    medium_risk_threshold: Optional[float] = None
    high_risk_threshold: Optional[float] = None
    copilot_configured: bool = False


class CopilotRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=600)
    segment_id: str = Field(..., min_length=3)
    departure: str = Field(..., description="HH:MM")
    locale: Literal["en", "ru", "kk"] = "en"
    profile: Literal["car", "truck", "family"] = "car"
    compare_times: list[str] = Field(default_factory=list, max_length=4)
    segment_label: Optional[str] = None
    mode: Literal["live", "winter_demo"] = "live"

    @field_validator("departure")
    @classmethod
    def validate_departure(cls, v: str) -> str:
        m = HHMM.match((v or "").strip())
        if not m:
            raise ValueError("departure must be HH:MM")
        return f"{int(m.group(1)):02d}:{m.group(2)}"

    @field_validator("compare_times")
    @classmethod
    def validate_compare(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for item in v or []:
            m = HHMM.match((item or "").strip())
            if not m:
                raise ValueError("compare_times must be HH:MM values")
            out.append(f"{int(m.group(1)):02d}:{m.group(2)}")
        return out

    @field_validator("message")
    @classmethod
    def strip_message(cls, v: str) -> str:
        text = (v or "").strip()
        if not text:
            raise ValueError("message required")
        return text


class CopilotResponse(BaseModel):
    answer: str
    available: bool = True
    locale: str
    profile: str
    risk: float
    risk_label: str
    winter_hazard_active: bool
    assessment: AssessmentOut
    compare_points: list[dict[str, Any]] = Field(default_factory=list)


class CopilotStatusResponse(BaseModel):
    available: bool
    model: Optional[str] = None
