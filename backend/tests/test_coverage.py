"""Route coverage matching — never invents ML risk."""

from app.coverage import analyze_route_coverage, haversine_km, route_length_km
from app.model_runtime import Segment, load_runtime


def test_route_length_positive():
    # Rough Almaty → Shymkent corridor
    coords = [
        [76.8512, 43.2220],
        [71.4704, 42.3417],
        [69.5901, 42.3417],
    ]
    assert route_length_km(coords) > 100


def test_zero_coverage_far_from_midpoints():
    rt = load_runtime()
    # Point in the Caspian / far west — should not hit midpoints under buffers
    coords = [[50.0, 45.0], [51.0, 45.5], [52.0, 46.0]]
    cov = analyze_route_coverage(coords, rt.segments, total_km=200)
    assert cov["percent"] == 0.0
    assert cov["matches"] == []
    assert 0.0 <= cov["percent"] <= 100.0


def test_almaty_shymkent_hits_trained_corridor():
    rt = load_runtime()
    # Pass near ALMATY_TASHKENT midpoints
    coords = [
        [76.85, 43.22],  # Almaty
        [74.63, 43.36],  # near KM_159_238 midpoint
        [74.70, 43.05],  # near Korday midpoint
        [70.77, 42.62],  # Momyshuly
        [69.59, 42.30],  # Shymkent-ish
    ]
    cov = analyze_route_coverage(coords, rt.segments)
    assert cov["percent"] > 0
    assert cov["percent"] <= 100
    assert len(cov["matches"]) >= 1
    ids = {m["segment_id"] for m in cov["matches"]}
    assert any(i.startswith("ALMATY_TASHKENT") for i in ids)
    for m in cov["matches"]:
        assert m["coverage_type"] == "trained_approximate"
        assert "risk" not in m  # coverage layer must not invent scores


def test_haversine_symmetry():
    a = haversine_km(43.2, 76.8, 42.3, 69.6)
    b = haversine_km(42.3, 69.6, 43.2, 76.8)
    assert abs(a - b) < 1e-6


def test_multiple_matches_bounded():
    rt = load_runtime()
    # Degenerate route sitting on one midpoint
    seg = next(iter(rt.segments.values()))
    assert isinstance(seg, Segment)
    coords = [
        [seg.longitude, seg.latitude],
        [seg.longitude + 0.05, seg.latitude + 0.05],
    ]
    cov = analyze_route_coverage(coords, rt.segments, total_km=50)
    assert 0 <= cov["percent"] <= 100
    assert cov["covered_km"] <= cov["total_km"] + 1e-6
