"""
Tests for the SES-backed _send in app/services/email_service.py.

conftest's autouse mock_send_email stubs _send for every other test; it's
overridden below so the real implementation runs here. Nothing reaches AWS:
sends go either to a fake client, or through a real botocore sesv2 client
whose HTTP layer is answered by a before-send handler (so botocore's actual
retry logic runs — botocore's Stubber short-circuits before retries).
"""

import asyncio
import json
import logging
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

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
    def apply(**overrides) -> Settings:
        values = {
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

    await email_service._send("volunteer@example.com", "Subject line", "plain body", "<p>html body</p>")

    ses_factory.assert_called_once_with("test-access-key", "test-secret-key", "us-west-2", 4)
    ses_factory.return_value.send_email.assert_called_once_with(
        FromEmailAddress=settings.email_from_address,
        Destination={"ToAddresses": ["volunteer@example.com"]},
        Content={
            "Simple": {
                "Subject": {"Data": "Subject line", "Charset": "UTF-8"},
                "Body": {
                    "Text": {"Data": "plain body", "Charset": "UTF-8"},
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
        ["good@example.com", "bad@example.com"], "Test Invitational", "https://nexus.example/join?code=X"
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
    """
    Queue (status, payload, error_type) tuples on .responses; each HTTP
    attempt pops one, and the last one repeats. Retry backoff sleeps are
    recorded instead of slept.
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
        status, payload, error_type = state.responses.pop(0) if len(state.responses) > 1 else state.responses[0]
        headers = {"Content-Type": "application/json"}
        if error_type:
            headers["x-amzn-ErrorType"] = error_type
        return AWSResponse(request.url, status, headers, _Body(payload))

    client.meta.events.register("before-send.sesv2.SendEmail", answer)
    return state


async def test_throttle_is_retried_until_success(ses_http):
    ses_http.responses[:] = [_error(429, "TooManyRequestsException"), _error(429, "TooManyRequestsException"), _ok()]

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
    ses_factory.return_value.send_email.side_effect = lambda **kwargs: sent_at.append(time.perf_counter())

    await asyncio.gather(*(email_service._send(f"v{i}@example.com", "s", "t", "h") for i in range(5)))

    sent_at.sort()
    gaps = [later - earlier for earlier, later in zip(sent_at, sent_at[1:])]
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
    await asyncio.gather(*(email_service._send(f"v{i}@example.com", "s", "t", "h") for i in range(5)))
    elapsed = time.perf_counter() - started
    stop.set()
    await beat

    assert elapsed < 0.9, elapsed  # five blocking 0.3s sends run serially would take 1.5s
    assert ticks >= 5, ticks


# ---------------------------------------------------------------------------
# Unconfigured SES
# ---------------------------------------------------------------------------

async def test_unconfigured_in_development_logs_body_and_skips(use_settings, ses_factory, caplog):
    use_settings(aws_access_key_id="", aws_secret_access_key="")

    with caplog.at_level(logging.WARNING, logger="app.services.email_service"):
        await email_service._send("v@example.com", "Verify your email on NEXUS", "Verify: https://nexus.example/verify?token=abc", "<p></p>")

    ses_factory.assert_not_called()
    assert "Verify your email on NEXUS" in caplog.text
    assert "https://nexus.example/verify?token=abc" in caplog.text


async def test_unconfigured_in_preview_skips_without_body(use_settings, ses_factory, caplog):
    use_settings(app_env="preview", aws_access_key_id="", aws_secret_access_key="")

    with caplog.at_level(logging.WARNING, logger="app.services.email_service"):
        await email_service._send("v@example.com", "Verify your email on NEXUS", "Verify: https://nexus.example/verify?token=abc", "<p></p>")

    ses_factory.assert_not_called()
    assert "Verify your email on NEXUS" in caplog.text
    assert "token=abc" not in caplog.text


async def test_unconfigured_in_production_raises(use_settings, ses_factory):
    use_settings(app_env="production", aws_access_key_id="", aws_secret_access_key="")

    with pytest.raises(RuntimeError):
        await email_service._send("v@example.com", "s", "t", "h")

    ses_factory.assert_not_called()
