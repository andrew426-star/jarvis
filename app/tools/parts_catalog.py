import re
from functools import cache
from pathlib import Path

# The electronics and hardware Andrew can buy on campus at Louisiana Tech:
# the engineering store's 2024-25 price list and the two vending machines.
# Transcribed from the store's public QR-code PDF into app/data/*.psv
# (pipe-separated, # comments); edit those files when the list changes.
# Campus first: online_parts.psv holds the products bought online (Adafruit,
# SparkFun, Waveshare...) with their price and link, for the jobs campus
# stocks nothing for; they come after the campus items in every listing.
DATA = Path(__file__).resolve().parent.parent / "data"
TAX_FACTOR = 1.13  # the store's own estimate: 11% tax + 2% card fees
MAX_RESULTS = 40

PARTS_CATALOG_SCHEMA = {
    "type": "function",
    "function": {
        "name": "parts_catalog",
        "description": (
            "The electronics, hardware and tools Andrew can buy on campus at Louisiana Tech: the "
            "engineering store's 2024-25 price list (Arduino UNO, A-Star, ESP32, sensors, motors, "
            "servos, drivers, relays, switches, breadboards, 2020/2040 extrusion, lead screws, "
            "bearings, power supplies, filament, course kits...) and the two vending machines, "
            "Anne Droid (right) and Buttons (left), with slot locations - and after them the products "
            "bought online where campus has nothing for the job (ESP32-S3 Feather, LiPo cells, USB-C "
            "charger, 5V boost, fuel gauge, mic and audio amps, speaker, 5V fan, pulse sensor, NeoPixels, "
            "PIR, positional MG90S/MG996R servos, 5V 4A supply), each with its supplier, price and link. "
            "Campus first: use an online product only when no campus item does the job. search finds "
            "parts by words in the name, part number, supplier or course; course lists one class's "
            "parts; max_price filters. Campus prices are pre-tax (about 1.13x at the till); online "
            "prices are before shipping and sales tax."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Words to match, e.g. 'servo', 'hall effect', 'nema 17', '12V supply'. "
                    "Omit with a course to list that course's parts.",
                },
                "course": {"type": "string", "description": "e.g. 'ENGR 120', 'MEEN 382'."},
                "source": {"type": "string", "enum": ["all", "store", "vending", "online"], "description": "Default all (campus first, then online)."},
                "max_price": {"type": "number", "description": "Only items at or under this price (USD)."},
            },
            "required": [],
        },
    },
}


def _rows(name: str) -> list[list[str]]:
    lines = (DATA / name).read_text(encoding="utf-8").splitlines()
    return [line.split("|") for line in lines if line.strip() and not line.startswith("#")]


@cache
def catalog() -> list[dict]:
    items = [
        {
            "source": "store",
            "item": item,
            "course": course,
            "supplier": supplier,
            "part_number": part,
            "packaging": packaging,
            "price": float(price),
        }
        for course, item, supplier, part, packaging, price in _rows("latech_store.psv")
    ]
    items += [
        {"source": "vending", "item": item, "location": location, "quantity": int(qty), "price": float(price)}
        for location, item, qty, price in _rows("latech_vending.psv")
    ]
    items += [
        {"source": "online", "item": item, "supplier": supplier, "part_number": part, "packaging": packaging, "price": float(price), "url": url}
        for supplier, item, part, packaging, price, url in _rows("online_parts.psv")
    ]
    return items


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9.]+", text.lower())


def _haystack(item: dict) -> str:
    return " ".join(str(v) for k, v in item.items() if k != "price").lower()


def parts_catalog(args: dict) -> dict:
    query = _words(args.get("query") or "")
    course = " ".join(_words(args.get("course") or ""))
    source = args.get("source") or "all"
    max_price = args.get("max_price")
    if not query and not course:
        return {"ok": False, "error": "Give a query or a course."}

    matches = []
    for item in catalog():
        if source != "all" and item["source"] != source:
            continue
        if max_price is not None and item["price"] > float(max_price):
            continue
        hay = _haystack(item)
        # Plurals in the query still match: "servos" finds "Servo".
        if any(w not in hay and w.rstrip("s") not in hay for w in query):
            continue
        if course and course not in " ".join(_words(item.get("course") or item["item"])):
            continue
        matches.append(item)

    return {
        "ok": True,
        "count": len(matches),
        "items": matches[:MAX_RESULTS],
        "truncated": len(matches) > MAX_RESULTS,
        "note": f"Campus prices are pre-tax; budget about {TAX_FACTOR}x. Online items (source online) are "
        "before shipping and tax; use one only where campus has nothing for the job. Vending machines place a temporary "
        "$25 card hold. Prototyping Lab services (3D printing, laser cutting) are quoted per project "
        "by Lab staff.",
    }
