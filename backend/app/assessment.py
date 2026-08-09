"""Deterministic Copilot assessment card + quick prompts (no LLM)."""

from __future__ import annotations

from typing import Any


def primary_concerns(
    *,
    wind_speed: float,
    wind_gusts: float | None,
    snowfall: float,
    visibility: float,
    temperature: float,
    winter_hazard_active: bool,
) -> list[str]:
    concerns: list[str] = []
    gust = wind_gusts if wind_gusts is not None else wind_speed
    if gust >= 15 or wind_speed >= 12:
        concerns.append("Wind gusts")
    elif wind_speed >= 8:
        concerns.append("Elevated wind")
    if snowfall >= 0.3:
        concerns.append("Accumulating snow")
    elif snowfall >= 0.05:
        concerns.append("Light snowfall")
    if visibility <= 1000:
        concerns.append("Reduced visibility")
    elif visibility <= 3000:
        concerns.append("Limited visibility")
    if temperature <= -15:
        concerns.append("Severe cold")
    elif temperature <= -5 and winter_hazard_active:
        concerns.append("Freezing temperatures")
    if not concerns:
        if winter_hazard_active:
            concerns.append("Winter corridor conditions")
        else:
            concerns.append("No winter weather hazard")
    return concerns[:4]


def quick_prompts(risk_label: str, winter_hazard_active: bool, locale: str = "en") -> list[str]:
    if not winter_hazard_active:
        table = {
            "en": [
                "Summarize current conditions",
                "Why is actionable winter risk 0%?",
                "What is the raw model score?",
                "Show me the winter scenario",
            ],
            "ru": [
                "Кратко опиши текущие условия",
                "Почему действующий зимний риск 0%?",
                "Что такое сырой score модели?",
                "Покажи зимный сценарий",
            ],
            "kk": [
                "Қазіргі жағдайды қысқаша айт",
                "Неге әрекетті қысқы қауіп 0%?",
                "Шикі модель бағасы не?",
                "Қысқы сценарийді көрсет",
            ],
        }
        return table.get(locale, table["en"])

    if risk_label == "high":
        table = {
            "en": [
                "Should I postpone?",
                "Why is risk high?",
                "Safest departure today",
                "What should I prepare?",
                "Advice for a truck",
            ],
            "ru": [
                "Стоит ли отложить поездку?",
                "Почему риск высокий?",
                "Самое безопасное время выезда",
                "Что взять с собой?",
                "Совет для грузовика",
            ],
            "kk": [
                "Сапарды кейінге қалдыру керек пе?",
                "Неге қауіп жоғары?",
                "Ең қауіпсіз шығу уақыты",
                "Не дайындау керек?",
                "Жүк көлігіне кеңес",
            ],
        }
    elif risk_label == "moderate":
        table = {
            "en": [
                "What is changing?",
                "Compare safer times",
                "Should I leave earlier?",
                "Summarize weather",
            ],
            "ru": [
                "Что меняется?",
                "Сравни более безопасные времена",
                "Выехать раньше?",
                "Кратко о погоде",
            ],
            "kk": [
                "Не өзгеруде?",
                "Қауіпсіз уақыттарды салыстыр",
                "Ертерек шығу керек пе?",
                "Ауа райын қысқаша айт",
            ],
        }
    else:
        table = {
            "en": [
                "Why is this route safer now?",
                "Best departure today",
                "Summarize weather",
            ],
            "ru": [
                "Почему маршрут сейчас безопаснее?",
                "Лучшее время выезда сегодня",
                "Кратко о погоде",
            ],
            "kk": [
                "Неге маршрут қазір қауіпсіздеу?",
                "Бүгінгі ең жақсы шығу уақыты",
                "Ауа райын қысқаша айт",
            ],
        }
    return table.get(locale, table["en"])


def build_assessment(
    *,
    risk: float,
    risk_label: str,
    departure: str,
    recommended_departure: str,
    wind_speed: float,
    wind_gusts: float | None,
    snowfall: float,
    visibility: float,
    temperature: float,
    winter_hazard_active: bool,
    seasonal_reason: str,
    locale: str = "en",
) -> dict[str, Any]:
    concerns = primary_concerns(
        wind_speed=wind_speed,
        wind_gusts=wind_gusts,
        snowfall=snowfall,
        visibility=visibility,
        temperature=temperature,
        winter_hazard_active=winter_hazard_active,
    )
    prompts = quick_prompts(risk_label, winter_hazard_active, locale)

    if not winter_hazard_active:
        title = {
            "en": "Winter hazard inactive",
            "ru": "Зимняя угроза неактивна",
            "kk": "Қысқы қауіп белсенді емес",
        }.get(locale, "Winter hazard inactive")
        summary = {
            "en": seasonal_reason + " Live weather is connected; the scene stays calm on purpose.",
            "ru": seasonal_reason + " Живая погода подключена; спокойная сцена — это честность, не ошибка.",
            "kk": seasonal_reason + " Нақты ауа райы қосылған; тыныш көрініс — шынайылық.",
        }.get(locale, seasonal_reason)
        verdict = "live_calm"
        best = ""
    elif risk_label == "high":
        title = {
            "en": f"Not recommended at {departure}",
            "ru": f"Не рекомендуется в {departure}",
            "kk": f"{departure} кезінде ұсынылмайды",
        }.get(locale, f"Not recommended at {departure}")
        summary = {
            "en": "The KAIROS risk score is elevated under the current forecast.",
            "ru": "Оценка риска KAIROS повышена при текущем прогнозе.",
            "kk": "Ағымдағы болжамда KAIROS қауіп бағасы жоғары.",
        }.get(locale, "")
        verdict = "not_recommended"
        best = f"Before {recommended_departure}" if recommended_departure else ""
    elif risk_label == "moderate":
        title = {
            "en": f"Caution at {departure}",
            "ru": f"Осторожность в {departure}",
            "kk": f"{departure} кезінде абайлаңыз",
        }.get(locale, f"Caution at {departure}")
        summary = {
            "en": "Conditions are deteriorating. Consider an earlier departure window.",
            "ru": "Условия ухудшаются. Рассмотрите более ранний выезд.",
            "kk": "Жағдай нашарлауда. Ертерек шығуды қарастырыңыз.",
        }.get(locale, "")
        verdict = "caution"
        best = f"Before {recommended_departure}" if recommended_departure else ""
    else:
        title = {
            "en": f"Acceptable at {departure}",
            "ru": f"Допустимо в {departure}",
            "kk": f"{departure} кезінде қолайлы",
        }.get(locale, f"Acceptable at {departure}")
        summary = {
            "en": "KAIROS shows the corridor below the warning threshold for this departure.",
            "ru": "KAIROS показывает коридор ниже порога предупреждения для этого выезда.",
            "kk": "KAIROS осы шығу үшін дәлізді ескерту шегінен төмен көрсетеді.",
        }.get(locale, "")
        verdict = "acceptable"
        best = ""

    return {
        "verdict": verdict,
        "title": title,
        "summary": summary,
        "best_window": best,
        "primary_concerns": concerns,
        "quick_prompts": prompts,
        "risk": risk,
        "risk_label": risk_label,
    }
