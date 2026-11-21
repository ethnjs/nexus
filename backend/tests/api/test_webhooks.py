"""Tests for POST /webhooks/ses/. Signature checking is covered in tests/core/test_sns.py."""

import json

import pytest

import app.api.routes.webhooks as webhooks
from app.core.config import Settings
from app.core.sns import InvalidSNSMessage
from app.models.models import EmailSuppression, User

TOPIC = "arn:aws:sns:us-west-2:123:ses-events"


@pytest.fixture(autouse=True)
def topic_settings(monkeypatch):
    settings = Settings(_env_file=None, app_env="test", ses_sns_topic_arn=TOPIC)
    monkeypatch.setattr(webhooks, "get_settings", lambda: settings)


@pytest.fixture(autouse=True)
def signature(monkeypatch):
    """Accepts every message; set .valid = False to reject them."""

    class State:
        valid = True

    def verify(message):
        if not State.valid:
            raise InvalidSNSMessage("Bad SNS signature")

    monkeypatch.setattr(webhooks, "verify_sns_message", verify)
    return State


def _post(client, event: dict, **message):
    body = {"Type": "Notification", "TopicArn": TOPIC, "Message": json.dumps(event), **message}
    # SNS posts JSON with a text/plain content type.
    return client.post(
        "/webhooks/ses/", content=json.dumps(body), headers={"Content-Type": "text/plain"}
    )


def _bounce(*emails: str, bounce_type: str = "Permanent") -> dict:
    return {
        "eventType": "Bounce",
        "mail": {"messageId": "ses-1"},
        "bounce": {
            "bounceType": bounce_type,
            "bounceSubType": "General",
            "bouncedRecipients": [{"emailAddress": email} for email in emails],
        },
    }


def _complaint(*emails: str) -> dict:
    return {
        "eventType": "Complaint",
        "mail": {"messageId": "ses-2"},
        "complaint": {
            "complaintFeedbackType": "abuse",
            "complainedRecipients": [{"emailAddress": email} for email in emails],
        },
    }


def _suppressions(db) -> dict[str, str]:
    return {row.email: row.reason for row in db.query(EmailSuppression).all()}


def test_permanent_bounce_suppresses_and_unverifies(client, db, td_user):
    td_user.email_verified = True
    db.commit()

    res = _post(client, _bounce("TD@test.com"))

    assert res.status_code == 204
    assert _suppressions(db) == {"td@test.com": "bounce"}
    row = db.query(EmailSuppression).one()
    assert (row.detail, row.ses_message_id) == ("General", "ses-1")
    db.expire_all()
    assert db.get(User, td_user.id).email_verified is False


def test_identity_notification_format_is_accepted(client, db):
    event = _bounce("a@example.com")
    event["notificationType"] = event.pop("eventType")

    assert _post(client, event).status_code == 204
    assert _suppressions(db) == {"a@example.com": "bounce"}


def test_transient_bounce_is_ignored(client, db):
    assert _post(client, _bounce("a@example.com", bounce_type="Transient")).status_code == 204
    assert _suppressions(db) == {}


def test_complaint_suppresses_without_unverifying(client, db, td_user):
    td_user.email_verified = True
    db.commit()

    assert _post(client, _complaint("td@test.com")).status_code == 204

    assert _suppressions(db) == {"td@test.com": "complaint"}
    db.expire_all()
    assert db.get(User, td_user.id).email_verified is True


def test_bounce_replaces_earlier_complaint(client, db):
    _post(client, _complaint("a@example.com"))
    _post(client, _bounce("a@example.com"))
    assert _suppressions(db) == {"a@example.com": "bounce"}


def test_complaint_keeps_earlier_bounce(client, db):
    _post(client, _bounce("a@example.com"))
    _post(client, _complaint("a@example.com"))
    assert _suppressions(db) == {"a@example.com": "bounce"}


def test_repeated_event_is_idempotent(client, db):
    _post(client, _bounce("a@example.com"))
    assert _post(client, _bounce("a@example.com")).status_code == 204
    assert _suppressions(db) == {"a@example.com": "bounce"}


def test_other_event_types_are_ignored(client, db):
    assert _post(client, {"eventType": "Delivery", "mail": {}}).status_code == 204
    assert _suppressions(db) == {}


def test_other_topic_is_refused(client, db):
    assert _post(client, _bounce("a@example.com"), TopicArn="arn:other").status_code == 403
    assert _suppressions(db) == {}


def test_unconfigured_topic_refuses_everything(client, db, monkeypatch):
    settings = Settings(_env_file=None, app_env="test")
    monkeypatch.setattr(webhooks, "get_settings", lambda: settings)
    assert _post(client, _bounce("a@example.com")).status_code == 403


def test_bad_signature_is_refused(client, db, signature):
    signature.valid = False
    assert _post(client, _bounce("a@example.com")).status_code == 403
    assert _suppressions(db) == {}


def test_no_api_key_needed(client, db, monkeypatch):
    from app.core import security

    monkeypatch.setattr(security.get_settings(), "api_key", "secret")
    assert _post(client, _bounce("a@example.com")).status_code == 204


def test_subscription_is_confirmed(client, monkeypatch):
    opened = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def urlopen(url, timeout):
        opened.append(url)
        return Response()

    monkeypatch.setattr(webhooks.urllib.request, "urlopen", urlopen)
    url = "https://sns.us-west-2.amazonaws.com/?Action=ConfirmSubscription&Token=t"

    res = _post(client, {}, Type="SubscriptionConfirmation", SubscribeURL=url)

    assert res.status_code == 204
    assert opened == [url]


def test_subscribe_url_off_sns_is_refused(client, monkeypatch):
    monkeypatch.setattr(webhooks.urllib.request, "urlopen", pytest.fail)
    res = _post(client, {}, Type="SubscriptionConfirmation", SubscribeURL="https://evil.example/")
    assert res.status_code == 400


def test_non_json_body_is_rejected(client):
    assert client.post("/webhooks/ses/", content="not json").status_code == 400
