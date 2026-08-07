FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY planner ./planner
COPY config ./config
COPY sql ./sql
COPY scripts ./scripts

RUN pip install --upgrade pip && pip install -e ".[dev]"

EXPOSE 8000 8501

CMD ["uvicorn", "planner.core.api.app:app", "--host", "0.0.0.0", "--port", "8000"]
