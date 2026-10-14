from app.services.claims import acted, claimed_action, unbacked_claim

# Jarvis must not claim an action no tool performed (app/services/claims.py).


def test_claims_are_recognised():
    for reply in [
        "Done, sir. The reminder is in.",
        "I've sent the email to Dr. Lee.",
        "I have scheduled the call for Thursday at three.",
        "Right. Reminder set for 3 PM.",
        "I just opened Moodle in a new tab.",
        "Sent. Two attachments, eleven pages.",
        "Hold on for an hour, sir.",
    ]:
        assert claimed_action(reply), reply


def test_plain_answers_and_honest_refusals_are_not_claims():
    for reply in [
        "AAPL is at $332.83, sir, up 1.2% on the day.",
        "I can't send email from the bubble; the console can.",
        "I have not sent it yet. Shall I?",
        "Your next class is at 1:45.",
        "I've checked the calendar: nothing until four.",
        "Shall I set a reminder for that?",
    ]:
        assert claimed_action(reply) is None, reply


def test_a_claim_backed_by_a_write_passes():
    executed = [("reminders", {"operation": "set", "text": "Call Dana"}, {"ok": True})]
    assert acted(executed)
    assert unbacked_claim("Done, sir. Reminder set for 3 PM.", executed) is None


def test_reads_and_failures_do_not_back_a_claim():
    reads = [("google_titan", {"operation": "calendar_list_events"}, {"ok": True}), ("weather", {}, {"ok": True})]
    assert unbacked_claim("I've scheduled it for Thursday.", reads)
    failed = [("google_titan", {"operation": "gmail_send_message"}, {"ok": False, "error": "not connected"})]
    assert unbacked_claim("I've sent the email.", failed)
    held = [("google_titan", {"operation": "gmail_send_message"}, {"ok": False, "held": True})]
    assert unbacked_claim("Sent.", held)
    assert unbacked_claim("Done.", []) == "Done"


def test_console_and_browser_actions_count_as_acting():
    assert acted([("console", {"actions": [{"action": "timer_start"}]}, {"ok": True})])
    assert acted([("browser", {"operation": "click"}, {"ok": True})])
    assert not acted([("browser", {"operation": "elements"}, {"ok": True})])
