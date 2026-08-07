"""Validator registry."""

from __future__ import annotations

from ..exceptions import DuplicateValidatorError, ValidatorNotRegisteredError
from .base import ValidatorCallable

_DEFAULT: ValidatorRegistry | None = None


class ValidatorRegistry:
    def __init__(self) -> None:
        self._validators: dict[str, ValidatorCallable] = {}

    def register(self, name: str, validator: ValidatorCallable) -> None:
        if name in self._validators:
            raise DuplicateValidatorError(name)
        self._validators[name] = validator

    def get(self, name: str) -> ValidatorCallable:
        try:
            return self._validators[name]
        except KeyError as exc:
            raise ValidatorNotRegisteredError(name) from exc

    def has(self, name: str) -> bool:
        return name in self._validators

    def names(self) -> list[str]:
        return sorted(self._validators.keys())


def build_default_validator_registry() -> ValidatorRegistry:
    from .builtins import BUILTIN_VALIDATORS

    registry = ValidatorRegistry()
    for name, fn in BUILTIN_VALIDATORS.items():
        registry.register(name, fn)
    return registry


def get_default_validator_registry() -> ValidatorRegistry:
    global _DEFAULT
    if _DEFAULT is None:
        _DEFAULT = build_default_validator_registry()
    return _DEFAULT
