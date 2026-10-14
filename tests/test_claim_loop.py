from types import SimpleNamespace

from app.services import orchestrator

# The turn loop sends a reply that claims an action nothing performed back
# to the model once (app/services/claims.py), and keeps the honest answer.


def _chunk(text):
    part = SimpleNamespace(text=text, thought=False, function_call=None)
    return SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=[part]), finish_reason="STOP")])


def _quiet(monkeypatch):
    for name, value in {
        "get_recent_turns": lambda *a, **k: [],
        "fetch_recent_turns": lambda *a, **k: [],
        "get_relevant_context": lambda *a, **k: None,
        "write_interaction": lambda *a, **k: None,
        "record_interaction": lambda *a, **k: None,
        "append_turn": lambda *a, **k: None,
        "count_turns": lambda *a, **k: 0,
        "situation_note": lambda *a, **k: "It is the afternoon.",
        "browser_context_line": lambda *a, **k: None,
    }.items():
        monkeypatch.setattr(orchestrator, name, value)


def test_a_false_done_is_sent_back_and_the_honest_reply_kept(monkeypatch):
    _quiet(monkeypatch)
    replies = iter([
        "<spoken>Done, sir.</spoken>Done. Reminder set for 3 PM.",
        "<spoken>I haven't set it yet, sir.</spoken>I haven't set that reminder: shall I, for 3 PM today?",
    ])
    seen = []

    def fake_stream(contents, config, **kwargs):
        seen.append(list(contents))
        return iter([_chunk(next(replies))]), "fake-model"

    monkeypatch.setattr(orchestrator, "generate_stream", fake_stream)
    events = list(orchestrator.stream_invoke("remind me at 3 to call Dana", "s1", channel="browser"))
    done = next(e for e in events if e["type"] == "done")

    assert len(seen) == 2  # sent back once
    correction = seen[1][-1].parts[0].text
    assert "no tool that changes anything ran" in correction and "Done" in correction
    assert any(e["type"] == "retract" for e in events)
    assert done["response"].startswith("I haven't set that reminder")


def test_an_honest_reply_is_not_second_guessed(monkeypatch):
    _quiet(monkeypatch)
    calls = []

    def fake_stream(contents, config, **kwargs):
        calls.append(1)
        return iter([_chunk("<spoken>About 333 dollars, sir.</spoken>AAPL is at $332.83.")]), "fake-model"

    monkeypatch.setattr(orchestrator, "generate_stream", fake_stream)
    events = list(orchestrator.stream_invoke("what's apple at?", "s2", channel="browser"))
    assert len(calls) == 1
    assert next(e for e in events if e["type"] == "done")["response"] == "AAPL is at $332.83."
