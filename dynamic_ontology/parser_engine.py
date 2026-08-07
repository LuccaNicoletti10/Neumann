"""Parser engine that transforms input data using parser definitions (US7962495)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple
import re

from .core_types import (
    ParserDefinition,
    ParserSubDefinition,
    ParserType,
    PropertyType,
)


class ParserEngine:
    """
    Parser engine that transforms input data using parser definitions.
    Implements the Parser (102) from FIG. 1.
    """

    def __init__(self) -> None:
        self._regex_cache: Dict[str, re.Pattern[str]] = {}
        self._code_modules: Dict[str, Callable[..., Any]] = {}
        self._parse_history: List[Dict[str, Any]] = []

    def register_code_module(self, name: str, func: Callable[..., Any]) -> None:
        """Register a code module for use in parsers."""
        self._code_modules[name] = func

    def parse_with_parser(
        self, parser: ParserDefinition, input_data: str
    ) -> Optional[Dict[str, Any]]:
        """Parse input data using a specific parser definition."""
        result = parser.match(input_data)
        if result is not None:
            self._parse_history.append(
                {
                    "parser": parser.name,
                    "input": input_data[:100] + ("..." if len(input_data) > 100 else ""),
                    "result": result,
                    "timestamp": datetime.now().isoformat(),
                }
            )
        return result

    def parse_with_property_type(
        self, prop_type: PropertyType, input_data: str
    ) -> Optional[Dict[str, Any]]:
        """
        Parse input data using all parsers for a property type.
        Tries each parser in priority order until one matches.
        """
        result = prop_type.parse_input(input_data)
        if result is not None:
            self._parse_history.append(
                {
                    "property_type": prop_type.name,
                    "input": input_data[:100] + ("..." if len(input_data) > 100 else ""),
                    "result": result,
                    "timestamp": datetime.now().isoformat(),
                }
            )
        return result

    def parse_and_validate(
        self, prop_type: PropertyType, input_data: str
    ) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
        """
        Parse input data and validate the result.
        Returns (success, parsed_data, error_message).
        """
        parsed = self.parse_with_property_type(prop_type, input_data)
        if parsed is None:
            return False, None, f"No parser matched input: {input_data}"

        for component in prop_type.components:
            if component.name in parsed:
                value = parsed[component.name]
                if component.validator:
                    valid, msg = component.validator.validate(value)
                    if not valid:
                        return False, parsed, f"Validation failed for {component.name}: {msg}"

        return True, parsed, None

    def parse_data_row(
        self,
        row: Dict[str, Any],
        property_type_mapping: Dict[str, PropertyType],
    ) -> Dict[str, Any]:
        """
        Parse a row of data using property type mappings.
        mapping: input_field -> PropertyType
        """
        result: Dict[str, Any] = {}
        errors: List[Dict[str, Any]] = []

        for input_field, prop_type in property_type_mapping.items():
            if input_field not in row:
                continue

            raw_value = row[input_field]
            success, parsed, error = self.parse_and_validate(prop_type, str(raw_value))
            if success:
                result[prop_type.name] = parsed
            else:
                errors.append(
                    {
                        "field": input_field,
                        "value": raw_value,
                        "error": error,
                    }
                )

        return {"parsed_data": result, "errors": errors}

    def get_parse_history(self, limit: int = 100) -> List[Dict[str, Any]]:
        """Get the parse history."""
        return self._parse_history[-limit:]

    def clear_history(self) -> None:
        """Clear the parse history."""
        self._parse_history = []

    def create_regex_parser_from_pattern(
        self, pattern: str, sub_definitions: List[ParserSubDefinition]
    ) -> ParserDefinition:
        """
        Create a regular expression parser from a pattern and sub-definitions.
        Corresponds to creating a parser using the Parser Editor (FIG. 5A).
        """
        return ParserDefinition(
            name=f"regex_parser_{len(self._parse_history)}",
            parser_type=ParserType.REGULAR_EXPRESSION,
            expression_pattern=pattern,
            property_type_name="",
            sub_definitions=sub_definitions,
        )

    def create_code_parser_from_module(
        self, module_name: str, sub_definitions: List[ParserSubDefinition]
    ) -> ParserDefinition:
        """Create a code module parser from a registered module."""
        return ParserDefinition(
            name=f"code_parser_{module_name}",
            parser_type=ParserType.CODE_MODULE,
            expression_pattern=module_name,
            property_type_name="",
            sub_definitions=sub_definitions,
        )
