"""jarvis (installed as the `jarvis` command; see cli/README.md): ask Jarvis from any terminal, including VS Code's.

    jarvis why is my recursion blowing the stack
    jarvis -f sort.py -f test_sort.py "why does the second test fail"
    python main.py 2>&1 | jarvis "what does this traceback mean"
    jarvis run javac Main.java          # runs it; explains the error if it fails
    jarvis --new ...                    # start a fresh conversation
    jarvis config --token <JARVIS_ACCESS_TOKEN> [--url https://...]

Talks to the same /invoke endpoint as the web console, with channel
"terminal" so replies come back as on-screen text with code blocks rather
than prose written to be spoken. Follow-up questions continue one
conversation per day; --new starts over. Standard library only, so it runs
anywhere Python does.
"""

import argparse
import json
import os
import subprocess
import sys
import threading
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

DEFAULT_URL = "https://jarvis-u49p.onrender.com"
HOME = Path(os.environ.get("JARVIS_HOME", Path.home() / ".jarvis"))
CONFIG = HOME / "config.json"
SESSION = HOME / "session.json"

MAX_FILE_CHARS = 60_000
MAX_OUTPUT_CHARS = 20_000
REQUEST_TIMEOUT = 180  # the free Render instance can take ~50s to wake

LANGS = {
    ".py": "python", ".java": "java", ".c": "c", ".h": "c", ".cpp": "cpp", ".cc": "cpp",
    ".hpp": "cpp", ".js": "javascript", ".ts": "typescript", ".tsx": "tsx", ".jsx": "jsx",
    ".cs": "csharp", ".go": "go", ".rs": "rust", ".rb": "ruby", ".php": "php", ".sql": "sql",
    ".sh": "bash", ".ps1": "powershell", ".html": "html", ".css": "css", ".json": "json",
    ".md": "markdown", ".kt": "kotlin", ".swift": "swift", ".r": "r", ".m": "matlab",
}


def _utf8_stdio() -> None:
    # Windows consoles default to a legacy code page; replies contain code
    # and punctuation that code page can't print.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def load_config() -> dict:
    config = {}
    if CONFIG.exists():
        try:
            config = json.loads(CONFIG.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
    return {
        "url": os.environ.get("JARVIS_URL") or config.get("url") or DEFAULT_URL,
        "token": os.environ.get("JARVIS_ACCESS_TOKEN") or config.get("token"),
    }


def central_today() -> str:
    # One conversation per Central calendar day. No zoneinfo dependency:
    # Central is UTC-5 (CDT, second Sunday of March to first Sunday of
    # November) or UTC-6.
    now = datetime.now(timezone.utc)
    year = now.year
    march = datetime(year, 3, 8, 8, tzinfo=timezone.utc)
    dst_start = march + timedelta(days=(6 - march.weekday()) % 7)
    november = datetime(year, 11, 1, 7, tzinfo=timezone.utc)
    dst_end = november + timedelta(days=(6 - november.weekday()) % 7)
    offset = 5 if dst_start <= now < dst_end else 6
    return (now - timedelta(hours=offset)).date().isoformat()


def session_id(new: bool) -> str:
    today = central_today()
    if not new and SESSION.exists():
        try:
            saved = json.loads(SESSION.read_text(encoding="utf-8"))
            if saved.get("date") == today and saved.get("id"):
                return saved["id"]
        except (OSError, json.JSONDecodeError):
            pass
    sid = f"cli-{uuid.uuid4()}"
    HOME.mkdir(parents=True, exist_ok=True)
    SESSION.write_text(json.dumps({"id": sid, "date": today}), encoding="utf-8")
    return sid


def attach_file(path: str) -> str:
    p = Path(path)
    try:
        text = p.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        sys.exit(f"jarvis: can't read {path}: {exc}")
    truncated = len(text) > MAX_FILE_CHARS
    text = text[:MAX_FILE_CHARS]
    # Line numbers so Jarvis can point at file:line.
    numbered = "\n".join(f"{i:>5}| {line}" for i, line in enumerate(text.splitlines(), 1))
    lang = LANGS.get(p.suffix.lower(), "")
    note = " (truncated)" if truncated else ""
    return f"BEGIN FILE {p.as_posix()}{note}\n```{lang}\n{numbered}\n```\nEND FILE {p.as_posix()}"


def attach_output(label: str, text: str) -> str:
    if len(text) > MAX_OUTPUT_CHARS:
        text = "...(earlier output cut)...\n" + text[-MAX_OUTPUT_CHARS:]
    return f"BEGIN {label}\n```\n{text.rstrip()}\n```\nEND {label}"


def ask(message: str, new_session: bool = False) -> int:
    config = load_config()
    if not config["token"]:
        print(
            "jarvis: no access token. Run:  jarvis config --token <JARVIS_ACCESS_TOKEN>",
            file=sys.stderr,
        )
        return 2

    body = json.dumps(
        {"message": message, "session_id": session_id(new_session), "channel": "terminal"}
    ).encode("utf-8")
    request = urllib.request.Request(
        config["url"].rstrip("/") + "/invoke",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {config['token']}"},
        method="POST",
    )

    waking = threading.Timer(6.0, lambda: print("(waking Jarvis up, this can take a minute...)", file=sys.stderr))
    waking.start()
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        if exc.code == 401:
            print("jarvis: token rejected. Run:  jarvis config --token <JARVIS_ACCESS_TOKEN>", file=sys.stderr)
        else:
            print(f"jarvis: server error {exc.code}: {detail}", file=sys.stderr)
        return 1
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"jarvis: couldn't reach {config['url']}: {exc}", file=sys.stderr)
        return 1
    finally:
        waking.cancel()

    print(data.get("response", "").strip())
    tools = data.get("tools_used") or []
    if tools:
        print(f"\n[{', '.join(dict.fromkeys(tools))}]", file=sys.stderr)
    return 0


def cmd_config(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="jarvis config", description="Save the Jarvis URL and access token.")
    parser.add_argument("--token", help="JARVIS_ACCESS_TOKEN (same value as on Render)")
    parser.add_argument("--url", help=f"Jarvis base URL (default {DEFAULT_URL})")
    args = parser.parse_args(argv)
    HOME.mkdir(parents=True, exist_ok=True)
    current = {}
    if CONFIG.exists():
        try:
            current = json.loads(CONFIG.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
    if args.token:
        current["token"] = args.token
    if args.url:
        current["url"] = args.url
    CONFIG.write_text(json.dumps(current, indent=2), encoding="utf-8")
    shown = {k: (v[:4] + "..." if k == "token" and v else v) for k, v in current.items()}
    print(f"saved {CONFIG}: {shown}")
    return 0


def cmd_run(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="jarvis run",
        description="Run a command, show its output live, and have Jarvis explain it if it fails.",
    )
    parser.add_argument("-f", "--file", action="append", default=[], help="also share this file")
    parser.add_argument("--always", action="store_true", help="ask Jarvis even if the command succeeds")
    parser.add_argument("--new", action="store_true", help="start a fresh conversation")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("give a command to run, e.g. jarvis run python main.py")

    # Through the shell, so it behaves exactly as if typed: PATH lookup,
    # .cmd/.bat wrappers on Windows, and quoting as the user wrote it.
    line = subprocess.list2cmdline(command) if os.name == "nt" else " ".join(
        subprocess.list2cmdline([c]) if " " in c else c for c in command
    )
    proc = subprocess.Popen(
        line, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace",
    )
    captured = []
    assert proc.stdout is not None
    for chunk in proc.stdout:
        sys.stdout.write(chunk)
        captured.append(chunk)
    code = proc.wait()

    if code == 0 and not args.always:
        return 0

    sys.stdout.flush()  # the program's output first, then Jarvis
    status = f"exited with code {code}" if code else "succeeded"
    parts = [
        f"I ran `{line}` in {Path.cwd().as_posix()} and it {status}. "
        + ("What went wrong, and where should I look?" if code else "Anything I should notice?"),
        attach_output("OUTPUT", "".join(captured)),
    ]
    parts += [attach_file(f) for f in args.file]
    print("\n--- Jarvis ---", file=sys.stderr)
    ask("\n\n".join(parts), new_session=args.new)
    return code


def cmd_ask(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="jarvis",
        description="Ask Jarvis from the terminal. Subcommands: run, config.",
        epilog="Pipe output in: python main.py 2>&1 | jarvis \"what does this mean\"",
    )
    parser.add_argument("-f", "--file", action="append", default=[], help="share a file (repeatable)")
    parser.add_argument("--new", action="store_true", help="start a fresh conversation")
    parser.add_argument("question", nargs="*")
    args = parser.parse_args(argv)

    question = " ".join(args.question).strip()
    piped = "" if sys.stdin.isatty() else sys.stdin.read()
    if not question and not piped and not args.file:
        parser.print_help()
        return 2
    if not question:
        question = "Explain what's going on here and what I should fix."

    parts = [question]
    if piped.strip():
        parts.append(attach_output("OUTPUT", piped))
    parts += [attach_file(f) for f in args.file]
    return ask("\n\n".join(parts), new_session=args.new)


def main() -> int:
    _utf8_stdio()
    argv = sys.argv[1:]
    if argv[:1] == ["run"]:
        return cmd_run(argv[1:])
    if argv[:1] == ["config"]:
        return cmd_config(argv[1:])
    return cmd_ask(argv)


if __name__ == "__main__":
    sys.exit(main())
