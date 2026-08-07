"""Modelos SQLAlchemy 2.0 do schema `audit`."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class AuditBase(DeclarativeBase):
    """Base Declarative para tabelas de auditoria."""


class ActionLogModel(AuditBase):
    """Registro imutável de cada Action executada (aprovação, rejeição, etc.)."""

    __tablename__ = "action_log"
    __table_args__ = {"schema": "audit"}

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    action_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    params: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    actor: Mapped[str | None] = mapped_column(String(128), nullable=True)
    actor_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    validations_result: Mapped[list | dict | None] = mapped_column(JSONB, nullable=True)
    effects_result: Mapped[list | dict | None] = mapped_column(JSONB, nullable=True)
    plan_run_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    success: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
