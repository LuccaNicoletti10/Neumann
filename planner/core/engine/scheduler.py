"""Scheduler OR-Tools CP-SAT — alocação de máquinas (função pura)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

import polars as pl


@dataclass
class OrderCandidate:
    id: str
    sku: str
    family: str
    qty: float
    priority: float
    deadline: date


@dataclass
class SchedulingProblem:
    orders: list[OrderCandidate]
    compatibility: pl.DataFrame
    setup_matrix: pl.DataFrame
    calendar: pl.DataFrame
    horizon_start: date
    horizon_end: date


@dataclass
class Assignment:
    order_id: str
    machine_id: str
    start: datetime
    end: datetime
    qty: float


@dataclass
class Schedule:
    assignments: list[Assignment] = field(default_factory=list)
    objective_value: float = 0.0
    solver_status: str = "FEASIBLE"
    setup_time_total: int = 0
    utilization: float = 0.0


def solve_schedule(
    problem: SchedulingProblem,
    time_limit_s: int = 60,
    *,
    emergency_greedy: bool = False,
    seed: int = 42,
) -> Schedule:
    """
    Resolve job-shop.

    Operacional: OR-Tools CP-SAT (padrão).
    emergency_greedy=True: heurística explícita, status marca HEURISTIC.
    Nunca troca silenciosamente de solver por Exception genérica.
    """
    # Validações duras antes do solver
    if problem.orders and problem.compatibility.height == 0:
        return Schedule(solver_status="INFEASIBLE", objective_value=0.0)
    for order in problem.orders:
        compat = problem.compatibility.filter(pl.col("sku") == order.sku)
        if compat.is_empty():
            return Schedule(
                solver_status="INFEASIBLE",
                objective_value=0.0,
                assignments=[],
            )

    if emergency_greedy:
        schedule = _solve_greedy(problem)
        schedule.solver_status = f"HEURISTIC_{schedule.solver_status}"
        return schedule

    return _solve_ortools(problem, time_limit_s, seed=seed)


def _solve_greedy(problem: SchedulingProblem) -> Schedule:
    machines = (
        problem.compatibility.get_column("machine_id").unique().to_list()
        if problem.compatibility.height
        else ["M01"]
    )
    cursor = {
        m: datetime.combine(problem.horizon_start, datetime.min.time()) for m in machines
    }
    assignments: list[Assignment] = []
    setup_total = 0
    last_family: dict[str, str | None] = {m: None for m in machines}

    ordered = sorted(problem.orders, key=lambda o: (-o.priority, o.deadline))
    for order in ordered:
        compat = problem.compatibility.filter(pl.col("sku") == order.sku)
        candidates = (
            compat.get_column("machine_id").to_list() if compat.height else list(machines)
        )
        best_m = min(candidates, key=lambda m: cursor[m])
        speed_rows = compat.filter(pl.col("machine_id") == best_m)
        speed = float(speed_rows["speed_units_per_hour"][0]) if speed_rows.height else 100.0
        hours = order.qty / max(speed, 1.0)

        setup = 0
        if last_family[best_m] and problem.setup_matrix.height:
            sm = problem.setup_matrix.filter(
                (pl.col("machine_id") == best_m)
                & (pl.col("from_family") == last_family[best_m])
                & (pl.col("to_family") == order.family)
            )
            if sm.height:
                if bool(sm["forbidden"][0]):
                    # tenta outra máquina
                    alt = [m for m in candidates if m != best_m]
                    if alt:
                        best_m = min(alt, key=lambda m: cursor[m])
                else:
                    setup = int(sm["setup_minutes"][0])
        start = cursor[best_m] + timedelta(minutes=setup)
        end = start + timedelta(hours=hours)
        assignments.append(
            Assignment(order.id, best_m, start, end, order.qty)
        )
        cursor[best_m] = end
        last_family[best_m] = order.family
        setup_total += setup

    total_cap = 0
    used = 0
    if problem.calendar.height:
        for row in problem.calendar.to_dicts():
            total_cap += float(row.get("available_hours") or 0) * 60
    for a in assignments:
        used += (a.end - a.start).total_seconds() / 60.0

    return Schedule(
        assignments=assignments,
        objective_value=float(setup_total),
        solver_status="FEASIBLE",
        setup_time_total=setup_total,
        utilization=(used / total_cap) if total_cap > 0 else 0.0,
    )


def _solve_ortools(problem: SchedulingProblem, time_limit_s: int, seed: int = 42) -> Schedule:
    from ortools.sat.python import cp_model

    model = cp_model.CpModel()
    machines = (
        problem.compatibility.get_column("machine_id").unique().to_list()
        if problem.compatibility.height
        else []
    )
    if not machines or not problem.orders:
        return Schedule(solver_status="INFEASIBLE")

    # Capacidade por máquina (minutos no horizonte) a partir do calendar
    capacity: dict[str, int] = {m: 0 for m in machines}
    if problem.calendar.height:
        for row in problem.calendar.to_dicts():
            mid = str(row["machine_id"])
            if mid in capacity:
                capacity[mid] += int(float(row.get("available_hours") or 0) * 60)
    else:
        horizon_min = int((problem.horizon_end - problem.horizon_start).days * 24 * 60)
        capacity = {m: horizon_min for m in machines}

    # Máquina com capacidade zero não recebe ordem
    machines = [m for m in machines if capacity.get(m, 0) > 0]
    if not machines:
        return Schedule(solver_status="INFEASIBLE")

    horizon_min = max(capacity.values())
    intervals = []
    assigns = {}
    machine_load: dict[str, list] = {m: [] for m in machines}

    for order in problem.orders:
        compat = problem.compatibility.filter(pl.col("sku") == order.sku)
        cands = [m for m in (compat.get_column("machine_id").to_list() if compat.height else machines) if m in machines]
        if not cands:
            return Schedule(solver_status="INFEASIBLE")
        literals = []
        for m in cands:
            speed_rows = compat.filter(pl.col("machine_id") == m)
            speed = float(speed_rows["speed_units_per_hour"][0]) if speed_rows.height else 100.0
            dur = max(int(order.qty / max(speed, 1.0) * 60), 1)
            if dur > capacity[m]:
                # ordem maior que capacidade da máquina — ainda pode ser INFEASIBLE global
                pass
            present = model.NewBoolVar(f"p_{order.id}_{m}")
            start = model.NewIntVar(0, horizon_min, f"s_{order.id}_{m}")
            end = model.NewIntVar(0, horizon_min, f"e_{order.id}_{m}")
            interval = model.NewOptionalIntervalVar(start, dur, end, present, f"i_{order.id}_{m}")
            intervals.append((m, interval))
            assigns[(order.id, m)] = (present, start, end, dur)
            literals.append(present)
            machine_load[m].append(interval)
        model.AddExactlyOne(literals)

    for m in machines:
        model.AddNoOverlap([iv for mid, iv in intervals if mid == m])
        # respeito à capacidade
        model.Add(
            sum(assigns[(o.id, m)][3] * assigns[(o.id, m)][0] for o in problem.orders if (o.id, m) in assigns)
            <= capacity[m]
        )

    # Objetivo: minimizar atraso ponderado + fim
    tardiness_terms = []
    for order in problem.orders:
        deadline_min = int((order.deadline - problem.horizon_start).days) * 24 * 60
        deadline_min = max(deadline_min, 0)
        for m in machines:
            key = (order.id, m)
            if key not in assigns:
                continue
            present, start, end, _dur = assigns[key]
            late = model.NewIntVar(0, horizon_min, f"late_{order.id}_{m}")
            model.Add(late >= end - deadline_min).OnlyEnforceIf(present)
            model.Add(late == 0).OnlyEnforceIf(present.Not())
            weight = int(max(order.priority, 1))
            tardiness_terms.append(late * weight)

    ends = [assigns[k][2] for k in assigns]
    model.Minimize(sum(tardiness_terms) + sum(ends))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s
    solver.parameters.random_seed = seed
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return Schedule(solver_status="INFEASIBLE")

    out: list[Assignment] = []
    setup_total = 0
    used_minutes: dict[str, int] = {m: 0 for m in machines}
    for order in problem.orders:
        for m in machines:
            key = (order.id, m)
            if key not in assigns:
                continue
            present, start, end, dur = assigns[key]
            if solver.Value(present):
                s = datetime.combine(problem.horizon_start, datetime.min.time()) + timedelta(
                    minutes=solver.Value(start)
                )
                e = datetime.combine(problem.horizon_start, datetime.min.time()) + timedelta(
                    minutes=solver.Value(end)
                )
                out.append(Assignment(order.id, m, s, e, order.qty))
                used_minutes[m] += dur

    total_cap = sum(capacity.values()) or 1
    utilization = sum(used_minutes.values()) / total_cap
    return Schedule(
        assignments=out,
        objective_value=solver.ObjectiveValue(),
        solver_status="OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE",
        setup_time_total=setup_total,
        utilization=utilization,
    )
