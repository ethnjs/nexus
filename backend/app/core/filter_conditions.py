from datetime import date
from typing import NoReturn

from fastapi import HTTPException, status

from app.schemas.tournament.display_config import FilterCondition, FilterGroup

FILTER_GROUP_OPS = frozenset({"and", "or"})
VALUELESS_OPS = frozenset({"empty", "not_empty"})
DATE_OPS = frozenset({"before", "after"})
FILTER_OPS = frozenset({"any_of", "none_of", "within_last"}) | VALUELESS_OPS | DATE_OPS


def _reject(detail: str) -> NoReturn:
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


def _validate_condition(condition: FilterCondition, known_fields: frozenset[str]) -> None:
    if condition.field not in known_fields:
        _reject(f"Unknown filter '{condition.field}'")
    if condition.op not in FILTER_OPS:
        _reject(f"Unknown filter operator '{condition.op}'")
    if condition.op in VALUELESS_OPS and condition.values:
        _reject(f"Filter operator '{condition.op}' takes no values")
    if condition.op in DATE_OPS:
        try:
            [value] = condition.values
            date.fromisoformat(value)
        except ValueError:
            _reject(f"Filter operator '{condition.op}' takes one ISO date")
    if condition.op == "within_last":
        if len(condition.values) != 1 or not condition.values[0].isdigit():
            _reject("Filter operator 'within_last' takes one whole number of days")


def validate_filter(group: FilterGroup, known_fields: frozenset[str]) -> None:
    """Rejects (422) a filter with unknown fields or operators, malformed
    values, or groups nested more than one level."""
    if group.op not in FILTER_GROUP_OPS:
        _reject(f"Unknown filter group operator '{group.op}'")
    for item in group.conditions:
        if isinstance(item, FilterCondition):
            _validate_condition(item, known_fields)
            continue
        if item.op not in FILTER_GROUP_OPS:
            _reject(f"Unknown filter group operator '{item.op}'")
        for condition in item.conditions:
            if not isinstance(condition, FilterCondition):
                _reject("Filter groups nest one level deep")
            else:
                _validate_condition(condition, known_fields)
