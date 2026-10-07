from app.tools.parts_catalog import catalog, parts_catalog


def test_every_row_of_both_lists_loads():
    items = catalog()
    assert sum(i["source"] == "store" for i in items) == 196
    assert sum(i["source"] == "vending" for i in items) == 70


def test_search_spans_the_store_and_the_vending_machines():
    found = parts_catalog({"query": "servos"})["items"]
    assert {i["source"] for i in found} == {"store", "vending", "online"}
    assert any(i.get("location") == "Anne Droid, C8" for i in found)
    # Campus first: every online product comes after every campus item.
    sources = [i["source"] for i in found]
    assert sources.index("online") > max(k for k, s in enumerate(sources) if s != "online")


def test_online_products_carry_supplier_price_and_link():
    online = [i for i in catalog() if i["source"] == "online"]
    assert online and all(i["url"].startswith("https://") and i["supplier"] and i["price"] > 0 for i in online)
    assert parts_catalog({"query": "servo", "source": "online"})["count"] >= 2


def test_course_and_price_filters():
    assert all(i["price"] <= 6 for i in parts_catalog({"query": "hall effect", "max_price": 6})["items"])
    engr122 = parts_catalog({"course": "ENGR 122"})["items"]
    assert engr122 and all("122" in (i.get("course") or i["item"]) for i in engr122)
    assert parts_catalog({"query": "nema 17", "source": "vending"})["count"] == 0


def test_needs_something_to_look_for():
    assert not parts_catalog({})["ok"]
