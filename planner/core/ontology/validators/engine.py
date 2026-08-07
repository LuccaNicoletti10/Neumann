"""Validator engine — decides whether a parsed value may enter the ontology."""

from __future__ import annotations

from typing import Any

from ..models import (
    PropertyTypeDefinition,
    ValidationError,
    ValidationResult,
    ValidatorDefinition,
)
from .registry import ValidatorRegistry, get_default_validator_registry


class ValidatorEngine:
    def __init__(self, registry: ValidatorRegistry | None = None) -> None:
        self.registry = registry or get_default_validator_registry()

    def validate(
        self,
        property_definition: PropertyTypeDefinition,
        value: Any,
    ) -> ValidationResult:
        errors: list[ValidationError] = []
        warnings: list = []

        # Always enforce declared data_type when value is present
        type_result = self.registry.get("data_type")(
            value,
            {"type": property_definition.data_type},
            property_definition,
        )
        if not type_result.valid:
            errors.extend(type_result.errors)

        for definition in sorted(property_definition.validators, key=lambda v: v.position):
            result = self._run(definition, value, property_definition)
            if not result.valid:
                if definition.severity == "warning":
                    warnings.extend(result.errors)
                else:
                    errors.extend(result.errors)

        # Composite completeness
        if property_definition.components and isinstance(value, dict):
            for component in property_definition.components:
                if component.required and (
                    component.name not in value or value[component.name] is None
                ):
                    errors.append(
                        ValidationError(
                            code="MISSING_COMPONENT",
                            message=f"Required component '{component.name}' missing",
                            path=component.name,
                        )
                    )

        return ValidationResult(
            valid=not errors,
            errors=tuple(errors),
            warnings=tuple(
                ValidationError(code=w.code, message=w.message, path=w.path)
                if isinstance(w, ValidationError)
                else w
                for w in warnings
            ),
        )

    def _run(
        self,
        definition: ValidatorDefinition,
        value: Any,
        property_definition: PropertyTypeDefinition,
    ) -> ValidationResult:
        validator = self.registry.get(definition.validator_type)
        result = validator(value, definition.args, property_definition)
        if not result.valid and definition.message:
            # Prefer configured message when present
            remapped = tuple(
                ValidationError(
                    code=definition.error_code or e.code,
                    message=definition.message or e.message,
                    path=e.path,
                )
                for e in result.errors
            )
            return ValidationResult(valid=False, errors=remapped, warnings=result.warnings)
        if not result.valid:
            remapped = tuple(
                ValidationError(
                    code=definition.error_code or e.code,
                    message=e.message,
                    path=e.path,
                )
                for e in result.errors
            )
            return ValidationResult(valid=False, errors=remapped, warnings=result.warnings)
        return result
