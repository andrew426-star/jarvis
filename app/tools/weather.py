import httpx

from app.core.local_time import LOCAL_TZ

# The weather, the way JARVIS opens Stark's morning ("72 degrees with
# scattered clouds"). Open-Meteo needs no key. Ruston is the default; any
# other place is looked up by name with Open-Meteo's geocoder first.

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
HOME = {"name": "Ruston, Louisiana", "latitude": 32.5232, "longitude": -92.6379}
TIMEOUT_S = 10
MAX_DAYS = 7

# WMO weather codes, as Open-Meteo reports them.
_CONDITIONS = {
    0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "freezing fog",
    51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
    71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
    80: "light showers", 81: "showers", 82: "violent showers", 85: "snow showers", 86: "heavy snow showers",
    95: "thunderstorms", 96: "thunderstorms with hail", 99: "thunderstorms with heavy hail",
}

WEATHER_SCHEMA = {
    "type": "function",
    "function": {
        "name": "weather",
        "description": (
            "Live weather and forecast: now (temperature, feels-like, conditions, wind, humidity), "
            "today's high, low, rain chance, sunrise and sunset, the next 12 hours' rain chances, "
            "and the coming days. Andrew is in Ruston, Louisiana, the default; give `place` for "
            "anywhere else (a trip, a meeting in another city). Use it for the morning brief, "
            "whenever he asks about weather, rain, an umbrella or a jacket, and before advising on "
            "what to wear outdoors. Temperatures are Fahrenheit, wind mph."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "place": {"type": "string", "description": "City or place name. Omit for Ruston."},
                "days": {"type": "integer", "description": f"Days of forecast, 1-{MAX_DAYS}. Default 3."},
            },
        },
    },
}


def _condition(code) -> str:
    return _CONDITIONS.get(int(code), "unknown") if code is not None else "unknown"


def _locate(place: str) -> dict | None:
    response = httpx.get(GEOCODE_URL, params={"name": place, "count": 1, "language": "en"}, timeout=TIMEOUT_S)
    response.raise_for_status()
    results = response.json().get("results") or []
    if not results:
        return None
    hit = results[0]
    name = ", ".join(p for p in (hit.get("name"), hit.get("admin1"), hit.get("country")) if p)
    return {"name": name, "latitude": hit["latitude"], "longitude": hit["longitude"], "timezone": hit.get("timezone")}


def _clock(stamp: str | None) -> str | None:
    """'2026-10-14T07:12' -> '7:12 AM'."""
    if not stamp or "T" not in stamp:
        return stamp
    hour, minute = (int(x) for x in stamp.split("T")[1].split(":")[:2])
    return f"{(hour % 12) or 12}:{minute:02d} {'AM' if hour < 12 else 'PM'}"


def forecast(place: dict, days: int) -> dict:
    response = httpx.get(
        FORECAST_URL,
        params={
            "latitude": place["latitude"],
            "longitude": place["longitude"],
            "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,precipitation",
            "hourly": "temperature_2m,precipitation_probability,weather_code",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max",
            "temperature_unit": "fahrenheit",
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
            "timezone": place.get("timezone") or str(LOCAL_TZ),
            "forecast_days": days,
        },
        timeout=TIMEOUT_S,
    )
    response.raise_for_status()
    data = response.json()
    now, hourly, daily = data.get("current") or {}, data.get("hourly") or {}, data.get("daily") or {}

    # The hours from now on: Open-Meteo's hourly series starts at midnight.
    times = hourly.get("time") or []
    current_hour = (now.get("time") or "")[:13]
    start = next((i for i, t in enumerate(times) if t[:13] >= current_hour), 0) if current_hour else 0
    next_hours = [
        {
            "time": _clock(times[i]),
            "temp_f": round(hourly["temperature_2m"][i]),
            "rain_chance": hourly["precipitation_probability"][i],
            "conditions": _condition(hourly["weather_code"][i]),
        }
        for i in range(start, min(start + 12, len(times)))
    ]

    outlook = [
        {
            "date": day,
            "conditions": _condition(daily["weather_code"][i]),
            "high_f": round(daily["temperature_2m_max"][i]),
            "low_f": round(daily["temperature_2m_min"][i]),
            "rain_chance": daily["precipitation_probability_max"][i],
            "uv_index": daily["uv_index_max"][i],
            "sunrise": _clock(daily["sunrise"][i]),
            "sunset": _clock(daily["sunset"][i]),
        }
        for i, day in enumerate(daily.get("time") or [])
    ]

    return {
        "ok": True,
        "place": place["name"],
        "now": {
            "temp_f": round(now["temperature_2m"]) if now.get("temperature_2m") is not None else None,
            "feels_like_f": round(now["apparent_temperature"]) if now.get("apparent_temperature") is not None else None,
            "conditions": _condition(now.get("weather_code")),
            "humidity": now.get("relative_humidity_2m"),
            "wind_mph": now.get("wind_speed_10m"),
            "gusts_mph": now.get("wind_gusts_10m"),
            "precip_in": now.get("precipitation"),
        },
        "today": outlook[0] if outlook else None,
        "next_hours": next_hours,
        "days": outlook,
    }


def weather(args: dict) -> dict:
    try:
        days = max(1, min(int(args.get("days") or 3), MAX_DAYS))
    except (TypeError, ValueError):
        days = 3
    place_name = str(args.get("place") or "").strip()
    try:
        place = HOME
        if place_name and place_name.lower() not in ("ruston", "ruston, la", "ruston, louisiana", "home"):
            place = _locate(place_name)
            if place is None:
                return {"ok": False, "error": f"No place called '{place_name}' found."}
        return forecast(place, days)
    except Exception as exc:  # noqa: BLE001 — say why, rather than failing the turn
        return {"ok": False, "error": f"Weather unavailable: {exc}"}
