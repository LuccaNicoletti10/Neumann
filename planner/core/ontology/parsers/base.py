"""Parser callable protocol and matcher helpers."""

from __future__ import annotations

from typing import Any, Mapping, Protocol

from ..models import ParserAttempt


class ParserCallable(Protocol):
    def __call__(
        self,
        raw_value: Any,
        args: Mapping[str, Any],
    ) -> ParserAttempt: ...


def is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


def matcher_matches(raw_value: Any, matcher: Mapping[str, Any] | None) -> bool:
    """Return True if the matcher accepts raw_value."""
    if not matcher:
        return True

    mtype = matcher.get("type", "any")

    if mtype == "any":
        return True

    if mtype == "any_non_null":
        return not is_blank(raw_value)

    if mtype == "exact_set":
        values = matcher.get("values", [])
        case_insensitive = bool(matcher.get("case_insensitive", False))
        text = "" if raw_value is None else str(raw_value).strip()
        if case_insensitive:
            text = text.casefold()
            return text in {str(v).strip().casefold() for v in values}
        return text in {str(v).strip() for v in values}

    if mtype == "regex":
        import re

        pattern = matcher.get("pattern", "")
        flags = re.IGNORECASE if matcher.get("case_insensitive") else 0
        text = "" if raw_value is None else str(raw_value)
        return re.search(pattern, text, flags) is not None

    if mtype == "decimal_br":
        import re

        text = "" if raw_value is None else str(raw_value).strip()
        return bool(re.fullmatch(r"-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:,\d+)?", text))

    if mtype == "decimal_us":
        import re

        text = "" if raw_value is None else str(raw_value).strip()
        return bool(re.fullmatch(r"-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?", text))

    if mtype == "integer":
        import re

        text = "" if raw_value is None else str(raw_value).strip()
        return bool(re.fullmatch(r"-?\d+", text))

    return True
