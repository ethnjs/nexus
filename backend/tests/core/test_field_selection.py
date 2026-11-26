from types import SimpleNamespace

import pytest
from pydantic import AliasChoices, AliasPath, BaseModel, ConfigDict, Field

from app.core.field_selection import validate_requested


class _Row(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    names: list[str] = Field(default=[], validation_alias=AliasChoices("missing", "labels"))


def test_alias_choices_fall_through_to_the_next_attribute():
    """from_attributes tries each choice in order; stopping at the first
    missing one would serialize the default instead of the value."""
    row = validate_requested(_Row, SimpleNamespace(id=1, labels=["a"]), set())
    assert row.names == ["a"]


def test_populate_by_name_falls_back_to_the_field_name():
    class ByName(BaseModel):
        model_config = ConfigDict(from_attributes=True, populate_by_name=True)

        roles: list[str] = Field(default=[], validation_alias="held_roles")

    assert validate_requested(ByName, SimpleNamespace(roles=["a"]), set()).roles == ["a"]


def test_nested_exclude_narrows_each_item_of_a_list():
    class Parent(BaseModel):
        model_config = ConfigDict(from_attributes=True)

        rows: list[_Row] = []

    obj = SimpleNamespace(rows=[SimpleNamespace(id=1, labels=["a"]), SimpleNamespace(id=2)])
    parent = validate_requested(Parent, obj, {"rows": {"names"}})
    assert [(row.id, row.names) for row in parent.rows] == [(1, []), (2, [])]


def test_an_alias_it_cannot_follow_fails_instead_of_defaulting():
    class Nested(BaseModel):
        model_config = ConfigDict(from_attributes=True)

        id: int
        city: str | None = Field(default=None, validation_alias=AliasPath("address", "city"))

    obj = SimpleNamespace(id=1, address={"city": "Irvine"})
    with pytest.raises(TypeError, match="city"):
        validate_requested(Nested, obj, set())
