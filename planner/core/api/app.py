"""FastAPI — health, plano, linhas e actions."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from planner.core.actions.executor import ActionExecutor
from planner.core.db import get_session_factory
from planner.core.monitoring.health import HealthService

app = FastAPI(title="Neumann Planner API", version="0.3.0")
_health = HealthService()
_actions = ActionExecutor()


class ActionRequest(BaseModel):
    action_type: str
    params: dict[str, Any] = Field(default_factory=dict)
    actor: str = "api"
    actor_type: str = "human"
    client: str | None = None
    plan_run_id: str | None = None


@app.get("/health")
def health() -> dict:
    status = _health.check()
    return {"status": status.status, "checks": status.checks}


@app.get("/")
def root() -> dict:
    return {
        "service": "neumann-planner",
        "docs": "/docs",
        "endpoints": [
            "/health",
            "/plans",
            "/plans/{plan_run_id}/lines",
            "/actions",
        ],
    }


@app.get("/plans")
def list_plans(client: str | None = None, limit: int = 20) -> dict:
    factory = get_session_factory()
    session = factory()
    try:
        if client:
            rows = session.execute(
                text(
                    """
                    SELECT id, client, created_at, solver_status, objective, duration_seconds
                    FROM decisions.plan_run
                    WHERE client = :client
                    ORDER BY created_at DESC
                    LIMIT :limit
                    """
                ),
                {"client": client, "limit": limit},
            ).mappings().all()
        else:
            rows = session.execute(
                text(
                    """
                    SELECT id, client, created_at, solver_status, objective, duration_seconds
                    FROM decisions.plan_run
                    ORDER BY created_at DESC
                    LIMIT :limit
                    """
                ),
                {"limit": limit},
            ).mappings().all()
        return {
            "plans": [
                {
                    "id": str(r["id"]),
                    "client": r["client"],
                    "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                    "solver_status": r["solver_status"],
                    "objective": r["objective"],
                    "duration_seconds": r["duration_seconds"],
                }
                for r in rows
            ]
        }
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        session.close()


@app.get("/plans/{plan_run_id}/lines")
def list_plan_lines(plan_run_id: str) -> dict:
    factory = get_session_factory()
    session = factory()
    try:
        rows = session.execute(
            text(
                """
                SELECT id, sku, family, qty, machine_id, start_ts, end_ts, status, priority
                FROM decisions.plan_line
                WHERE plan_run_id = :pid
                ORDER BY start_ts NULLS LAST
                """
            ),
            {"pid": plan_run_id},
        ).mappings().all()
        return {
            "plan_run_id": plan_run_id,
            "lines": [
                {
                    "id": str(r["id"]),
                    "sku": r["sku"],
                    "family": r["family"],
                    "qty": r["qty"],
                    "machine_id": r["machine_id"],
                    "start_ts": r["start_ts"].isoformat() if r["start_ts"] else None,
                    "end_ts": r["end_ts"].isoformat() if r["end_ts"] else None,
                    "status": r["status"],
                    "priority": r["priority"],
                }
                for r in rows
            ],
        }
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        session.close()


@app.post("/actions")
def run_action(body: ActionRequest) -> dict:
    plan_run = UUID(body.plan_run_id) if body.plan_run_id else None
    result = _actions.execute(
        body.action_type,
        body.params,
        body.actor,
        body.actor_type,
        plan_run_id=plan_run,
        client=body.client,
    )
    if not result.success:
        raise HTTPException(
            status_code=400,
            detail={
                "error": result.error,
                "validations": result.validations_result,
                "audit_id": result.audit_id,
            },
        )
    return {
        "success": True,
        "action_type": result.action_type,
        "effects": result.effects_result,
        "audit_id": result.audit_id,
    }
