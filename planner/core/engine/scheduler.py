"""Scheduler OR-Tools CP-SAT — alocação com setup sequencial e calendário por janelas."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

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
    Resolve job-shop com setup dependente de sequência e janelas de calendário.

    Operacional: OR-Tools CP-SAT (padrão).
    emergency_greedy=True: heurística explícita, status marca HEURISTIC.
    """
    if problem.orders and problem.compatibility.height == 0:
        return Schedule(solver_status="INFEASIBLE", objective_value=0.0)
    for order in problem.orders:
        compat = problem.compatibility.filter(pl.col("sku") == order.sku)
        if compat.is_empty():
            return Schedule(solver_status="INFEASIBLE", objective_value=0.0, assignments=[])

    if emergency_greedy:
        schedule = _solve_greedy(problem)
        schedule.solver_status = f"HEURISTIC_{schedule.solver_status}"
        return schedule

    return _solve_ortools(problem, time_limit_s, seed=seed)


def calendar_windows(
    calendar: pl.DataFrame,
    horizon_start: date,
    horizon_end: date,
) -> dict[str, list[tuple[int, int]]]:
    """Converte calendar diário em janelas [start_min, end_min) absolutas."""
    windows: dict[str, list[tuple[int, int]]] = {}
    if calendar.is_empty():
        return windows

    for row in calendar.to_dicts():
        mid = str(row["machine_id"])
        day = row["date"]
        if isinstance(day, str):
            day = date.fromisoformat(day[:10])
        if day < horizon_start or day > horizon_end:
            continue
        hours = float(row.get("available_hours") or 0)
        if hours <= 0:
            continue
        day_offset = (day - horizon_start).days
        shift_start = int(row.get("shift_start_minute") or 0)
        start_min = day_offset * 24 * 60 + shift_start
        end_min = start_min + int(hours * 60)
        windows.setdefault(mid, []).append((start_min, end_min))

    for mid in windows:
        windows[mid].sort()
    return windows


def setup_lookup(setup_matrix: pl.DataFrame) -> dict[tuple[str, str, str], tuple[int, bool]]:
    out: dict[tuple[str, str, str], tuple[int, bool]] = {}
    if setup_matrix.is_empty():
        return out
    for row in setup_matrix.to_dicts():
        key = (str(row["machine_id"]), str(row["from_family"]), str(row["to_family"]))
        out[key] = (int(float(row.get("setup_minutes") or 0)), bool(row.get("forbidden") or False))
    return out


def _setup_between(
    lookup: dict[tuple[str, str, str], tuple[int, bool]],
    machine: str,
    from_family: str | None,
    to_family: str,
) -> tuple[int, bool]:
    if from_family is None or from_family == to_family:
        return 0, False
    return lookup.get((machine, from_family, to_family), (0, False))


def _solve_greedy(problem: SchedulingProblem) -> Schedule:
    machines = (
        problem.compatibility.get_column("machine_id").unique().to_list()
        if problem.compatibility.height
        else ["M01"]
    )
    windows = calendar_windows(problem.calendar, problem.horizon_start, problem.horizon_end)
    setup_map = setup_lookup(problem.setup_matrix)

    cursor: dict[str, int] = {m: 0 for m in machines}
    for m in machines:
        w = windows.get(m) or []
        if w:
            cursor[m] = w[0][0]

    assignments: list[Assignment] = []
    setup_total = 0
    last_family: dict[str, str | None] = {m: None for m in machines}

    ordered = sorted(problem.orders, key=lambda o: (-o.priority, o.deadline))
    for order in ordered:
        compat = problem.compatibility.filter(pl.col("sku") == order.sku)
        candidates = [
            m
            for m in (compat.get_column("machine_id").to_list() if compat.height else list(machines))
            if m in machines
        ]
        if not candidates:
            return Schedule(solver_status="INFEASIBLE")

        best: tuple[str, int, int, int] | None = None
        for m in candidates:
            speed_rows = compat.filter(pl.col("machine_id") == m)
            speed = float(speed_rows["speed_units_per_hour"][0]) if speed_rows.height else 100.0
            dur = max(int(order.qty / max(speed, 1.0) * 60), 1)
            setup, forbidden = _setup_between(setup_map, m, last_family[m], order.family)
            if forbidden:
                continue
            start = _place_in_windows(cursor[m] + setup, dur, windows.get(m) or [])
            if start is None:
                continue
            end = start + dur
            if best is None or start < best[1]:
                best = (m, start, end, setup)

        if best is None:
            return Schedule(solver_status="INFEASIBLE", assignments=assignments)

        m, start, end, setup = best
        base = datetime.combine(problem.horizon_start, datetime.min.time())
        assignments.append(
            Assignment(order.id, m, base + timedelta(minutes=start), base + timedelta(minutes=end), order.qty)
        )
        cursor[m] = end
        last_family[m] = order.family
        setup_total += setup

    total_cap = sum((we - ws) for wins in windows.values() for ws, we in wins) or 1
    used = sum((a.end - a.start).total_seconds() / 60.0 for a in assignments)
    return Schedule(
        assignments=assignments,
        objective_value=float(setup_total),
        solver_status="FEASIBLE",
        setup_time_total=setup_total,
        utilization=used / total_cap,
    )


def _place_in_windows(earliest: int, duration: int, windows: list[tuple[int, int]]) -> int | None:
    if not windows:
        return earliest
    for ws, we in windows:
        start = max(earliest, ws)
        if start + duration <= we:
            return start
    return None


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

    windows = calendar_windows(problem.calendar, problem.horizon_start, problem.horizon_end)
    setup_map = setup_lookup(problem.setup_matrix)

    horizon_span = max(int((problem.horizon_end - problem.horizon_start).days + 1) * 24 * 60, 1)
    if windows:
        horizon_span = max(horizon_span, max(we for wins in windows.values() for _, we in wins))

    machines = [
        m
        for m in machines
        if (windows.get(m) and any(we > ws for ws, we in windows[m])) or (not windows)
    ]
    if not machines:
        return Schedule(solver_status="INFEASIBLE")
    if not windows:
        windows = {m: [(0, horizon_span)] for m in machines}

    order_by_id = {o.id: o for o in problem.orders}
    # (order_id, machine) -> (present, start, end, dur)
    assigns: dict[tuple[str, str], tuple[Any, Any, Any, int]] = {}

    for order in problem.orders:
        compat = problem.compatibility.filter(pl.col("sku") == order.sku)
        cands = [
            m
            for m in (compat.get_column("machine_id").to_list() if compat.height else machines)
            if m in machines
        ]
        literals = []
        for m in cands:
            speed_rows = compat.filter(pl.col("machine_id") == m)
            speed = float(speed_rows["speed_units_per_hour"][0]) if speed_rows.height else 100.0
            dur = max(int(order.qty / max(speed, 1.0) * 60), 1)
            feasible_windows = [(ws, we) for ws, we in windows.get(m, []) if we - ws >= dur]
            if not feasible_windows:
                continue

            present = model.NewBoolVar(f"p_{order.id}_{m}")
            start = model.NewIntVar(0, horizon_span, f"s_{order.id}_{m}")
            end = model.NewIntVar(0, horizon_span, f"e_{order.id}_{m}")
            model.Add(end == start + dur).OnlyEnforceIf(present)
            assigns[(order.id, m)] = (present, start, end, dur)
            literals.append(present)

            # Uma janela: start em domínio união das janelas
            win_lits = []
            for wi, (ws, we) in enumerate(feasible_windows):
                in_w = model.NewBoolVar(f"w_{order.id}_{m}_{wi}")
                model.Add(start >= ws).OnlyEnforceIf([present, in_w])
                model.Add(start <= we - dur).OnlyEnforceIf([present, in_w])
                win_lits.append(in_w)
            model.Add(sum(win_lits) == 1).OnlyEnforceIf(present)
            model.Add(sum(win_lits) == 0).OnlyEnforceIf(present.Not())

        if not literals:
            return Schedule(solver_status="INFEASIBLE")
        model.AddExactlyOne(literals)

    # Precedência + setup + forbidden (substitui NoOverlap)
    setup_penalty_terms: list[Any] = []
    for m in machines:
        order_ids = [oid for (oid, mid) in assigns if mid == m]
        for i, oi in enumerate(order_ids):
            for oj in order_ids[i + 1 :]:
                pi, si, ei, _di = assigns[(oi, m)]
                pj, sj, ej, _dj = assigns[(oj, m)]
                fi = order_by_id[oi].family
                fj = order_by_id[oj].family
                setup_ij, forb_ij = _setup_between(setup_map, m, fi, fj)
                setup_ji, forb_ji = _setup_between(setup_map, m, fj, fi)

                if forb_ij and forb_ji:
                    model.AddBoolOr([pi.Not(), pj.Not()])
                    continue

                before = model.NewBoolVar(f"bef_{oi}_{oj}_{m}")
                if forb_ij:
                    # não pode oi → oj
                    model.AddBoolOr([pi.Not(), pj.Not(), before.Not()])
                if forb_ji:
                    model.AddBoolOr([pi.Not(), pj.Not(), before])

                # gap com setup (cobre também no-overlap quando setup=0)
                model.Add(ei + setup_ij <= sj).OnlyEnforceIf([pi, pj, before])
                model.Add(ej + setup_ji <= si).OnlyEnforceIf([pi, pj, before.Not()])

                if setup_ij or setup_ji:
                    su = model.NewIntVar(0, max(setup_ij, setup_ji), f"su_{oi}_{oj}_{m}")
                    model.Add(su == setup_ij).OnlyEnforceIf([pi, pj, before])
                    model.Add(su == setup_ji).OnlyEnforceIf([pi, pj, before.Not()])
                    model.Add(su == 0).OnlyEnforceIf(pi.Not())
                    model.Add(su == 0).OnlyEnforceIf(pj.Not())
                    setup_penalty_terms.append(su)

    # Objetivo: atraso >> setup >> ends
    tardiness_terms = []
    for order in problem.orders:
        deadline_min = max(int((order.deadline - problem.horizon_start).days) * 24 * 60, 0)
        for m in machines:
            key = (order.id, m)
            if key not in assigns:
                continue
            present, _s, end, _d = assigns[key]
            late = model.NewIntVar(0, horizon_span, f"late_{order.id}_{m}")
            model.Add(late >= end - deadline_min).OnlyEnforceIf(present)
            model.Add(late == 0).OnlyEnforceIf(present.Not())
            tardiness_terms.append(late * int(max(order.priority, 1)) * 1_000_000)

    ends = [assigns[k][2] for k in assigns]
    model.Minimize(sum(tardiness_terms) + sum(setup_penalty_terms) * 1000 + sum(ends))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(time_limit_s)
    solver.parameters.random_seed = seed
    solver.parameters.num_search_workers = 1
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return Schedule(solver_status="INFEASIBLE")

    out: list[Assignment] = []
    chosen: dict[str, tuple[str, int, int]] = {}
    used_minutes: dict[str, int] = {m: 0 for m in machines}
    base = datetime.combine(problem.horizon_start, datetime.min.time())
    for order in problem.orders:
        for m in machines:
            key = (order.id, m)
            if key not in assigns:
                continue
            present, start, end, dur = assigns[key]
            if solver.Value(present):
                s_min = int(solver.Value(start))
                e_min = int(solver.Value(end))
                chosen[order.id] = (m, s_min, e_min)
                out.append(
                    Assignment(
                        order.id,
                        m,
                        base + timedelta(minutes=s_min),
                        base + timedelta(minutes=e_min),
                        order.qty,
                    )
                )
                used_minutes[m] += dur

    setup_total = _compute_setup_total(chosen, order_by_id, setup_map)
    if _has_forbidden_transition(chosen, order_by_id, setup_map):
        return Schedule(solver_status="INFEASIBLE")

    total_cap = sum((we - ws) for wins in windows.values() for ws, we in wins) or 1
    return Schedule(
        assignments=out,
        objective_value=float(solver.ObjectiveValue()),
        solver_status="OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE",
        setup_time_total=setup_total,
        utilization=sum(used_minutes.values()) / total_cap,
    )


def _compute_setup_total(
    chosen: dict[str, tuple[str, int, int]],
    order_by_id: dict[str, OrderCandidate],
    setup_map: dict[tuple[str, str, str], tuple[int, bool]],
) -> int:
    by_machine: dict[str, list[tuple[str, int, int]]] = {}
    for oid, (m, s, e) in chosen.items():
        by_machine.setdefault(m, []).append((oid, s, e))
    total = 0
    for m, items in by_machine.items():
        items.sort(key=lambda x: x[1])
        prev_fam: str | None = None
        for oid, _s, _e in items:
            fam = order_by_id[oid].family
            mins, _ = _setup_between(setup_map, m, prev_fam, fam)
            total += mins
            prev_fam = fam
    return total


def _has_forbidden_transition(
    chosen: dict[str, tuple[str, int, int]],
    order_by_id: dict[str, OrderCandidate],
    setup_map: dict[tuple[str, str, str], tuple[int, bool]],
) -> bool:
    by_machine: dict[str, list[tuple[str, int]]] = {}
    for oid, (m, s, _e) in chosen.items():
        by_machine.setdefault(m, []).append((oid, s))
    for m, items in by_machine.items():
        items.sort(key=lambda x: x[1])
        prev_fam: str | None = None
        for oid, _s in items:
            fam = order_by_id[oid].family
            _, forbidden = _setup_between(setup_map, m, prev_fam, fam)
            if forbidden:
                return True
            prev_fam = fam
    return False
