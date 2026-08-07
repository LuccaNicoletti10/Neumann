"""Immutable ontology definition models (US7962495-style dynamic ontology)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Mapping
from uuid import UUID


class ParseStatus(Enum):
    MATCHED = "matched"
    NO_MATCH = "no_match"
    INVALID = "invalid"
    DEFAULTED = "defaulted"
    NULL = "null"


class OntologyVersionStatus(Enum):
    DRAFT = "draft"
    VALIDATING = "validating"
    PUBLISHED = "published"
    DEPRECATED = "deprecated"
    REJECTED = "rejected"


class Cardinality(Enum):
    ONE = "one"
    MANY = "many"


@dataclass(frozen=True)
class PropertyComponentDefinition:
    name: str
    data_type: str
    required: bool = False
    default: Any = None
    position: int = 0


@dataclass(frozen=True)
class ParserSubDefinition:
    id: str
    parser_id: str
    source_pattern: str
    capture_group: str | int
    target_component: str
    transform: str | None = None
    required: bool = True
    default: Any = None


@dataclass(frozen=True)
class ParserDefinition:
    id: str
    property_type_id: str
    name: str
    parser_type: str
    priority: int
    matcher: Mapping[str, Any]
    transform: str
    args: Mapping[str, Any] = field(default_factory=dict)
    output_component: str | None = None
    continue_on_invalid: bool = False
    active: bool = True
    version: int = 1
    sub_definitions: tuple[ParserSubDefinition, ...] = ()


@dataclass(frozen=True)
class ValidatorDefinition:
    id: str
    property_type_id: str
    validator_type: str
    args: Mapping[str, Any] = field(default_factory=dict)
    error_code: str = "VALIDATION_FAILED"
    message: str = "Validation failed"
    severity: str = "error"
    position: int = 0


@dataclass(frozen=True)
class PropertyTypeDefinition:
    id: str
    object_type: str
    name: str
    data_type: str
    required: bool = False
    nullable: bool = True
    cardinality: str = "one"
    default: Any = None
    components: tuple[PropertyComponentDefinition, ...] = ()
    parsers: tuple[ParserDefinition, ...] = ()
    validators: tuple[ValidatorDefinition, ...] = ()
    active: bool = True
    description: str | None = None


@dataclass(frozen=True)
class LinkTypeDefinition:
    id: str
    name: str
    source_object_type: str
    target_object_type: str
    cardinality: str = "many"
    required: bool = False
    active: bool = True
    description: str | None = None


@dataclass(frozen=True)
class ObjectTypeDefinition:
    id: str
    name: str
    display_name: str
    key_property: str
    properties: tuple[str, ...] = ()
    links: tuple[str, ...] = ()
    description: str | None = None
    base_type: str | None = None
    active: bool = True


@dataclass(frozen=True)
class OntologySnapshot:
    """Immutable snapshot of a loaded ontology version."""

    version_id: str
    client: str
    semantic_version: str
    checksum: str
    objects: Mapping[str, ObjectTypeDefinition]
    properties: Mapping[str, PropertyTypeDefinition]
    links: Mapping[str, LinkTypeDefinition]
    # name indexes: object_name -> object_id, (object_name, prop_name) -> property_id
    object_names: Mapping[str, str]
    property_names: Mapping[tuple[str, str], str]


@dataclass(frozen=True)
class OntologyVersion:
    id: UUID
    client: str
    version: str
    checksum: str
    status: OntologyVersionStatus
    parent_version_id: UUID | None
    created_at: datetime
    created_by: str
    published_at: datetime | None = None
    definition: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ParserAttempt:
    matched: bool
    value: Any = None
    error_code: str | None = None
    error_message: str | None = None


@dataclass(frozen=True)
class ValidationError:
    code: str
    message: str
    path: str | None = None


@dataclass(frozen=True)
class ValidationWarning:
    code: str
    message: str
    path: str | None = None


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    errors: tuple[ValidationError, ...] = ()
    warnings: tuple[ValidationWarning, ...] = ()


@dataclass(frozen=True)
class ParseResult:
    status: ParseStatus
    raw_value: Any
    canonical_value: Any
    property_type_id: str
    ontology_version_id: str
    parser_id: str | None = None
    parser_version: int | None = None
    warnings: tuple[str, ...] = ()
    errors: tuple[str, ...] = ()

    @property
    def ok(self) -> bool:
        return self.status in {
            ParseStatus.MATCHED,
            ParseStatus.DEFAULTED,
            ParseStatus.NULL,
        }


@dataclass(frozen=True)
class CanonicalPropertyValue:
    property_type_id: str
    value: Any
    ontology_version_id: str
    parser_definition_id: str | None
    source_ref: str | None = None
    raw_value_hash: str | None = None
    parsed_at: datetime | None = None
    parser_version: int | None = None


@dataclass(frozen=True)
class CanonicalObject:
    object_type_id: str
    ontology_version_id: str
    key: str
    properties: Mapping[str, CanonicalPropertyValue]
    source_ref: str | None = None
    links: Mapping[str, tuple[str, ...]] = field(default_factory=dict)


def json_safe(value: Any) -> Any:
    """Convert values to JSON-serializable forms."""
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Mapping):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    return value


def model_to_dict(obj: Any) -> dict[str, Any]:
    return json_safe(asdict(obj))
