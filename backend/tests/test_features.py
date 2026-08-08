"""Deterministic feature-engineering tests."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from app.features import engineer_features
from app.model_runtime import Segment, load_runtime


def _synthetic_weather(n: int = 30) -> pd.DataFrame:
    start = pd.Timestamp("2025-01-15 00:00:00")
    rows = []
    for i in range(n):
        rows.append(
            {
                "time": start + pd.Timedelta(hours=i),
                "temperature_2m": -10.0 - (i % 5) * 0.5,
                "relative_humidity_2m": 80.0,
                "precipitation": 0.1 if i % 3 == 0 else 0.0,
                "rain": 0.0,
                "snowfall": 0.2 if i % 2 == 0 else 0.0,
                "snow_depth": 0.05,
                "surface_pressure": 980.0,
                "visibility": 3000.0 - i * 20,
                "wind_speed_10m": 5.0 + (i % 4),
                "wind_gusts_10m": 8.0 + (i % 5),
            }
        )
    return pd.DataFrame(rows)


def test_engineered_features_match_order_and_math():
    rt = load_runtime()
    seg = Segment(
        segment_id="TEST",
        latitude=43.0,
        longitude=74.0,
        timezone="Asia/Almaty",
        km_lo=0,
        km_hi=10,
        km_length=10.0,
        label="test",
    )
    raw = _synthetic_weather(30)
    eng = engineer_features(raw, seg, rt.features)

    assert "segment_id" not in eng.columns
    for f in rt.features:
        assert f in eng.columns

    # Rolling snowfall sum over last 3 hours at index 5:
    # snowfall pattern 0.2,0,0.2,0,0.2,0 → indices 3,4,5 = 0, 0.2, 0 → sum 0.2
    idx = 5
    expected_snow_3 = float(raw.loc[idx - 2 : idx, "snowfall"].sum())
    assert math.isclose(eng.loc[idx, "snowfall_sum_3h"], expected_snow_3, rel_tol=1e-9)

    expected_gust_6 = float(raw.loc[idx - 5 : idx, "wind_gusts_10m"].max())
    assert math.isclose(eng.loc[idx, "gust_max_6h"], expected_gust_6, rel_tol=1e-9)

    expected_vis_12 = float(raw.loc[0:idx, "visibility"].min())  # min_periods=1, window 12 but only 6 rows
    # window 12 with idx=5 uses rows 0..5
    expected_vis_12 = float(raw.loc[max(0, idx - 11) : idx, "visibility"].min())
    assert math.isclose(eng.loc[idx, "visibility_min_12h"], expected_vis_12, rel_tol=1e-9)

    snow = float(raw.loc[idx, "snowfall"])
    wind = float(raw.loc[idx, "wind_speed_10m"])
    gust = float(raw.loc[idx, "wind_gusts_10m"])
    vis = float(raw.loc[idx, "visibility"])
    assert math.isclose(eng.loc[idx, "snow_x_wind"], snow * wind, rel_tol=1e-9)
    assert math.isclose(eng.loc[idx, "snow_x_gust"], snow * gust, rel_tol=1e-9)
    assert math.isclose(
        eng.loc[idx, "wind_visibility_ratio"], wind / max(vis, 100.0), rel_tol=1e-9
    )

    # Matrix order equals feature_order.json
    matrix = eng.reindex(columns=rt.features)
    assert list(matrix.columns) == rt.features
    assert len(matrix.columns) == 44
