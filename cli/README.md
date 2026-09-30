# jarvis CLI

Ask Jarvis from any terminal, including VS Code's integrated terminal.
Standard library only.

## Install

```
pip install --user -e cli
jarvis config --token <JARVIS_ACCESS_TOKEN>
```

The token is the same `JARVIS_ACCESS_TOKEN` set on the Render service. It's
saved to `~/.jarvis/config.json`; `JARVIS_ACCESS_TOKEN` / `JARVIS_URL` in the
environment override it.

## Use

```
jarvis why is my recursion blowing the stack
jarvis -f sort.py -f test_sort.py "why does the second test fail"
python main.py 2>&1 | jarvis "what does this traceback mean"
jarvis run javac Main.java        # shows output live; Jarvis explains a failure
jarvis run --always pytest        # ask even when it passes
jarvis --new "fresh topic"        # new conversation (otherwise one per day)
```

Replies use the terminal channel: code blocks and short prose instead of the
console's spoken style. For what looks like coursework, Jarvis teaches first
(explains, points to the line, hints) and writes a full solution only when
asked outright.
