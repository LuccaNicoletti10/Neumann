"""Context Service — monta pacote de contexto para o LLM."""

from __future__ import annotations

import time
from typing import Any


class ContextService:
    def __init__(self, store: dict[str, Any] | None = None, ttl_seconds: int = 300) -> None:
        self.store = store or {}
        self.ttl_seconds = ttl_seconds
        self._cache: dict[tuple[str, str], tuple[float, str]] = {}

    def build_context(self, object_type: str, key: Any, depth: int = 2) -> str:
        cache_key = (object_type, str(key))
        now = time.time()
        hit = self._cache.get(cache_key)
        if hit and now - hit[0] < self.ttl_seconds:
            return hit[1]

        product = self.store.get("products", {}).get(str(key), {})
        inventory = self.store.get("inventory", {}).get(str(key), {})
        text = "\n".join(
            [
                f"=== {object_type.upper()}: {key} - {product.get('description', '')} ===",
                f"Família: {product.get('family', '-')}",
                f"Unidade: {product.get('unit', '-')}",
                f"Estoque mínimo: {product.get('min_stock', '-')} | lote mínimo: {product.get('min_lot', '-')}",
                "--- ESTOQUE ATUAL ---",
                f"Disponível: {inventory.get('available', 0)}",
                f"Bloqueado: {inventory.get('blocked', 0)}",
                f"Em processo: {inventory.get('in_process', 0)}",
                f"(depth={depth})",
            ]
        )
        self._cache[cache_key] = (now, text)
        return text
