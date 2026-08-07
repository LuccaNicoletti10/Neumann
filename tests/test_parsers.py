"""Unit tests for built-in parsers."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from planner.core.ontology.parsers.builtins import (
    map_values,
    parse_date_br,
    parse_decimal_br,
    parse_decimal_us,
    strip,
)
from planner.core.ontology.parsers.registry import build_default_parser_registry


def test_parse_decimal_br():
    result = parse_decimal_br("1.234,56", {})
    assert result.matched
    assert result.value == Decimal("1234.56")


def test_parse_decimal_us():
    result = parse_decimal_us("1234.56", {})
    assert result.matched
    assert result.value == Decimal("1234.56")


def test_map_values_case_insensitive():
    result = map_values(
        "Ql",
        {
            "case_insensitive": True,
            "mapping": {"KG": "kg", "QL": "kg"},
        },
    )
    assert result.matched
    assert result.value == "kg"


def test_strip_spaces():
    assert strip("  abc  ", {}).value == "abc"


def test_parse_date_br():
    result = parse_date_br("31/12/2026", {})
    assert result.matched
    assert result.value == date(2026, 12, 31)


def test_invalid_not_silently_preserved():
    result = parse_decimal_br("not-a-number", {})
    assert not result.matched


def test_registry_has_builtins():
    registry = build_default_parser_registry()
    for name in (
        "strip",
        "strip_upper",
        "parse_decimal_br",
        "parse_decimal_us",
        "map_values",
        "regex_components",
        "normalize_unit",
    ):
        assert registry.has(name)
