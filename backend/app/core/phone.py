from __future__ import annotations

import re


def format_phone_us(value: str | None) -> str | None:
    """
    Normalize a phone string to '(###) ###-####' when it looks like a US number.

    Accepted inputs:
    - 10 digits: '9495551234', '(949)555-1234', '949-555-1234'
    - 11 digits starting with 1: '+1 949 555 1234'

    Returns:
    - Formatted US number when parseable
    - Trimmed original string when not parseable as US
    - None for null/blank input
    """
    if value is None:
        return None

    text = value.strip()
    if not text:
        return None

    digits = re.sub(r"\D", "", text)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]

    if len(digits) == 10:
        return f"({digits[0:3]}) {digits[3:6]}-{digits[6:10]}"

    return text

