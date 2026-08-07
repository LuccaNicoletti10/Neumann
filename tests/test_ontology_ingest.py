"""Ontology registry and ingestion integration tests."""

from __future__ import annotations

import csv
from pathlib import Path
from uuid import uuid4

from planner.core.ingestion.result import IngestionContext
from planner.core.ingestion.service import IngestionService
from planner.core.mapping.executor import MappingExecutor
from planner.core.mapping.loader import load_schema_map
from planner.core.ontology.compatibility import analyze_compatibility
from planner.core.ontology.parsers.engine import ParserEngine
from planner.core.ontology.registry import OntologyRegistry
from planner.core.ontology.repository import OntologyRepository

ROOT = Path(__file__).resolve().parents[1]


def test_ontology_loads_product():
    reg = OntologyRegistry()
    snap = reg.load_client(
        "nicoletti",
        core_dir=ROOT / "config" / "core" / "ontology",
        version="1.0.0",
    )
    assert "Product" in snap.object_names
    prop = reg.get_property("Product", "unit", snap.version_id)
    assert len(prop.parsers) >= 1
    assert snap.checksum


def test_duplicate_object_detected(tmp_path: Path):
    from planner.core.ontology.exceptions import OntologyValidationError
    from planner.core.ontology.loader import OntologyLoader

    (tmp_path / "a.yaml").write_text(
        """
object:
  id: x.a
  name: Dup
  key_property: code
  active: true
properties:
  - id: x.a.code
    name: code
    type: string
    required: true
    parsers:
      - id: p1
        priority: 10
        matcher: {type: any_non_null}
        transform: strip
""",
        encoding="utf-8",
    )
    (tmp_path / "b.yaml").write_text(
        """
object:
  id: x.b
  name: Dup
  key_property: code
  active: true
properties:
  - id: x.b.code
    name: code
    type: string
    required: true
    parsers:
      - id: p2
        priority: 10
        matcher: {type: any_non_null}
        transform: strip
""",
        encoding="utf-8",
    )
    try:
        OntologyLoader().load_directory(tmp_path)
        assert False, "expected OntologyValidationError"
    except OntologyValidationError as exc:
        assert any("Duplicate object name" in e for e in exc.errors)


def test_ingest_products_fixture():
    reg = OntologyRegistry()
    snap = reg.load_client(
        "nicoletti",
        core_dir=ROOT / "config" / "core" / "ontology",
        version="1.0.0",
    )
    schema = load_schema_map(
        ROOT / "config" / "nicoletti" / "mappings" / "products.yaml",
        client="nicoletti",
    )
    assert MappingExecutor(reg).validate_map(schema, snap.version_id) == []

    service = IngestionService(
        ontology_registry=reg,
        parser_engine=ParserEngine(reg),
        repository=OntologyRepository(),
    )
    with (ROOT / "fixtures" / "nicoletti" / "produtos.csv").open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    report = service.ingest_rows(
        rows,
        schema,
        IngestionContext(
            client="nicoletti",
            run_id=str(uuid4()),
            ontology_version_id=snap.version_id,
            dataset="products",
            dry_run=True,
            max_error_rate=0.9,
        ),
    )
    assert report.accepted >= 4
    assert report.quarantined >= 1
    # invalid unit row quarantined
    assert any(not r.success for r in report.results)

    ok = next(r for r in report.results if r.success and r.object and r.object.key == "PROD001")
    unit_prop = reg.get_property("Product", "unit", snap.version_id)
    assert ok.object.properties[unit_prop.id].value == "kg"
    assert ok.object.properties[unit_prop.id].parser_definition_id == "product.unit.mapping"


def test_compatibility_add_property_non_breaking():
    reg = OntologyRegistry()
    left = reg.load_client(
        "nicoletti",
        core_dir=ROOT / "config" / "core" / "ontology",
        version="1.0.0",
        version_id="v1",
        publish=False,
    )
    right = reg.load_client(
        "nicoletti",
        core_dir=ROOT / "config" / "core" / "ontology",
        version="1.1.0",
        version_id="v2",
        publish=False,
    )
    report = analyze_compatibility(left, right)
    assert report.breaking is False
