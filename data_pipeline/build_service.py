"""Build service with catalog and dependency graph (FIG. 4/5/8)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple
import time

from .core_types import (
    BuildCatalogEntry,
    BuildDependency,
    BuildMessage,
    DatasetType,
    DerivationProgram,
)
from .data_lake import DataLake
from .transaction_service import TransactionService


class BuildService:
    def __init__(
        self, data_lake: DataLake, transaction_service: TransactionService
    ) -> None:
        self.data_lake = data_lake
        self.transaction_service = transaction_service
        self.build_catalog: Dict[str, List[BuildCatalogEntry]] = {}
        self.derivation_programs: Dict[str, List[DerivationProgram]] = {}
        self.build_dependency_graph: Dict[str, Set[str]] = {}
        self.reverse_dependency_graph: Dict[str, Set[str]] = {}
        self.dataset_derivation_map: Dict[str, str] = {}
        self._build_queue: List[BuildMessage] = []
        self._build_history: List[Dict[str, Any]] = []
        self.transaction_service.add_build_listener(self._on_dataset_changed)

    def _on_dataset_changed(self, dataset_name: str, version_id: str) -> None:
        if dataset_name not in self.reverse_dependency_graph:
            return
        for parent in self.reverse_dependency_graph[dataset_name]:
            if parent in self.dataset_derivation_map:
                self._build_queue.append(
                    BuildMessage(
                        dataset_name=parent,
                        new_version_id=version_id,
                        triggered_at=datetime.now(),
                        trigger_type="dependency_updated",
                    )
                )

    def register_derivation_program(
        self,
        program_name: str,
        code: str,
        input_datasets: List[str],
        output_datasets: List[str],
        program_type: str = "python",
        description: Optional[str] = None,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> str:
        if program_name not in self.derivation_programs:
            version = "1.0.0"
        else:
            parts = self.derivation_programs[program_name][-1].version.split(".")
            major, minor, patch = int(parts[0]), int(parts[1]), int(parts[2]) + 1
            if patch >= 10:
                patch, minor = 0, minor + 1
            if minor >= 10:
                minor, major = 0, major + 1
            version = f"{major}.{minor}.{patch}"

        prog = DerivationProgram(
            program_name=program_name,
            version=version,
            code=code,
            program_type=program_type,
            input_datasets=input_datasets,
            output_datasets=output_datasets,
            description=description,
            parameters=parameters or {},
        )
        self.derivation_programs.setdefault(program_name, []).append(prog)
        for output_ds in output_datasets:
            self.dataset_derivation_map[output_ds] = program_name
            self.data_lake.set_dataset_type(output_ds, DatasetType.DERIVED)
            self._update_dataset_dependencies(output_ds, input_datasets)
        return version

    def _update_dataset_dependencies(
        self, dataset_name: str, dependencies: List[str]
    ) -> None:
        for dep in self.build_dependency_graph.get(dataset_name, set()):
            self.reverse_dependency_graph.get(dep, set()).discard(dataset_name)
        self.build_dependency_graph[dataset_name] = set(dependencies)
        for dep in dependencies:
            self.reverse_dependency_graph.setdefault(dep, set()).add(dataset_name)

    def define_derived_dataset(self, dataset_name: str, program_name: str) -> bool:
        if program_name not in self.derivation_programs:
            return False
        prog = self.derivation_programs[program_name][-1]
        if dataset_name not in prog.output_datasets:
            return False
        self.dataset_derivation_map[dataset_name] = program_name
        self.data_lake.set_dataset_type(dataset_name, DatasetType.DERIVED)
        self._update_dataset_dependencies(dataset_name, prog.input_datasets)
        return True

    def build_dataset(
        self,
        dataset_name: str,
        force: bool = False,
        build_trigger: str = "manual",
    ) -> Optional[str]:
        if dataset_name not in self.dataset_derivation_map:
            return None
        prog_name = self.dataset_derivation_map[dataset_name]
        prog = self.derivation_programs[prog_name][-1]

        current = self.data_lake.get_latest_version(dataset_name)
        if (
            not force
            and current
            and self._is_up_to_date(dataset_name, current.version_id)
        ):
            return None

        input_data: Dict[str, Any] = {}
        dependency_versions: List[Tuple[str, str]] = []
        for dep in prog.input_datasets:
            latest = self.data_lake.get_latest_version(dep)
            if not latest:
                if dep in self.dataset_derivation_map:
                    self.build_dataset(dep)
                    latest = self.data_lake.get_latest_version(dep)
                if not latest:
                    return None
            dep_data = self.transaction_service.read_version(dep, latest.version_id)
            if dep_data is None:
                return None
            input_data[dep] = dep_data
            dependency_versions.append((dep, latest.version_id))

        start = time.time()
        result_data = self._execute_program(prog, input_data)
        duration = time.time() - start
        if result_data is None:
            return None

        tx_id, ok = self.transaction_service.start_transaction(
            dataset_name, "build_service"
        )
        if not ok:
            return None
        if self.transaction_service.write_data(tx_id, result_data):
            version_id = self.transaction_service.commit_transaction(tx_id)
            if version_id:
                self._add_build_catalog_entry(
                    dataset_name,
                    version_id,
                    prog_name,
                    prog.version,
                    dependency_versions,
                    duration,
                    build_trigger,
                )
                info = self.data_lake.get_dataset_info(dataset_name)
                if info:
                    info.last_built_at = datetime.now()
                    info.last_build_status = "success"
                return version_id
        return None

    def _execute_program(
        self, prog: DerivationProgram, input_data: Dict[str, Any]
    ) -> Any:
        result: Dict[str, Any] = {
            "program": prog.program_name,
            "version": prog.version,
            "program_type": prog.program_type,
            "inputs": list(input_data.keys()),
            "output": {},
            "execution_time": datetime.now().isoformat(),
        }

        if prog.program_type == "python":
            safe_builtins = {
                "list": list,
                "dict": dict,
                "str": str,
                "int": int,
                "float": float,
                "len": len,
                "sum": sum,
                "range": range,
                "set": set,
                "min": min,
                "max": max,
                "sorted": sorted,
                "enumerate": enumerate,
                "zip": zip,
                "True": True,
                "False": False,
                "None": None,
            }
            local_ns: Dict[str, Any] = {}
            try:
                exec(prog.code, {"__builtins__": safe_builtins}, local_ns)
                transform = local_ns.get("transform")
                if callable(transform):
                    result["output"] = transform(input_data)
                    return result
            except Exception:
                pass

            if len(input_data) == 1:
                name, data = next(iter(input_data.items()))
                result["output"] = {
                    "source": name,
                    "transformed": data,
                    "metadata": {
                        "program": prog.program_name,
                        "version": prog.version,
                    },
                }
            else:
                result["output"] = {
                    "combined": {
                        n: (d if isinstance(d, dict) else str(d)[:100])
                        for n, d in input_data.items()
                    },
                    "metadata": {
                        "sources": list(input_data.keys()),
                        "program": prog.program_name,
                        "version": prog.version,
                    },
                }
        elif prog.program_type == "sql":
            result["output"] = {
                "sql_result": {n: str(d)[:50] for n, d in input_data.items()},
                "query_preview": prog.code[:100],
            }
        elif prog.program_type == "spark":
            result["output"] = {
                "spark_result": {
                    "sources": list(input_data.keys()),
                    "row_count": sum(
                        len(d) if isinstance(d, list) else 1
                        for d in input_data.values()
                    ),
                }
            }
        else:
            result["output"] = input_data
        return result

    def _add_build_catalog_entry(
        self,
        dataset_name: str,
        version_id: str,
        prog_name: str,
        prog_version: str,
        dependency_versions: List[Tuple[str, str]],
        build_duration: float,
        build_trigger: str,
    ) -> None:
        dependencies = [
            BuildDependency(
                dataset_name=dep_name,
                version_id=dep_version,
                dependent_dataset=dataset_name,
                dependent_version=version_id,
                derivation_program_name=prog_name,
                derivation_program_version=prog_version,
            )
            for dep_name, dep_version in dependency_versions
        ]
        version = self.data_lake.get_version(dataset_name, version_id)
        entry = BuildCatalogEntry(
            dataset_name=dataset_name,
            dataset_version=version_id,
            derivation_program_name=prog_name,
            derivation_program_version=prog_version,
            input_dependencies=dependencies,
            build_duration_seconds=build_duration,
            build_status="success",
            build_trigger=build_trigger,
            output_containers=version.container_ids if version else [],
        )
        self.data_lake.add_build_catalog_entry(entry)
        self.build_catalog.setdefault(dataset_name, []).append(entry)
        self._build_history.append(
            {
                "dataset": dataset_name,
                "version": version_id,
                "program": prog_name,
                "program_version": prog_version,
                "duration": build_duration,
                "trigger": build_trigger,
                "timestamp": datetime.now().isoformat(),
            }
        )

    def _is_up_to_date(self, dataset_name: str, current_version: str) -> bool:
        entry = self.data_lake.get_build_catalog_entry(dataset_name, current_version)
        if not entry:
            return False
        for dep in entry.input_dependencies:
            latest = self.data_lake.get_latest_version(dep.dataset_name)
            if latest and latest.version_id != dep.version_id:
                return False
        if entry.derivation_program_name in self.derivation_programs:
            latest_prog = self.derivation_programs[entry.derivation_program_name][-1]
            if latest_prog.version != entry.derivation_program_version:
                return False
        return True

    def build_all(self, build_trigger: str = "scheduled") -> Dict[str, Optional[str]]:
        results: Dict[str, Optional[str]] = {}
        derived = list(self.dataset_derivation_map.keys())
        built: Set[str] = set()
        iterations = 0
        while len(built) < len(derived) and iterations < len(derived) * 2:
            iterations += 1
            progress = False
            for ds in derived:
                if ds in built:
                    continue
                deps = self.build_dependency_graph.get(ds, set())
                if any(d in derived and d not in built for d in deps):
                    continue
                results[ds] = self.build_dataset(ds, build_trigger=build_trigger)
                built.add(ds)
                progress = True
                break
            if not progress:
                for ds in derived:
                    if ds not in built:
                        results[ds] = None
                break
        return results

    def get_build_catalog_entry(
        self, dataset_name: str, version_id: str
    ) -> Optional[BuildCatalogEntry]:
        return self.data_lake.get_build_catalog_entry(dataset_name, version_id)

    def get_all_build_catalog_entries(
        self, dataset_name: str
    ) -> List[BuildCatalogEntry]:
        return self.data_lake.get_build_catalog(dataset_name)

    def get_build_dependencies(self, dataset_name: str) -> Set[str]:
        return self.build_dependency_graph.get(dataset_name, set())

    def get_reverse_dependencies(self, dataset_name: str) -> Set[str]:
        return self.reverse_dependency_graph.get(dataset_name, set())

    def get_full_dependency_chain(self, dataset_name: str) -> List[str]:
        result: List[str] = []
        visited: Set[str] = set()

        def traverse(ds: str) -> None:
            if ds in visited:
                return
            visited.add(ds)
            for dep in self.build_dependency_graph.get(ds, set()):
                traverse(dep)
            result.append(ds)

        traverse(dataset_name)
        return result

    def get_derivation_program_history(
        self, program_name: str
    ) -> List[DerivationProgram]:
        return self.derivation_programs.get(program_name, [])

    def get_derivation_program_latest(
        self, program_name: str
    ) -> Optional[DerivationProgram]:
        versions = self.derivation_programs.get(program_name, [])
        return versions[-1] if versions else None

    def get_build_dependency_graph(self) -> Dict[str, Set[str]]:
        return self.build_dependency_graph

    def process_build_queue(self) -> Dict[str, Optional[str]]:
        results: Dict[str, Optional[str]] = {}
        while self._build_queue:
            msg = self._build_queue.pop(0)
            results[msg.dataset_name] = self.build_dataset(
                msg.dataset_name, build_trigger="queue_triggered"
            )
        return results

    def get_build_history(self, limit: int = 100) -> List[Dict[str, Any]]:
        return self._build_history[-limit:]
