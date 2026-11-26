from collections.abc import Mapping, Set
from typing import Any, get_args

from pydantic import AliasChoices, BaseModel
from pydantic.fields import FieldInfo

type Exclude = Mapping[str, Any] | Set[str]


def validate_requested[M: BaseModel](model: type[M], obj: object, exclude: Exclude | None) -> M:
    """`model.model_validate(obj)` that never reads the optional fields `exclude`
    drops, which keep their defaults. `exclude` has model_dump's shape, so the same
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
        found = _read(obj, _source_names(model, name, field))
        if found is None:
            continue
        key, value = found
        if isinstance(nested, (Mapping, Set)) and value is not None:
            sub = _model_of(field)
            if isinstance(value, (list, tuple)):
                value = [_attributes(sub, item, nested) for item in value]
            else:
                value = _attributes(sub, value, nested)
        data[key] = value
    return data


def _source_names(model: type[BaseModel], name: str, field: FieldInfo) -> tuple[str, ...]:
    """The attributes from_attributes would try for `field`, in order."""
    alias = field.validation_alias
    if alias is None:
        return (name,)
    if isinstance(alias, str):
        names: tuple[str, ...] = (alias,)
    elif isinstance(alias, AliasChoices) and all(isinstance(c, str) for c in alias.choices):
        names = tuple(choice for choice in alias.choices if isinstance(choice, str))
    else:
        # Guessing would read the wrong attribute and silently serialize the default.
        raise TypeError(f"validate_requested can't read {name!r} through {alias!r}")
    config = model.model_config
    if (config.get("populate_by_name") or config.get("validate_by_name")) and name not in names:
        names += (name,)
    return names


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
