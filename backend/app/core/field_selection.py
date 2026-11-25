from collections.abc import Mapping, Set
from typing import Any, get_args

from pydantic import AliasChoices, BaseModel
from pydantic.fields import FieldInfo

type Exclude = Mapping[str, Any] | Set[str]


def validate_requested[M: BaseModel](model: type[M], obj: object, exclude: Exclude | None) -> M:
    """`model.model_validate(obj)` that never reads the fields `exclude` drops,
    which keep their defaults. `exclude` has model_dump's shape, so the same
    value narrows both validation and the dump."""
    if exclude is None:
        return model.model_validate(obj)
    return model.model_validate(_attributes(model, obj, exclude))


def _attributes(model: type[BaseModel], obj: object, exclude: Exclude) -> dict[str, Any]:
    data: dict[str, Any] = {}
    for name, field in model.model_fields.items():
        nested = exclude.get(name) if isinstance(exclude, Mapping) else name in exclude or None
        # A required field can't fall back to a default, and is a column anyway.
        if nested is True and not field.is_required():
            continue
        found = _read(obj, _source_names(name, field))
        if found is None:
            continue
        key, value = found
        if isinstance(nested, (Mapping, Set)) and value is not None:
            value = _attributes(_model_of(field), value, nested)
        data[key] = value
    return data


def _source_names(name: str, field: FieldInfo) -> tuple[str, ...]:
    """The attributes from_attributes would try for `field`, in order."""
    alias = field.validation_alias
    if alias is None:
        return (name,)
    if isinstance(alias, str):
        return (alias,)
    if isinstance(alias, AliasChoices):
        names = tuple(choice for choice in alias.choices if isinstance(choice, str))
        if len(names) == len(alias.choices):
            return names
    # Guessing would read the wrong attribute and silently serialize the default.
    raise TypeError(f"validate_requested can't read {name!r} through {alias!r}")


def _read(obj: object, keys: tuple[str, ...]) -> tuple[str, Any] | None:
    for key in keys:
        try:
            return key, getattr(obj, key)
        except AttributeError:
            continue
    return None


def _model_of(field: FieldInfo) -> type[BaseModel]:
    for candidate in (field.annotation, *get_args(field.annotation)):
        if isinstance(candidate, type) and issubclass(candidate, BaseModel):
            return candidate
    raise TypeError(f"{field.annotation!r} has no nested model to narrow")
