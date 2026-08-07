"""Tkinter GUI for provenance visualization (US9996595)."""

from __future__ import annotations

import json
import tkinter as tk
from datetime import datetime
from tkinter import filedialog, messagebox, scrolledtext, ttk
from typing import Optional

from .build_service import BuildService
from .data_lake import DataLake
from .provenance import ProvenanceGraph, ProvenanceResolver
from .transaction_service import TransactionService


class ProvenanceVisualizationGUI:
    """Graphical interface for visualizing full data provenance."""

    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title("Data Provenance Visualization - US9996595")
        self.root.geometry("1400x900")

        self.data_lake = DataLake()
        self.tx_service = TransactionService(self.data_lake)
        self.build_service = BuildService(self.data_lake, self.tx_service)
        self.provenance_resolver = ProvenanceResolver(
            self.data_lake, self.build_service
        )

        self.current_graph: Optional[ProvenanceGraph] = None
        self._setup_ui()
        self._create_demo_data()

    def _setup_ui(self) -> None:
        main_paned = ttk.PanedWindow(self.root, orient=tk.HORIZONTAL)
        main_paned.pack(fill=tk.BOTH, expand=True)

        left_frame = ttk.Frame(main_paned, width=450)
        main_paned.add(left_frame, weight=1)
        right_frame = ttk.Frame(main_paned)
        main_paned.add(right_frame, weight=3)

        select_frame = ttk.LabelFrame(left_frame, text="Dataset Selection", padding=10)
        select_frame.pack(fill=tk.X, pady=5)
        ttk.Label(select_frame, text="Dataset:").pack(anchor=tk.W)
        self.dataset_var = tk.StringVar()
        self.dataset_combo = ttk.Combobox(
            select_frame, textvariable=self.dataset_var, state="readonly"
        )
        self.dataset_combo.pack(fill=tk.X, pady=2)
        self.dataset_combo.bind("<<ComboboxSelected>>", self._on_dataset_select)
        ttk.Button(
            select_frame, text="Refresh Datasets", command=self._refresh_datasets
        ).pack(fill=tk.X, pady=2)

        version_frame = ttk.LabelFrame(left_frame, text="Version Selection", padding=10)
        version_frame.pack(fill=tk.X, pady=5)
        ttk.Label(version_frame, text="Version:").pack(anchor=tk.W)
        self.version_var = tk.StringVar()
        self.version_combo = ttk.Combobox(
            version_frame, textvariable=self.version_var, state="readonly"
        )
        self.version_combo.pack(fill=tk.X, pady=2)
        ttk.Button(
            version_frame, text="Show Provenance", command=self._show_provenance
        ).pack(fill=tk.X, pady=2)
        ttk.Button(version_frame, text="Show Latest", command=self._show_latest).pack(
            fill=tk.X, pady=2
        )

        invalid_frame = ttk.LabelFrame(left_frame, text="Invalidate Version", padding=10)
        invalid_frame.pack(fill=tk.X, pady=5)
        self.invalid_dataset_var = tk.StringVar()
        self.invalid_version_var = tk.StringVar()
        self.invalid_reason_var = tk.StringVar(value="Data validation failed")
        ttk.Label(invalid_frame, text="Dataset:").pack(anchor=tk.W)
        ttk.Entry(invalid_frame, textvariable=self.invalid_dataset_var).pack(
            fill=tk.X, pady=1
        )
        ttk.Label(invalid_frame, text="Version ID:").pack(anchor=tk.W)
        ttk.Entry(invalid_frame, textvariable=self.invalid_version_var).pack(
            fill=tk.X, pady=1
        )
        ttk.Label(invalid_frame, text="Reason:").pack(anchor=tk.W)
        ttk.Entry(invalid_frame, textvariable=self.invalid_reason_var).pack(
            fill=tk.X, pady=1
        )
        btn_frame = ttk.Frame(invalid_frame)
        btn_frame.pack(fill=tk.X, pady=2)
        ttk.Button(btn_frame, text="Mark Invalid", command=self._mark_invalid).pack(
            side=tk.LEFT, padx=2
        )
        ttk.Button(btn_frame, text="Clear Invalid", command=self._clear_invalid).pack(
            side=tk.LEFT, padx=2
        )

        build_frame = ttk.LabelFrame(left_frame, text="Build Controls", padding=10)
        build_frame.pack(fill=tk.X, pady=5)
        btn_frame2 = ttk.Frame(build_frame)
        btn_frame2.pack(fill=tk.X)
        ttk.Button(btn_frame2, text="Build All", command=self._build_all).pack(
            side=tk.LEFT, padx=2
        )
        ttk.Button(
            btn_frame2, text="Build Selected", command=self._build_selected
        ).pack(side=tk.LEFT, padx=2)
        ttk.Button(
            btn_frame2, text="Add Sample Data", command=self._add_sample_data
        ).pack(side=tk.LEFT, padx=2)

        stats_frame = ttk.LabelFrame(
            left_frame, text="Provenance Statistics", padding=10
        )
        stats_frame.pack(fill=tk.X, pady=5)
        self.stats_text = tk.Text(stats_frame, height=8, width=40)
        self.stats_text.pack(fill=tk.X)

        log_frame = ttk.LabelFrame(left_frame, text="Log", padding=10)
        log_frame.pack(fill=tk.BOTH, expand=True, pady=5)
        self.log_text = scrolledtext.ScrolledText(log_frame, height=6)
        self.log_text.pack(fill=tk.BOTH, expand=True)

        viz_frame = ttk.LabelFrame(right_frame, text="Provenance Graph", padding=10)
        viz_frame.pack(fill=tk.BOTH, expand=True)
        tool_frame = ttk.Frame(viz_frame)
        tool_frame.pack(fill=tk.X, pady=2)
        ttk.Button(tool_frame, text="Export JSON", command=self._export_json).pack(
            side=tk.LEFT, padx=2
        )
        ttk.Button(tool_frame, text="Clear", command=self._clear_viz).pack(
            side=tk.LEFT, padx=2
        )
        self.viz_text = scrolledtext.ScrolledText(viz_frame, font=("Courier", 10))
        self.viz_text.pack(fill=tk.BOTH, expand=True)

        self.status_var = tk.StringVar(value="Ready")
        ttk.Label(self.root, textvariable=self.status_var, relief=tk.SUNKEN).pack(
            side=tk.BOTTOM, fill=tk.X
        )

    def _log(self, msg: str) -> None:
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_text.insert(tk.END, f"[{timestamp}] {msg}\n")
        self.log_text.see(tk.END)
        self.root.update()

    def _refresh_datasets(self) -> None:
        datasets = self.data_lake.list_datasets()
        self.dataset_combo["values"] = datasets
        if datasets:
            self.dataset_combo.set(datasets[0])
            self._refresh_versions(datasets[0])
        self._log(f"Refreshed datasets: {len(datasets)} datasets found")

    def _refresh_versions(self, dataset_name: str) -> None:
        versions = self.data_lake.get_all_versions(dataset_name)
        version_ids = [v.version_id for v in versions]
        self.version_combo["values"] = version_ids
        if version_ids:
            self.version_combo.set(version_ids[-1])
        self._log(f"Dataset {dataset_name} has {len(version_ids)} versions")

    def _on_dataset_select(self, event=None) -> None:
        ds = self.dataset_var.get()
        if ds:
            self._refresh_versions(ds)

    def _show_provenance(self) -> None:
        ds = self.dataset_var.get()
        ver = self.version_var.get()
        if not ds or not ver:
            self._log("Please select a dataset and version")
            return
        graph = self.provenance_resolver.get_full_provenance(ds, ver)
        if not graph:
            self._log("No provenance found")
            return
        self.current_graph = graph
        self._render_graph(graph)
        self._update_stats(graph)
        self._log(
            f"Provenance resolved: {len(graph.nodes)} datasets, {len(graph.edges)} edges"
        )

    def _show_latest(self) -> None:
        ds = self.dataset_var.get()
        if not ds:
            self._log("Please select a dataset")
            return
        latest = self.data_lake.get_latest_version(ds)
        if not latest:
            self._log(f"No versions found for dataset {ds}")
            return
        self.version_var.set(latest.version_id)
        self._show_provenance()

    def _render_graph(self, graph: ProvenanceGraph) -> None:
        self.viz_text.delete("1.0", tk.END)
        lines = [
            "=" * 80,
            "PROVENANCE GRAPH",
            f"Selected: {graph.selected_dataset} (version {graph.selected_version})",
            "=" * 80,
            "",
            "LEGEND:",
            "  [INV]   = Invalid version",
            "  [P-INV] = Potentially invalid (depends on invalid data)",
            "  [TARGET]= Selected dataset",
            "  ===>    = Derivation dependency",
            "  =!=>    = Potentially invalid derivation",
            "",
            "COMPOUND NODES:",
            "-" * 80,
        ]
        for ds_name, node in sorted(graph.nodes.items()):
            marker = " [TARGET]" if ds_name == graph.selected_dataset else ""
            lines.append(f"  Dataset: {ds_name}{marker}")
            for v_id in sorted(node.versions.keys()):
                v_obj = node.versions[v_id]
                invalid = " [INV]" if node.is_version_invalid(v_id) else ""
                pot_invalid = (
                    " [P-INV]" if node.is_version_potentially_invalid(v_id) else ""
                )
                parent = (
                    f" (parent: {v_obj.parent_version_id})"
                    if v_obj.parent_version_id
                    else ""
                )
                lines.append(f"    ├─ {v_id}{invalid}{pot_invalid}{parent}")
            lines.append("")

        if graph.edges:
            lines.extend(["EDGES:", "-" * 80])
            for edge in graph.edges:
                from_node = graph.nodes.get(edge.from_dataset)
                is_pot_inv = from_node and from_node.is_version_potentially_invalid(
                    edge.from_version
                )
                arrow = "=!=>" if is_pot_inv else "===>"
                marker = " [POTENTIALLY INVALID]" if is_pot_inv else ""
                prog = (
                    f" (via {edge.derivation_program_name} "
                    f"v{edge.derivation_program_version})"
                    if edge.derivation_program_name
                    else ""
                )
                lines.append(
                    f"  {edge.from_dataset}:{edge.from_version} {arrow} "
                    f"{edge.to_dataset}:{edge.to_version}{marker}{prog}"
                )
            lines.append("")

        stats = graph.get_statistics()
        lines.extend(
            [
                "STATISTICS:",
                "-" * 80,
                f"  Total Datasets: {stats['total_datasets']}",
                f"  Total Versions: {stats['total_versions']}",
                f"  Total Edges: {stats['total_edges']}",
                f"  Invalid Versions: {stats['invalid_versions']}",
                f"  Potentially Invalid Edges: {stats['potentially_invalid_edges']}",
                "=" * 80,
            ]
        )
        self.viz_text.insert(tk.END, "\n".join(lines))
        self.status_var.set(
            f"Showing provenance for {graph.selected_dataset}:{graph.selected_version}"
        )

    def _update_stats(self, graph: ProvenanceGraph) -> None:
        self.stats_text.delete("1.0", tk.END)
        stats = graph.get_statistics()
        self.stats_text.insert(
            tk.END,
            (
                f"Selected: {graph.selected_dataset}:{graph.selected_version}\n\n"
                f"Total Datasets:   {stats['total_datasets']}\n"
                f"Total Versions:   {stats['total_versions']}\n"
                f"Total Edges:      {stats['total_edges']}\n"
                f"Invalid Versions: {stats['invalid_versions']}\n"
                f"Potentially Invalid: {stats['potentially_invalid_edges']}\n"
            ),
        )

    def _mark_invalid(self) -> None:
        ds = self.invalid_dataset_var.get().strip()
        ver = self.invalid_version_var.get().strip()
        reason = self.invalid_reason_var.get().strip() or "Data validation failed"
        if not ds or not ver:
            self._log("Please enter dataset name and version ID")
            return
        if not self.data_lake.get_version(ds, ver):
            self._log(f"Version {ver} not found for dataset {ds}")
            return
        self.provenance_resolver.mark_invalid(ds, ver, reason)
        self._log(f"Marked {ds} version {ver} as invalid: {reason}")
        if self.current_graph:
            self._show_provenance()

    def _clear_invalid(self) -> None:
        ds = self.invalid_dataset_var.get().strip()
        ver = self.invalid_version_var.get().strip()
        if not ds or not ver:
            self._log("Please enter dataset name and version ID")
            return
        self.provenance_resolver.clear_invalid_flag(ds, ver)
        self._log(f"Cleared invalid flag for {ds} version {ver}")
        if self.current_graph:
            self._show_provenance()

    def _build_all(self) -> None:
        self._log("Building all out-of-date datasets...")
        for ds, ver in self.build_service.build_all().items():
            self._log(f"  {ds}: {ver if ver else 'up-to-date/failed'}")
        self._refresh_datasets()

    def _build_selected(self) -> None:
        ds = self.dataset_var.get()
        if not ds:
            self._log("Please select a dataset to build")
            return
        result = self.build_service.build_dataset(ds, force=True)
        self._log(f"Built {ds} -> {result}" if result else f"Failed to build {ds}")
        self._refresh_datasets()

    def _add_sample_data(self) -> None:
        self._log("Adding sample data...")
        samples = {
            "A": {"records": [{"id": 1, "name": "Alice"}], "source": "internal"},
            "B": {"records": [{"id": 10, "category": "X"}], "source": "external"},
            "C": {"records": [{"id": 20, "type": "alpha"}], "source": "third_party"},
            "D": {"records": [{"id": 30, "region": "north"}], "source": "sales_db"},
            "E": {"records": [{"id": 40, "product": "widget"}], "source": "catalog"},
        }
        versions = {}
        for name, data in samples.items():
            tx_id, _ = self.tx_service.start_transaction(name, "admin")
            self.tx_service.write_data(tx_id, data)
            versions[name] = self.tx_service.commit_transaction(tx_id)
            self._log(f"Created base dataset {name}: {versions[name]}")

        code = "def transform(input_data):\n    return {'combined': list(input_data.keys())}\n"
        self.build_service.register_derivation_program(
            "P1", code, ["B", "C"], ["BC_Combined"], description="B+C"
        )
        self.build_service.register_derivation_program(
            "P2", code, ["D", "E"], ["DE_Combined"], description="D+E"
        )
        self.build_service.register_derivation_program(
            "P3",
            code,
            ["BC_Combined", "DE_Combined"],
            ["Final"],
            description="BC+DE",
        )
        self.build_service.define_derived_dataset("BC_Combined", "P1")
        self.build_service.define_derived_dataset("DE_Combined", "P2")
        self.build_service.define_derived_dataset("Final", "P3")
        self.build_service.build_dataset("BC_Combined")
        self.build_service.build_dataset("DE_Combined")
        final_v = self.build_service.build_dataset("Final")
        self._log(f"Built Final: {final_v}")

        tx_id, _ = self.tx_service.start_transaction("D", "admin")
        self.tx_service.write_data(
            tx_id, {"records": [{"id": 30, "region": "north", "sales": 1100}]}
        )
        d2 = self.tx_service.commit_transaction(tx_id)
        self._log(f"Updated D: {d2}")
        self.build_service.build_dataset("DE_Combined")
        final_v2 = self.build_service.build_dataset("Final")
        self._log(f"Rebuilt Final: {final_v2}")

        self.provenance_resolver.mark_invalid(
            "B", versions["B"], "Validation failed: missing required fields"
        )
        self._refresh_datasets()
        latest = self.data_lake.get_latest_version("Final")
        if latest:
            self.dataset_var.set("Final")
            self.version_var.set(latest.version_id)
            self._show_provenance()
        self._log("Sample data creation complete!")

    def _export_json(self) -> None:
        if not self.current_graph:
            self._log("No provenance graph to export")
            return
        filepath = filedialog.asksaveasfilename(
            title="Export Provenance Graph",
            defaultextension=".json",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
        )
        if filepath:
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(self.current_graph.to_dict(), f, indent=2, default=str)
            self._log(f"Exported graph to {filepath}")

    def _clear_viz(self) -> None:
        self.viz_text.delete("1.0", tk.END)
        self.current_graph = None
        self.status_var.set("Cleared")

    def _create_demo_data(self) -> None:
        if not self.data_lake.list_datasets():
            self._add_sample_data()
        else:
            self._refresh_datasets()

    def run(self) -> None:
        self.root.mainloop()


def main() -> None:
    ProvenanceVisualizationGUI().run()


if __name__ == "__main__":
    main()
