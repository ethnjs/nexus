"""Tests for app/core/config.py."""

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_production_refuses_to_start_without_an_email_key():
    with pytest.raises(ValidationError, match="RESEND_API_KEY"):
        Settings(_env_file=None, app_env="production", resend_api_key="")


def test_production_starts_with_an_email_key():
    assert Settings(_env_file=None, app_env="production", resend_api_key="re_test").resend_api_key


def test_development_starts_without_an_email_key():
    assert Settings(_env_file=None, app_env="development", resend_api_key="").resend_api_key == ""
