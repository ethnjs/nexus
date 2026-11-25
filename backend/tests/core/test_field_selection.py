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


def test_an_alias_it_cannot_follow_fails_instead_of_defaulting():
    class Nested(BaseModel):
        model_config = ConfigDict(from_attributes=True)

        id: int
        city: str | None = Field(default=None, validation_alias=AliasPath("address", "city"))

    obj = SimpleNamespace(id=1, address={"city": "Irvine"})
    with pytest.raises(TypeError, match="city"):
        validate_requested(Nested, obj, set())
