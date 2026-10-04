import hashlib
import hmac
import math
import secrets
from datetime import datetime, timedelta, timezone

from app.core.supabase_client import get_supabase_client

# The console's lock: PIN and face, checked here, never in the browser.
# The site is a public static bundle, so anything the page itself compared
# against could be read out of it; the page only ever sends what was typed
# or scanned, and gets an unlock token back if it matches.

TABLE = "jarvis_lock"

# scrypt, with a per-PIN salt. A four-digit PIN has only 10,000 values, so
# the hash alone cannot protect it against someone holding the table; the
# lockouts below are what make guessing it through the API impractical.
SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}

# Five misses lock the factor for 15 minutes; every further five doubles it.
ATTEMPTS_PER_WINDOW = 5
FIRST_LOCKOUT = timedelta(minutes=15)

# Face descriptors (face-api's 128-number embeddings) match when their
# Euclidean distance is under this. face-api's own default is 0.6; 0.5 is
# stricter, trading a few more retries for fewer false matches.
FACE_MATCH_DISTANCE = 0.5
DESCRIPTOR_LENGTH = 128


class LockedOut(Exception):
    """`started` is True when this attempt is the one that began the
    lockout (worth telling Andrew about), False when it was already on."""

    def __init__(self, until: datetime, started: bool = False):
        self.until = until
        self.started = started
        super().__init__(f"Too many attempts. Locked until {until.astimezone(timezone.utc):%H:%M} UTC.")


class Rejected(Exception):
    pass


def _row() -> dict:
    rows = get_supabase_client().table(TABLE).select("*").eq("id", "default").limit(1).execute().data
    return rows[0] if rows else {"id": "default", "pin_failures": 0, "face_failures": 0}


def _save(**changes) -> None:
    changes["updated_at"] = datetime.now(timezone.utc).isoformat()
    get_supabase_client().table(TABLE).upsert({"id": "default", **changes}).execute()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _locked_until(value) -> datetime | None:
    if not value:
        return None
    until = datetime.fromisoformat(value) if isinstance(value, str) else value
    return until if until > _now() else None


def status() -> dict:
    row = _row()
    pin_until = _locked_until(row.get("pin_locked_until"))
    face_until = _locked_until(row.get("face_locked_until"))
    return {
        "pin_set": bool(row.get("pin_hash")),
        "face_enrolled": bool(row.get("face_samples")),
        "pin_locked_until": pin_until.isoformat() if pin_until else None,
        "face_locked_until": face_until.isoformat() if face_until else None,
    }


def hash_pin(pin: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(pin.encode(), salt=salt, **SCRYPT)
    return digest.hex(), salt.hex()


def _fail(kind: str, row: dict) -> int:
    """Counts a miss; returns how many tries are left before a lockout (0
    when this miss started one)."""
    failures = int(row.get(f"{kind}_failures") or 0) + 1
    changes: dict = {f"{kind}_failures": failures}
    if failures % ATTEMPTS_PER_WINDOW == 0:
        lockout = FIRST_LOCKOUT * (2 ** (failures // ATTEMPTS_PER_WINDOW - 1))
        changes[f"{kind}_locked_until"] = (_now() + lockout).isoformat()
    _save(**changes)
    return (ATTEMPTS_PER_WINDOW - failures % ATTEMPTS_PER_WINDOW) % ATTEMPTS_PER_WINDOW


def _guard(kind: str, row: dict) -> None:
    until = _locked_until(row.get(f"{kind}_locked_until"))
    if until:
        raise LockedOut(until)


def check_pin(pin: str) -> None:
    """Raises LockedOut or Rejected; returns when the PIN is right."""
    row = _row()
    _guard("pin", row)
    if not row.get("pin_hash"):
        raise Rejected("No PIN is set. Run scripts/set_pin.py.")
    digest, _ = hash_pin(pin, bytes.fromhex(row["pin_salt"]))
    if not hmac.compare_digest(digest, row["pin_hash"]):
        left = _fail("pin", row)
        if not left:
            raise LockedOut(_locked_until(_row().get("pin_locked_until")) or _now(), started=True)
        raise Rejected(f"Wrong PIN. {left} {'try' if left == 1 else 'tries'} before a lockout.")
    _save(pin_failures=0, pin_locked_until=None)


def set_pin(pin: str) -> None:
    digest, salt = hash_pin(pin)
    _save(pin_hash=digest, pin_salt=salt, pin_failures=0, pin_locked_until=None)


def _valid(descriptor) -> list[float] | None:
    if not isinstance(descriptor, list) or len(descriptor) != DESCRIPTOR_LENGTH:
        return None
    try:
        values = [float(x) for x in descriptor]
    except (TypeError, ValueError):
        return None
    return values if all(math.isfinite(v) for v in values) else None


def _distance(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def enroll_face(descriptors: list) -> int:
    samples = [d for d in (_valid(x) for x in descriptors) if d]
    if len(samples) < 3:
        raise Rejected("The scan did not capture enough of your face. Try again in better light.")
    # Samples of one face sit close together; a set that does not came from
    # more than one face, or a bad capture.
    spread = max(_distance(a, b) for a in samples for b in samples)
    if spread > FACE_MATCH_DISTANCE * 1.4:
        raise Rejected("The captures did not agree with each other. Hold still, alone in frame, and try again.")
    _save(face_samples=samples, face_enrolled_at=_now().isoformat(), face_failures=0, face_locked_until=None)
    return len(samples)


def check_face(descriptors: list, liveness: dict) -> float:
    """Returns the match distance; raises LockedOut or Rejected."""
    row = _row()
    _guard("face", row)
    enrolled = row.get("face_samples") or []
    if not enrolled:
        raise Rejected("No face is enrolled yet.")
    if not liveness.get("blinked") or not liveness.get("turned"):
        raise Rejected("The liveness check was not completed.")
    scans = [d for d in (_valid(x) for x in descriptors) if d]
    if len(scans) < 2:
        raise Rejected("The scan did not capture your face clearly.")
    # Each scan frame against its nearest enrolled sample; the median frame
    # decides, so one blurred frame neither passes nor fails it alone.
    distances = sorted(min(_distance(s, e) for e in enrolled) for s in scans)
    median = distances[len(distances) // 2]
    if median > FACE_MATCH_DISTANCE:
        left = _fail("face", row)
        if not left:
            raise LockedOut(_locked_until(_row().get("face_locked_until")) or _now(), started=True)
        raise Rejected(f"Face not recognised. {left} {'try' if left == 1 else 'tries'} before a lockout.")
    _save(face_failures=0, face_locked_until=None)
    return median
