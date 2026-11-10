import re

# ASCII only, to match the frontend's roomFloor: \d alone also takes digits
# like "٣", and isdigit() takes "²", which int() rejects.
_DIGITS = re.compile(r"([0-9]+)")


def room_sort_key(name: str) -> tuple[tuple[int, int | str], ...]:
    """Natural order: "B2" < "B10" < "Lab". Digit runs compare as numbers."""
    return tuple(
        (0, int(part)) if index % 2 else (1, part)
        for index, part in enumerate(_DIGITS.split(name.casefold()))
        if part
    )


def derived_floor(room_name: str) -> str | None:
    """Room numbers lead with the floor almost everywhere ("210" -> "2"); a
    name like "Lobby" or "A12" says nothing about the floor, so it has none."""
    name = room_name.strip()
    return name[0] if _DIGITS.match(name) else None
