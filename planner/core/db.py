"""Conexão SQLAlchemy 2.0 compartilhada (DATABASE_URL)."""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

_DEFAULT_URL = "postgresql+psycopg://planner:planner@localhost:5432/planner"

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def get_database_url() -> str:
    """Retorna DATABASE_URL do ambiente ou URL local padrão do docker-compose."""
    return os.environ.get("DATABASE_URL", _DEFAULT_URL)


def get_engine(*, echo: bool = False) -> Engine:
    """Engine singleton criado a partir de DATABASE_URL."""
    global _engine, _SessionLocal
    if _engine is None:
        _engine = create_engine(get_database_url(), echo=echo, future=True)
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False, future=True)
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    """Factory de sessões (cria o engine se necessário)."""
    get_engine()
    assert _SessionLocal is not None
    return _SessionLocal


@contextmanager
def session_scope() -> Iterator[Session]:
    """Context manager com commit/rollback padrão."""
    factory = get_session_factory()
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def reset_engine() -> None:
    """Reseta o singleton (útil em testes)."""
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionLocal = None
