"""Deterministic headline/detail copy from risk + weather (no LLM)."""

from __future__ import annotations


def risk_copy(
    label: str,
    *,
    wind_speed: float,
    wind_gusts: float | None,
    snowfall: float,
    visibility: float,
    recommended_departure: str,
) -> tuple[str, str]:
    gust = wind_gusts if wind_gusts is not None else wind_speed

    if label == "low":
        return (
            "Road conditions are currently below the warning threshold.",
            "Live weather is within the model's lower risk band for the next 6 hours.",
        )

    if label == "moderate":
        return (
            "Conditions are deteriorating.",
            (
                f"Wind around {wind_speed:.0f} m/s, snowfall {snowfall:.1f} mm/h and "
                f"visibility near {visibility:.0f} m are lifting the KAIROS risk score."
            ),
        )

    # high
    signals: list[str] = []
    if gust >= 15:
        signals.append(f"wind gusts up to {gust:.0f} m/s")
    elif wind_speed >= 10:
        signals.append(f"wind around {wind_speed:.0f} m/s")
    if snowfall >= 0.3:
        signals.append(f"recent snowfall ({snowfall:.1f} mm/h)")
    if visibility <= 2000:
        signals.append(f"reduced visibility (~{visibility:.0f} m)")
    if not signals:
        signals.append("adverse winter weather signals")

    detail = (
        ", ".join(signals[:-1]) + (" and " if len(signals) > 1 else "") + signals[-1]
        if len(signals) > 1
        else signals[0]
    )
    detail = (
        detail[0].upper() + detail[1:]
        + " are raising the model risk of closure or restriction within the next 6 hours."
    )
    if recommended_departure:
        detail += f" Consider departing before {recommended_departure}."
    else:
        detail += " No safer earlier departure was found in today's available curve — postpone if possible."

    return ("High risk of closure or restriction.", detail)
