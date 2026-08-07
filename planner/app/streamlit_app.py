"""Streamlit MVP — Espelho Operacional, Plano do Dia e Exceções."""

from __future__ import annotations

from pathlib import Path

import polars as pl
import streamlit as st

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(__file__).resolve().parents[3] / "data"
CONFIG = Path(__file__).resolve().parents[3] / "config"


st.set_page_config(page_title="Neumann Planner", layout="wide")
st.title("Neumann Planner — MVP")

page = st.sidebar.radio("Telas", ["Espelho Operacional", "Plano do Dia", "Exceções"])
client = st.sidebar.text_input("Cliente", value="nicoletti")


@st.cache_data(ttl=300)
def load_products(client_name: str) -> pl.DataFrame:
    clean = DATA / client_name / "clean" / "products"
    files = sorted(clean.glob("snapshot_date=*/run_*.parquet")) if clean.exists() else []
    if files:
        return pl.read_parquet(files[-1])
    fixture = Path(__file__).resolve().parents[3] / "fixtures" / client_name / "produtos.csv"
    if fixture.exists():
        return pl.read_csv(fixture)
    return pl.DataFrame({"sku": ["PROD001"], "description": ["Exemplo"], "unit": ["kg"], "min_stock": [100.0]})


products = load_products(client)

if page == "Espelho Operacional":
    st.subheader("Espelho Operacional")
    skus = products.get_column("sku").to_list() if products.height else []
    sku = st.selectbox("SKU", skus)
    row = products.filter(pl.col("sku") == sku).to_dicts()[0] if sku else {}
    c1, c2, c3, c4 = st.columns(4)
    cover = 8.0
    color = "🟢" if cover > 20 else "🟡" if cover >= 12 else "🔴"
    c1.metric("Estoque mín.", row.get("min_stock", "-"))
    c2.metric("Cobertura (dias)", f"{cover:.0f} {color}")
    c3.metric("Unidade", row.get("unit", "-"))
    c4.metric("Família", row.get("family", row.get("B1_GRUPO", "-")))
    st.dataframe(products.to_pandas() if hasattr(products, "to_pandas") else products.to_dicts())

elif page == "Plano do Dia":
    st.subheader("Plano do Dia")
    st.info("Linhas do plano vêm de decisions.plan_run. Use actions para aprovar/alterar/rejeitar.")
    demo = pl.DataFrame(
        {
            "order": ["PROP-001"],
            "sku": [products["sku"][0] if products.height else "PROD001"],
            "qty": [12000],
            "machine": ["M04"],
            "narrativa": ["Estoque cobre 8 dias; M04 economiza setup."],
        }
    )
    st.dataframe(demo.to_dicts())
    col_a, col_b, col_c = st.columns(3)
    if col_a.button("Aprovar"):
        st.success("Action approve_plan_line disparada")
    if col_b.button("Alterar"):
        st.warning("Action modify_plan_line (reason_code obrigatório)")
    if col_c.button("Rejeitar"):
        st.error("Action reject_plan_line")

else:
    st.subheader("Exceções")
    st.write(
        [
            {
                "severity": "high",
                "category": "stockout_risk",
                "explanation": "SKU com cobertura abaixo do limite",
            }
        ]
    )
    if st.button("Acknowledge"):
        st.success("Action acknowledge_exception")
