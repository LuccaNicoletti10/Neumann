"""Core data types for the dynamic ontology system (US7962495)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple
import re
import uuid


class BaseType(Enum):
    """Base types for property types."""

    STRING = "string"
    NUMBER = "number"
    DATE = "date"
    DATETIME = "datetime"
    BOOLEAN = "boolean"
    COMPOSITE = "composite"
    URI = "uri"
    EMAIL = "email"
    PHONE = "phone"
    ADDRESS = "address"


class ParserType(Enum):
    """Types of parsers."""

    REGULAR_EXPRESSION = "regular_expression"
    CODE_MODULE = "code_module"
    SCRIPT = "script"
    CHAINED = "chained"


class ValidatorType(Enum):
    """Types of validators."""

    REGEX = "regex"
    SET = "set"
    CODE = "code"
    RANGE = "range"
    CUSTOM = "custom"


@dataclass
class PropertyComponent:
    """A component of a property type (e.g., FirstName, LastName for Name)."""

    name: str
    base_type: BaseType
    description: Optional[str] = None
    validator: Optional[Validator] = None
    default_value: Optional[Any] = None
    is_required: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "base_type": self.base_type.value,
            "description": self.description,
            "validator": self.validator.to_dict() if self.validator else None,
            "default_value": self.default_value,
            "is_required": self.is_required,
        }


@dataclass
class Validator:
    """Validator for property types."""

    validator_type: ValidatorType
    value: Any  # regex pattern, set of values, range tuple, or code
    error_message: Optional[str] = None

    def validate(self, value: Any) -> Tuple[bool, Optional[str]]:
        """Validate a value against this validator."""
        if value is None or value == "":
            return True, None

        if self.validator_type == ValidatorType.REGEX:
            if re.match(self.value, str(value)):
                return True, None
            return False, self.error_message or f"Value '{value}' does not match pattern"

        if self.validator_type == ValidatorType.SET:
            if value in self.value:
                return True, None
            return False, self.error_message or f"Value '{value}' not in allowed set"

        if self.validator_type == ValidatorType.RANGE:
            min_val, max_val = self.value
            try:
                numeric = float(value) if not isinstance(value, (int, float)) else value
            except (TypeError, ValueError):
                return False, self.error_message or f"Value '{value}' is not numeric"
            if min_val <= numeric <= max_val:
                return True, None
            return False, self.error_message or f"Value '{value}' outside range [{min_val}, {max_val}]"

        if self.validator_type == ValidatorType.CODE:
            return True, None

        return True, None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "validator_type": self.validator_type.value,
            "value": self.value,
            "error_message": self.error_message,
        }


@dataclass
class ParserSubDefinition:
    """
    A sub-definition in a parser definition.
    Maps a part of the input (e.g., a regex group) to a property component.
    Corresponds to the mappings shown in FIG. 5A.
    """

    pattern: str  # The regex group or pattern
    property_component: str  # The property component name
    property_type_name: str  # The property type this belongs to
    default_value: Optional[Any] = None
    is_required: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "pattern": self.pattern,
            "property_component": self.property_component,
            "property_type_name": self.property_type_name,
            "default_value": self.default_value,
            "is_required": self.is_required,
        }


@dataclass
class ParserDefinition:
    """
    A parser definition for a property type.
    Contains the full transformation expression and sub-definitions.
    This is the Parser Definition shown in FIG. 5A.
    """

    name: str
    parser_type: ParserType
    expression_pattern: str  # Full regex or code identifier
    property_type_name: str  # The property type this parser is for
    sub_definitions: List[ParserSubDefinition] = field(default_factory=list)
    constraints: List[Validator] = field(default_factory=list)
    default_values: Dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.now)
    created_by: str = "system"
    is_active: bool = True
    priority: int = 0  # Lower = higher priority

    def match(self, input_data: str) -> Optional[Dict[str, Any]]:
        """
        Match input data against this parser.
        Returns a dict mapping component names to values if match succeeds.
        """
        if self.parser_type == ParserType.REGULAR_EXPRESSION:
            return self._match_regex(input_data)
        if self.parser_type == ParserType.CODE_MODULE:
            return self._match_code(input_data)
        return None

    def _match_regex(self, input_data: str) -> Optional[Dict[str, Any]]:
        """Match using regular expression."""
        try:
            match = re.match(self.expression_pattern, input_data)
            if not match:
                return None

            result: Dict[str, Any] = {}
            for sub_def in self.sub_definitions:
                value = None
                pattern = sub_def.pattern.lstrip("$")

                if pattern.isdigit():
                    group_index = int(pattern)
                    if match.lastindex is not None and group_index <= match.lastindex:
                        value = match.group(group_index)
                elif pattern in match.groupdict():
                    value = match.group(pattern)
                else:
                    try:
                        value = match.group(sub_def.pattern)
                    except (IndexError, ValueError):
                        value = None

                if value is None and sub_def.default_value is not None:
                    value = sub_def.default_value
                elif value is None and sub_def.property_component in self.default_values:
                    value = self.default_values[sub_def.property_component]

                result[sub_def.property_component] = value

            return result
        except Exception:
            return None

    def _match_code(self, input_data: str) -> Optional[Dict[str, Any]]:
        """
        Match using a code module.
        For demonstration, simulate by using the expression as a simple parser.
        """
        try:
            result: Dict[str, Any] = {}
            for sub_def in self.sub_definitions:
                if sub_def.pattern in input_data:
                    parts = input_data.split(sub_def.pattern)
                    if len(parts) > 1:
                        value = parts[1].strip().split(",")[0].strip()
                        result[sub_def.property_component] = value
                    else:
                        result[sub_def.property_component] = sub_def.default_value
                else:
                    result[sub_def.property_component] = sub_def.default_value

            if any(v is not None for v in result.values()):
                return result
            return None
        except Exception:
            return None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "parser_type": self.parser_type.value,
            "expression_pattern": self.expression_pattern,
            "property_type_name": self.property_type_name,
            "sub_definitions": [s.to_dict() for s in self.sub_definitions],
            "constraints": [c.to_dict() for c in self.constraints],
            "default_values": self.default_values,
            "created_at": self.created_at.isoformat(),
            "created_by": self.created_by,
            "is_active": self.is_active,
            "priority": self.priority,
        }


@dataclass
class ObjectType:
    """
    An object type in the ontology.
    This is an Object Type (110) from FIG. 1.
    """

    name: str
    display_name: str
    uri: str
    base_type: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)
    created_by: str = "system"
    is_active: bool = True
    property_types: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "display_name": self.display_name,
            "uri": self.uri,
            "base_type": self.base_type,
            "icon": self.icon,
            "description": self.description,
            "created_at": self.created_at.isoformat(),
            "created_by": self.created_by,
            "is_active": self.is_active,
            "property_types": self.property_types,
        }


@dataclass
class PropertyType:
    """
    A property type in the ontology.
    This is a Property Type (116) from FIG. 1.
    """

    name: str
    display_name: str
    base_type: BaseType
    components: List[PropertyComponent] = field(default_factory=list)
    validators: List[Validator] = field(default_factory=list)
    parser_definitions: List[ParserDefinition] = field(default_factory=list)
    icon: Optional[str] = None
    description: Optional[str] = None
    display_formatter: Optional[str] = None
    associated_words: List[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    created_by: str = "system"
    is_active: bool = True

    def add_parser(self, parser: ParserDefinition) -> None:
        """Add a parser definition to this property type."""
        parser.property_type_name = self.name
        self.parser_definitions.append(parser)

    def get_parsers_sorted(self) -> List[ParserDefinition]:
        """Get parsers sorted by priority."""
        return sorted(self.parser_definitions, key=lambda p: p.priority)

    def validate_value(self, value: Any) -> Tuple[bool, Optional[str]]:
        """Validate a value against all validators."""
        for validator in self.validators:
            valid, msg = validator.validate(value)
            if not valid:
                return False, msg
        return True, None

    def parse_input(self, input_data: str) -> Optional[Dict[str, Any]]:
        """
        Parse input data using all parsers for this property type.
        Returns the first successful parse result.
        """
        for parser in self.get_parsers_sorted():
            if not parser.is_active:
                continue
            result = parser.match(input_data)
            if result is None:
                continue

            # Validate each component; if any fail, try next parser
            failed = False
            for component in self.components:
                if component.name not in result:
                    continue
                val = result[component.name]
                if component.validator:
                    valid, _msg = component.validator.validate(val)
                    if not valid:
                        failed = True
                        break
            if not failed:
                return result
        return None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "display_name": self.display_name,
            "base_type": self.base_type.value,
            "components": [c.to_dict() for c in self.components],
            "validators": [v.to_dict() for v in self.validators],
            "parser_definitions": [p.to_dict() for p in self.parser_definitions],
            "icon": self.icon,
            "description": self.description,
            "display_formatter": self.display_formatter,
            "associated_words": self.associated_words,
            "created_at": self.created_at.isoformat(),
            "created_by": self.created_by,
            "is_active": self.is_active,
        }


@dataclass
class ObjectInstance:
    """
    An instance of an object type.
    This is an Object (112) from FIG. 1.
    """

    object_type: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    properties: Dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.now)
    created_by: str = "system"

    def add_property(self, property_name: str, value: Any) -> None:
        """Add a property value."""
        self.properties[property_name] = value

    def get_property(self, property_name: str) -> Optional[Any]:
        """Get a property value."""
        return self.properties.get(property_name)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "object_type": self.object_type,
            "properties": self.properties,
            "created_at": self.created_at.isoformat(),
            "created_by": self.created_by,
        }


@dataclass
class ObjectPropertyMapping:
    """
    Mapping from input data to object properties.
    This is the Object-Property Mapping (101) from FIG. 1.
    """

    object_type: str
    field_mappings: Dict[str, str]  # input_field -> property_name
    row_identifier: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "object_type": self.object_type,
            "field_mappings": self.field_mappings,
            "row_identifier": self.row_identifier,
            "created_at": self.created_at.isoformat(),
        }
