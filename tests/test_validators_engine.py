"""Validator and parser engine integration tests."""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

from planner.core.ontology.models import ParseStatus
from planner.core.ontology.parsers.engine import ParserEngine
from planner.core.ontology.registry import OntologyRegistry
from planner.core.ontology.validators.builtins import allowed_values, max_value, min_value
from planner.core.ontology.validators.engine import ValidatorEngine

ROOT = Path(__file__).resolve().parents[1]


def _registry() -> tuple[OntologyRegistry, str]:
    reg = OntologyRegistry()
    snap = reg.load_client(
        "nicoletti",
        core_dir=ROOT / "config" / "core" / "ontology",
        overrides_path=ROOT / "config" / "nicoletti" / "ontology_overrides.yaml",
        version="1.0.0",
    )
    return reg, snap.version_id


def test_min_max_validators():
    assert min_value(Decimal("0.5"), {"value": 0}, None).valid
    assert not max_value(Decimal("1.2"), {"value": 1}, None).valid
    assert not allowed_values("ton", {"values": ["kg", "m"]}, None).valid


def test_unit_parse_ql_to_kg():
    reg, vid = _registry()
    engine = ParserEngine(reg)
    prop = reg.get_property("Product", "unit", vid)
    result = engine.parse_property(prop.id, "QL", vid)
    assert result.status == ParseStatus.MATCHED
    assert result.canonical_value == "kg"
    assert result.parser_id == "product.unit.mapping"


def test_efficiency_style_rejection():
    """1,2 parses as decimal then fails max_value-style validator on unit enum."""
    reg, vid = _registry()
    engine = ParserEngine(reg)
    prop = reg.get_property("Product", "min_stock", vid)
    result = engine.parse_property(prop.id, "-1", vid)
    # -1 matches decimal parsers but fails min_value >= 0
    assert result.status == ParseStatus.INVALID


def test_required_blank_fails():
    reg, vid = _registry()
    engine = ParserEngine(reg)
    prop = reg.get_property("Product", "sku", vid)
    result = engine.parse_property(prop.id, "  ", vid)
    assert result.status == ParseStatus.INVALID


def test_default_applied():
    reg, vid = _registry()
    engine = ParserEngine(reg)
    prop = reg.get_property("Product", "min_stock", vid)
    result = engine.parse_property(prop.id, "", vid)
    assert result.status == ParseStatus.DEFAULTED
    assert result.canonical_value == Decimal("0")


def test_parser_priority_br_before_us():
    reg, vid = _registry()
    engine = ParserEngine(reg)
    prop = reg.get_property("Product", "cost", vid)
    result = engine.parse_property(prop.id, "1.234,56", vid)
    assert result.ok
    assert result.canonical_value == Decimal("1234.56")
    assert result.parser_id == "product.cost.br"
