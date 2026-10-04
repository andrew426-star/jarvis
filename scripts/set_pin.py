"""Set or change the console's unlock PIN (app/services/lock.py).

    python scripts/set_pin.py

Prompts for the PIN (never echoed, and never written anywhere except as a
salted scrypt hash in jarvis_lock). Needs the backend's environment
(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the rest) in the shell or .env.
"""

import getpass
import re
import sys

sys.path.insert(0, ".")

from app.services.lock import set_pin  # noqa: E402

pin = getpass.getpass("New PIN (4-8 digits): ")
if not re.fullmatch(r"\d{4,8}", pin) or getpass.getpass("Again: ") != pin:
    sys.exit("PINs must be 4-8 digits and match.")
set_pin(pin)
print("PIN set.")
