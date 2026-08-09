"""Physical applicability gate for winter-road hazard presentation.

Separates two questions:

1. What pattern did LightGBM score? → raw_model_risk
2. Are current physical conditions consistent with an actionable winter
   road hazard? → applicability active | inactive

This is deterministic product logic from live weather — not an ML prediction
and not a calendar-month rule.
"""

from __future__ import annotations

from typing import Any, Literal

Applicability = Literal["active", "inactive"]


def assess_physical_applicability(
    *,
    temperature: float,
    snowfall: float,
    snow_depth: float,
    visibility: float,
    precipitation: float = 0.0,
    snowfall_sum_24h: float = 0.0,
    wind_speed: float = 0.0,
    wind_gusts: float | None = None,
) -> dict[str, Any]:
    """
    Conservative, explainable winter-hazard applicability.

    Thresholds are product heuristics for an August-demo-safe UX, not validated
    meteorological closure criteria.
    """
    temp = float(temperature)
    snow = float(snowfall)
    depth = float(snow_depth)
    vis = float(visibility)
    precip = float(precipitation)
    snow24 = float(snowfall_sum_24h)
    wind = float(wind_speed)
    gust = float(wind_gusts if wind_gusts is not None else wind_speed)

    # Prefer instantaneous snowfall; dilute 24h accumulation so a dry hour
    # after overnight snow does not alone force a blizzard presentation.
    snow_signal = max(snow, snow24 / 8.0)
    freezing = temp <= 1.5
    near_freezing = temp <= 3.0
    snow_present = snow_signal >= 0.05 or depth >= 0.01
    strong_wind = wind >= 8.0 or gust >= 12.0
    low_vis = vis < 4000.0
    wintry_precip = precip >= 0.2 and near_freezing

    # Warm, dry, no snowpack: wind or haze alone must NOT activate winter risk.
    warm_clear = (
        temp >= 10.0
        and snow_signal < 0.02
        and depth < 0.005
        and precip < 0.1
    )

    if warm_clear:
        active = False
    else:
        active = bool(
            snow_signal >= 0.2
            or (snow_present and near_freezing)
            or (depth >= 0.01 and strong_wind and near_freezing)
            or (freezing and wintry_precip)
            or (freezing and snow_present and low_vis)
        )

    applicability: Applicability = "active" if active else "inactive"

    if active:
        context = "winter"
        reason = (
            "Snow, freezing precipitation, or snowpack with wind indicates "
            "an active winter-weather road hazard."
        )
    elif temp >= 10 and snow_signal < 0.02 and depth < 0.005:
        context = "summer"
        reason = "No active winter-weather hazard indicators."
    elif temp >= 3 and snow_signal < 0.05:
        context = "shoulder"
        reason = "Mild conditions with negligible winter precipitation."
    else:
        context = "transitional"
        reason = "Mixed signals; winter hazard not clearly active."

    ood_caution = (not active) and context in ("summer", "shoulder")

    return {
        "applicability": applicability,
        "applicability_reason": reason,
        "winter_hazard_active": active,
        "seasonal_context": context,
        "reason": reason,
        "ood_caution": ood_caution,
    }


def effective_risk(raw_model_risk: float, applicability: str) -> float:
    """Actionable winter risk shown by the product (never destroys the raw score)."""
    if applicability == "inactive":
        return 0.0
    r = float(raw_model_risk)
    if r < 0.0:
        return 0.0
    if r > 1.0:
        return 1.0
    return r
