"""Load LightGBM once and score feature rows."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import lightgbm as lgb
import numpy as np
import pandas as pd

from .config import MODEL_DIR, SEGMENT_LABELS

log = logging.getLogger("kairos.model")


@dataclass(frozen=True)
class Segment:
    segment_id: str
    latitude: float
    longitude: float
    timezone: str
    km_lo: float
    km_hi: float
    km_length: float
    label: str


@dataclass
class ModelRuntime:
    booster: lgb.Booster
    features: list[str]
    meta: dict[str, Any]
    segments: dict[str, Segment]
    medium_threshold: float
    high_threshold: float

    @property
    def feature_count(self) -> int:
        return len(self.features)

    @property
    def segment_count(self) -> int:
        return len(self.segments)

    def risk_label(self, score: float) -> str:
        if score >= self.high_threshold:
            return "high"
        if score >= self.medium_threshold:
            return "moderate"
        return "low"

    def predict_score(self, feature_row: dict[str, Any]) -> float:
        missing = [f for f in self.features if f not in feature_row]
        if missing:
            raise KeyError(f"missing required features: {missing}")
        frame = pd.DataFrame([feature_row]).reindex(columns=self.features)
        if list(frame.columns) != self.features:
            raise RuntimeError("feature column order mismatch")
        if len(self.features) != 44:
            raise RuntimeError(f"expected 44 features, got {len(self.features)}")
        score = float(self.booster.predict(frame)[0])
        if not np.isfinite(score):
            raise RuntimeError("model returned non-finite score")
        return float(min(1.0, max(0.0, score)))


_RUNTIME: ModelRuntime | None = None


def get_runtime() -> ModelRuntime:
    if _RUNTIME is None:
        raise RuntimeError("model runtime not loaded")
    return _RUNTIME


def load_runtime(model_dir: Path | None = None) -> ModelRuntime:
    global _RUNTIME
    root = Path(model_dir or MODEL_DIR)

    feature_path = root / "feature_order.json"
    meta_path = root / "model_metadata.json"
    segments_path = root / "segments.json"
    model_path = root / "boran_lgbm.txt"

    for p in (feature_path, meta_path, segments_path, model_path):
        if not p.is_file():
            raise FileNotFoundError(f"missing model artifact: {p}")

    with feature_path.open(encoding="utf-8") as f:
        features = json.load(f)
    if not isinstance(features, list):
        raise ValueError("feature_order.json must be a JSON array")
    if len(features) != 44:
        raise ValueError(f"feature_order length must be 44, got {len(features)}")

    with meta_path.open(encoding="utf-8") as f:
        meta = json.load(f)
    meta_count = int(meta.get("feature_count", -1))
    if meta_count != len(features):
        raise ValueError(
            f"metadata feature_count ({meta_count}) != len(feature_order) ({len(features)})"
        )

    with segments_path.open(encoding="utf-8") as f:
        raw_segments = json.load(f)

    selected = set(meta.get("selected_segments") or [])
    segments: dict[str, Segment] = {}
    for sid, info in raw_segments.items():
        if selected and sid not in selected:
            continue
        label = SEGMENT_LABELS.get(sid, sid)
        segments[sid] = Segment(
            segment_id=sid,
            latitude=float(info["latitude"]),
            longitude=float(info["longitude"]),
            timezone=str(info["timezone"]),
            km_lo=float(info["km_lo"]),
            km_hi=float(info["km_hi"]),
            km_length=float(info["km_length"]),
            label=label,
        )

    if len(segments) != 7:
        raise ValueError(f"expected 7 trained segments, got {len(segments)}")

    booster = lgb.Booster(model_file=str(model_path))
    medium = float(meta["medium_risk_threshold"])
    high = float(meta["high_risk_threshold"])

    runtime = ModelRuntime(
        booster=booster,
        features=features,
        meta=meta,
        segments=segments,
        medium_threshold=medium,
        high_threshold=high,
    )
    _RUNTIME = runtime

    log.info(
        "model loaded type=%s features=%d segments=%d target=%r medium=%.6f high=%.6f",
        meta.get("model_type"),
        runtime.feature_count,
        runtime.segment_count,
        meta.get("target"),
        medium,
        high,
    )
    return runtime
