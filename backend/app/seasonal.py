"""Deterministic seasonal / winter-hazard assessment (not an ML prediction)."""

from __future__ import annotations

from typing import Any


def assess_winter_hazard(
    *,
    temperature: float,
    snowfall: float,
    snow_depth: float,
    visibility: float,
    precipitation: float = 0.0,
    snowfall_sum_24h: float = 0.0,
) -> dict[str, Any]:
    """
    Decide whether current conditions look like an active winter road hazard.

    Transparent product logic from live weather — separate from the LightGBM
    risk score. Prefer weather signals over calendar month alone.
    """
    snow_signal = max(float(snowfall), float(snowfall_sum_24h) / 8.0)
    freezing = float(temperature) <= 1.5
    near_freezing = float(temperature) <= 3.0
    snow_present = snow_signal >= 0.05 or float(snow_depth) >= 0.01
    low_vis = float(visibility) < 4000
    wintry_precip = float(precipitation) >= 0.2 and near_freezing

    active = bool(
        (freezing and (snow_present or low_vis or wintry_precip))
        or (snow_present and near_freezing)
        or (snow_signal >= 0.2)
    )

    if active:
        context = "winter"
        reason = "Snow, freezing temperatures, or low winter visibility present in the forecast."
    elif float(temperature) >= 10 and snow_signal < 0.02 and float(snow_depth) < 0.005:
        context = "summer"
        reason = "No snow or freezing conditions in the current forecast."
    elif float(temperature) >= 3 and snow_signal < 0.05:
        context = "shoulder"
        reason = "Mild conditions with negligible winter precipitation."
    else:
        context = "transitional"
        reason = "Mixed signals; winter hazard not clearly active."

    # Soft OOD hint when the model score may be less interpretable.
    # Metadata evaluates from Oct onward (winter season start) but does not
    # claim exclusive winter training — keep this as a caution, not a hard claim.
    ood_caution = (not active) and context in ("summer", "shoulder")

    return {
        "winter_hazard_active": active,
        "seasonal_context": context,
        "reason": reason,
        "ood_caution": ood_caution,
    }
