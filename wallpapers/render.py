"""Renders the wallpapers to video and stills.

    python wallpapers/render.py serve        # then drive capture.js in a browser
    python wallpapers/render.py encode lock  # frames -> out/lock.mp4 (+ a still)
    python wallpapers/render.py bundle       # self-contained out/*.html
    python wallpapers/render.py gxmod        # frames of newtab -> the Opera GX mod's video

`serve` serves this folder on http://localhost:8777 and accepts frames at
POST /frame/<name>/<n> (PNG), written to out/frames/<name>/. Each
wallpaper's page, opened with ?capture, draws exact frames at its full
size (window.WALL.frame(t)); capture.js steps through one period and posts
them. `encode` makes an H.264 MP4 that loops seamlessly, because every
motion in the designs repeats within the period. `bundle` inlines the
shared script and the font, for wallpaper apps that take a single HTML
file (Lively Wallpaper on Windows, web wallpapers on Android).

ffmpeg comes from the imageio-ffmpeg package (pip install imageio-ffmpeg).
"""

import base64
import http.server
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
FPS = 30
NAMES = ("lock", "home", "command")
# Frames the server accepts: the three wallpapers, and the blueprint
# (newtab/newtab.html?capture) for the Opera GX mod.
CAPTURES = (*NAMES, "gx")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def do_POST(self):
        match = re.fullmatch(r"/frame/(\w+)/(\d+)", self.path)
        if not match or match.group(1) not in CAPTURES:
            self.send_error(404)
            return
        folder = OUT / "frames" / match.group(1)
        folder.mkdir(parents=True, exist_ok=True)
        length = int(self.headers.get("Content-Length", 0))
        # PNG by default; JPEG when the page sends it (the long GX loop).
        ext = "jpg" if self.headers.get("Content-Type") == "image/jpeg" else "png"
        (folder / f"{int(match.group(2)):04d}.{ext}").write_bytes(self.rfile.read(length))
        self.send_response(204)
        self.end_headers()

    def end_headers(self):
        # Edits to the designs show on the next load, not after a cache expires.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


def serve() -> None:
    print("Serving wallpapers on http://localhost:8777")
    http.server.ThreadingHTTPServer(("127.0.0.1", 8777), Handler).serve_forever()


def encode(name: str) -> None:
    import imageio_ffmpeg

    frames = OUT / "frames" / name
    count = len(list(frames.glob("*.png")))
    if not count:
        sys.exit(f"No frames for {name}; capture them first.")
    video = OUT / f"{name}.mp4"
    subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
            "-framerate", str(FPS), "-i", str(frames / "%04d.png"),
            "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", str(video),
        ],
        check=True,
    )
    shutil.copyfile(frames / "0000.png", OUT / f"{name}.png")
    print(f"{video.name}: {count} frames, {video.stat().st_size / 1e6:.1f} MB; still {name}.png")


def gxmod() -> None:
    """The blueprint loop as the GX mod's wallpaper: VP9 WebM without audio
    (what Opera plays most reliably) and the first frame as a JPEG, which
    Opera needs before it will play the video."""
    import imageio_ffmpeg
    from PIL import Image

    frames = OUT / "frames" / "gx"
    ext = "jpg" if any(frames.glob("*.jpg")) else "png"
    count = len(list(frames.glob(f"*.{ext}")))
    if not count:
        sys.exit("No frames for gx; capture newtab/newtab.html?capture first.")
    target = HERE / "gxmod" / "wallpaper"
    target.mkdir(parents=True, exist_ok=True)
    video = target / "blueprint.webm"
    subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
            "-framerate", str(FPS), "-i", str(frames / f"%04d.{ext}"),
            "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4",
            "-pix_fmt", "yuv420p", "-an", str(video),
        ],
        check=True,
    )
    Image.open(frames / f"0000.{ext}").convert("RGB").save(target / "blueprint.jpg", quality=90)
    print(f"{video.name}: {count} frames, {video.stat().st_size / 1e6:.1f} MB; first frame blueprint.jpg")


def bundle() -> None:
    shared = (HERE / "shared" / "hud.js").read_text(encoding="utf-8")
    shared = shared.replace("export const ", "const ").replace("export function ", "function ").replace(
        "export async function ", "async function "
    )
    font = base64.b64encode((HERE / "shared" / "jetbrains-mono-400.woff").read_bytes()).decode()
    OUT.mkdir(exist_ok=True)
    for name in NAMES:
        page = (HERE / name / "index.html").read_text(encoding="utf-8")
        page = page.replace('url("../shared/jetbrains-mono-400.woff")', f'url("data:font/woff;base64,{font}")')
        page = re.sub(r'import \{[^}]*\} from "\.\./shared/hud\.js"\n', shared + "\n", page)
        (OUT / f"{name}.html").write_text(page, encoding="utf-8")
        print(f"out/{name}.html")


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "serve":
        serve()
    elif command == "encode" and len(sys.argv) == 3:
        encode(sys.argv[2])
    elif command == "bundle":
        bundle()
    elif command == "gxmod":
        gxmod()
    else:
        sys.exit(__doc__)
