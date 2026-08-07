"""Validator callable protocol."""

from __future__ import annotations

from typing import Any, Mapping, Protocol

from ..models import PropertyTypeDefinition, ValidationResult


class ValidatorCallable(Protocol):
    def __call__(
        self,
        value: Any,
        args: Mapping[str, Any],
        property_definition: PropertyTypeDefinition | None = None,
    ) -> ValidationResult: ...
