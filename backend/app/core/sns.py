"""Verifies Amazon SNS HTTP messages, following AWS's documented signing scheme."""

import base64
import re
import urllib.request
from functools import lru_cache
from typing import Any
from urllib.parse import urlparse

from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

_SNS_HOST = re.compile(r"^sns\.[a-z0-9-]+\.amazonaws\.com$")

_SIGNED_KEYS = {
    "Notification": ("Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"),
    "SubscriptionConfirmation": (
        "Message",
        "MessageId",
        "SubscribeURL",
        "Timestamp",
        "Token",
        "TopicArn",
        "Type",
    ),
}
_SIGNED_KEYS["UnsubscribeConfirmation"] = _SIGNED_KEYS["SubscriptionConfirmation"]


class InvalidSNSMessage(ValueError):
    pass


def is_sns_url(url: str) -> bool:
    """Whether `url` is an https URL on an SNS endpoint, so it's safe to fetch."""
    parsed = urlparse(url)
    return parsed.scheme == "https" and bool(_SNS_HOST.match(parsed.hostname or ""))


@lru_cache(maxsize=8)
def _signing_cert(url: str) -> x509.Certificate:
    with urllib.request.urlopen(url, timeout=10) as response:
        return x509.load_pem_x509_certificate(response.read())


def _string_to_sign(message: dict[str, Any]) -> bytes:
    keys = _SIGNED_KEYS.get(message.get("Type", ""))
    if keys is None:
        raise InvalidSNSMessage(f"Unknown SNS message type {message.get('Type')!r}")
    # Subject is signed only when present; every other key is required.
    return "".join(
        f"{key}\n{message[key]}\n" for key in keys if key != "Subject" or key in message
    ).encode()


def verify_sns_message(message: dict[str, Any]) -> None:
    """Raises InvalidSNSMessage unless SNS signed `message`. Fetches (and caches) SNS's cert."""
    cert_url = message.get("SigningCertURL", "")
    if not is_sns_url(cert_url) or not urlparse(cert_url).path.endswith(".pem"):
        raise InvalidSNSMessage("Signing certificate URL is not an SNS URL")

    # Version 1 signs with SHA1; set the topic's SignatureVersion to 2 for SHA256.
    algorithm = {"1": hashes.SHA1(), "2": hashes.SHA256()}.get(message.get("SignatureVersion", ""))
    if algorithm is None:
        raise InvalidSNSMessage("Unsupported SNS signature version")

    try:
        signed = _string_to_sign(message)
        signature = base64.b64decode(message["Signature"], validate=True)
    except InvalidSNSMessage:
        raise
    except (KeyError, ValueError) as e:
        raise InvalidSNSMessage("Malformed SNS message") from e

    public_key = _signing_cert(cert_url).public_key()
    if not isinstance(public_key, rsa.RSAPublicKey):
        raise InvalidSNSMessage("SNS signing certificate is not RSA")
    try:
        public_key.verify(signature, signed, padding.PKCS1v15(), algorithm)
    except InvalidSignature as e:
        raise InvalidSNSMessage("Bad SNS signature") from e
