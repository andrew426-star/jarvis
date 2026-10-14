import logging
import threading

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.core.config import get_settings
from app.integrations.groq_transcription import transcribe_audio
from app.services import phone
from app.services.inbox import add_item, announce
from app.services.push import hold_status
from app.tools.rounds import READ_ONLY
from app.tools.schemas import DISPATCH, TOOL_SCHEMAS

# Jarvis answering Andrew's phone (app/services/phone.py). Twilio calls
# these as webhooks; each request must carry Twilio's signature, made with
# the account's auth token over this exact URL and its parameters, so
# nobody else can drive them. The TwiML they return is the call:
#
#   /phone/voice        a forwarded call arrives: Jarvis asks who and why
#   /phone/screen       their answer: spam is turned away; otherwise his
#                       phone rings, and he hears who it is first
#   /phone/whisper      what Andrew hears when he picks up: press 1 to take it
#   /phone/accept       he pressed a key
#   /phone/after-dial   he did not take it: a message after the tone
#   /phone/recording    the message, transcribed, into his inbox and phone
#   /phone/status       a call ended; one that left nothing is a missed call
#   /phone/sms          a text: from Andrew, a conversation with Jarvis;
#                       from anyone else, a notice
#   /phone/audio/...    Jarvis's own voice, for <Play>, behind a signed link

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/phone")

RING_SECONDS = 15  # under a carrier's no-answer forward (~20 s), so it cannot loop


def _xml(body: str) -> Response:
    return Response(content=body, media_type="application/xml")


async def twilio_form(request: Request) -> dict:
    if not phone.configured():
        raise HTTPException(status_code=503, detail="The phone line is not set up.")
    from twilio.request_validator import RequestValidator

    params = {k: str(v) for k, v in (await request.form()).items()}
    query = f"?{request.url.query}" if request.url.query else ""
    signed_url = f"{phone.base_url()}{request.url.path}{query}"
    signature = request.headers.get("X-Twilio-Signature", "")
    if not RequestValidator(get_settings().twilio_auth_token).validate(signed_url, params, signature):
        raise HTTPException(status_code=403, detail="Bad Twilio signature.")
    return params


def _voicemail(intro: str) -> Response:
    return _xml(phone.twiml(
        phone.say(intro),
        f'<Record maxLength="120" timeout="5" playBeep="true" action="{phone.url("/phone/done")}" '
        f'recordingStatusCallback="{phone.url("/phone/recording")}" recordingStatusCallbackEvent="completed"/>',
    ))


@router.post("/voice")
def voice(form: dict = Depends(twilio_form)) -> Response:
    number = form.get("From")
    contact = phone.lookup_contact(number)
    phone.log(form["CallSid"], kind="call", direction="inbound", from_number=number,
              caller=(contact or {}).get("name"), status="screening")
    if contact:
        first = contact["name"].split()[0]
        greeting = f"Good day, {first}. This is Jarvis; Andrew can't come to the phone just now. What shall I tell him it's about?"
    else:
        greeting = "Good day. You've reached Andrew Thomas; this is Jarvis, his assistant. May I ask who's calling, and what it's regarding?"
    return _xml(phone.twiml(
        f'<Gather input="speech" speechTimeout="auto" timeout="6" language="en-US" action="{phone.url("/phone/screen")}">'
        + phone.say(greeting) + "</Gather>",
        f'<Redirect method="POST">{phone.url("/phone/screen")}</Redirect>',
    ))


@router.post("/screen")
def screen(form: dict = Depends(twilio_form)) -> Response:
    sid, number = form["CallSid"], form.get("From")
    contact = phone.lookup_contact(number)
    heard = phone.summarize(form.get("SpeechResult", ""), number, contact)
    phone.log(sid, caller=heard["caller"], reason=heard["reason"], transcript=form.get("SpeechResult", "")[:1000])

    if heard["spam"]:
        phone.log(sid, status="spam")
        add_item("notice", f"Turned away a likely spam call from {number}", heard["reason"], "low", topic="calls")
        return _xml(phone.twiml(phone.say("Thank you. I'll pass that along. Goodbye."), "<Hangup/>"))

    # "Hold my calls", or the line set to messages only: straight to a message.
    if hold_status().get("held") or phone.phone_settings()["mode"] == "voicemail":
        phone.log(sid, status="message")
        return _voicemail("He isn't taking calls just now. Leave a message after the tone, and I'll see that he gets it.")

    phone.log(sid, status="ringing")
    whisper = phone.url("/phone/whisper", call=sid)
    return _xml(phone.twiml(
        phone.say("Thank you. One moment, I'll see if he's available."),
        f'<Dial timeout="{RING_SECONDS}" callerId="{get_settings().twilio_number}" action="{phone.url("/phone/after-dial")}">'
        f'<Number url="{whisper}">{get_settings().andrew_phone}</Number></Dial>',
    ))


@router.post("/whisper")
def whisper(call: str, form: dict = Depends(twilio_form)) -> Response:
    row = phone.get_call(call) or {}
    who, why = row.get("caller") or "Someone", row.get("reason") or "something they didn't say"
    return _xml(phone.twiml(
        f'<Gather numDigits="1" timeout="7" action="{phone.url("/phone/accept", call=call)}">'
        + phone.say(f"Sir, {who}, calling about {why}. Press 1 to take it, or hang up and I'll take a message.")
        + "</Gather>",
        "<Hangup/>",
    ))


@router.post("/accept")
def accept(call: str, form: dict = Depends(twilio_form)) -> Response:
    if form.get("Digits") == "1":
        phone.log(call, status="accepted")
        return _xml(phone.twiml())  # an empty answer bridges the two calls
    return _xml(phone.twiml("<Hangup/>"))


@router.post("/after-dial")
def after_dial(form: dict = Depends(twilio_form)) -> Response:
    row = phone.get_call(form["CallSid"]) or {}
    if row.get("status") == "accepted" and form.get("DialCallStatus") == "completed":
        phone.log(form["CallSid"], status="done")
        return _xml(phone.twiml("<Hangup/>"))
    phone.log(form["CallSid"], status="message")
    return _voicemail("I'm afraid he can't take it just now. Leave a message after the tone, and I'll see that he gets it.")


@router.post("/done")
def done(form: dict = Depends(twilio_form)) -> Response:
    return _xml(phone.twiml(phone.say("Thank you. Goodbye."), "<Hangup/>"))


@router.post("/recording")
def recording(form: dict = Depends(twilio_form)) -> Response:
    sid = form["CallSid"]
    row = phone.get_call(sid) or {}
    try:
        text = transcribe_audio(phone.fetch_recording(form["RecordingUrl"]), "voicemail.mp3", "audio/mpeg").strip()
    except Exception:  # noqa: BLE001 — the message is still there to play
        logger.warning("voicemail transcription failed", exc_info=True)
        text = ""
    phone.log(sid, status="message", recording_url=form.get("RecordingUrl"), transcript=text[:2000] or row.get("transcript"))
    who = row.get("caller") or row.get("from_number") or "Someone"
    item = add_item(
        "notice", f"Voicemail from {who}", f"{row.get('reason') or ''}\n{text or '(no words made out)'}\nFrom {row.get('from_number')}.",
        "high" if row.get("caller") and row.get("caller") != "Unknown caller" else "normal", topic="calls",
    )
    if item:
        announce([item])
    return _xml(phone.twiml())


@router.post("/status")
def call_status(form: dict = Depends(twilio_form)) -> Response:
    if form.get("CallStatus") not in ("completed", "no-answer", "busy", "failed", "canceled"):
        return _xml(phone.twiml())
    row = phone.get_call(form["CallSid"])
    if row and row.get("direction") == "inbound" and row.get("status") in ("screening", "ringing"):
        phone.log(form["CallSid"], status="missed")
        who = row.get("caller") or row.get("from_number") or "Unknown"
        item = add_item("notice", f"Missed call from {who}", row.get("reason") or "Hung up before saying why.", "normal", topic="calls")
        if item:
            announce([item])
    return _xml(phone.twiml())


@router.post("/sms")
def sms(form: dict = Depends(twilio_form)) -> Response:
    sid, number, body = form["MessageSid"], form.get("From"), form.get("Body", "").strip()
    if phone.is_andrew(number):
        phone.log(sid, kind="sms", direction="inbound", from_number=number, caller="Andrew", transcript=body[:1500], status="to-jarvis")
        # A turn takes longer than Twilio waits, so the reply goes out as its own text.
        threading.Thread(target=_answer_andrew, args=(body,), daemon=True).start()
        return _xml(phone.twiml())
    contact = phone.lookup_contact(number)
    who = (contact or {}).get("name") or number
    phone.log(sid, kind="sms", direction="inbound", from_number=number, caller=who, transcript=body[:1500], status="received")
    item = add_item("notice", f"Text from {who}", body[:1000], "normal", topic="calls")
    if item:
        announce([item])
    return _xml(phone.twiml())


def _answer_andrew(body: str) -> None:
    from app.services.orchestrator import run_invoke

    try:
        result = run_invoke(body, f"sms-{phone.digits(get_settings().andrew_phone)}", channel="sms", tool_override=sms_tools())
        reply = (result.get("response") or "").strip() or "Done, sir."
    except Exception:  # noqa: BLE001 — he should hear something back
        logger.warning("text turn failed", exc_info=True)
        reply = "I'm afraid that one failed on my end, sir. Try the console."
    try:
        phone.send_text(get_settings().andrew_phone, reply)
    except Exception:  # noqa: BLE001
        logger.warning("text reply failed", exc_info=True)


@router.get("/audio/{token}.mp3")
def audio(token: str) -> Response:
    text = phone.read_audio_token(token)
    if text is None:
        raise HTTPException(status_code=404)
    from app.integrations.fish_audio import text_to_speech

    s = get_settings()
    try:
        clip = text_to_speech(text, s.fish_audio_voice_id, s.fish_audio_api_key, s.fish_audio_model)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return Response(content=clip, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=600"})



# Over text, Jarvis can read anything his rounds can, and make only the
# small, undoable changes below. A text can come from a borrowed or stolen
# phone as easily as from Andrew, so the rest (mail, money, the pipeline,
# texting others) waits for the console.
SMS_WRITES: dict[str, set[str] | None] = {
    "reminders": {"set", "cancel", "list"},
    "checklist": None,
    "notes": {"list", "read", "save"},
    "hold": None,
    "habits": None,
}


def _allowed(name: str, args: dict) -> bool:
    for table in (SMS_WRITES, READ_ONLY):
        if name in table:
            ops = table[name]
            if ops is None or args.get("operation") in ops:
                return True
    return False


def sms_tools() -> tuple[list[dict], dict]:
    names = set(SMS_WRITES) | set(READ_ONLY)
    schemas = [s for s in TOOL_SCHEMAS if s["function"]["name"] in names]

    def gated(name: str):
        handler = DISPATCH[name]

        def run(args: dict) -> dict:
            if not _allowed(name, args):
                return {"ok": False, "error": "Not over text: that changes something. Tell him to do it from the console."}
            return handler(args)

        return run

    return schemas, {s["function"]["name"]: gated(s["function"]["name"]) for s in schemas}
