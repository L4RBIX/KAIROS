"""Seasonal hazard logic must not overwrite model risk."""

from app.seasonal import assess_winter_hazard


def test_summer_like_weather_inactive():
    s = assess_winter_hazard(
        temperature=28.0,
        snowfall=0.0,
        snow_depth=0.0,
        visibility=50000.0,
        precipitation=0.0,
        snowfall_sum_24h=0.0,
    )
    assert s["winter_hazard_active"] is False
    assert s["seasonal_context"] == "summer"
    assert s["ood_caution"] is True


def test_winter_storm_active():
    s = assess_winter_hazard(
        temperature=-12.0,
        snowfall=1.4,
        snow_depth=0.05,
        visibility=700.0,
        precipitation=0.8,
        snowfall_sum_24h=6.0,
    )
    assert s["winter_hazard_active"] is True
    assert s["seasonal_context"] == "winter"


def test_seasonal_does_not_mutate_risk_input():
    risk = 0.47
    s = assess_winter_hazard(
        temperature=30.0,
        snowfall=0.0,
        snow_depth=0.0,
        visibility=40000.0,
    )
    # Function returns seasonal fields only — risk is never part of output.
    assert "risk" not in s
    assert risk == 0.47
    assert s["winter_hazard_active"] is False
