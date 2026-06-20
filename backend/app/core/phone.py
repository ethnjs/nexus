from __future__ import annotations
from typing import Optional

import re


def normalize_phone(value: Optional[str]) -> Optional[str]:
    """
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
        return digits

    raise ValueError("Invalid US phone number format")

