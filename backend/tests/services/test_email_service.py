"""Tests for the real _send. Nothing reaches AWS.

Retry tests answer a real botocore client's HTTP layer with a before-send handler, because
botocore's Stubber short-circuits before retries run.
"""

import asyncio
import json
import logging
import time
from itertools import pairwise
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from botocore.awsrequest import AWSResponse
from botocore.exceptions import ClientError

from app.core.config import Settings
from app.services import email_service

_real_get_ses_client = email_service._get_ses_client


@pytest.fixture(autouse=True)
def mock_send_email():
    """Overrides the conftest stub so these tests exercise the real _send."""
    return None


@pytest.fixture(autouse=True)
def fresh_state(monkeypatch):
    _real_get_ses_client.cache_clear()
    monkeypatch.setattr(email_service, "_rate_limiter", email_service._SendRateLimiter())
    yield
    _real_get_ses_client.cache_clear()


@pytest.fixture
def use_settings(monkeypatch):
    def apply(**overrides: Any) -> Settings:
        values: dict[str, Any] = {
            "app_env": "development",
            "aws_access_key_id": "test-access-key",
            "aws_secret_access_key": "test-secret-key",
            "aws_region": "us-west-2",
            "email_from_address": "NEXUS Test <test@nexus.example>",
            "ses_max_send_rate": 1000,
            "ses_max_attempts": 4,
            **overrides,
        }
        settings = Settings(_env_file=None, **values)
        monkeypatch.setattr(email_service, "get_settings", lambda: settings)
        return settings

    return apply


@pytest.fixture
def ses_factory(monkeypatch):
    """Replaces the client factory; the fake client is factory.return_value."""
    factory = MagicMock()
    factory.return_value.send_email.return_value = {"MessageId": "fake-message-id"}
    monkeypatch.setattr(email_service, "_get_ses_client", factory)
    return factory


def _client_error(code: str) -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": f"{code} (test)"}}, "SendEmail")


# ---------------------------------------------------------------------------
# Sending
# ---------------------------------------------------------------------------


async def test_send_builds_ses_request(use_settings, ses_factory):
    settings = use_settings()

    await email_service._send(
        "volunteer@example.com", "Subject line", "plain body", "<p>html body</p>"
    )

    ses_factory.assert_called_once_with("test-access-key", "test-secret-key", "us-west-2", 4)
    ses_factory.return_value.send_email.assert_called_once_with(
        FromEmailAddress=settings.email_from_address,
        Destination={"ToAddresses": ["volunteer@example.com"]},
        Content={
            "Simple": {
                "Subject": {"Data": "Subject line", "Charset": "UTF-8"},
                "Body": {
                    "Text": {
                        "Data": "plain body",
                        "Charset": "UTF-8",
                    },
                    "Html": {"Data": "<p>html body</p>", "Charset": "UTF-8"},
                },
            },
        },
    )


def test_client_uses_standard_retries_in_configured_region():
    client = _real_get_ses_client("key", "secret", "us-west-2", 4)

    assert client.meta.region_name == "us-west-2"
    assert client.meta.config.retries == {"mode": "standard", "total_max_attempts": 4}
    assert _real_get_ses_client("key", "secret", "us-west-2", 4) is client


async def test_send_failure_propagates(use_settings, ses_factory):
    use_settings()
    ses_factory.return_value.send_email.side_effect = _client_error("MessageRejected")

    with pytest.raises(ClientError) as exc_info:
        await email_service._send("volunteer@example.com", "s", "t", "h")

    assert exc_info.value.response["Error"]["Code"] == "MessageRejected"


async def test_staff_invites_report_only_rejected_address(use_settings, ses_factory):
    use_settings()

    def send_email(**kwargs):
        if kwargs["Destination"]["ToAddresses"] == ["bad@example.com"]:
            raise _client_error("MessageRejected")
        return {"MessageId": "ok"}

    ses_factory.return_value.send_email.side_effect = send_email

    failed = await email_service.send_staff_invite_emails(
        ["good@example.com", "bad@example.com"],
        "Test Invitational",
        "https://nexus.example/join?code=X",
    )

    assert failed == ["bad@example.com"]


# ---------------------------------------------------------------------------
# Retries — real botocore client, HTTP layer answered locally
# ---------------------------------------------------------------------------


class _Body:
    def __init__(self, payload: dict):
        self._data = json.dumps(payload).encode()

    def stream(self, **kwargs):
        yield self._data


def _ok():
    return (200, {"MessageId": "real-message-id"}, None)


def _error(status: int, code: str):
    return (status, {"message": f"{code} (test)"}, code)


@pytest.fixture
def ses_http(use_settings, monkeypatch):
    """Each HTTP attempt pops a (status, payload, error_type) from .responses; the last repeats.

    Retry backoff sleeps are recorded in .backoffs instead of slept.
    """
    settings = use_settings()
    client = _real_get_ses_client(
        settings.aws_access_key_id,
        settings.aws_secret_access_key,
        settings.aws_region,
        settings.ses_max_attempts,
    )
    state = SimpleNamespace(responses=[], attempts=0, backoffs=[])
    monkeypatch.setattr("botocore.endpoint.time.sleep", state.backoffs.append)

    def answer(request, **kwargs):
        state.attempts += 1
        status, payload, error_type = (
            state.responses.pop(0) if len(state.responses) > 1 else state.responses[0]
        )
        headers = {"Content-Type": "application/json"}
        if error_type:
            headers["x-amzn-ErrorType"] = error_type
        return AWSResponse(request.url, status, headers, _Body(payload))

    client.meta.events.register("before-send.sesv2.SendEmail", answer)
    return state


async def test_throttle_is_retried_until_success(ses_http):
    ses_http.responses[:] = [
        _error(429, "TooManyRequestsException"),
        _error(429, "TooManyRequestsException"),
        _ok(),
    ]

    await email_service._send("volunteer@example.com", "s", "t", "h")

    assert ses_http.attempts == 3
    assert len(ses_http.backoffs) == 2


async def test_throttling_exception_code_is_retried(ses_http):
    ses_http.responses[:] = [_error(400, "ThrottlingException"), _ok()]

    await email_service._send("volunteer@example.com", "s", "t", "h")

    assert ses_http.attempts == 2


async def test_persistent_throttle_fails_after_max_attempts(ses_http):
    ses_http.responses[:] = [_error(429, "TooManyRequestsException")]

    with pytest.raises(ClientError) as exc_info:
        await email_service._send("volunteer@example.com", "s", "t", "h")

    assert exc_info.value.response["Error"]["Code"] == "TooManyRequestsException"
    assert ses_http.attempts == 4


async def test_rejected_message_is_not_retried(ses_http):
    ses_http.responses[:] = [_error(400, "MessageRejected")]

    with pytest.raises(ClientError) as exc_info:
        await email_service._send("volunteer@example.com", "s", "t", "h")

    assert exc_info.value.response["Error"]["Code"] == "MessageRejected"
    assert ses_http.attempts == 1


async def test_staff_invite_throttled_then_accepted_is_not_reported_failed(ses_http):
    ses_http.responses[:] = [_error(429, "TooManyRequestsException"), _ok()]

    failed = await email_service.send_staff_invite_emails(
        ["volunteer@example.com"], "Test Invitational", "https://nexus.example/join?code=X"
    )

    assert failed == []
    assert ses_http.attempts == 2


# ---------------------------------------------------------------------------
# Rate limiting / concurrency
# ---------------------------------------------------------------------------


async def test_concurrent_sends_are_spaced_by_rate_limit(use_settings, ses_factory):
    use_settings(ses_max_send_rate=10)
    sent_at = []
    ses_factory.return_value.send_email.side_effect = lambda **kwargs: sent_at.append(
        time.perf_counter()
    )

    await asyncio.gather(
        *(email_service._send(f"v{i}@example.com", "s", "t", "h") for i in range(5))
    )

    sent_at.sort()
    gaps = [later - earlier for earlier, later in pairwise(sent_at)]
    assert len(gaps) == 4
    # 0.1s interval, less timer resolution/thread-dispatch jitter
    assert all(gap >= 0.07 for gap in gaps), gaps


async def test_concurrent_sends_do_not_block_event_loop(use_settings, ses_factory):
    use_settings()
    ses_factory.return_value.send_email.side_effect = lambda **kwargs: time.sleep(0.3)

    ticks = 0
    stop = asyncio.Event()

    async def heartbeat():
        nonlocal ticks
        while not stop.is_set():
            ticks += 1
            await asyncio.sleep(0.01)

    beat = asyncio.create_task(heartbeat())
    started = time.perf_counter()
    await asyncio.gather(
        *(email_service._send(f"v{i}@example.com", "s", "t", "h") for i in range(5))
    )
    elapsed = time.perf_counter() - started
    stop.set()
    await beat

    assert elapsed < 0.9, elapsed  # five blocking 0.3s sends run serially would take 1.5s
    assert ticks >= 5, ticks


@pytest.mark.parametrize("app_env", ["development", "preview", "test"])
async def test_nexus_dev_logged_not_sent_outside_production(
    use_settings, ses_factory, caplog, app_env
):
    use_settings(app_env=app_env)

    with caplog.at_level(logging.WARNING, logger="app.services.email_service"):
        await email_service._send("User1@Nexus.Dev", "Subject", "Your code: 123456", "<p></p>")

    ses_factory.assert_not_called()
    assert "Your code: 123456" in caplog.text


async def test_nexus_dev_sent_in_production(use_settings, ses_factory):
    use_settings(app_env="production")

    await email_service._send("user1@nexus.dev", "Subject", "Text", "<p></p>")

    ses_factory.return_value.send_email.assert_called_once()


@pytest.mark.parametrize(
    "send",
    [
        email_service.send_sign_in_code_email,
        email_service.send_sign_up_code_email,
        email_service.send_step_up_code_email,
    ],
)
async def test_code_emails_show_the_code_in_both_versions(monkeypatch, send):
    capture = AsyncMock()
    monkeypatch.setattr(email_service, "_send", capture)

    await send("v@example.com", "042917")

    _, subject, text, html = capture.call_args.args
    assert "Your code: 042917" in text
    assert "042917" in html
    assert "042917" not in subject
    assert "If the button doesn't work" not in html


# ---------------------------------------------------------------------------
# Unconfigured SES
# ---------------------------------------------------------------------------


async def test_unconfigured_in_development_logs_body_and_skips(use_settings, ses_factory, caplog):
    use_settings(aws_access_key_id="", aws_secret_access_key="")

    with caplog.at_level(logging.WARNING, logger="app.services.email_service"):
        await email_service._send(
            "v@example.com",
            "Verify your email on NEXUS",
            "Verify: https://nexus.example/verify?token=abc",
            "<p></p>",
        )

    ses_factory.assert_not_called()
    assert "Verify your email on NEXUS" in caplog.text
    assert "https://nexus.example/verify?token=abc" in caplog.text


async def test_unconfigured_in_preview_skips_without_body(use_settings, ses_factory, caplog):
    use_settings(app_env="preview", aws_access_key_id="", aws_secret_access_key="")

    with caplog.at_level(logging.WARNING, logger="app.services.email_service"):
        await email_service._send(
            "v@example.com",
            "Verify your email on NEXUS",
            "Verify: https://nexus.example/verify?token=abc",
            "<p></p>",
        )

    ses_factory.assert_not_called()
    assert "Verify your email on NEXUS" in caplog.text
    assert "token=abc" not in caplog.text


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


@pytest.fixture
def captured(monkeypatch):
    mock = AsyncMock()
    monkeypatch.setattr(email_service, "_send", mock)
    return mock


async def test_values_are_escaped_in_html(captured):
    name = '<a href="https://evil.example">Verify here</a>'

    await email_service.send_staff_invite_email("v@example.com", name, "https://nexus.example/j")

    to, subject, text, html = captured.call_args.args
    assert '<a href="https://evil.example">' not in html
    assert "&lt;a href=&quot;https://evil.example&quot;&gt;" in html
    assert name in subject
    assert name in text


async def test_plain_text_carries_the_whole_message(captured):
    await email_service.send_password_reset_email("v@example.com", "tok123")

    text = captured.call_args.args[2]
    assert "Reset your password" in text
    assert "Choose a new password to regain access." in text
    assert "/reset-password?token=tok123" in text
    assert "This link expires in 1 hour." in text


async def test_bold_and_footer_render_in_both_versions(captured):
    await email_service.send_password_changed_notice("v@example.com")

    _, _, text, html = captured.call_args.args
    assert "<b>If you made this change, no action is needed.</b>" in html
    assert "**" not in html
    assert "**" not in text
    assert "If you made this change, no action is needed." in text
    assert 'href="mailto:support@nexus.socalscioly.org"' in html
    assert "Questions? Email support@nexus.socalscioly.org" in text


async def test_email_change_notice_says_when_the_undo_link_expires(captured):
    await email_service.send_email_change_requested_notice(
        "old@example.com", "new@example.com", "t"
    )

    assert "This link expires in 24 hours." in captured.call_args.args[2]


async def test_asterisks_in_a_value_stay_literal(captured):
    await email_service.send_staff_invite_email(
        "v@example.com", "**Big** Invitational", "https://nexus.example/j"
    )

    _, subject, text, html = captured.call_args.args
    assert "<b>" not in html
    assert "**Big** Invitational" in html
    assert "**Big** Invitational" in text
    assert "**Big** Invitational" in subject
    assert "501(c)(3)" in html
    assert "501(c)(3)" in text
