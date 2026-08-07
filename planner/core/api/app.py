"""FastAPI — health e endpoints mínimos do planner."""

from __future__ import annotations

from fastapi import FastAPI

from planner.core.monitoring.health import HealthService

app = FastAPI(title="Neumann Planner API", version="0.2.0")
_health = HealthService()


@app.get("/health")
def health() -> dict:
    status = _health.check(postgres_ok=True)
    return {"ok": status.ok, "checks": status.checks}


@app.get("/")
def root() -> dict:
    return {"service": "neumann-planner", "docs": "/docs"}
