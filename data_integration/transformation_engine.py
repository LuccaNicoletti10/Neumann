"""Transformation script engine with proactive debugging."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Generator, List, Optional
import csv
import json
import re
import uuid

from .dsl_builder import DSLBuilder, DSLBuilderFactory
from .object_model import Link, ObjectModel, ObjectModelCollection
from .ontology import Ontology
from .schema_map import ObjectMapping, SchemaMap


@dataclass
class TransformationResult:
    """Result of a transformation operation."""

    success: bool
    objects_created: int = 0
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    debug_info: Dict[str, Any] = field(default_factory=dict)


class DataSource(ABC):
    """Abstract base class for data sources."""

    @abstractmethod
    def get_data(self) -> Generator[Dict[str, Any], None, None]:
        """Get data items from the source."""

    @abstractmethod
    def get_schema(self) -> Dict[str, Any]:
        """Get the schema of the data source."""


class CSVDataSource(DataSource):
    """CSV file data source."""

    def __init__(
        self,
        filepath: str,
        delimiter: str = ",",
        has_header: bool = True,
    ) -> None:
        self.filepath = filepath
        self.delimiter = delimiter
        self.has_header = has_header
        self._header: List[str] = []
        self._schema: Dict[str, Any] = {}

    def get_data(self) -> Generator[Dict[str, Any], None, None]:
        """Get rows from CSV as dictionaries."""
        with open(self.filepath, "r", newline="", encoding="utf-8") as f:
            reader = csv.reader(f, delimiter=self.delimiter)

            if self.has_header:
                self._header = next(reader)
                self._schema = {
                    "fields": [
                        {"name": col, "type": "string"} for col in self._header
                    ],
                    "row_count": 0,
                }

            row_count = 0
            for row in reader:
                if self.has_header:
                    data = dict(zip(self._header, row))
                else:
                    data = {f"col_{i}": value for i, value in enumerate(row)}

                row_count += 1
                yield data

            if self._schema:
                self._schema["row_count"] = row_count

    def get_schema(self) -> Dict[str, Any]:
        """Get the CSV schema."""
        if not self._schema:
            try:
                with open(self.filepath, "r", newline="", encoding="utf-8") as f:
                    reader = csv.reader(f, delimiter=self.delimiter)
                    if self.has_header:
                        self._header = next(reader)
                        self._schema = {
                            "fields": [
                                {"name": col, "type": "string"}
                                for col in self._header
                            ]
                        }
            except Exception:
                self._schema = {"fields": []}

        return self._schema


class JSONDataSource(DataSource):
    """JSON data source."""

    def __init__(self, filepath: str, key: Optional[str] = None) -> None:
        self.filepath = filepath
        self.key = key
        self._data: List[Dict[str, Any]] = []
        self._schema: Dict[str, Any] = {}

    def get_data(self) -> Generator[Dict[str, Any], None, None]:
        """Get items from JSON."""
        with open(self.filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

            if isinstance(data, list):
                items = data
            elif isinstance(data, dict) and self.key:
                items = data.get(self.key, [])
            elif isinstance(data, dict):
                items = [data]
            else:
                items = []

            self._data = items
            yield from items

    def get_schema(self) -> Dict[str, Any]:
        """Get the JSON schema."""
        if not self._schema:
            if not self._data:
                # Trigger a read so schema can be inferred.
                list(self.get_data())
            first_item = self._data[0] if self._data else {}
            self._schema = {
                "fields": [
                    {"name": key, "type": "string"} for key in first_item.keys()
                ],
                "total_items": len(self._data),
            }
        return self._schema


class Condition:
    """Represents a condition in a transformation script."""

    def __init__(self, expression: str, condition_type: str = "if") -> None:
        self.expression = expression
        self.type = condition_type
        self._parsed = self._parse_expression()

    def _parse_expression(self) -> Dict[str, Any]:
        """Parse the condition expression."""
        result: Dict[str, Any] = {"variables": [], "operators": []}

        var_pattern = r"\b([a-zA-Z_][a-zA-Z0-9_]*)\b"
        matches = re.findall(var_pattern, self.expression)

        keywords = {"true", "false", "null", "undefined", "NaN", "and", "or", "not"}
        result["variables"] = [m for m in matches if m not in keywords]

        operator_pattern = r"(==|!=|<=|>=|<|>|&&|\|\||!)"
        result["operators"] = re.findall(operator_pattern, self.expression)

        return result

    def get_variables(self) -> List[str]:
        """Get all variables used in the condition."""
        return self._parsed["variables"]

    def evaluate(self, context: Dict[str, Any]) -> bool:
        """Evaluate the condition in the given context."""
        try:
            expr = self.expression
            # Replace longer names first to avoid partial replacements.
            for var in sorted(self._parsed["variables"], key=len, reverse=True):
                if var in context:
                    value = context[var]
                    if isinstance(value, str):
                        expr = re.sub(rf"\b{re.escape(var)}\b", f"'{value}'", expr)
                    else:
                        expr = re.sub(rf"\b{re.escape(var)}\b", str(value), expr)

            expr = expr.replace("&&", " and ").replace("||", " or ")
            return bool(eval(expr, {"__builtins__": {}}, {}))
        except Exception:
            return False


class TransformationScript:
    """Represents a transformation script."""

    def __init__(self, name: str, script_content: str) -> None:
        self.name = name
        self.content = script_content
        self.conditions: List[Condition] = []
        self.builders: List[Dict[str, Any]] = []
        self._parse_script()

    def _parse_script(self) -> None:
        """Parse the script content to extract conditions and builders."""
        condition_pattern = r"(if|while)\s*\(([^)]+)\)"
        matches = re.findall(condition_pattern, self.content)
        for match in matches:
            self.conditions.append(Condition(match[1], match[0]))

        builder_pattern = r"(?:builder|DSLBuilder)\.(\w+)\s*\(([^)]*)\)"
        matches = re.findall(builder_pattern, self.content)
        for match in matches:
            self.builders.append(
                {
                    "method": match[0],
                    "params": match[1],
                }
            )

    def get_conditions(self) -> List[Condition]:
        """Get all conditions in the script."""
        return self.conditions

    def get_builders(self) -> List[Dict[str, Any]]:
        """Get all builder definitions."""
        return self.builders


class LinkBuilder:
    """Represents a link builder in a transform method."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.link_type: Optional[str] = None
        self.aggregate: bool = False

    def build_link(
        self,
        from_object: ObjectModel,
        to_object: ObjectModel,
        properties: Optional[Dict[str, Any]] = None,
    ) -> Link:
        """Build a link between two objects."""
        if self.link_type is None:
            self.link_type = (
                f"link_{from_object.object_type}_{to_object.object_type}"
            )

        return Link(
            id=str(uuid.uuid4()),
            link_type=self.link_type,
            from_object_id=from_object.id,
            to_object_id=to_object.id,
            properties=properties or {},
        )


class ContentProcessor:
    """Processes content during transformation."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.processors: List[Callable] = []

    def process_row(
        self,
        row: Dict[str, Any],
        builder: DSLBuilder,
    ) -> Optional[ObjectModel]:
        """Process a row of data."""
        return builder.build(row)

    def add_processor(self, processor: Callable) -> None:
        """Add a processor function."""
        self.processors.append(processor)


class TransformMethod:
    """Represents a transform method in a script."""

    def __init__(self, name: str, code: str) -> None:
        self.name = name
        self.code = code
        self.link_builders: List[LinkBuilder] = []
        self.content_processors: List[ContentProcessor] = []
        self._parse_method()

    def _parse_method(self) -> None:
        """Parse the transform method."""
        link_pattern = r"linkBuilder\s*=\s*(\w+)"
        matches = re.findall(link_pattern, self.code)
        for match in matches:
            self.link_builders.append(LinkBuilder(match))

        processor_pattern = r"contentProcessor\s*=\s*(\w+)"
        matches = re.findall(processor_pattern, self.code)
        for match in matches:
            self.content_processors.append(ContentProcessor(match))


class TransformationEngine:
    """Main transformation engine."""

    def __init__(self, ontology: Ontology, schema_map: SchemaMap) -> None:
        self.ontology = ontology
        self.schema_map = schema_map
        self.collection = ObjectModelCollection()
        self.debug_mode: bool = False
        self.validation_errors: List[str] = []
        self.validation_warnings: List[str] = []

    def set_debug_mode(self, enabled: bool) -> None:
        """Enable or disable debug mode."""
        self.debug_mode = enabled

    def transform_data_source(
        self,
        source: DataSource,
        source_type: str,
        target_object_type: Optional[str] = None,
    ) -> TransformationResult:
        """Transform data from a source."""
        result = TransformationResult(success=True)

        mappings = self.schema_map.get_mapping_for_source(
            source_type, target_object_type
        )

        if not mappings:
            result.errors.append(f"No mapping found for source type '{source_type}'")
            result.success = False
            return result

        builder = DSLBuilderFactory.create_builder(
            "groovy", self.ontology, self.collection
        )

        row_count = 0
        for row in source.get_data():
            row_count += 1

            for mapping in mappings:
                mapped_data = self._apply_field_mappings(row, mapping)

                if mapping.filter_condition:
                    condition = Condition(mapping.filter_condition)
                    # Evaluate against source row + mapped fields (e.g. _record_type).
                    if not condition.evaluate({**row, **mapped_data}):
                        continue

                obj = builder.build(mapped_data)

                if obj:
                    result.objects_created += 1
                    if self.debug_mode:
                        result.debug_info[f"row_{row_count}"] = {
                            "object_id": obj.id,
                            "object_type": obj.object_type,
                        }
                else:
                    result.warnings.append(
                        f"Row {row_count}: Failed to build object"
                    )
                    result.warnings.extend(builder.validation_warnings)
                    result.errors.extend(builder.validation_errors)
                    result.success = False

        return result

    def _apply_field_mappings(
        self,
        row: Dict[str, Any],
        mapping: ObjectMapping,
    ) -> Dict[str, Any]:
        """Apply field mappings to a row."""
        # Keep object_type reserved so a property named "type" cannot overwrite it.
        mapped_data: Dict[str, Any] = {
            "type": mapping.target_object,
            "object_type": mapping.target_object,
        }

        for field_map in mapping.field_mappings:
            source_value = row.get(field_map.source_field)

            if source_value is None and field_map.default_value is not None:
                source_value = field_map.default_value
            elif source_value == "" and field_map.default_value is not None:
                source_value = field_map.default_value

            if field_map.transformation:
                source_value = self._apply_transformation(
                    source_value, field_map.transformation
                )

            target = field_map.target_property
            if target == "type":
                # Ontology property "type" (e.g. Organization.type)
                mapped_data["org_type"] = source_value
                mapped_data["type"] = mapping.target_object
            else:
                mapped_data[target] = source_value

        return mapped_data

    def _apply_transformation(self, value: Any, transformation: str) -> Any:
        """Apply a transformation to a value."""
        if transformation == "uppercase":
            return str(value).upper() if value else value
        if transformation == "lowercase":
            return str(value).lower() if value else value
        if transformation == "trim":
            return str(value).strip() if value else value
        if transformation.startswith("substring:"):
            parts = transformation.split(":")
            if len(parts) >= 2 and isinstance(value, str):
                try:
                    start = int(parts[1])
                    end = int(parts[2]) if len(parts) > 2 else None
                    return value[start:end] if end else value[start:]
                except ValueError:
                    return value
        if transformation == "parse_int":
            try:
                return int(value)
            except (ValueError, TypeError):
                return value
        if transformation == "parse_float":
            try:
                return float(value)
            except (ValueError, TypeError):
                return value
        return value

    def execute_script(
        self,
        script: TransformationScript,
        data_source: DataSource,
        source_type: str = "csv",
        target_object_type: Optional[str] = None,
    ) -> TransformationResult:
        """Execute a transformation script (or mapped transform as fallback)."""
        # Prefer schema-map driven transform when mappings exist.
        mappings = self.schema_map.get_mapping_for_source(
            source_type, target_object_type
        )
        if mappings:
            return self.transform_data_source(
                data_source, source_type, target_object_type
            )

        result = TransformationResult(success=True)
        builder = DSLBuilderFactory.create_builder(
            "groovy", self.ontology, self.collection
        )

        for row in data_source.get_data():
            builders = script.get_builders()
            if builders:
                for builder_def in builders:
                    method_name = builder_def.get("method")
                    if method_name in {"build", "person", "organization", "event"}:
                        if "type" not in row and method_name != "build":
                            mapped = {"type": method_name.capitalize(), **row}
                            if method_name == "person":
                                mapped["type"] = "Person"
                            elif method_name == "organization":
                                mapped["type"] = "Organization"
                            obj = builder.build(mapped)
                        else:
                            obj = builder.build(row)

                        if obj:
                            result.objects_created += 1
                        else:
                            result.errors.extend(builder.validation_errors)
                            result.warnings.extend(builder.validation_warnings)
                            result.success = False
            else:
                # Best-effort: treat each row as typed data if present.
                obj = builder.build(row)
                if obj:
                    result.objects_created += 1
                else:
                    result.errors.extend(builder.validation_errors)
                    result.warnings.extend(builder.validation_warnings)
                    result.success = False

        return result

    def validate_script(self, script: TransformationScript) -> bool:
        """Validate a transformation script without executing it."""
        valid = True
        self.validation_errors.clear()
        self.validation_warnings.clear()

        # Locals / receivers commonly used in sample Groovy scripts.
        ignored_identifiers = {
            "row",
            "data",
            "it",
            "person",
            "org",
            "organization",
            "call",
            "caller",
            "receiver",
            "builder",
            "linkbuilder",
            "contentprocessor",
            "datasource",
            "csvsource",
            "true",
            "false",
            "null",
        }

        ontology_properties = {
            prop_info["name"]
            for prop_info in self.ontology.properties.values()
            if "name" in prop_info
        }
        ontology_objects_lower = {name.lower() for name in self.ontology.objects}

        for condition in script.get_conditions():
            # Prefer dotted property access: row.email -> email
            dotted = re.findall(
                r"\b[a-zA-Z_][a-zA-Z0-9_]*\.([a-zA-Z_][a-zA-Z0-9_]*)\b",
                condition.expression,
            )
            candidates = dotted or [
                var
                for var in condition.get_variables()
                if var.lower() not in ignored_identifiers
                and var.lower() not in ontology_objects_lower
            ]

            for var in candidates:
                if var.lower() in ignored_identifiers:
                    continue
                if var in ontology_properties:
                    continue
                # Source-field checks (e.g. row.organization) are warnings;
                # they may be valid for the data source even if not ontology props.
                self.validation_warnings.append(
                    f"Identifier '{var}' is not an ontology property"
                )

        for builder_def in script.get_builders():
            method = builder_def.get("method", "")
            # builder.person(...) / builder.organization(...)
            if method and method.lower() in ontology_objects_lower:
                continue
            if method.lower() in {
                "person",
                "organization",
                "event",
                "location",
                "phonecall",
            }:
                if method.lower() not in ontology_objects_lower and self.ontology.objects:
                    self.validation_errors.append(
                        f"Invalid object type '{method}' in builder definition"
                    )
                    valid = False

        return valid

    def get_validation_results(self) -> Dict[str, List[str]]:
        """Get validation results."""
        return {
            "errors": self.validation_errors,
            "warnings": self.validation_warnings,
        }


class ProactiveDebugger:
    """Provides proactive debugging capabilities."""

    def __init__(self, engine: TransformationEngine) -> None:
        self.engine = engine
        self.debug_events: List[Dict[str, Any]] = []
        self.breakpoints: List[int] = []
        self.current_line: int = 0

    def add_breakpoint(self, line_number: int) -> None:
        """Add a breakpoint at a line."""
        if line_number not in self.breakpoints:
            self.breakpoints.append(line_number)

    def remove_breakpoint(self, line_number: int) -> None:
        """Remove a breakpoint."""
        if line_number in self.breakpoints:
            self.breakpoints.remove(line_number)

    def debug_script(
        self,
        script: TransformationScript,
        data_source: DataSource,
        max_rows: Optional[int] = None,
        source_type: str = "csv",
    ) -> TransformationResult:
        """Debug a transformation script proactively."""
        result = TransformationResult(success=True)
        self.debug_events.clear()

        if not self.engine.validate_script(script):
            result.errors.extend(self.engine.validation_errors)
            result.warnings.extend(self.engine.validation_warnings)
            result.success = False
            return result

        mappings = self.engine.schema_map.get_mapping_for_source(source_type)
        builder = DSLBuilderFactory.create_builder(
            "groovy", self.engine.ontology, self.engine.collection
        )

        row_count = 0
        for row in data_source.get_data():
            row_count += 1

            if max_rows and row_count > max_rows:
                break

            if mappings:
                mapped_data = self.engine._apply_field_mappings(row, mappings[0])
                obj = builder.build(mapped_data)
                source_row = mapped_data
            else:
                obj = builder.build(row)
                source_row = row

            debug_event = {
                "row": row_count,
                "data": source_row,
                "object_created": obj is not None,
                "errors": builder.validation_errors.copy(),
                "warnings": builder.validation_warnings.copy(),
            }
            self.debug_events.append(debug_event)

            if obj:
                result.objects_created += 1
                result.debug_info[f"row_{row_count}"] = {
                    "object_id": obj.id,
                    "object_type": obj.object_type,
                }

            if builder.validation_errors:
                result.errors.extend(builder.validation_errors)
                result.success = False

                if self.engine.debug_mode:
                    result.debug_info["stopped_at_row"] = row_count
                    result.debug_info["reason"] = (
                        "Validation error detected proactively"
                    )
                    break

            builder.validation_errors.clear()
            builder.validation_warnings.clear()

        return result

    def get_debug_events(self) -> List[Dict[str, Any]]:
        """Get all debug events."""
        return self.debug_events

    def get_debug_summary(self) -> Dict[str, Any]:
        """Get a summary of debug events."""
        total_rows = len(self.debug_events)
        error_rows = sum(1 for e in self.debug_events if e.get("errors"))
        warning_rows = sum(1 for e in self.debug_events if e.get("warnings"))

        return {
            "total_rows": total_rows,
            "error_rows": error_rows,
            "warning_rows": warning_rows,
            "successful_rows": total_rows - error_rows,
            "total_errors": sum(
                len(e.get("errors", [])) for e in self.debug_events
            ),
            "total_warnings": sum(
                len(e.get("warnings", [])) for e in self.debug_events
            ),
        }
