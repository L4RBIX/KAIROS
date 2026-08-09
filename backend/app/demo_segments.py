"""Demo coverage network: synthetic corridor segments for nationwide routing.

The trained BORAN model only carries seven surveyed segments, all on the
Almaty–Taraz–Shymkent axis and the Kyzylorda–Aral leg. Every other city pair
therefore matched nothing and the planner fell back to "weather-only".

For demo builds we lay representative midpoints along the real Kazakhstan
trunk-road network so any city pair resolves to a corridor. These midpoints are
NOT surveyed training segments: they carry `trained=False`, they are ranked
below real segments when the journey picks what to score, and the API reports
them as `demo_corridor`. Weather and LightGBM inference stay genuine — the model
consumes only latitude, longitude and km_length from a segment, so a synthetic
midpoint yields a real score for real live weather at that coordinate.

Disable with KAIROS_DEMO_COVERAGE=0.
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path

log = logging.getLogger("kairos.demo")

# Kazakhstan runs a single UTC+5 offset since 2024-03-01.
DEMO_TZ = "Asia/Almaty"

# Nominal spacing between representative midpoints along a corridor, in km.
DEMO_SPACING_KM = 60.0

#: (road code, human label, [(lat, lon), ...]) along the real trunk network.
CORRIDORS: list[tuple[str, str, list[tuple[float, float]]]] = [
    # --- south / Silk Road axis -------------------------------------------
    ("A2", "Алматы–Кордай–Тараз–Шымкент", [
        (43.2389, 76.9455), (43.0466, 74.7075), (42.9000, 71.3667), (42.3417, 69.5901),
    ]),
    ("A2W", "Шымкент–Туркестан–Кызылорда", [
        (42.3417, 69.5901), (43.3017, 68.2517), (44.8528, 65.5092),
    ]),
    # --- west --------------------------------------------------------------
    ("M32", "Кызылорда–Аральск–Шалкар–Актобе", [
        (44.8528, 65.5092), (46.7955, 61.6636), (47.8333, 59.6000), (50.2839, 57.1670),
    ]),
    ("M32W", "Актобе–Уральск", [
        (50.2839, 57.1670), (51.2333, 51.3667),
    ]),
    ("A27", "Актобе–Кандыагаш–Атырау", [
        (50.2839, 57.1670), (49.4667, 57.4000), (47.1164, 51.9207),
    ]),
    ("M32A", "Уральск–Атырау", [
        (51.2333, 51.3667), (47.1164, 51.9207),
    ]),
    ("A33", "Атырау–Бейнеу–Актау", [
        (47.1164, 51.9207), (45.3167, 55.2000), (43.6500, 51.2000),
    ]),
    # --- east --------------------------------------------------------------
    ("A3", "Алматы–Талдыкорган", [
        (43.2389, 76.9455), (45.0156, 78.3739),
    ]),
    ("A350", "Талдыкорган–Аягоз–Усть-Каменогорск", [
        (45.0156, 78.3739), (47.9667, 80.4333), (49.9483, 82.6270),
    ]),
    ("A351", "Усть-Каменогорск–Семей", [
        (49.9483, 82.6270), (50.4111, 80.2275),
    ]),
    ("A17", "Семей–Павлодар", [
        (50.4111, 80.2275), (52.2873, 76.9674),
    ]),
    # --- centre / north ----------------------------------------------------
    ("A17N", "Павлодар–Экибастуз–Астана", [
        (52.2873, 76.9674), (51.7298, 75.3266), (51.1694, 71.4491),
    ]),
    ("M36", "Астана–Караганда", [
        (51.1694, 71.4491), (49.8047, 73.1094),
    ]),
    ("M36S", "Караганда–Балхаш–Алматы", [
        (49.8047, 73.1094), (46.8481, 74.9950), (43.2389, 76.9455),
    ]),
    ("A17W", "Караганда–Жезказган–Кызылорда", [
        (49.8047, 73.1094), (47.7833, 67.7000), (44.8528, 65.5092),
    ]),
    ("A1", "Астана–Кокшетау", [
        (51.1694, 71.4491), (53.2833, 69.3833),
    ]),
    ("M51", "Кокшетау–Петропавловск", [
        (53.2833, 69.3833), (54.8753, 69.1628),
    ]),
    ("A22", "Кокшетау–Костанай", [
        (53.2833, 69.3833), (53.2144, 63.6246),
    ]),
    ("A1W", "Астана–Атбасар–Костанай", [
        (51.1694, 71.4491), (51.8000, 68.3500), (53.2144, 63.6246),
    ]),
    ("A21", "Костанай–Актобе", [
        (53.2144, 63.6246), (50.2839, 57.1670),
    ]),
    # Northern legs whose driving route runs along/through the Russian border
    # rather than any domestic corridor above.
    ("M38", "Павлодар–Омск–Петропавловск", [
        (52.2873, 76.9674), (54.9885, 73.3242), (54.8753, 69.1628),
    ]),
    ("A310", "Костанай–Петропавловск", [
        (53.2144, 63.6246), (54.8753, 69.1628),
    ]),
]

#: Midpoints snapped to real OSRM road geometry, baked by
#: tools/build_demo_corridors.py. Absent file → straight-line fallback below.
BAKED_PATH = Path(__file__).resolve().parent / "data" / "demo_corridors.json"


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _point_at(
    waypoints: list[tuple[float, float]],
    legs: list[float],
    distance_km: float,
) -> tuple[float, float]:
    """Linear interpolation along the polyline at `distance_km` from the start."""
    remaining = distance_km
    for i, leg in enumerate(legs):
        if remaining <= leg or i == len(legs) - 1:
            t = (remaining / leg) if leg > 0 else 0.0
            t = min(1.0, max(0.0, t))
            a, b = waypoints[i], waypoints[i + 1]
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        remaining -= leg
    return waypoints[-1]


def segments_along_polyline(
    road: str,
    name: str,
    points: list[tuple[float, float]],
    spacing_km: float,
) -> dict[str, dict]:
    """Representative midpoints every `spacing_km` along a (lat, lon) polyline.

    `points` may be a coarse waypoint list or a dense road geometry; denser
    input places the midpoints closer to the real carriageway.
    """
    out: dict[str, dict] = {}
    legs = [
        _haversine_km(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1])
        for i in range(len(points) - 1)
    ]
    total = sum(legs)
    if total <= 0:
        return out

    count = max(1, int(round(total / spacing_km)))
    step = total / count

    for k in range(count):
        km_lo = k * step
        km_hi = km_lo + step
        lat, lon = _point_at(points, legs, km_lo + step / 2.0)
        sid = f"{road}__KM_{int(round(km_lo))}_{int(round(km_hi))}"
        out[sid] = {
            "latitude": round(lat, 5),
            "longitude": round(lon, 5),
            "timezone": DEMO_TZ,
            "geo_method": "demo_corridor_midpoint",
            "km_lo": round(km_lo, 1),
            "km_hi": round(km_hi, 1),
            "km_length": round(step, 1),
            "label": f"{name} · км {int(round(km_lo))}–{int(round(km_hi))}",
        }
    return out


def build_demo_segments(spacing_km: float = DEMO_SPACING_KM) -> dict[str, dict]:
    """Demo corridor midpoints, preferring geometry baked from real roads."""
    if BAKED_PATH.is_file():
        try:
            with BAKED_PATH.open(encoding="utf-8") as f:
                baked = json.load(f)
            segments = baked.get("segments") or {}
            if segments:
                return segments
            log.warning("baked demo corridors empty; falling back to waypoint lines")
        except (OSError, ValueError):
            log.exception("failed to read %s; falling back to waypoint lines", BAKED_PATH)

    return build_demo_segments_from_waypoints(spacing_km)


def build_demo_segments_from_waypoints(
    spacing_km: float = DEMO_SPACING_KM,
) -> dict[str, dict]:
    """Straight-line fallback: interpolate between the corridor waypoints."""
    out: dict[str, dict] = {}
    for road, name, waypoints in CORRIDORS:
        out.update(segments_along_polyline(road, name, waypoints, spacing_km))
    return out
