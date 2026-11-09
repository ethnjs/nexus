"""Tests for the real _send, which every other test stubs out. Nothing reaches Resend."""

import logging
from typing import Any
from unittest.mock import AsyncMock

import pytest
import resend

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
