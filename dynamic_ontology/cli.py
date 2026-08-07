"""CLI helpers for the Dynamic Ontology System (US7962495)."""

from __future__ import annotations

import json
from typing import Any

from .ontology import DynamicOntology
from .parser_engine import ParserEngine
from .sample_data import create_sample_ontology


def run_demo() -> int:
    """Run a headless demo of parse / validate / store."""
    ontology = create_sample_ontology()
    engine = ParserEngine()

    print("=== Dynamic Ontology Demo (US7962495) ===")
    print(f"Object types: {ontology.list_object_types()}")
    print(f"Property types: {ontology.list_property_types()}")
    print(f"Instances: {len(ontology.object_instances)}")
    print()

    name_prop = ontology.get_property_type("Name")
    assert name_prop is not None
    for sample in ["Smith, John", "Jane Doe", "Robert J. Johnson"]:
        ok, parsed, err = engine.parse_and_validate(name_prop, sample)
        print(f"Name parse '{sample}': ok={ok} result={parsed} err={err}")

    print()
    addr_prop = ontology.get_property_type("Address")
    assert addr_prop is not None
    for sample in [
        "123 Main St, Apt 4B, New York, NY 10001",
        "456 Oak Ave, Los Angeles, CA 90210",
    ]:
        ok, parsed, err = engine.parse_and_validate(addr_prop, sample)
        print(f"Address parse '{sample}': ok={ok} result={parsed} err={err}")

    print()
    print("--- Stored Person instances ---")
    for obj in ontology.get_object_instances_by_type("Person"):
        print(json.dumps(obj.to_dict(), indent=2, default=str))

    return 0


def export_sample(path: str) -> int:
    ontology = create_sample_ontology()
    with open(path, "w", encoding="utf-8") as f:
        f.write(ontology.to_json())
    print(f"Wrote ontology to {path}")
    return 0


def parse_file(path: str, object_type: str) -> int:
    ontology = create_sample_ontology()
    with open(path, "r", encoding="utf-8") as f:
        if path.endswith(".json"):
            data: Any = json.load(f)
            if isinstance(data, dict):
                data = [data]
        else:
            import csv

            data = list(csv.DictReader(f))

    results = ontology.parse_and_store_data(data, object_type)
    print(f"Parsed and stored {len(results)} {object_type} instances")
    for obj in results[:5]:
        print(json.dumps(obj.to_dict(), indent=2, default=str))
    if len(results) > 5:
        print(f"... and {len(results) - 5} more")
    return 0
