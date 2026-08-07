"""Composite property parsing helpers."""

from __future__ import annotations

from typing import Any, Mapping

from ..models import ParserAttempt, PropertyTypeDefinition
from .registry import ParserRegistry


def parse_composite_components(
    raw_value: Any,
    property_def: PropertyTypeDefinition,
    parser_registry: ParserRegistry,
    args: Mapping[str, Any],
) -> ParserAttempt:
    """Delegate to regex_components and validate against property components."""
    attempt = parser_registry.get("regex_components")(raw_value, args)
    if not attempt.matched or attempt.error_code:
        return attempt

    if not isinstance(attempt.value, dict):
        return ParserAttempt(
            matched=True,
            error_code="INVALID_COMPOSITE",
            error_message="Composite parser must return a dict",
        )

    known = {c.name for c in property_def.components}
    for key in attempt.value:
        if known and key not in known:
            return ParserAttempt(
                matched=True,
                error_code="UNKNOWN_COMPONENT",
                error_message=f"Unknown component '{key}'",
            )

    for component in property_def.components:
        if component.required and component.name not in attempt.value:
            return ParserAttempt(
                matched=True,
                error_code="MISSING_COMPONENT",
                error_message=f"Required component '{component.name}' missing",
            )

    return attempt
