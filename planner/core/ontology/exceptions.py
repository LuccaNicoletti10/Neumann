"""Exceptions for the planner ontology system."""

from __future__ import annotations


class OntologyError(Exception):
    """Base ontology error."""


class DuplicateDefinitionError(OntologyError):
    def __init__(self, kind: str, identifier: str) -> None:
        super().__init__(f"Duplicate {kind}: {identifier}")
        self.kind = kind
        self.identifier = identifier


class DefinitionNotFoundError(OntologyError):
    def __init__(self, kind: str, identifier: str) -> None:
        super().__init__(f"{kind} not found: {identifier}")
        self.kind = kind
        self.identifier = identifier


class OntologyValidationError(OntologyError):
    """Structural validation of ontology definitions failed."""

    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("; ".join(errors))


class ImmutableVersionError(OntologyError):
    def __init__(self, version_id: str) -> None:
        super().__init__(f"Published ontology version is immutable: {version_id}")
        self.version_id = version_id


class DuplicateParserError(OntologyError):
    def __init__(self, name: str) -> None:
        super().__init__(f"Parser already registered: {name}")
        self.name = name


class ParserNotRegisteredError(OntologyError):
    def __init__(self, name: str) -> None:
        super().__init__(f"Parser not registered: {name}")
        self.name = name


class DuplicateValidatorError(OntologyError):
    def __init__(self, name: str) -> None:
        super().__init__(f"Validator already registered: {name}")
        self.name = name


class ValidatorNotRegisteredError(OntologyError):
    def __init__(self, name: str) -> None:
        super().__init__(f"Validator not registered: {name}")
        self.name = name


class MappingError(OntologyError):
    """Schema mapping error."""


class IngestionError(OntologyError):
    """Row/dataset ingestion error."""


class QuarantineError(OntologyError):
    """Quarantine persistence error."""
