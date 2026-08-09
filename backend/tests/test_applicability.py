"""Physical applicability gate — deterministic, no live weather."""

from app.applicability import assess_physical_applicability, effective_risk


def test_case_a_warm_dry_summer_inactive_even_if_raw_elevated():
    s = assess_physical_applicability(
        temperature=25.0,
        snowfall=0.0,
        snow_depth=0.0,
        visibility=50000.0,
        precipitation=0.0,
        snowfall_sum_24h=0.0,
        wind_speed=4.0,
    )
    assert s["applicability"] == "inactive"
    assert s["winter_hazard_active"] is False
    assert effective_risk(0.45, s["applicability"]) == 0.0


def test_case_b_warm_but_windy_still_inactive():
    s = assess_physical_applicability(
        temperature=22.0,
        snowfall=0.0,
        snow_depth=0.0,
        visibility=40000.0,
        precipitation=0.0,
        wind_speed=18.0,
        wind_gusts=24.0,
    )
    assert s["applicability"] == "inactive"
    assert effective_risk(0.52, s["applicability"]) == 0.0


def test_case_c_active_snowfall():
    s = assess_physical_applicability(
        temperature=-6.0,
        snowfall=0.8,
        snow_depth=0.02,
        visibility=2000.0,
        precipitation=0.5,
        wind_speed=7.0,
    )
    assert s["applicability"] == "active"
    assert effective_risk(0.71, s["applicability"]) == 0.71


def test_case_d_snowpack_plus_strong_wind():
    s = assess_physical_applicability(
        temperature=-2.0,
        snowfall=0.0,
        snow_depth=0.04,
        visibility=8000.0,
        precipitation=0.0,
        wind_speed=14.0,
        wind_gusts=18.0,
    )
    assert s["applicability"] == "active"


def test_case_e_freezing_precipitation():
    s = assess_physical_applicability(
        temperature=-1.0,
        snowfall=0.0,
        snow_depth=0.0,
        visibility=6000.0,
        precipitation=0.6,
        wind_speed=5.0,
    )
    assert s["applicability"] == "active"


def test_case_f_curve_hours_independent():
    warm = assess_physical_applicability(
        temperature=28.0,
        snowfall=0.0,
        snow_depth=0.0,
        visibility=45000.0,
        precipitation=0.0,
    )
    cold = assess_physical_applicability(
        temperature=-8.0,
        snowfall=1.2,
        snow_depth=0.03,
        visibility=900.0,
        precipitation=0.9,
    )
    assert warm["applicability"] == "inactive"
    assert cold["applicability"] == "active"
    assert effective_risk(0.48, warm["applicability"]) == 0.0
    assert effective_risk(0.48, cold["applicability"]) == 0.48


def test_low_visibility_alone_when_warm_does_not_activate():
    s = assess_physical_applicability(
        temperature=24.0,
        snowfall=0.0,
        snow_depth=0.0,
        visibility=800.0,
        precipitation=0.0,
        wind_speed=3.0,
    )
    assert s["applicability"] == "inactive"
