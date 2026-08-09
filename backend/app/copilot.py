"""DeepSeek-backed KAIROS Road Copilot (explanation only)."""

from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Any

import httpx

from .config import (
    DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL,
    DEEPSEEK_MAX_TOKENS,
    DEEPSEEK_MODEL,
    DEEPSEEK_TIMEOUT,
)

log = logging.getLogger("kairos.copilot")

SYSTEM_PROMPT = """You are KAIROS Road Copilot — a road-risk decision assistant for Kazakhstan winter highways.

Role boundaries (strict):
- You explain and advise using ONLY the structured KAIROS context provided in the user message.
- You do NOT predict road closure yourself.
- You do NOT change, invent, or recalculate the LightGBM risk score.
- You do NOT invent weather, closures, police notices, incidents, hospitals, fuel stations, or alternate highways.
- You do NOT say a road WILL close unless an official closure status is explicitly supplied in context.
- The risk score is a model risk score, NOT a calibrated probability. Never call it a probability.
- Do not claim feature causality from LightGBM (no SHAP is provided). Prefer:
  "These weather conditions are associated with the current elevated model score."
- Prefer phrasing:
  "KAIROS shows elevated closure/restriction risk."
  "The current risk score is..."
  "Current forecast conditions indicate..."
  "The lower-risk departure window is..."
- If winter_hazard_active is false / applicability is inactive: the PRODUCT surfaces effective risk 0% (actionable winter risk inactive). A raw_model_risk may still exist for diagnostics — never call that raw score today's actionable winter hazard, and never invent a blizzard.
- If mode is winter_demo: this is an ILLUSTRATIVE demonstration scenario, not live weather. Say so explicitly. Do not claim demo snowfall is happening now.
- If asked for missing information, say KAIROS does not currently have it.
- Keep answers concise and actionable (typically 3–7 short sentences).
- Respond in the language requested by locale (en, ru, or kk).
- Profile (car/truck/family) changes practical advice only, never the risk score.
- When compare_points are supplied, use those exact numbers — do not invent curve values.
- You may emphasize key terms with **double asterisks** (e.g. **inactive**, **high**). Do not use other markdown.
"""

_CACHE: dict[str, tuple[float, str]] = {}
_CACHE_TTL = 120.0


def deepseek_configured() -> bool:
    return bool(DEEPSEEK_API_KEY and DEEPSEEK_MODEL)


def _cache_key(payload: dict[str, Any]) -> str:
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def build_user_payload(
    *,
    message: str,
    locale: str,
    profile: str,
    context: dict[str, Any],
    compare_points: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    return {
        "locale": locale,
        "profile": profile,
        "question": message,
        "kairos_context": context,
        "compare_points": compare_points or [],
        "instructions": (
            "Answer using kairos_context and compare_points only. "
            "Do not invent numbers. Do not alter risk."
        ),
    }


async def complete_copilot(user_payload: dict[str, Any]) -> str:
    if not deepseek_configured():
        raise RuntimeError("DeepSeek is not configured")

    key = _cache_key(user_payload)
    hit = _CACHE.get(key)
    now = time.time()
    if hit and (now - hit[0]) < _CACHE_TTL:
        return hit[1]

    url = DEEPSEEK_BASE_URL.rstrip("/") + "/chat/completions"
    body = {
        "model": DEEPSEEK_MODEL,
        "temperature": 0.3,
        "max_tokens": DEEPSEEK_MAX_TOKENS,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": json.dumps(user_payload, ensure_ascii=False),
            },
        ],
    }
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=DEEPSEEK_TIMEOUT) as client:
            resp = await client.post(url, headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()
    except httpx.TimeoutException as exc:
        raise TimeoutError("DeepSeek request timed out") from exc
    except httpx.HTTPError as exc:
        log.warning("deepseek http error: %s", exc)
        raise RuntimeError("DeepSeek request failed") from exc

    try:
        text = data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError, AttributeError) as exc:
        raise RuntimeError("DeepSeek response malformed") from exc

    if not text:
        raise RuntimeError("DeepSeek returned empty content")

    _CACHE[key] = (now, text)
    # Bound cache size.
    if len(_CACHE) > 64:
        oldest = sorted(_CACHE.items(), key=lambda kv: kv[1][0])[:16]
        for k, _ in oldest:
            _CACHE.pop(k, None)
    return text


def clear_cache() -> None:
    _CACHE.clear()
