"""In-memory last-prediction store for Copilot grounding."""

from __future__ import annotations

from typing import Any

_LAST: dict[str, dict[str, Any]] = {}


def put_prediction(segment_id: str, payload: dict[str, Any]) -> None:
    _LAST[segment_id] = payload


def get_prediction(segment_id: str) -> dict[str, Any] | None:
    return _LAST.get(segment_id)


def clear() -> None:
    _LAST.clear()
