"""Model artifact and LightGBM load tests."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.model_runtime import load_runtime


def test_model_loads_with_44_features_and_7_segments():
    rt = load_runtime()
    assert rt.feature_count == 44
    assert len(rt.features) == 44
    assert rt.segment_count == 7
    assert 0 < rt.medium_threshold < rt.high_threshold < 1
    assert "CLOSE" in str(rt.meta.get("target", "")).upper() or "RESTRICT" in str(
        rt.meta.get("target", "")
    ).upper()


def test_model_score_in_unit_interval():
    rt = load_runtime()
    row = {f: 0.0 for f in rt.features}
    # Realistic-ish mid winter values inside training ranges.
    row.update(
        {
            "temperature_2m": -8.0,
            "relative_humidity_2m": 80.0,
            "precipitation": 0.2,
            "rain": 0.0,
            "snowfall": 0.4,
            "snow_depth": 0.05,
            "surface_pressure": 980.0,
            "visibility": 2000.0,
            "wind_speed_10m": 8.0,
            "wind_gusts_10m": 14.0,
            "latitude": 43.35803,
            "longitude": 74.63131,
            "km_length": 79.0,
            "hour_sin": 0.0,
            "hour_cos": 1.0,
            "doy_sin": 0.5,
            "doy_cos": 0.8,
            "snowfall_sum_3h": 1.0,
            "precip_sum_3h": 1.0,
            "wind_max_3h": 9.0,
            "gust_max_3h": 15.0,
            "visibility_min_3h": 1500.0,
            "temp_min_3h": -10.0,
            "snowfall_sum_6h": 2.0,
            "precip_sum_6h": 2.0,
            "wind_max_6h": 10.0,
            "gust_max_6h": 16.0,
            "visibility_min_6h": 1200.0,
            "temp_min_6h": -11.0,
            "snowfall_sum_12h": 3.0,
            "precip_sum_12h": 3.5,
            "wind_max_12h": 11.0,
            "gust_max_12h": 18.0,
            "visibility_min_12h": 800.0,
            "temp_min_12h": -12.0,
            "snowfall_sum_24h": 5.0,
            "precip_sum_24h": 6.0,
            "wind_max_24h": 12.0,
            "gust_max_24h": 20.0,
            "visibility_min_24h": 500.0,
            "temp_min_24h": -14.0,
            "snow_x_wind": 3.2,
            "snow_x_gust": 5.6,
            "wind_visibility_ratio": 8.0 / 2000.0,
        }
    )
    score = rt.predict_score(row)
    assert 0.0 <= score <= 1.0
    assert np.isfinite(score)
