"""Backward-compatible alias for the physical applicability gate."""

from __future__ import annotations

from typing import Any

from .applicability import assess_physical_applicability


def assess_winter_hazard(
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
    """Legacy name — delegates to assess_physical_applicability."""
    return assess_physical_applicability(
        temperature=temperature,
        snowfall=snowfall,
        snow_depth=snow_depth,
        visibility=visibility,
        precipitation=precipitation,
        snowfall_sum_24h=snowfall_sum_24h,
        wind_speed=wind_speed,
        wind_gusts=wind_gusts,
    )
