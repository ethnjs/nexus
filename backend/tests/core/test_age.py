"""Tests for app/core/age.py — pure date arithmetic, no DB.

The whole point of these helpers is the off-by-one around a birthday, so the
cases that matter are the day before / day of / day after, plus the Feb 29
birthday that has no anniversary in a common year.
"""
from datetime import date

from app.core.age import calculate_age, meets_age_requirement


# ---------------------------------------------------------------------------
# calculate_age
# ---------------------------------------------------------------------------

def test_calculate_age_day_before_birthday_has_not_ticked_over():
    assert calculate_age(date(2000, 6, 15), date(2020, 6, 14)) == 19


def test_calculate_age_on_birthday_ticks_over():
    """Turning N on the reference date counts as N, not N-1."""
    assert calculate_age(date(2000, 6, 15), date(2020, 6, 15)) == 20


def test_calculate_age_day_after_birthday():
    assert calculate_age(date(2000, 6, 15), date(2020, 6, 16)) == 20


def test_calculate_age_earlier_month_same_day():
    """Month is compared before day — a later day in an earlier month is still younger."""
    assert calculate_age(date(2000, 6, 15), date(2020, 5, 31)) == 19


def test_calculate_age_same_day_is_zero():
    assert calculate_age(date(2020, 6, 15), date(2020, 6, 15)) == 0


def test_calculate_age_leap_day_birthday_in_common_year():
    """A Feb 29 birthday has no anniversary in 2021, so Feb 28 is still 20 and
    Mar 1 is 21 — the tuple comparison handles this without special-casing."""
    dob = date(2000, 2, 29)
    assert calculate_age(dob, date(2021, 2, 28)) == 20
    assert calculate_age(dob, date(2021, 3, 1)) == 21


# ---------------------------------------------------------------------------
# meets_age_requirement
# ---------------------------------------------------------------------------

def test_meets_age_requirement_exactly_on_birthday_passes():
    assert meets_age_requirement(date(2002, 6, 15), date(2020, 6, 15), 18) is True


def test_meets_age_requirement_day_before_18th_fails():
    assert meets_age_requirement(date(2002, 6, 15), date(2020, 6, 14), 18) is False


def test_meets_age_requirement_21_gate_independent_of_18():
    """Someone who is 19 clears the 18 gate but not the 21 gate."""
    dob, ref = date(2001, 6, 15), date(2020, 6, 15)
    assert meets_age_requirement(dob, ref, 18) is True
    assert meets_age_requirement(dob, ref, 21) is False
