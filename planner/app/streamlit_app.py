"""Streamlit — Espelho Operacional, Plano do Dia e Exceções (dados reais)."""

from __future__ import annotations

import os
from pathlib import Path

import polars as pl
import streamlit as st
from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(__file__).resolve().parents[3] / "data"


st.set_page_config(page_title="Neumann Planner", layout="wide")
st.title("Neumann Planner")

page = st.sidebar.radio("Telas", ["Espelho Operacional", "Plano do Dia", "Exceções"])
client = st.sidebar.text_input("Cliente", value="test_client")


def _db_url() -> str:
    return os.environ.get(
        "DATABASE_URL", "postgresql+psycopg://planner:planner@localhost:5432/planner"
    )


def _query(sql: str, params: dict | None = None) -> list[dict]:
    try:
        engine = create_engine(_db_url(), future=True)
        with engine.connect() as conn:
            rows = conn.execute(text(sql), params or {}).mappings().all()
        engine.dispose()
        return [dict(r) for r in rows]
    except Exception as exc:
        st.warning(f"Postgres indisponível: {exc}")
        return []


@st.cache_data(ttl=60)
def load_products(client_name: str) -> pl.DataFrame:
    clean = DATA / client_name / "clean" / "products"
    files = sorted(clean.glob("snapshot_date=*/run_*.parquet")) if clean.exists() else []
    if files:
        return pl.read_parquet(files[-1])
    rows = _query(
        "SELECT sku, description, family, unit, min_stock FROM ontology.product "
        "WHERE active IS DISTINCT FROM false ORDER BY sku LIMIT 500"
    )
    if rows:
        return pl.DataFrame(rows)
    return pl.DataFrame({"sku": [], "description": [], "family": [], "unit": [], "min_stock": []})


products = load_products(client)

if page == "Espelho Operacional":
    st.subheader("Espelho Operacional")
    skus = products.get_column("sku").to_list() if products.height else []
    if not skus:
        st.info("Sem produtos. Rode `python -m planner plan --client …` primeiro.")
    else:
        sku = st.selectbox("SKU", skus)
        row = products.filter(pl.col("sku") == sku).to_dicts()[0] if sku else {}
        inv = _query(
            """
            SELECT available, blocked, reserved, snapshot_date
            FROM ontology.inventory_position
            WHERE sku = :sku
            ORDER BY snapshot_date DESC LIMIT 1
            """,
            {"sku": sku},
        )
        available = float(inv[0]["available"]) if inv else None
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Estoque mín.", row.get("min_stock", "-"))
        c2.metric("Disponível", available if available is not None else "-")
        c3.metric("Unidade", row.get("unit", "-"))
        c4.metric("Família", row.get("family", "-"))
        st.dataframe(products.to_dicts())

elif page == "Plano do Dia":
    st.subheader("Plano do Dia")
    plans = _query(
        """
        SELECT id, created_at, solver_status, objective
        FROM decisions.plan_run
        WHERE client = :client
        ORDER BY created_at DESC LIMIT 10
        """,
        {"client": client},
    )
    if not plans:
        st.info("Nenhum plan_run para este cliente.")
    else:
        labels = {
            str(p["id"]): f"{p['created_at']} · {p['solver_status']}" for p in plans
        }
        chosen = st.selectbox("Plan run", list(labels.keys()), format_func=lambda x: labels[x])
        lines = _query(
            """
            SELECT id, sku, family, qty, machine_id, start_ts, end_ts, status
            FROM decisions.plan_line
            WHERE plan_run_id = :pid
            ORDER BY start_ts NULLS LAST
            """,
            {"pid": chosen},
        )
        st.dataframe(lines)
        if lines:
            line_id = st.selectbox("Linha", [str(l["id"]) for l in lines])
            col_a, col_b, col_c = st.columns(3)
            from planner.core.actions.executor import ActionExecutor

            executor = ActionExecutor()
            if col_a.button("Aprovar"):
                res = executor.execute(
                    "approve_plan_line",
                    {"plan_line_id": line_id, "actor_role": "approver"},
                    actor="streamlit",
                    actor_type="human",
                    client=client,
                    plan_run_id=chosen,
                )
                st.success(res.effects_result if res.success else res.error)
            if col_b.button("Alterar (+10%)"):
                line = next(l for l in lines if str(l["id"]) == line_id)
                res = executor.execute(
                    "modify_plan_line",
                    {
                        "plan_line_id": line_id,
                        "new_qty": float(line["qty"]) * 1.1,
                        "reason_code": "adjust_qty",
                        "comment": "UI Streamlit",
                        "actor_role": "approver",
                    },
                    actor="streamlit",
                    actor_type="human",
                    client=client,
                    plan_run_id=chosen,
                )
                st.warning(res.effects_result if res.success else res.error)
            if col_c.button("Rejeitar"):
                res = executor.execute(
                    "reject_plan_line",
                    {
                        "plan_line_id": line_id,
                        "reason_code": "not_needed",
                        "comment": "UI Streamlit",
                        "actor_role": "approver",
                    },
                    actor="streamlit",
                    actor_type="human",
                    client=client,
                    plan_run_id=chosen,
                )
                st.error(res.effects_result if res.success else res.error)

else:
    st.subheader("Exceções / forecast degradado")
    rows = _query(
        """
        SELECT sku, model, wmape_backtest, status, forecast_run_id
        FROM decisions.forecast
        WHERE client_id = :client AND status IN ('degraded', 'blocked')
        ORDER BY created_at DESC LIMIT 50
        """,
        {"client": client},
    )
    if rows:
        st.dataframe(rows)
    else:
        st.write("Sem forecast degradado/bloqueado recente.")
