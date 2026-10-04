from datetime import datetime, timedelta, timezone

from app.services import intel

NOW = datetime(2026, 10, 4, 20, 0, tzinfo=timezone.utc)
GROUPS = {"reuters.com": "wire", "wsj.com": "wire", "barrons.com": "markets", "hedgeweek.com": "funds"}


def item(title, domain, hours_ago, source=None):
    return {
        "title": title,
        "url": f"https://news.example/{abs(hash(title))}",
        "source": source or domain,
        "domain": domain,
        "published_at": NOW - timedelta(hours=hours_ago),
    }


PATTERN = intel.CATEGORIES["hedge-funds"][3]


def test_pick_keeps_category_headlines_and_drops_noise():
    chosen = intel.pick(
        [
            item("Hedge funds pile into yen shorts", "reuters.com", 1),
            item("Opinion | Hedge funds are overrated", "wsj.com", 1),
            item("Opinion: hedge funds are back", "barrons.com", 1),
            item("52-Week Highs & Lows | Market Data Center", "barrons.com", 1),
            item("STRC Stock Price | Series A Stock Quote", "barrons.com", 1),
            item("Apple unveils a new phone", "reuters.com", 1),
        ],
        PATTERN,
        GROUPS,
    )
    assert [c["title"] for c in chosen] == ["Hedge funds pile into yen shorts"]


def test_pick_caps_each_outlet_and_mixes_groups():
    items = [item(f"Hedge fund story {i}", "reuters.com", i) for i in range(8)]
    items.append(item("Multistrategy hedge funds slow hiring", "hedgeweek.com", 30))
    chosen = intel.pick(items, PATTERN, GROUPS)
    domains = [c["domain"] for c in chosen]
    assert domains.count("reuters.com") == intel.MAX_PER_SOURCE
    assert "hedgeweek.com" in domains  # the trade outlet is not crowded out
    assert chosen == sorted(chosen, key=lambda c: c["published_at"], reverse=True)


def test_pick_drops_repeats():
    chosen = intel.pick(
        [item("Hedge funds pile into yen shorts", "reuters.com", 1), item("Hedge Funds Pile Into Yen Shorts!", "wsj.com", 2)],
        PATTERN,
        GROUPS,
    )
    assert len(chosen) == 1


RSS = b"""<?xml version="1.0"?><rss><channel>
<item><title>Hedge funds pile into yen shorts - Reuters</title><link>https://news.google.com/a</link>
<pubDate>Sat, 04 Oct 2026 18:00:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item>
<item><title>Some blog post - Random Blog</title><link>https://news.google.com/b</link>
<pubDate>Sat, 04 Oct 2026 18:00:00 GMT</pubDate><source url="https://randomblog.example">Random Blog</source></item>
<item><title>Barron's take - bloomberg.com</title><link>https://news.google.com/c</link>
<pubDate>Sat, 04 Oct 2026 17:00:00 GMT</pubDate><source url="https://www.bloomberg.com">bloomberg.com</source></item>
</channel></rss>"""


def test_search_keeps_only_vetted_outlets_and_uses_their_names(monkeypatch):
    class Res:
        is_success = True
        status_code = 200
        content = RSS

    monkeypatch.setattr(intel.httpx, "get", lambda *a, **k: Res())
    found = intel.search("hedge fund", ["reuters.com", "bloomberg.com"], names={"bloomberg.com": "Bloomberg"})
    assert [(f["title"], f["source"]) for f in found] == [
        ("Hedge funds pile into yen shorts", "Reuters"),
        ("Barron's take", "Bloomberg"),
    ]


def test_refresh_never_empties_a_category(db, monkeypatch):
    db.tables["intel_sources"] = [{"domain": "reuters.com", "name": "Reuters", "grp": "wire", "enabled": True}]
    db.tables["intel_articles"] = [
        {"category": "hedge-funds", "title": "old", "url": "u", "source": "Reuters", "domain": "reuters.com", "fetched_at": "old"}
    ]
    monkeypatch.setattr(intel.time, "sleep", lambda s: None)
    monkeypatch.setattr(
        intel, "search", lambda terms, domains, **kw: [item("Hedge funds pile into yen shorts", "reuters.com", 1)]
    )
    intel.refresh_intel()
    titles = [a["title"] for a in db.tables["intel_articles"] if a["category"] == "hedge-funds"]
    assert titles == ["Hedge funds pile into yen shorts"]


BING = b"""<?xml version="1.0"?><rss xmlns:News="https://www.bing.com/news"><channel>
<item><title>Hedge-Fund Managers Lose Out on Tax Strategy</title>
<link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fwww.wsj.com%2fpolicy%2fhedge&amp;c=1</link>
<pubDate>Thu, 01 Oct 2026 07:00:00 GMT</pubDate><News:Source>The Wall Street Journal</News:Source></item>
<item><title>Off-list story</title>
<link>http://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fblog.example%2fx</link>
<pubDate>Thu, 01 Oct 2026 07:00:00 GMT</pubDate><News:Source>Blog</News:Source></item>
</channel></rss>"""


def test_bing_steps_in_when_google_fails(monkeypatch):
    class Res:
        def __init__(self, status, content):
            self.status_code, self.content, self.is_success = status, content, status == 200

    def fake_get(url, **kwargs):
        return Res(429, b"") if "google" in url else Res(200, BING)

    monkeypatch.setattr(intel.httpx, "get", fake_get)
    notes = []
    found = intel.search("hedge fund", ["wsj.com"], names={"wsj.com": "The Wall Street Journal"}, notes=notes)
    assert [(f["title"], f["url"], f["source"]) for f in found] == [
        ("Hedge-Fund Managers Lose Out on Tax Strategy", "https://www.wsj.com/policy/hedge", "The Wall Street Journal")
    ]
    assert notes == ["google HTTP 429 0, bing 200 1"]
