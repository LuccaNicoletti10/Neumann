"""Modelos SQLAlchemy do schema `decisions` (motor de decisão)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class DecisionsBase(DeclarativeBase):
    """Base Declarative para tabelas de decisions/audit do motor."""


class DecisionLogModel(DecisionsBase):
    """Recomendação vs decisão humana vs actuals — base do aprendizado."""

    __tablename__ = "decision_log"
    __table_args__ = {"schema": "decisions"}

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    client: Mapped[str] = mapped_column(String(64), nullable=False)
    family: Mapped[str | None] = mapped_column(String(64), nullable=True)
    plan_run_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    plan_line_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    recommended_qty: Mapped[float] = mapped_column(Float, nullable=False)
    recommended_machine: Mapped[str | None] = mapped_column(String(64), nullable=True)
    final_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    final_machine: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action_taken: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reason_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor: Mapped[str | None] = mapped_column(String(128), nullable=True)
    actor_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    actual_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    actual_scrap: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AutonomyLogModel(DecisionsBase):
    """Auditoria de liberações (ou bloqueios) de autonomia."""

    __tablename__ = "autonomy_log"
    __table_args__ = {"schema": "audit"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client: Mapped[str] = mapped_column(String(64), nullable=False)
    family: Mapped[str | None] = mapped_column(String(64), nullable=True)
    plan_line_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    allowed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    approval_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class WriteBackLogModel(DecisionsBase):
    """Idempotência de exportação para ERP."""

    __tablename__ = "write_back_log"
    __table_args__ = {"schema": "audit"}

    action_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    erp_order_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    exported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    client_id: Mapped[str | None] = mapped_column(String(64), nullable=True, default="default")


class LlmLogModel(DecisionsBase):
    """Auditoria de chamadas ao LLM (prompt/resposta/custo)."""

    __tablename__ = "llm_log"
    __table_args__ = {"schema": "audit"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    response: Mapped[str | None] = mapped_column(Text, nullable=True)
    tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
