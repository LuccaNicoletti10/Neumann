"""Main GUI application for the Dynamic Ontology System (US7962495)."""

from __future__ import annotations

import csv
import json
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

from .object_editor_gui import ObjectTypeEditorGUI
from .ontology import DynamicOntology
from .parser_editor_gui import ParserEditorGUI
from .parser_engine import ParserEngine
from .sample_data import create_sample_ontology


class DynamicOntologyApp:
    """
    Main application for the Dynamic Ontology System.
    Implements the overall system shown in FIG. 1.
    """

    def __init__(self) -> None:
        self.ontology = DynamicOntology()
        self.parser_engine = ParserEngine()

        self.root = tk.Tk()
        self.root.title("Dynamic Ontology System - US7962495")
        self.root.geometry("900x600")

        self._setup_ui()
        create_sample_ontology(self.ontology)
        self._update_summary()
        self.status_var.set("Sample data created successfully!")

    def _setup_ui(self) -> None:
        menubar = tk.Menu(self.root)
        self.root.config(menu=menubar)

        file_menu = tk.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="File", menu=file_menu)
        file_menu.add_command(label="Export Ontology", command=self._export_ontology)
        file_menu.add_command(label="Import Ontology", command=self._import_ontology)
        file_menu.add_separator()
        file_menu.add_command(label="Exit", command=self.root.quit)

        edit_menu = tk.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="Edit", menu=edit_menu)
        edit_menu.add_command(label="Object Type Editor", command=self._open_object_editor)
        edit_menu.add_command(label="Parser Editor", command=self._open_parser_editor)

        data_menu = tk.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="Data", menu=data_menu)
        data_menu.add_command(label="Import Data", command=self._import_data)
        data_menu.add_command(label="View Data", command=self._view_data)

        help_menu = tk.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="Help", menu=help_menu)
        help_menu.add_command(label="About", command=self._show_about)

        main_frame = ttk.Frame(self.root)
        main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        left_frame = ttk.LabelFrame(main_frame, text="Ontology Summary", padding=10)
        left_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=5)

        self.summary_text = tk.Text(left_frame, height=20, width=40)
        self.summary_text.pack(fill=tk.BOTH, expand=True)

        right_frame = ttk.LabelFrame(main_frame, text="Actions", padding=10)
        right_frame.pack(side=tk.RIGHT, fill=tk.BOTH, expand=False, padx=5, ipadx=20)

        ttk.Button(
            right_frame, text="Object Type Editor", command=self._open_object_editor
        ).pack(fill=tk.X, pady=5)
        ttk.Button(
            right_frame, text="Parser Editor", command=self._open_parser_editor
        ).pack(fill=tk.X, pady=5)
        ttk.Button(right_frame, text="Import Data", command=self._import_data).pack(
            fill=tk.X, pady=5
        )
        ttk.Button(right_frame, text="View Data", command=self._view_data).pack(
            fill=tk.X, pady=5
        )
        ttk.Button(
            right_frame, text="Export Ontology", command=self._export_ontology
        ).pack(fill=tk.X, pady=5)
        ttk.Button(
            right_frame, text="Create Sample Data", command=self._create_sample_data
        ).pack(fill=tk.X, pady=5)

        self.status_var = tk.StringVar(value="Ready")
        status_bar = ttk.Label(self.root, textvariable=self.status_var, relief=tk.SUNKEN)
        status_bar.pack(side=tk.BOTTOM, fill=tk.X)

    def _update_summary(self) -> None:
        self.summary_text.delete(1.0, tk.END)

        object_types = self.ontology.list_object_types()
        property_types = self.ontology.list_property_types()
        instances = len(self.ontology.object_instances)

        self.summary_text.insert(tk.END, "DYNAMIC ONTOLOGY SUMMARY\n")
        self.summary_text.insert(tk.END, "=" * 40 + "\n\n")

        self.summary_text.insert(tk.END, f"Object Types: {len(object_types)}\n")
        for name in object_types:
            obj = self.ontology.get_object_type(name)
            props = obj.property_types if obj else []
            self.summary_text.insert(tk.END, f"  - {name} ({len(props)} properties)\n")

        self.summary_text.insert(tk.END, f"\nProperty Types: {len(property_types)}\n")
        for name in property_types:
            prop = self.ontology.get_property_type(name)
            parsers = len(prop.parser_definitions) if prop else 0
            components = len(prop.components) if prop else 0
            self.summary_text.insert(
                tk.END, f"  - {name} ({components} components, {parsers} parsers)\n"
            )

        self.summary_text.insert(tk.END, f"\nObject Instances: {instances}\n")
        count = 0
        for id_, obj in self.ontology.object_instances.items():
            if count >= 20:
                self.summary_text.insert(
                    tk.END, f"  (Showing first 20 of {instances})\n"
                )
                break
            self.summary_text.insert(tk.END, f"  - {id_[:8]} ({obj.object_type})\n")
            count += 1

    def _create_sample_data(self) -> None:
        self.status_var.set("Creating sample data...")
        create_sample_ontology(self.ontology)
        self._update_summary()
        self.status_var.set("Sample data created successfully!")

    def _open_object_editor(self) -> None:
        editor = ObjectTypeEditorGUI(self.ontology)
        editor.run()
        self._update_summary()

    def _open_parser_editor(self) -> None:
        editor = ParserEditorGUI(self.ontology, self.parser_engine)
        editor.run()
        self._update_summary()

    def _import_data(self) -> None:
        filepath = filedialog.askopenfilename(
            title="Import Data",
            filetypes=[
                ("JSON files", "*.json"),
                ("CSV files", "*.csv"),
                ("All files", "*.*"),
            ],
        )
        if not filepath:
            return

        object_type = simpledialog.askstring("Object Type", "Enter object type name:")
        if not object_type:
            return

        try:
            if filepath.endswith(".json"):
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        data = [data]
            else:
                data = []
                with open(filepath, "r", encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        data.append(row)

            results = self.ontology.parse_and_store_data(data, object_type)
            self.status_var.set(f"Imported {len(results)} records")
            self._update_summary()
        except Exception as e:
            messagebox.showerror("Import Error", str(e))

    def _view_data(self) -> None:
        view_window = tk.Toplevel(self.root)
        view_window.title("Data Viewer")
        view_window.geometry("800x500")

        instances = list(self.ontology.object_instances.values())
        if not instances:
            tk.Label(view_window, text="No data found").pack(pady=20)
            return

        tree = ttk.Treeview(view_window)
        tree.pack(fill=tk.BOTH, expand=True)

        scroll_y = ttk.Scrollbar(view_window, orient="vertical", command=tree.yview)
        scroll_y.pack(side=tk.RIGHT, fill=tk.Y)
        tree.configure(yscrollcommand=scroll_y.set)

        all_props = set()
        for obj in instances:
            all_props.update(obj.properties.keys())

        columns = ["ID", "Object Type"] + sorted(all_props)
        tree["columns"] = columns
        tree["show"] = "headings"

        for col in columns:
            tree.heading(col, text=col)
            tree.column(col, width=120)

        for obj in instances:
            row = [obj.id[:8], obj.object_type]
            for prop in sorted(all_props):
                row.append(obj.properties.get(prop, ""))
            tree.insert("", "end", values=row)

        self.status_var.set(f"Viewing {len(instances)} instances")

    def _export_ontology(self) -> None:
        filepath = filedialog.asksaveasfilename(
            title="Export Ontology",
            defaultextension=".json",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
        )
        if not filepath:
            return

        try:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(self.ontology.to_json())
            self.status_var.set(f"Exported ontology to {filepath}")
        except Exception as e:
            messagebox.showerror("Export Error", str(e))

    def _import_ontology(self) -> None:
        filepath = filedialog.askopenfilename(
            title="Import Ontology",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
        )
        if not filepath:
            return

        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.ontology = DynamicOntology.from_dict(data)
            self._update_summary()
            self.status_var.set(f"Imported ontology from {filepath}")
        except Exception as e:
            messagebox.showerror("Import Error", str(e))

    def _show_about(self) -> None:
        messagebox.showinfo(
            "About",
            "Dynamic Ontology System\n"
            "Based on US7962495\n\n"
            "Creating Data in a Data Store Using a Dynamic Ontology\n\n"
            "Features:\n"
            "- Dynamic object types and property types\n"
            "- Parser definitions with regular expressions\n"
            "- Property components (composite types)\n"
            "- Validators and constraints\n"
            "- Object-property mappings\n"
            "- Data import and parsing",
        )

    def run(self) -> None:
        self.root.mainloop()


def main() -> None:
    app = DynamicOntologyApp()
    app.run()


if __name__ == "__main__":
    main()
