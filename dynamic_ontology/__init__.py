"""Dynamic Ontology System based on US7962495.

Creating data in a data store using a dynamic ontology with
parser definitions, composite property types, and validators.
"""

from .core_types import (
    BaseType,
    ParserType,
    ValidatorType,
    PropertyComponent,
    Validator,
    ParserSubDefinition,
    ParserDefinition,
    ObjectType,
    PropertyType,
    ObjectInstance,
    ObjectPropertyMapping,
)
from .ontology import DynamicOntology
from .parser_engine import ParserEngine

__all__ = [
    "BaseType",
    "ParserType",
    "ValidatorType",
    "PropertyComponent",
    "Validator",
    "ParserSubDefinition",
    "ParserDefinition",
    "ObjectType",
    "PropertyType",
    "ObjectInstance",
    "ObjectPropertyMapping",
    "DynamicOntology",
    "ParserEngine",
]

__version__ = "0.1.0"
