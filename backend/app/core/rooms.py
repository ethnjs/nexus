import re


def room_sort_key(name: str) -> tuple[tuple[int, int | str], ...]:
    """Natural order: "B2" < "B10" < "Lab". Digit runs compare as numbers."""
    return tuple(
        (0, int(part)) if part.isdigit() else (1, part)
        for part in re.split(r"(\d+)", name.casefold())
        if part
    )


def derived_floor(room_name: str) -> str | None:
    """Room numbers lead with the floor almost everywhere ("210" -> "2"); a
    name like "Lobby" or "A12" says nothing about the floor, so it has none."""
    name = room_name.strip()
    return name[0] if name[:1].isdigit() else None
