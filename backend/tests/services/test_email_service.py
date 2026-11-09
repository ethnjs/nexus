"""Tests for the real _send, which every other test stubs out. Nothing reaches Resend."""

import logging
from typing import Any
from unittest.mock import AsyncMock

import pytest
import resend
from resend.exceptions import RateLimitError

from app.core.config import Settings
from app.services import email_service


@pytest.fixture(autouse=True)
def mock_send_email():
    """Overrides the conftest stub so these tests exercise the real _send."""
    return None


@pytest.fixture
def use_settings(monkeypatch):
    def apply(**overrides: Any) -> Settings:
        values: dict[str, Any] = {
            "app_env": "development",
            "resend_api_key": "test-key",
            **overrides,
        }
        settings = Settings(_env_file=None, **values)
        monkeypatch.setattr(email_service, "get_settings", lambda: settings)
        return settings

    return apply


@pytest.fixture
def resend_send(monkeypatch):
    mock = AsyncMock()
    monkeypatch.setattr(resend.Emails, "send_async", mock)
    return mock


def test_resend_has_async_http_client():
    # Without the resend[async] extra this is None and every send fails. httpx
    # once reached production only as a test dependency, so tests passed anyway.
    assert resend.default_async_http_client is not None


async def test_send_with_key_calls_resend(use_settings, resend_send):
    use_settings()

    await email_service._send("v@example.com", "Subject", "Text", "<p>Html</p>")

    params = resend_send.call_args.args[0]
    assert params["to"] == "v@example.com"
    assert params["subject"] == "Subject"
    assert params["text"] == "Text"
    assert params["html"] == "<p>Html</p>"


def _rate_limited(error_type: str = "rate_limit_exceeded", headers=None):
    return RateLimitError(
        message="Too many requests", error_type=error_type, code=429, headers=headers
    )


@pytest.fixture
def no_retry_delay(monkeypatch):
    monkeypatch.setattr(email_service, "_retry_delay", lambda error, attempt: 0)


async def test_rate_limited_send_is_retried_until_it_succeeds(
    use_settings, resend_send, no_retry_delay
):
    use_settings()
    resend_send.side_effect = [_rate_limited(), _rate_limited(), {"id": "sent"}]

    await email_service._send("v@example.com", "s", "t", "h")

    assert resend_send.call_count == 3


async def test_persistent_rate_limit_fails_after_the_last_attempt(
    use_settings, resend_send, no_retry_delay
):
    use_settings()
    resend_send.side_effect = _rate_limited()

    with pytest.raises(RateLimitError):
        await email_service._send("v@example.com", "s", "t", "h")

    assert resend_send.call_count == email_service._RATE_LIMIT_ATTEMPTS


async def test_quota_exceeded_is_not_retried(use_settings, resend_send, no_retry_delay):
    use_settings()
    resend_send.side_effect = _rate_limited("daily_quota_exceeded")

    with pytest.raises(RateLimitError):
        await email_service._send("v@example.com", "s", "t", "h")

    assert resend_send.call_count == 1


def test_retry_delay_honors_retry_after():
    delay = email_service._retry_delay(_rate_limited(headers={"Retry-After": "3"}), attempt=1)
    assert 3 <= delay < 4


def test_retry_delay_backs_off_without_retry_after():
    assert 1 <= email_service._retry_delay(_rate_limited(), attempt=1) < 2
    assert 4 <= email_service._retry_delay(_rate_limited(), attempt=3) < 5


async def test_unconfigured_in_development_logs_body_and_skips(use_settings, resend_send, caplog):
    use_settings(resend_api_key="")

    with caplog.at_level(logging.WARNING, logger="app.services.email_service"):
        await email_service._send(
            "v@example.com",
            "Verify your email on NEXUS",
            "Verify: https://nexus.example/verify?token=abc",
            "<p></p>",
        )

    resend_send.assert_not_called()
    assert "Verify your email on NEXUS" in caplog.text
    assert "https://nexus.example/verify?token=abc" in caplog.text


async def test_unconfigured_in_preview_skips_without_body(use_settings, resend_send, caplog):
    use_settings(app_env="preview", resend_api_key="")

    with caplog.at_level(logging.WARNING, logger="app.services.email_service"):
        await email_service._send(
            "v@example.com",
            "Verify your email on NEXUS",
            "Verify: https://nexus.example/verify?token=abc",
            "<p></p>",
        )

    resend_send.assert_not_called()
    assert "Verify your email on NEXUS" in caplog.text
    assert "token=abc" not in caplog.text


async def test_unconfigured_in_production_raises(use_settings, resend_send):
    use_settings(app_env="production", resend_api_key="")

    with pytest.raises(RuntimeError):
        await email_service._send("v@example.com", "s", "t", "h")

    resend_send.assert_not_called()


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
    assert "501(c)(3)" in html
    assert "501(c)(3)" in text
