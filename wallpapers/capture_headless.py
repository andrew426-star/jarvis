"""Captures a wallpaper's frames in headless Chrome, without a visible
browser (which throttles pages it is not showing).

    python wallpapers/capture_headless.py gx newtab/newtab.html
    python wallpapers/capture_headless.py lock lock/index.html --png

Needs `python wallpapers/render.py serve` running, and Playwright
(pip install playwright) with Chrome or `playwright install chromium`.
Frames land in out/frames/<name>/, as render.py's encoders expect; those
already there are skipped, so an interrupted run picks up where it stopped.
"""

import argparse
import base64
import concurrent.futures
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
FPS = 30


def launch(p):
    try:
        return p.chromium.launch(channel="chrome", headless=True)
    except Exception:  # noqa: BLE001 — no system Chrome: Playwright's own
        return p.chromium.launch(headless=True)


def work(url: str, indices: list[int], folder: Path, png: bool) -> int:
    kind, ext = ("image/png", "png") if png else ("image/jpeg", "jpg")
    with sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.goto(url)
        page.wait_for_function("window.WALL !== undefined", timeout=30000)
        for i in indices:
            data = page.evaluate(
                """([t, kind]) => { WALL.frame(t); return document.querySelector("canvas").toDataURL(kind, 0.95) }""",
                [i / FPS, kind],
            )
            (folder / f"{i:04d}.{ext}").write_bytes(base64.b64decode(data.split(",", 1)[1]))
        browser.close()
    return len(indices)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("name")
    parser.add_argument("page", help="path under wallpapers/, e.g. newtab/newtab.html")
    parser.add_argument("--png", action="store_true")
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()

    folder = HERE / "out" / "frames" / args.name
    folder.mkdir(parents=True, exist_ok=True)
    url = f"http://localhost:8777/{args.page}?capture"
    with sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page()
        page.goto(url)
        page.wait_for_function("window.WALL !== undefined", timeout=30000)
        total = round(page.evaluate("WALL.period") * FPS)
        browser.close()
    ext = "png" if args.png else "jpg"
    todo = [i for i in range(total) if not (folder / f"{i:04d}.{ext}").exists()]
    print(f"{args.name}: {total} frames, {len(todo)} to render")
    chunks = [todo[k :: args.workers] for k in range(args.workers)]
    with concurrent.futures.ThreadPoolExecutor(args.workers) as pool:
        done = sum(pool.map(lambda c: work(url, c, folder, args.png), chunks))
    print(f"rendered {done}")


if __name__ == "__main__":
    main()
