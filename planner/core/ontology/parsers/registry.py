"""Parser registry — register and resolve transform callables by name."""

from __future__ import annotations

from ..exceptions import DuplicateParserError, ParserNotRegisteredError
from .base import ParserCallable

_DEFAULT: ParserRegistry | None = None


class ParserRegistry:
    def __init__(self) -> None:
        self._parsers: dict[str, ParserCallable] = {}

    def register(self, name: str, parser: ParserCallable) -> None:
        if name in self._parsers:
            raise DuplicateParserError(name)
        self._parsers[name] = parser

    def register_or_replace(self, name: str, parser: ParserCallable) -> None:
        self._parsers[name] = parser

    def get(self, name: str) -> ParserCallable:
        try:
            return self._parsers[name]
        except KeyError as exc:
            raise ParserNotRegisteredError(name) from exc

    def has(self, name: str) -> bool:
        return name in self._parsers

    def names(self) -> list[str]:
        return sorted(self._parsers.keys())


def build_default_parser_registry() -> ParserRegistry:
    from .builtins import BUILTIN_PARSERS

    registry = ParserRegistry()
    for name, fn in BUILTIN_PARSERS.items():
        registry.register(name, fn)
    return registry


def get_default_parser_registry() -> ParserRegistry:
    global _DEFAULT
    if _DEFAULT is None:
        _DEFAULT = build_default_parser_registry()
    return _DEFAULT
