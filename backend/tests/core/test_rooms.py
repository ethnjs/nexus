from app.core.rooms import derived_floor, room_sort_key


def test_rooms_sort_naturally():
    names = ["Lab", "B10", "b2", "210", "B2a"]
    assert sorted(names, key=room_sort_key) == ["210", "b2", "B2a", "B10", "Lab"]


def test_non_ascii_digits_sort_as_text():
    assert sorted(["²", "2", "B"], key=room_sort_key) == ["2", "B", "²"]
    assert room_sort_key("³⁴") == ((1, "³⁴"),)
    assert room_sort_key("٣01") == ((1, "٣"), (0, 1))


def test_derived_floor_reads_only_an_ascii_leading_digit():
    assert derived_floor(" 210 ") == "2"
    assert derived_floor("A12") is None
    assert derived_floor("²") is None
    assert derived_floor("٣01") is None
