"""Tests for app/services/email_service.py.

Every other test stubs out _send (the autouse mock_send_email fixture), so
nothing else exercises the real Resend client setup.
"""
import resend


def test_resend_has_async_http_client():
    # _send uses resend.Emails.send_async, which needs httpx through the
    # resend[async] extra. Without it, resend leaves this as None and every
    # email fails with "No async HTTP client configured". httpx used to reach
    # production only as a test dependency, so dropping the extra broke email
    # in production while every test still passed.
    assert resend.default_async_http_client is not None
