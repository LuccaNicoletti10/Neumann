"""Data Integration Tool based on US8930897.

Ontology-driven transformation with proactive script validation.
"""

from .ontology import Ontology, OntologyParameter, EntityType
from .schema_map import SchemaMap, ObjectMapping, FieldMapping
from .object_model import ObjectModel, ObjectModelCollection, Property, Link
from .dsl_builder import DSLBuilder, GroovyStyleDSLBuilder, PythonStyleDSLBuilder, DSLBuilderFactory
from .transformation_engine import (
    TransformationEngine,
    TransformationScript,
    TransformationResult,
    ProactiveDebugger,
    CSVDataSource,
    JSONDataSource,
)

__all__ = [
    "Ontology",
    "OntologyParameter",
    "EntityType",
    "SchemaMap",
    "ObjectMapping",
    "FieldMapping",
    "ObjectModel",
    "ObjectModelCollection",
    "Property",
    "Link",
    "DSLBuilder",
    "GroovyStyleDSLBuilder",
    "PythonStyleDSLBuilder",
    "DSLBuilderFactory",
    "TransformationEngine",
    "TransformationScript",
    "TransformationResult",
    "ProactiveDebugger",
    "CSVDataSource",
    "JSONDataSource",
]

__version__ = "0.1.0"
