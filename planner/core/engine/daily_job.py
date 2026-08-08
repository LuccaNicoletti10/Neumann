"""Job diário APScheduler — extract → build → sync → forecast → netting → schedule → persist."""

from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


def run_daily_plan(client: str | None = None) -> None:
    """Entrypoint do job — chama run_plan em modo operacional."""
    from planner.core.engine.plan_pipeline import run_plan

    client = client or os.environ.get("PLANNER_CLIENT", "default")
    config_root = Path(os.environ.get("PLANNER_CONFIG_ROOT", "config"))
    data_root = Path(os.environ.get("PLANNER_DATA_ROOT", "data"))
    logger.info("Job diário início client=%s", client)
    summary = run_plan(
        client,
        config_root=config_root,
        data_root=data_root,
        horizon_days=int(os.environ.get("PLANNER_HORIZON_DAYS", "30")),
        dry_run=False,
        mode="operational",
    )
    logger.info(
        "Job diário fim client=%s plan_run=%s status=%s orders=%s",
        client,
        summary.plan_run_id,
        summary.solver_status,
        summary.orders_created,
    )


def start_scheduler() -> None:
    """Agenda job diário (cron). Bloqueia o processo."""
    from apscheduler.schedulers.blocking import BlockingScheduler

    cron = os.environ.get("PLANNER_CRON", "0 6 * * *")  # 06:00 diário
    minute, hour, day, month, dow = (cron.split() + ["*"] * 5)[:5]
    sched = BlockingScheduler()
    sched.add_job(
        run_daily_plan,
        "cron",
        minute=minute,
        hour=hour,
        day=day,
        month=month,
        day_of_week=dow,
        id="daily_plan",
        replace_existing=True,
    )
    logger.info("APScheduler ativo cron=%s", cron)
    sched.start()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    if os.environ.get("PLANNER_RUN_ONCE") == "1":
        run_daily_plan()
    else:
        start_scheduler()
