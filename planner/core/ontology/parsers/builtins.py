"""Built-in parsers — pure functions, no I/O, no client knowledge."""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping

from ..models import ParserAttempt

DECIMAL_BR_PATTERN = re.compile(r"^-?\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^-?\d+(?:,\d+)?$")
DECIMAL_US_PATTERN = re.compile(r"^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^-?\d+(?:\.\d+)?$")
DATE_BR_PATTERN = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")
ISO_DATE_PATTERN = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


def strip(raw_value: Any, args: Mapping[str, Any]) -> ParserAttempt:
    if raw_value is None:
        return ParserAttempt(matched=False)
    return ParserAttempt(matched=True, value=str(raw_value).strip())


def strip_upper(raw_value: Any, args: Mapping[str, Any]) -> ParserAttempt:
    if raw_value is None:
        return ParserAttempt(matched=False)
    return ParserAttempt(matched=True, value=str(raw_value).strip().upper())


def lowercase(raw_value: Any, args: Mapping[str, Any]) -> ParserAttempt:
    if raw_value is None:
        return ParserAttempt(matched=False)
    return ParserAttempt(matched=True, value=str(raw_value).strip().lower())


def parse_integer(raw_value: Any, args: Mapping[str, Any]) -> ParserAttempt:
    if raw_value is None:
        return ParserAttempt(matched=False)
    text = str(raw_value).strip()
    if not re.fullmatch(r"-?\d+", text):
        return ParserAttempt(matched=False)
    try:
        return ParserAttempt(matched=True, value=int(text))
    except ValueError:
        return ParserAttempt(
            matched=True,
            error_code="INVALID_INTEGER",
            error_message=f"Invalid integer: {text}",
        )


def parse_decimal_br(raw_value: Any, args: Mapping[str, Any]) -> ParserAttempt:
    if raw_value is None:
        return ParserAttempt(matched=False)

    text = str(raw_value).strip()
    if not DECIMAL_BR_PATTERN.fullmatch(text):
        return ParserAttempt(matched=False)

    normalized = text.replace(".", "").replace(",", ".")
    try:
        value = Decimal(normalized)
    except InvalidOperation:
        return ParserAttempt(
            matched=True,
            error_code="INVALID_DECIMAL",
            error_message=f"Invalid Brazilian decimal: {text}",
        )
    return ParserAttempt(matched=True, value=value)


def parse_decimal_us(raw_value: Any, args: Mapping[str, Any]) -> ParserAttempt:
    if raw_value is None:
        return ParserAttempt(matched=False)

    text = str(raw_value).strip()
    if not DECIMAL_US_PATTERN.fullmatch(text):
        return ParserAttempt(matched=False)

    normalized = text.replace(",", "")
    try:
        value = Decimal(normalized)
    except InvalidOperation:
        return ParserAttempt(
            matched=True,
            error_code="INVALID_DECIMAL",
            error_message=f"Invalid US decimal: {text}",
        )
    return ParserAttempt(matched=True, value=value)


def parse_date_br(raw_value: Any, args: Mapping[str, Any]) -> ParserAttempt:
    if raw_value is None:
        return ParserAttempt(matched=False)
    text = str(raw_value).strip()
    m = DATE_BR_PATTERN.fullmatch(text)
    if not m:
        return ParserAttempt(matched=False)
    day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return ParserAttempt(matched=True, value=date(year, month, day))
    except ValueError:
        return ParserAttempt(
            matched=True,
            error_code="INVALID_DATE",
            error_message=f"Invalid BR date: {text}",
        )


def parse_iso_date(raw_value: Any, args: Mapping[str, Any]) -> ParserAttempt:
    if raw_value is None:
        return ParserAttempt(matched=False)
    text = str(raw_value).strip()
    m = ISO_DATE_PATTERN.fullmatch(text)
    if not m:
        return ParserAttempt(matched=False)
    year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return ParserAttempt(matched=True, value=date(year, month, day))
    except ValueError:
        return ParserAttempt(
            matched=True,
            error_code="INVALID_DATE",
            error_message=f"Invalid ISO date: {text}",
        )


def parse_boolean(raw_value: Any, args: Mapping[str, Any]) -> ParserAttempt:
    if raw_value is None:
        return ParserAttempt(matched=False)
    if isinstance(raw_value, bool):
        return ParserAttempt(matched=True, value=raw_value)

    mapping = args.get(
        "mapping",
        {
            "true": True,
            "false": False,
            "1": True,
            "0": False,
            "yes": True,
            "no": False,
            "y": True,
            "n": False,
            "sim": True,
            "nao": False,
            "não": False,
            "s": True,
        },
    )
    case_insensitive = args.get("case_insensitive", True)
    text = str(raw_value).strip()
    key = text.casefold() if case_insensitive else text
    normalized = {
        (str(k).casefold() if case_insensitive else str(k)): v for k, v in mapping.items()
    }
    if key not in normalized:
        return ParserAttempt(matched=False)
    return ParserAttempt(matched=True, value=bool(normalized[key]))


def map_values(raw_value: Any, args: Mapping[str, Any]) -> ParserAttempt:
    if raw_value is None:
        return ParserAttempt(matched=False)

    mapping: Mapping[str, Any] = args.get("mapping", {})
    case_insensitive = bool(args.get("case_insensitive", False))
    text = str(raw_value).strip()
    lookup = text.casefold() if case_insensitive else text

    for src, dst in mapping.items():
        src_key = str(src).strip().casefold() if case_insensitive else str(src).strip()
        if lookup == src_key:
            return ParserAttempt(matched=True, value=dst)

    if args.get("passthrough_canonical"):
        allowed = list(mapping.values())
        if text in allowed:
            return ParserAttempt(matched=True, value=text)
        if case_insensitive:
            for v in allowed:
                if str(v).casefold() == text.casefold():
                    return ParserAttempt(matched=True, value=v)

    return ParserAttempt(matched=False)


def regex_extract(raw_value: Any, args: Mapping[str, Any]) -> ParserAttempt:
    if raw_value is None:
        return ParserAttempt(matched=False)
    pattern = args.get("pattern")
    if not pattern:
        return ParserAttempt(
            matched=True,
            error_code="MISSING_PATTERN",
            error_message="regex_extract requires args.pattern",
        )
    group = args.get("group", 1)
    text = str(raw_value)
    flags = re.IGNORECASE if args.get("case_insensitive") else 0
    m = re.search(pattern, text, flags)
    if not m:
        return ParserAttempt(matched=False)
    try:
        value = m.group(group)
    except IndexError:
        return ParserAttempt(
            matched=True,
            error_code="INVALID_GROUP",
            error_message=f"Capture group {group} not found",
        )
    return ParserAttempt(matched=True, value=value)


def regex_components(raw_value: Any, args: Mapping[str, Any]) -> ParserAttempt:
    """Parse a composite value into a dict of components."""
    if raw_value is None:
        return ParserAttempt(matched=False)

    pattern = args.get("pattern")
    components = args.get("components", [])
    if not pattern or not components:
        return ParserAttempt(
            matched=True,
            error_code="MISSING_ARGS",
            error_message="regex_components requires pattern and components",
        )

    text = str(raw_value)
    flags = re.IGNORECASE if args.get("case_insensitive") else 0
    m = re.fullmatch(pattern, text, flags)
    if not m:
        return ParserAttempt(matched=False)

    from .registry import get_default_parser_registry

    registry = get_default_parser_registry()
    result: dict[str, Any] = {}

    for comp in components:
        group = comp.get("group")
        target = comp.get("target")
        transform = comp.get("transform")
        required = bool(comp.get("required", True))
        default = comp.get("default")

        try:
            captured = m.group(group)
        except IndexError:
            captured = None

        if captured is None or captured == "":
            if required and default is None:
                return ParserAttempt(
                    matched=True,
                    error_code="MISSING_COMPONENT",
                    error_message=f"Required component '{target}' missing",
                )
            result[target] = default
            continue

        if transform:
            attempt = registry.get(transform)(captured, comp.get("args", {}))
            if not attempt.matched:
                return ParserAttempt(
                    matched=True,
                    error_code="COMPONENT_NO_MATCH",
                    error_message=f"Component '{target}' transform did not match",
                )
            if attempt.error_code:
                return ParserAttempt(
                    matched=True,
                    error_code=attempt.error_code,
                    error_message=attempt.error_message,
                )
            result[target] = attempt.value
        else:
            result[target] = captured

    return ParserAttempt(matched=True, value=result)


def normalize_unit(raw_value: Any, args: Mapping[str, Any]) -> ParserAttempt:
    default_mapping = {
        "KG": "kg",
        "KILO": "kg",
        "QL": "kg",
        "MT": "m",
        "M": "m",
        "METRO": "m",
        "UN": "unit",
        "PC": "unit",
        "PÇ": "unit",
    }
    merged = {**default_mapping, **dict(args.get("mapping", {}))}
    return map_values(
        raw_value,
        {
            "mapping": merged,
            "case_insensitive": args.get("case_insensitive", True),
            "passthrough_canonical": args.get("passthrough_canonical", True),
        },
    )


def identity(raw_value: Any, args: Mapping[str, Any]) -> ParserAttempt:
    if raw_value is None:
        return ParserAttempt(matched=False)
    return ParserAttempt(matched=True, value=raw_value)


BUILTIN_PARSERS = {
    "strip": strip,
    "strip_upper": strip_upper,
    "lowercase": lowercase,
    "parse_integer": parse_integer,
    "parse_decimal_br": parse_decimal_br,
    "parse_decimal_us": parse_decimal_us,
    "parse_date_br": parse_date_br,
    "parse_iso_date": parse_iso_date,
    "parse_boolean": parse_boolean,
    "map_values": map_values,
    "regex_extract": regex_extract,
    "regex_components": regex_components,
    "normalize_unit": normalize_unit,
    "identity": identity,
}
