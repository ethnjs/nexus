import pytest

from app.core.discord import previews
from app.core.discord.build import Action, Plan, Target
from app.core.discord.previews import PreviewExpired, discord_summary, sign, verify

BIG_ID = 1_560_569_782_195_978_320


def test_round_trip():
    token = sign(12, True, Target("role", BIG_ID), "d540713227571429376")
    parsed = verify(token)
    assert parsed is not None
    assert (parsed.link_id, parsed.reset, parsed.target, parsed.actor) == (
        12,
        True,
        Target("role", BIG_ID),
        "d540713227571429376",
    )


def test_full_build_has_no_target():
    parsed = verify(sign(3, False, None, "u7"))
    assert parsed is not None and parsed.target is None and parsed.reset is False


@pytest.mark.parametrize(
    "change",
    [lambda t: t.replace("u7", "u8"), lambda t: t[:-1] + ("B" if t[-1] == "A" else "A")],
)
def test_tampering_is_rejected(change):
    assert verify(change(sign(3, False, None, "u7"))) is None


def test_garbage_is_rejected():
    assert verify("nonsense") is None


def test_expires_after_ten_minutes(monkeypatch):
    token = sign(3, False, None, "u7")
    now = previews.time.time()
    monkeypatch.setattr(previews.time, "time", lambda: now + previews.EXPIRY_SECONDS + 1)
    with pytest.raises(PreviewExpired):
        verify(token)


def test_fits_in_a_discord_custom_id():
    token = sign(999_999, True, Target("channel", BIG_ID), f"d{BIG_ID}")
    assert len("nexus:go:" + token) <= 100


def test_discord_summary_caps_each_group():
    plan = Plan(actions=[Action("Create", f"Role: {i}") for i in range(14)], warnings=["Careful"])
    text = discord_summary(plan, "Preview of /setup", "http://nexus/settings")
    assert text.startswith("**Preview of /setup**")
    assert "• Role: 9" in text
    assert "• Role: 10" not in text
    assert "…and 4 more" in text
    assert "**Warnings**\n• Careful" in text
    assert text.endswith("Full list in NEXUS: http://nexus/settings")


def test_discord_summary_stays_under_the_message_limit():
    plan = Plan(actions=[Action(group, "x" * 150) for group in ("Create", "Adopt") * 10])
    text = discord_summary(plan, "Preview", "http://nexus/settings")
    assert len(text) <= previews.DISCORD_MESSAGE_LIMIT
    assert text.endswith("Full list in NEXUS: http://nexus/settings")
