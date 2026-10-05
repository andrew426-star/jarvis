import os
import re
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

# Compiles a workshop project's Arduino sketch to an Intel HEX image for
# the browser's emulated UNO (web/src/lib/workshop/sim). arduino-cli and the
# arduino:avr core are baked into the Docker image (see Dockerfile); where
# they are missing (a dev machine without them) compiling says so plainly
# instead of failing the save. ARDUINO_CLI overrides the binary's path.

FQBN = "arduino:avr:uno"
TIMEOUT_S = 90
MAX_CODE_CHARS = 60_000
MAX_ERROR_CHARS = 2500

# One compile at a time: avr-gcc is memory-hungry and the service is small.
_LOCK = threading.Lock()

# A quoted include of a path, not a library header, would put files from
# the server into the compiler's error output.
_PATH_INCLUDE = re.compile(r'#\s*include\s*[<"][^>"]*(\.\.|[/\\:])', re.IGNORECASE)

_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_PATH = re.compile(r"(?:[A-Za-z]:)?[^\s:'\"]*[\\/]([^\\/\s:'\"]+\.(?:ino|cpp|h|c))")


def _cli() -> str | None:
    return os.environ.get("ARDUINO_CLI") or shutil.which("arduino-cli")


def _clean_errors(text: str) -> str:
    """The compiler's complaints: each file:line message with the source
    line and caret under it, paths cut to file names, the toolchain's own
    chatter dropped."""
    text = _PATH.sub(r"\1", _ANSI.sub("", text))
    lines = text.splitlines()
    kept: list[str] = []
    for i, line in enumerate(lines):
        if re.search(r"\b(error|warning):", line):
            kept.append(line)
            kept.extend(l for l in lines[i + 1 : i + 3] if l.startswith(" "))
    return "\n".join(kept or [l for l in lines if l.strip()][-6:])[:MAX_ERROR_CHARS]


def compile_sketch(code: str) -> dict:
    """{ok, hex, flash_bytes, ram_bytes, warnings} or {ok: False, error} —
    or {ok: False, unavailable: True} where there is no compiler."""
    code = code or ""
    if not code.strip():
        return {"ok": False, "error": "The sketch is empty."}
    if len(code) > MAX_CODE_CHARS:
        return {"ok": False, "error": f"The sketch is over {MAX_CODE_CHARS} characters."}
    if _PATH_INCLUDE.search(code):
        return {"ok": False, "error": "#include may only name library headers, not file paths."}
    cli = _cli()
    if not cli:
        return {"ok": False, "unavailable": True, "error": "No Arduino compiler on this server (arduino-cli is not installed)."}

    with _LOCK, tempfile.TemporaryDirectory(prefix="jarvis-sketch-") as tmp:
        sketch_dir = os.path.join(tmp, "sketch")
        out_dir = os.path.join(tmp, "out")
        os.makedirs(sketch_dir)
        Path(sketch_dir, "sketch.ino").write_text(code, encoding="utf-8")
        try:
            run = subprocess.run(
                [cli, "compile", "--no-color", "--fqbn", FQBN, "--output-dir", out_dir, "--warnings", "default", sketch_dir],
                capture_output=True,
                text=True,
                timeout=TIMEOUT_S,
            )
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": f"Compiling took over {TIMEOUT_S}s and was stopped."}
        output = (run.stdout or "") + "\n" + (run.stderr or "")
        if run.returncode != 0:
            return {"ok": False, "error": _clean_errors(output) or "The compiler failed with no message."}
        hex_path = Path(out_dir, "sketch.ino.hex")
        if not hex_path.exists():
            return {"ok": False, "error": "The compiler reported success but wrote no HEX file."}
        flash = re.search(r"Sketch uses (\d+) bytes", output)
        ram = re.search(r"Global variables use (\d+) bytes", output)
        warnings = [line for line in _clean_errors(run.stderr or "").splitlines() if "warning:" in line]
        return {
            "ok": True,
            "hex": hex_path.read_text(encoding="ascii"),
            "flash_bytes": int(flash.group(1)) if flash else None,
            "ram_bytes": int(ram.group(1)) if ram else None,
            "warnings": warnings[:10],
        }
