"""Parser engine — property-centric parse → validate pipeline."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from ..exceptions import DefinitionNotFoundError
from ..models import ParseResult, ParseStatus, PropertyTypeDefinition
from ..validators.engine import ValidatorEngine
from .base import is_blank, matcher_matches
from .registry import ParserRegistry, get_default_parser_registry


def _coerce_canonical(data_type: str, value: Any) -> Any:
    if value is None:
        return None
    if data_type == "decimal" and not isinstance(value, Decimal):
        return Decimal(str(value))
    if data_type == "integer" and not isinstance(value, int):
        return int(value)
    if data_type == "boolean" and not isinstance(value, bool):
        return bool(value)
    return value


class OntologyAccessor:
    """Minimal protocol used by ParserEngine to resolve property definitions."""

    def get_property_by_id(
        self, property_type_id: str, version_id: str
    ) -> PropertyTypeDefinition: ...


class ParserEngine:
    def __init__(
        self,
        ontology_registry: OntologyAccessor,
        parser_registry: ParserRegistry | None = None,
        validator_engine: ValidatorEngine | None = None,
    ) -> None:
        self.ontology_registry = ontology_registry
        self.parser_registry = parser_registry or get_default_parser_registry()
        self.validator_engine = validator_engine or ValidatorEngine()

    def parse_property(
        self,
        property_type_id: str,
        raw_value: Any,
        ontology_version_id: str,
        *,
        parser_override: str | None = None,
    ) -> ParseResult:
        try:
            prop = self.ontology_registry.get_property_by_id(
                property_type_id, ontology_version_id
            )
        except DefinitionNotFoundError:
            return ParseResult(
                status=ParseStatus.INVALID,
                raw_value=raw_value,
                canonical_value=None,
                property_type_id=property_type_id,
                ontology_version_id=ontology_version_id,
                errors=(f"Unknown property type: {property_type_id}",),
            )

        # Null / blank handling
        if is_blank(raw_value):
            if prop.default is not None:
                default_value = _coerce_canonical(prop.data_type, prop.default)
                validation = self.validator_engine.validate(prop, default_value)
                if not validation.valid:
                    return ParseResult(
                        status=ParseStatus.INVALID,
                        raw_value=raw_value,
                        canonical_value=None,
                        property_type_id=property_type_id,
                        ontology_version_id=ontology_version_id,
                        errors=tuple(e.message for e in validation.errors),
                    )
                return ParseResult(
                    status=ParseStatus.DEFAULTED,
                    raw_value=raw_value,
                    canonical_value=default_value,
                    property_type_id=property_type_id,
                    ontology_version_id=ontology_version_id,
                )

            if prop.nullable and not prop.required:
                return ParseResult(
                    status=ParseStatus.NULL,
                    raw_value=raw_value,
                    canonical_value=None,
                    property_type_id=property_type_id,
                    ontology_version_id=ontology_version_id,
                )

            if prop.required:
                return ParseResult(
                    status=ParseStatus.INVALID,
                    raw_value=raw_value,
                    canonical_value=None,
                    property_type_id=property_type_id,
                    ontology_version_id=ontology_version_id,
                    errors=("Required value missing",),
                )

            return ParseResult(
                status=ParseStatus.NULL,
                raw_value=raw_value,
                canonical_value=None,
                property_type_id=property_type_id,
                ontology_version_id=ontology_version_id,
            )

        parsers = [p for p in prop.parsers if p.active]
        if parser_override:
            override = next((p for p in parsers if p.id == parser_override or p.transform == parser_override), None)
            parsers = [override] if override else []
        else:
            parsers = sorted(parsers, key=lambda p: p.priority)

        # If no parsers defined, accept identity + validate
        if not parsers:
            validation = self.validator_engine.validate(prop, raw_value)
            if not validation.valid:
                return ParseResult(
                    status=ParseStatus.INVALID,
                    raw_value=raw_value,
                    canonical_value=None,
                    property_type_id=property_type_id,
                    ontology_version_id=ontology_version_id,
                    errors=tuple(e.message for e in validation.errors),
                )
            return ParseResult(
                status=ParseStatus.MATCHED,
                raw_value=raw_value,
                canonical_value=raw_value,
                property_type_id=property_type_id,
                ontology_version_id=ontology_version_id,
                parser_id=None,
                parser_version=None,
            )

        for definition in parsers:
            if not matcher_matches(raw_value, definition.matcher):
                continue

            parser = self.parser_registry.get(definition.transform)
            attempt = parser(raw_value, definition.args)

            if not attempt.matched:
                continue

            if attempt.error_code:
                if definition.continue_on_invalid:
                    continue
                return ParseResult(
                    status=ParseStatus.INVALID,
                    raw_value=raw_value,
                    canonical_value=None,
                    property_type_id=property_type_id,
                    ontology_version_id=ontology_version_id,
                    parser_id=definition.id,
                    parser_version=definition.version,
                    errors=(attempt.error_message or attempt.error_code,),
                )

            validation = self.validator_engine.validate(prop, attempt.value)
            if not validation.valid:
                if definition.continue_on_invalid:
                    continue
                return ParseResult(
                    status=ParseStatus.INVALID,
                    raw_value=raw_value,
                    canonical_value=None,
                    property_type_id=property_type_id,
                    ontology_version_id=ontology_version_id,
                    parser_id=definition.id,
                    parser_version=definition.version,
                    errors=tuple(e.message for e in validation.errors),
                )

            return ParseResult(
                status=ParseStatus.MATCHED,
                raw_value=raw_value,
                canonical_value=attempt.value,
                property_type_id=property_type_id,
                ontology_version_id=ontology_version_id,
                parser_id=definition.id,
                parser_version=definition.version,
                warnings=tuple(w.message for w in validation.warnings),
            )

        return ParseResult(
            status=ParseStatus.NO_MATCH,
            raw_value=raw_value,
            canonical_value=None,
            property_type_id=property_type_id,
            ontology_version_id=ontology_version_id,
            errors=("NO_PARSER_MATCHED",),
        )
