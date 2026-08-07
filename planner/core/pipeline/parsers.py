"""Parsers Polars-friendly para schema maps (funções puras, sem I/O)."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Callable


ParserFn = Callable[[Any, dict[str, Any]], Any]


def strip(value: Any, args: dict[str, Any] | None = None) -> Any:
    if value is None:
        return None
    return str(value).strip()


def strip_upper(value: Any, args: dict[str, Any] | None = None) -> Any:
    if value is None:
        return None
    return str(value).strip().upper()


def to_float(value: Any, args: dict[str, Any] | None = None) -> Any:
    if value is None or value == "":
        return None
    text = str(value).strip()
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".")
    elif "," in text:
        text = text.replace(",", ".")
    return float(text)


def to_int(value: Any, args: dict[str, Any] | None = None) -> Any:
    if value is None or value == "":
        return None
    return int(float(str(value).strip().replace(",", ".")))


def map_values(value: Any, args: dict[str, Any] | None = None) -> Any:
    args = args or {}
    mapping = args.get("mapping", args)
    if not isinstance(mapping, dict):
        return value
    case_insensitive = bool(args.get("case_insensitive", True))
    text = "" if value is None else str(value).strip()
    key = text.casefold() if case_insensitive else text
    for src, dst in mapping.items():
        if src in {"mapping", "case_insensitive"}:
            continue
        src_key = str(src).casefold() if case_insensitive else str(src)
        if key == src_key:
            return dst
    return value


def parse_date_br(value: Any, args: dict[str, Any] | None = None) -> Any:
    if value is None or value == "":
        return None
    text = str(value).strip()
    return datetime.strptime(text, "%d/%m/%Y").date()


def parse_decimal_br(value: Any, args: dict[str, Any] | None = None) -> Any:
    if value is None or value == "":
        return None
    text = str(value).strip()
    if "," in text:
        # 1.234,56 → 1234.56
        normalized = text.replace(".", "").replace(",", ".")
    else:
        # já está em formato US/simples
        normalized = text
    try:
        return float(Decimal(normalized))
    except InvalidOperation as exc:
        raise ValueError(f"Decimal BR inválido: {value}") from exc


BUILTIN_PARSERS: dict[str, ParserFn] = {
    "strip": strip,
    "strip_upper": strip_upper,
    "to_float": to_float,
    "to_int": to_int,
    "map_values": map_values,
    "parse_date_br": parse_date_br,
    "parse_decimal_br": parse_decimal_br,
}


def get_parser(name: str) -> ParserFn:
    try:
        return BUILTIN_PARSERS[name]
    except KeyError as exc:
        raise KeyError(f"Parser não registrado: {name}") from exc
