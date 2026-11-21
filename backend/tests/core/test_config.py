"""Tests for app/core/config.py."""

import pytest
from pydantic import ValidationError

from app.core.config import Settings


@pytest.mark.parametrize(
    ("access_key_id", "secret_access_key"), [("", ""), ("AKIA_TEST", ""), ("", "secret")]
)
def test_production_refuses_to_start_without_aws_keys(access_key_id, secret_access_key):
    with pytest.raises(ValidationError, match="AWS_ACCESS_KEY_ID"):
        Settings(
            _env_file=None,
            app_env="production",
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
        )


def test_production_starts_with_aws_keys():
    settings = Settings(
        _env_file=None,
        app_env="production",
        aws_access_key_id="AKIA_TEST",
        aws_secret_access_key="secret",
    )
    assert settings.aws_access_key_id


def test_development_starts_without_aws_keys():
    settings = Settings(
        _env_file=None, app_env="development", aws_access_key_id="", aws_secret_access_key=""
    )
    assert settings.aws_access_key_id == ""
