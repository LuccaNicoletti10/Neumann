"""Built-in validators."""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Mapping

from ..models import PropertyTypeDefinition, ValidationError, ValidationResult


def _ok() -> ValidationResult:
    return ValidationResult(valid=True)


def _fail(code: str, message: str, path: str | None = None) -> ValidationResult:
    return ValidationResult(
        valid=False,
        errors=(ValidationError(code=code, message=message, path=path),),
    )


def required(
    value: Any,
    args: Mapping[str, Any],
    property_definition: PropertyTypeDefinition | None = None,
) -> ValidationResult:
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return _fail("REQUIRED", args.get("message", "Value is required"))
    return _ok()


def not_blank(
    value: Any,
    args: Mapping[str, Any],
    property_definition: PropertyTypeDefinition | None = None,
) -> ValidationResult:
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return _fail("NOT_BLANK", args.get("message", "Value must not be blank"))
    return _ok()


def data_type(
    value: Any,
    args: Mapping[str, Any],
    property_definition: PropertyTypeDefinition | None = None,
) -> ValidationResult:
    expected = args.get("type") or (property_definition.data_type if property_definition else None)
    if expected is None or value is None:
        return _ok()

    checks = {
        "string": lambda v: isinstance(v, str),
        "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
        "decimal": lambda v: isinstance(v, Decimal),
        "boolean": lambda v: isinstance(v, bool),
        "date": lambda v: isinstance(v, date) and not isinstance(v, datetime),
        "datetime": lambda v: isinstance(v, datetime),
        "enum": lambda v: isinstance(v, str),
        "object": lambda v: isinstance(v, dict),
    }
    checker = checks.get(expected)
    if checker and not checker(value):
        return _fail(
            "WRONG_TYPE",
            f"Expected {expected}, got {type(value).__name__}",
        )
    return _ok()


def allowed_values(
    value: Any,
    args: Mapping[str, Any],
    property_definition: PropertyTypeDefinition | None = None,
) -> ValidationResult:
    values = args.get("values", [])
    if value is None:
        return _ok()
    if value not in values:
        return _fail("NOT_ALLOWED", f"Value '{value}' not in allowed set")
    return _ok()


def regex(
    value: Any,
    args: Mapping[str, Any],
    property_definition: PropertyTypeDefinition | None = None,
) -> ValidationResult:
    if value is None:
        return _ok()
    pattern = args.get("pattern", "")
    if not re.fullmatch(pattern, str(value)):
        return _fail("REGEX", args.get("message", f"Value does not match {pattern}"))
    return _ok()


def min_value(
    value: Any,
    args: Mapping[str, Any],
    property_definition: PropertyTypeDefinition | None = None,
) -> ValidationResult:
    if value is None:
        return _ok()
    bound = Decimal(str(args["value"]))
    if Decimal(str(value)) < bound:
        return _fail("MIN_VALUE", f"Value {value} below minimum {bound}")
    return _ok()


def max_value(
    value: Any,
    args: Mapping[str, Any],
    property_definition: PropertyTypeDefinition | None = None,
) -> ValidationResult:
    if value is None:
        return _ok()
    bound = Decimal(str(args["value"]))
    if Decimal(str(value)) > bound:
        return _fail("MAX_VALUE", f"Value {value} above maximum {bound}")
    return _ok()


def decimal_scale(
    value: Any,
    args: Mapping[str, Any],
    property_definition: PropertyTypeDefinition | None = None,
) -> ValidationResult:
    if value is None:
        return _ok()
    scale = int(args.get("value", 0))
    dec = value if isinstance(value, Decimal) else Decimal(str(value))
    if dec.as_tuple().exponent < -scale:
        return _fail("DECIMAL_SCALE", f"More than {scale} decimal places")
    return _ok()


def min_length(
    value: Any,
    args: Mapping[str, Any],
    property_definition: PropertyTypeDefinition | None = None,
) -> ValidationResult:
    if value is None:
        return _ok()
    minimum = int(args["value"])
    if len(str(value)) < minimum:
        return _fail("MIN_LENGTH", f"Length below {minimum}")
    return _ok()


def max_length(
    value: Any,
    args: Mapping[str, Any],
    property_definition: PropertyTypeDefinition | None = None,
) -> ValidationResult:
    if value is None:
        return _ok()
    maximum = int(args["value"])
    if len(str(value)) > maximum:
        return _fail("MAX_LENGTH", f"Length above {maximum}")
    return _ok()


def date_range(
    value: Any,
    args: Mapping[str, Any],
    property_definition: PropertyTypeDefinition | None = None,
) -> ValidationResult:
    if value is None:
        return _ok()
    if not isinstance(value, date):
        return _fail("WRONG_TYPE", "Expected date")
    min_d = args.get("min")
    max_d = args.get("max")
    if min_d and value < date.fromisoformat(str(min_d)):
        return _fail("DATE_RANGE", f"Date before {min_d}")
    if max_d and value > date.fromisoformat(str(max_d)):
        return _fail("DATE_RANGE", f"Date after {max_d}")
    return _ok()


def reference_exists(
    value: Any,
    args: Mapping[str, Any],
    property_definition: PropertyTypeDefinition | None = None,
) -> ValidationResult:
    """Placeholder — actual existence checks belong to ingestion context."""
    known = args.get("known_keys")
    if known is None or value is None:
        return _ok()
    if value not in known:
        return _fail("REFERENCE", f"Referenced key '{value}' does not exist")
    return _ok()


def custom_rule(
    value: Any,
    args: Mapping[str, Any],
    property_definition: PropertyTypeDefinition | None = None,
) -> ValidationResult:
    """Only supports named built-in rules via args.rule — never eval/exec."""
    rule = args.get("rule")
    if rule == "positive":
        if value is not None and Decimal(str(value)) <= 0:
            return _fail("CUSTOM", "Value must be positive")
        return _ok()
    return _fail("UNKNOWN_CUSTOM_RULE", f"Unknown custom rule: {rule}")


BUILTIN_VALIDATORS = {
    "required": required,
    "not_blank": not_blank,
    "data_type": data_type,
    "allowed_values": allowed_values,
    "regex": regex,
    "min_value": min_value,
    "max_value": max_value,
    "decimal_scale": decimal_scale,
    "min_length": min_length,
    "max_length": max_length,
    "date_range": date_range,
    "reference_exists": reference_exists,
    "custom_rule": custom_rule,
}
