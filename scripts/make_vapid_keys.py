"""Make the VAPID key pair Web Push needs (app/services/push.py).

    python scripts/make_vapid_keys.py

Prints VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY for the Render service's
environment (and .env for local runs). Make them once: a new pair
invalidates every device's subscription, and each device then has to
switch notifications on again.
"""

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


key = ec.generate_private_key(ec.SECP256R1())
private_raw = key.private_numbers().private_value.to_bytes(32, "big")
public_raw = key.public_key().public_bytes(
    serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
)
print(f"VAPID_PUBLIC_KEY={b64url(public_raw)}")
print(f"VAPID_PRIVATE_KEY={b64url(private_raw)}")
print("VAPID_SUBJECT=mailto:you@example.com  # your own address")
