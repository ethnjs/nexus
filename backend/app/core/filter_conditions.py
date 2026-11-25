import re
from collections.abc import Callable
from datetime import date
from typing import NoReturn

from fastapi import HTTPException, status

from app.schemas.tournament.display_config import FilterCondition, FilterGroup

FILTER_GROUP_OPS = frozenset({"and", "or"})
VALUELESS_OPS = frozenset({"empty", "not_empty"})
DATE_OPS = frozenset({"before", "after"})
DAY_COUNT_OPS = frozenset({"within_last", "within_next"})
# A time-of-day range, ["HH:mm" or "", "HH:mm" or ""]: either end may be open.
TIME_RANGE_OPS = frozenset({"between"})
FILTER_OPS = (
    frozenset({"any_of", "all_of", "none_of"})
    | VALUELESS_OPS
    | DATE_OPS
    | DAY_COUNT_OPS
    | TIME_RANGE_OPS
)
_TIME_OF_DAY = re.compile(r"([01]\d|2[0-3]):[0-5]\d")


def _reject(detail: str) -> NoReturn:
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


ConditionCheck = Callable[[FilterCondition], str | None]


def _validate_condition(
    condition: FilterCondition, known_fields: frozenset[str], check: ConditionCheck | None
) -> None:
    if condition.field not in known_fields:
        _reject(f"Unknown filter '{condition.field}'")
    if check is not None and (problem := check(condition)):
        _reject(problem)
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
    if condition.op in DAY_COUNT_OPS:
        if len(condition.values) != 1 or not condition.values[0].isdigit():
            _reject(f"Filter operator '{condition.op}' takes one whole number of days")
    if condition.op in TIME_RANGE_OPS:
        values = condition.values
        if (
            len(values) != 2
            or not any(values)
            or not all(v == "" or _TIME_OF_DAY.fullmatch(v) for v in values)
        ):
            _reject(
                f"Filter operator '{condition.op}' takes a start and end time, one may be blank"
            )


def validate_filter(
    group: FilterGroup, known_fields: frozenset[str], check: ConditionCheck | None = None
) -> None:
    """Rejects (422) a filter with unknown fields or operators, malformed
    values, groups nested more than one level, or a condition `check` (the
    table's own rules) names a problem with."""
    if group.op not in FILTER_GROUP_OPS:
        _reject(f"Unknown filter group operator '{group.op}'")
    for item in group.conditions:
        if isinstance(item, FilterCondition):
            _validate_condition(item, known_fields, check)
            continue
        if item.op not in FILTER_GROUP_OPS:
            _reject(f"Unknown filter group operator '{item.op}'")
        for condition in item.conditions:
            if not isinstance(condition, FilterCondition):
                _reject("Filter groups nest one level deep")
            else:
                _validate_condition(condition, known_fields, check)
