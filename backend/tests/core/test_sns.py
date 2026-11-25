"""Tests for app/core/sns.py, signing with a local key in place of SNS's certificate."""

import base64
from datetime import UTC, datetime, timedelta

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import NameOID

from app.core import sns

CERT_URL = "https://sns.us-west-2.amazonaws.com/SimpleNotificationService-abc.pem"

_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "sns.amazonaws.com")])
_cert = (
    x509.CertificateBuilder()
    .subject_name(_name)
    .issuer_name(_name)
    .public_key(_key.public_key())
    .serial_number(1)
    .not_valid_before(datetime.now(UTC) - timedelta(days=1))
    .not_valid_after(datetime.now(UTC) + timedelta(days=1))
    .sign(_key, hashes.SHA256())
)


@pytest.fixture(autouse=True)
def local_cert(monkeypatch):
    fetched = []

    def signing_cert(url: str) -> x509.Certificate:
        fetched.append(url)
        return _cert

    monkeypatch.setattr(sns, "_signing_cert", signing_cert)
    return fetched


def _signed(message: dict, version: str = "2") -> dict:
    message = {"SignatureVersion": version, "SigningCertURL": CERT_URL, **message}
    algorithm = hashes.SHA256() if version == "2" else hashes.SHA1()
    signature = _key.sign(sns._string_to_sign(message), padding.PKCS1v15(), algorithm)
    return {**message, "Signature": base64.b64encode(signature).decode()}


def _notification(**extra) -> dict:
    return {
        "Type": "Notification",
        "MessageId": "m-1",
        "TopicArn": "arn:aws:sns:us-west-2:123:ses-events",
        "Message": '{"eventType": "Bounce"}',
        "Timestamp": "2026-11-21T00:00:00.000Z",
        **extra,
    }


@pytest.mark.parametrize("version", ["1", "2"])
def test_valid_signature_passes(version, local_cert):
    sns.verify_sns_message(_signed(_notification(), version))
    assert local_cert == [CERT_URL]


def test_subject_is_signed_when_present():
    sns.verify_sns_message(_signed(_notification(Subject="Amazon SES Email Event")))


def test_subscription_confirmation_signs_its_own_keys():
    sns.verify_sns_message(
        _signed(
            {
                **_notification(Type="SubscriptionConfirmation"),
                "SubscribeURL": "https://sns.us-west-2.amazonaws.com/?Action=ConfirmSubscription",
                "Token": "t",
            }
        )
    )


def test_tampered_message_fails():
    message = _signed(_notification())
    message["Message"] = '{"eventType": "Complaint"}'
    with pytest.raises(sns.InvalidSNSMessage, match="Bad SNS signature"):
        sns.verify_sns_message(message)


@pytest.mark.parametrize(
    "url",
    [
        "http://sns.us-west-2.amazonaws.com/cert.pem",
        "https://sns.us-west-2.amazonaws.com.evil.example/cert.pem",
        "https://evil.example/sns.us-west-2.amazonaws.com/cert.pem",
        "https://sns.us-west-2.amazonaws.com/cert.txt",
    ],
)
def test_cert_url_off_sns_is_refused_before_fetching(url, local_cert):
    message = {**_signed(_notification()), "SigningCertURL": url}
    with pytest.raises(sns.InvalidSNSMessage, match="not an SNS URL"):
        sns.verify_sns_message(message)
    assert local_cert == []


def test_unknown_type_fails():
    with pytest.raises(sns.InvalidSNSMessage, match="Unknown SNS message type"):
        sns.verify_sns_message(
            {"Type": "Other", "SignatureVersion": "2", "SigningCertURL": CERT_URL}
        )


def test_missing_key_fails():
    message = _signed(_notification())
    del message["Timestamp"]
    with pytest.raises(sns.InvalidSNSMessage, match="Malformed"):
        sns.verify_sns_message(message)
