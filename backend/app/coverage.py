"""Conservative route ↔ trained-segment coverage matching.

Segments only have representative midpoints (no road polylines). We therefore
claim coverage only when the route comes within a bounded buffer of a midpoint,
and we never invent LightGBM scores for unmatched geometry.
"""

from __future__ import annotations

import math
from typing import Any

from .model_runtime import Segment


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def route_length_km(coords: list[list[float]]) -> float:
    """coords are [lon, lat] pairs (GeoJSON order)."""
    if len(coords) < 2:
        return 0.0
    total = 0.0
    for i in range(1, len(coords)):
        lon1, lat1 = coords[i - 1]
        lon2, lat2 = coords[i]
        total += haversine_km(lat1, lon1, lat2, lon2)
    return total


def coverage_radius_km(segment: Segment) -> float:
    """Conservative buffer around the representative midpoint."""
    # Half-length as rough corridor, clamped — never claim a huge national area.
    raw = max(18.0, float(segment.km_length) * 0.22)
    return min(raw, 42.0)


def analyze_route_coverage(
    coords: list[list[float]],
    segments: dict[str, Segment],
    *,
    total_km: float | None = None,
) -> dict[str, Any]:
    """
    Match a route LineString against trained segment midpoints.

    Returns covered segment ids with approximate covered_km contributions.
    Does not run the model and does not invent risk.
    """
    if len(coords) < 2:
        return {
            "total_km": 0.0,
            "covered_km": 0.0,
            "percent": 0.0,
            "coverage_quality": "none",
            "note": "Route geometry is empty.",
            "matches": [],
        }

    length = float(total_km) if total_km is not None else route_length_km(coords)
    length = max(length, 0.0)

    matches: list[dict[str, Any]] = []
    covered_sum = 0.0

    # Bounding box of the route, so a national segment catalog does not cost a
    # full haversine sweep per segment.
    lats = [lat for _, lat in coords]
    lons = [lon for lon, _ in coords]
    lat_min, lat_max = min(lats), max(lats)
    lon_min, lon_max = min(lons), max(lons)

    for sid, seg in segments.items():
        radius = coverage_radius_km(seg)
        lat_pad = radius / 111.0
        lon_pad = radius / max(
            1.0, 111.0 * math.cos(math.radians(max(-89.0, min(89.0, seg.latitude))))
        )
        if not (lat_min - lat_pad <= seg.latitude <= lat_max + lat_pad):
            continue
        if not (lon_min - lon_pad <= seg.longitude <= lon_max + lon_pad):
            continue

        min_d = float("inf")
        min_i = 0
        for i, (lon, lat) in enumerate(coords):
            d = haversine_km(seg.latitude, seg.longitude, lat, lon)
            if d < min_d:
                min_d, min_i = d, i
        if min_d > radius:
            continue

        # Approximate contribution: closer approach → more of the segment length.
        proximity = 1.0 - (min_d / radius)
        approx_km = min(float(seg.km_length), max(8.0, float(seg.km_length) * proximity))
        covered_sum += approx_km
        matches.append(
            {
                "segment_id": sid,
                "label": seg.label,
                "trained": bool(seg.trained),
                "coverage_type": "trained_approximate" if seg.trained else "demo_corridor",
                # 0 at the origin, 1 at the destination — lets the caller spread
                # a limited number of model calls along the whole journey.
                "route_position": round(min_i / max(1, len(coords) - 1), 4),
                "distance_to_midpoint_km": round(min_d, 2),
                "coverage_radius_km": round(radius, 2),
                "approx_covered_km": round(approx_km, 1),
                "latitude": seg.latitude,
                "longitude": seg.longitude,
                "km_length": seg.km_length,
                "geo_method": "midpoint_buffer",
            }
        )

    # Cap covered km so percent never exceeds 100.
    covered_sum = min(covered_sum, length) if length > 0 else 0.0
    percent = (covered_sum / length * 100.0) if length > 0 else 0.0
    percent = max(0.0, min(100.0, percent))

    quality = "none"
    note = "No KAIROS corridors intersect this route under conservative matching."
    if matches:
        quality = "approximate"
        note = (
            "Coverage uses representative segment midpoints (not surveyed polylines). "
            "Only matched corridors receive LightGBM risk."
        )

    # Surveyed training segments always rank ahead of demo corridor midpoints,
    # so a route that touches real trained geometry scores on that geometry.
    matches.sort(key=lambda m: (not m["trained"], m["distance_to_midpoint_km"]))
    return {
        "total_km": round(length, 1),
        "covered_km": round(covered_sum, 1),
        "percent": round(percent, 1),
        "coverage_quality": quality,
        "note": note,
        "matches": matches,
    }
