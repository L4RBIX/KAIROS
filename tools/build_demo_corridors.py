#!/usr/bin/env python3
"""Bake demo corridor midpoints from real OSRM road geometry.

The demo coverage network (backend/app/demo_segments.py) can interpolate
straight lines between corridor waypoints, but real roads curve away from those
lines, so a planned route often passes outside the matching buffer. This script
asks OSRM for each corridor's actual driving geometry and places the
representative midpoints on the carriageway itself.

    python tools/build_demo_corridors.py [--spacing 60] [--osrm URL]

Writes backend/app/data/demo_corridors.json, which the backend prefers on load.
Network access is only needed here — the service reads the baked file.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.demo_segments import (  # noqa: E402
    CORRIDORS,
    DEMO_SPACING_KM,
    segments_along_polyline,
)

OUT_PATH = ROOT / "backend" / "app" / "data" / "demo_corridors.json"
DEFAULT_OSRM = "https://router.project-osrm.org"


def osrm_geometry(base: str, waypoints: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Driving geometry through every waypoint, returned as (lat, lon) pairs."""
    path = ";".join(f"{lon},{lat}" for lat, lon in waypoints)
    url = f"{base.rstrip('/')}/route/v1/driving/{path}?overview=full&geometries=geojson&steps=false"
    with urllib.request.urlopen(url, timeout=60) as res:
        payload = json.load(res)
    routes = payload.get("routes") or []
    if not routes:
        raise RuntimeError(f"no route: {payload.get('code')}")
    coords = routes[0]["geometry"]["coordinates"]
    return [(lat, lon) for lon, lat in coords]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--spacing", type=float, default=DEMO_SPACING_KM,
                    help="km between representative midpoints")
    ap.add_argument("--osrm", default=DEFAULT_OSRM)
    ap.add_argument("--sleep", type=float, default=0.4,
                    help="pause between requests; the public demo server rate-limits")
    args = ap.parse_args()

    segments: dict[str, dict] = {}
    failed: list[str] = []

    for road, name, waypoints in CORRIDORS:
        try:
            geometry = osrm_geometry(args.osrm, waypoints)
            source = "osrm"
        except (urllib.error.URLError, RuntimeError, KeyError, TimeoutError) as exc:
            print(f"  {road:6s} OSRM failed ({exc}); using waypoint line", file=sys.stderr)
            geometry = waypoints
            source = "waypoints"
            failed.append(road)

        built = segments_along_polyline(road, name, geometry, args.spacing)
        for info in built.values():
            info["geo_method"] = (
                "demo_corridor_road_midpoint" if source == "osrm" else "demo_corridor_midpoint"
            )
        segments.update(built)
        print(f"  {road:6s} {len(built):3d} segments  ({source})  {name}")
        time.sleep(args.sleep)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(
            {
                "generated_by": "tools/build_demo_corridors.py",
                "spacing_km": args.spacing,
                "router": args.osrm,
                "corridors": len(CORRIDORS),
                "fallback_corridors": failed,
                "segments": segments,
            },
            f,
            ensure_ascii=False,
            indent=1,
        )

    print(f"\nwrote {len(segments)} segments -> {OUT_PATH.relative_to(ROOT)}")
    if failed:
        print(f"WARNING: straight-line fallback used for: {', '.join(failed)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
