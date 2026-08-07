"""Graphical interface for the data integration tool."""

from __future__ import annotations

import json
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, scrolledtext, ttk
from typing import Optional

from .object_model import ObjectModelCollection
from .ontology import Ontology
from .schema_map import FieldMapping, ObjectMapping, SchemaMap
from .transformation_engine import (
    CSVDataSource,
    DataSource,
    JSONDataSource,
    ProactiveDebugger,
    TransformationEngine,
    TransformationScript,
)


class DataIntegrationGUI:
    """Graphical interface for the data integration tool."""

    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title("Data Integration Tool - US8930897")
        self.root.geometry("1200x800")

        self.ontology: Optional[Ontology] = None
        self.schema_map: Optional[SchemaMap] = None
        self.engine: Optional[TransformationEngine] = None
        self.debugger: Optional[ProactiveDebugger] = None
        self.current_script: Optional[TransformationScript] = None
        self.data_source: Optional[DataSource] = None

        self._setup_ui()
        self._setup_menu()

    def _setup_ui(self) -> None:
        """Set up the main UI components."""
        main_frame = ttk.Frame(self.root)
        main_frame.pack(fill=tk.BOTH, expand=True)

        left_panel = ttk.Frame(main_frame, width=400)
        left_panel.pack(side=tk.LEFT, fill=tk.BOTH, expand=False)

        right_panel = ttk.Frame(main_frame)
        right_panel.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True)

        ontology_frame = ttk.LabelFrame(left_panel, text="Ontology", padding=10)
        ontology_frame.pack(fill=tk.X, pady=5)

        ttk.Button(
            ontology_frame, text="Load Ontology", command=self._load_ontology
        ).pack(fill=tk.X, pady=2)
        ttk.Button(
            ontology_frame, text="Create Ontology", command=self._create_ontology
        ).pack(fill=tk.X, pady=2)

        schema_frame = ttk.LabelFrame(left_panel, text="Schema Map", padding=10)
        schema_frame.pack(fill=tk.X, pady=5)

        ttk.Button(
            schema_frame, text="Load Schema Map", command=self._load_schema
        ).pack(fill=tk.X, pady=2)
        ttk.Button(
            schema_frame, text="Create Schema Map", command=self._create_schema
        ).pack(fill=tk.X, pady=2)

        source_frame = ttk.LabelFrame(left_panel, text="Data Source", padding=10)
        source_frame.pack(fill=tk.X, pady=5)

        ttk.Button(source_frame, text="Load CSV", command=self._load_csv).pack(
            fill=tk.X, pady=2
        )
        ttk.Button(source_frame, text="Load JSON", command=self._load_json).pack(
            fill=tk.X, pady=2
        )

        script_frame = ttk.LabelFrame(
            left_panel, text="Transformation Script", padding=10
        )
        script_frame.pack(fill=tk.X, pady=5)

        self.script_text = scrolledtext.ScrolledText(script_frame, height=10)
        self.script_text.pack(fill=tk.X, pady=5)

        ttk.Button(script_frame, text="Load Script", command=self._load_script).pack(
            fill=tk.X, pady=2
        )
        ttk.Button(script_frame, text="Save Script", command=self._save_script).pack(
            fill=tk.X, pady=2
        )

        controls_frame = ttk.LabelFrame(left_panel, text="Controls", padding=10)
        controls_frame.pack(fill=tk.X, pady=5)

        controls_row = ttk.Frame(controls_frame)
        controls_row.pack(fill=tk.X)

        ttk.Button(controls_row, text="Debug", command=self._debug_script).pack(
            side=tk.LEFT, padx=2
        )
        ttk.Button(controls_row, text="Run", command=self._run_script).pack(
            side=tk.LEFT, padx=2
        )
        ttk.Button(controls_row, text="Validate", command=self._validate_script).pack(
            side=tk.LEFT, padx=2
        )

        self.debug_mode = tk.BooleanVar(value=True)
        ttk.Checkbutton(
            controls_frame,
            text="Proactive Debugging",
            variable=self.debug_mode,
        ).pack(anchor=tk.W)

        output_frame = ttk.LabelFrame(right_panel, text="Output", padding=10)
        output_frame.pack(fill=tk.BOTH, expand=True)

        self.output_text = scrolledtext.ScrolledText(output_frame)
        self.output_text.pack(fill=tk.BOTH, expand=True)

        self.status_var = tk.StringVar(value="Ready")
        status_bar = ttk.Label(
            self.root, textvariable=self.status_var, relief=tk.SUNKEN
        )
        status_bar.pack(side=tk.BOTTOM, fill=tk.X)

    def _setup_menu(self) -> None:
        """Set up the menu bar."""
        menu_bar = tk.Menu(self.root)
        self.root.config(menu=menu_bar)

        file_menu = tk.Menu(menu_bar, tearoff=0)
        menu_bar.add_cascade(label="File", menu=file_menu)
        file_menu.add_command(label="New Project", command=self._new_project)
        file_menu.add_command(label="Open Project", command=self._open_project)
        file_menu.add_command(label="Save Project", command=self._save_project)
        file_menu.add_separator()
        file_menu.add_command(label="Exit", command=self.root.quit)

        view_menu = tk.Menu(menu_bar, tearoff=0)
        menu_bar.add_cascade(label="View", menu=view_menu)
        view_menu.add_command(label="Clear Output", command=self._clear_output)
        view_menu.add_command(
            label="Show Debug Events", command=self._show_debug_events
        )

        help_menu = tk.Menu(menu_bar, tearoff=0)
        menu_bar.add_cascade(label="Help", menu=help_menu)
        help_menu.add_command(label="About", command=self._show_about)

    def _ensure_engine(self) -> None:
        """Ensure transformation engine exists with current ontology/schema."""
        if not self.ontology:
            return
        schema = self.schema_map or SchemaMap()
        self.engine = TransformationEngine(self.ontology, schema)

    def _log(self, message: str, level: str = "INFO") -> None:
        """Log a message to the output."""
        self.output_text.insert(tk.END, f"[{level}] {message}\n")
        self.output_text.see(tk.END)
        self.root.update()

    def _load_ontology(self) -> None:
        """Load an ontology from a file."""
        filepath = filedialog.askopenfilename(
            title="Load Ontology",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
        )
        if not filepath:
            return

        try:
            self.ontology = Ontology.load_from_file(filepath)
            self._ensure_engine()
            self._log(f"Ontology loaded: {filepath}")
            self.status_var.set(f"Ontology loaded: {filepath}")
            self._log(f"Objects: {len(self.ontology.objects)}")
            self._log(f"Properties: {len(self.ontology.properties)}")
            self._log(f"Links: {len(self.ontology.links)}")
        except Exception as e:
            self._log(f"Error loading ontology: {e}", "ERROR")

    def _create_ontology(self) -> None:
        """Create a new ontology with sample data."""
        self.ontology = Ontology()

        self.ontology.add_object("Person", "A person or individual")
        self.ontology.add_object("Organization", "An organization or company")
        self.ontology.add_object("Event", "An event or occurrence")
        self.ontology.add_object("PhoneCall", "A phone call event")
        self.ontology.add_object("Location", "A physical location")

        self.ontology.add_property("name", "Person", "string", True)
        self.ontology.add_property("firstName", "Person", "string")
        self.ontology.add_property("lastName", "Person", "string")
        self.ontology.add_property("email", "Person", "string")
        self.ontology.add_property("phone", "Person", "string")
        self.ontology.add_property("address", "Person", "string")
        self.ontology.add_property("ssn", "Person", "string")

        self.ontology.add_property("name", "Organization", "string", True)
        self.ontology.add_property("type", "Organization", "string")
        self.ontology.add_property("industry", "Organization", "string")
        self.ontology.add_property("founded", "Organization", "date")

        self.ontology.add_property("name", "Event", "string", True)
        self.ontology.add_property("date", "Event", "date")
        self.ontology.add_property("description", "Event", "string")
        self.ontology.add_property("location", "Event", "string")

        self.ontology.add_property("duration", "PhoneCall", "number")
        self.ontology.add_property("timestamp", "PhoneCall", "datetime")
        self.ontology.add_property("caller", "PhoneCall", "string")
        self.ontology.add_property("receiver", "PhoneCall", "string")

        self.ontology.add_property("name", "Location", "string", True)
        self.ontology.add_property("address", "Location", "string")
        self.ontology.add_property("city", "Location", "string")
        self.ontology.add_property("state", "Location", "string")
        self.ontology.add_property("zip", "Location", "string")

        self.ontology.add_link("worksFor", "Person", "Organization")
        self.ontology.add_link("locatedAt", "Person", "Location")
        self.ontology.add_link("locatedAt", "Organization", "Location")
        self.ontology.add_link("attends", "Person", "Event")
        self.ontology.add_link("organizes", "Organization", "Event")
        self.ontology.add_link("calls", "Person", "PhoneCall")
        self.ontology.add_link("receives", "Person", "PhoneCall")

        self._ensure_engine()
        self._log("New ontology created with sample data")
        self.status_var.set("New ontology created")
        self._log(f"Objects: {len(self.ontology.objects)}")
        self._log(f"Properties: {len(self.ontology.properties)}")
        self._log(f"Links: {len(self.ontology.links)}")

    def _load_schema(self) -> None:
        """Load a schema map from a file."""
        filepath = filedialog.askopenfilename(
            title="Load Schema Map",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
        )
        if not filepath:
            return

        try:
            self.schema_map = SchemaMap.load_from_file(filepath)
            self._ensure_engine()
            self._log(f"Schema map loaded: {filepath}")
            self.status_var.set(f"Schema map loaded: {filepath}")
        except Exception as e:
            self._log(f"Error loading schema map: {e}", "ERROR")

    def _create_schema(self) -> None:
        """Create a new schema map."""
        if not self.ontology:
            self._log("Please load or create an ontology first", "ERROR")
            return

        self.schema_map = SchemaMap()

        person_mapping = ObjectMapping(source_type="csv", target_object="Person")
        person_mapping.field_mappings = [
            FieldMapping("name", "name", "Person"),
            FieldMapping("first_name", "firstName", "Person"),
            FieldMapping("last_name", "lastName", "Person"),
            FieldMapping("email", "email", "Person"),
            FieldMapping("phone", "phone", "Person"),
            FieldMapping("address", "address", "Person"),
            FieldMapping("ssn", "ssn", "Person"),
        ]
        self.schema_map.add_object_mapping(person_mapping)

        self._ensure_engine()
        self._log("New schema map created with sample mappings")
        self.status_var.set("New schema map created")

    def _load_csv(self) -> None:
        """Load a CSV data source."""
        filepath = filedialog.askopenfilename(
            title="Load CSV",
            filetypes=[("CSV files", "*.csv"), ("All files", "*.*")],
        )
        if not filepath:
            return

        try:
            self.data_source = CSVDataSource(filepath)
            self._log(f"CSV loaded: {filepath}")
            self.status_var.set(f"CSV loaded: {filepath}")
            schema = self.data_source.get_schema()
            self._log(f"CSV Schema: {schema}")
        except Exception as e:
            self._log(f"Error loading CSV: {e}", "ERROR")

    def _load_json(self) -> None:
        """Load a JSON data source."""
        filepath = filedialog.askopenfilename(
            title="Load JSON",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
        )
        if not filepath:
            return

        try:
            self.data_source = JSONDataSource(filepath)
            self._log(f"JSON loaded: {filepath}")
            self.status_var.set(f"JSON loaded: {filepath}")
            schema = self.data_source.get_schema()
            self._log(f"JSON Schema: {schema}")
        except Exception as e:
            self._log(f"Error loading JSON: {e}", "ERROR")

    def _load_script(self) -> None:
        """Load a transformation script from a file."""
        filepath = filedialog.askopenfilename(
            title="Load Script",
            filetypes=[
                ("Groovy files", "*.groovy"),
                ("Python files", "*.py"),
                ("All files", "*.*"),
            ],
        )
        if not filepath:
            return

        try:
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()
            self.script_text.delete("1.0", tk.END)
            self.script_text.insert("1.0", content)
            self.current_script = TransformationScript(filepath, content)
            self._log(f"Script loaded: {filepath}")
            self.status_var.set(f"Script loaded: {filepath}")

            conditions = self.current_script.get_conditions()
            if conditions:
                self._log(f"Found {len(conditions)} conditions:")
                for cond in conditions:
                    self._log(f"  - {cond.type}: {cond.expression}")
        except Exception as e:
            self._log(f"Error loading script: {e}", "ERROR")

    def _save_script(self) -> None:
        """Save the current script to a file."""
        filepath = filedialog.asksaveasfilename(
            title="Save Script",
            defaultextension=".groovy",
            filetypes=[("Groovy files", "*.groovy"), ("All files", "*.*")],
        )
        if not filepath:
            return

        try:
            content = self.script_text.get("1.0", tk.END)
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            self.current_script = TransformationScript(filepath, content)
            self._log(f"Script saved: {filepath}")
            self.status_var.set(f"Script saved: {filepath}")
        except Exception as e:
            self._log(f"Error saving script: {e}", "ERROR")

    def _validate_script(self) -> None:
        """Validate the current script."""
        content = self.script_text.get("1.0", tk.END).strip()
        if content:
            self.current_script = TransformationScript("editor.groovy", content)

        if not self.current_script:
            self._log("Please load a script first", "ERROR")
            return

        if not self.engine:
            self._log("Please load or create an ontology first", "ERROR")
            return

        self._log("Validating script...")
        is_valid = self.engine.validate_script(self.current_script)

        results = self.engine.get_validation_results()
        if results["errors"]:
            self._log("Errors:", "ERROR")
            for error in results["errors"]:
                self._log(f"  - {error}", "ERROR")

        if results["warnings"]:
            self._log("Warnings:", "WARNING")
            for warning in results["warnings"]:
                self._log(f"  - {warning}", "WARNING")

        if is_valid:
            self._log("Script is valid")
        else:
            self._log("Script has errors")

    def _debug_script(self) -> None:
        """Debug the current script with proactive validation."""
        content = self.script_text.get("1.0", tk.END).strip()
        if content:
            self.current_script = TransformationScript("editor.groovy", content)

        if not self.current_script:
            self._log("Please load a script first", "ERROR")
            return

        if not self.data_source:
            self._log("Please load a data source first", "ERROR")
            return

        if not self.engine:
            self._log("Please load or create an ontology first", "ERROR")
            return

        self._log("Starting proactive debugging...")
        self._log(f"Debug mode: {self.debug_mode.get()}")

        self.engine.set_debug_mode(self.debug_mode.get())
        self.debugger = ProactiveDebugger(self.engine)

        result = self.debugger.debug_script(
            self.current_script,
            self.data_source,
            max_rows=10,
        )

        self._log(f"Debugging complete: {result.objects_created} objects created")

        if result.errors:
            self._log(f"Errors: {len(result.errors)}", "ERROR")
            for error in result.errors:
                self._log(f"  - {error}", "ERROR")

        if result.warnings:
            self._log(f"Warnings: {len(result.warnings)}", "WARNING")
            for warning in result.warnings:
                self._log(f"  - {warning}", "WARNING")

        summary = self.debugger.get_debug_summary()
        self._log(f"Debug summary: {summary}")

        events = self.debugger.get_debug_events()
        if events:
            self._log("Debug events:")
            for event in events[:5]:
                self._log(
                    f"  Row {event['row']}: Created: {event['object_created']}"
                )

    def _run_script(self) -> None:
        """Run the current script."""
        content = self.script_text.get("1.0", tk.END).strip()
        if content:
            self.current_script = TransformationScript("editor.groovy", content)

        if not self.current_script:
            self._log("Please load a script first", "ERROR")
            return

        if not self.data_source:
            self._log("Please load a data source first", "ERROR")
            return

        if not self.engine:
            self._log("Please load or create an ontology first", "ERROR")
            return

        self._log("Running script...")
        self.engine.collection = ObjectModelCollection()

        result = self.engine.execute_script(self.current_script, self.data_source)

        self._log(
            f"Transformation complete: {result.objects_created} objects created"
        )

        if result.errors:
            self._log(f"Errors: {len(result.errors)}", "ERROR")
            for error in result.errors:
                self._log(f"  - {error}", "ERROR")

        if result.warnings:
            self._log(f"Warnings: {len(result.warnings)}", "WARNING")
            for warning in result.warnings:
                self._log(f"  - {warning}", "WARNING")

    def _show_debug_events(self) -> None:
        """Show debug events."""
        if not self.debugger:
            self._log(
                "No debug events available. Run a debug session first.", "INFO"
            )
            return

        events = self.debugger.get_debug_events()
        if not events:
            self._log("No debug events recorded.", "INFO")
            return

        self._log("Debug Events:")
        for event in events:
            self._log(f"  Row {event['row']}:")
            self._log(f"    Data: {event['data']}")
            self._log(f"    Object Created: {event['object_created']}")
            if event["errors"]:
                self._log(f"    Errors: {event['errors']}", "ERROR")
            if event["warnings"]:
                self._log(f"    Warnings: {event['warnings']}", "WARNING")

    def _clear_output(self) -> None:
        """Clear the output area."""
        self.output_text.delete("1.0", tk.END)

    def _new_project(self) -> None:
        """Create a new project."""
        self.ontology = None
        self.schema_map = None
        self.engine = None
        self.debugger = None
        self.current_script = None
        self.data_source = None
        self.script_text.delete("1.0", tk.END)
        self._clear_output()
        self._log("New project created")
        self.status_var.set("New project created")

    def _open_project(self) -> None:
        """Open a project from a file."""
        filepath = filedialog.askopenfilename(
            title="Open Project",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
        )
        if not filepath:
            return

        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)

            if "ontology" in data:
                self.ontology = Ontology.from_dict(data["ontology"])
                self._log("Ontology loaded from project")

            if "schema_map" in data:
                self.schema_map = SchemaMap.from_dict(data["schema_map"])
                self._log("Schema map loaded from project")

            self._ensure_engine()

            if "script" in data:
                self.script_text.delete("1.0", tk.END)
                self.script_text.insert("1.0", data["script"])
                self.current_script = TransformationScript(
                    "project.groovy", data["script"]
                )
                self._log("Script loaded from project")

            self._log(f"Project opened: {filepath}")
            self.status_var.set(f"Project opened: {filepath}")
        except Exception as e:
            self._log(f"Error opening project: {e}", "ERROR")

    def _save_project(self) -> None:
        """Save the current project to a file."""
        filepath = filedialog.asksaveasfilename(
            title="Save Project",
            defaultextension=".json",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
        )
        if not filepath:
            return

        try:
            data = {}

            if self.ontology:
                data["ontology"] = self.ontology.to_dict()

            if self.schema_map:
                data["schema_map"] = self.schema_map.to_dict()

            script_content = self.script_text.get("1.0", tk.END).strip()
            if script_content:
                data["script"] = script_content

            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)

            self._log(f"Project saved: {filepath}")
            self.status_var.set(f"Project saved: {filepath}")
        except Exception as e:
            self._log(f"Error saving project: {e}", "ERROR")

    def _show_about(self) -> None:
        """Show about dialog."""
        messagebox.showinfo(
            "About",
            "Data Integration Tool\n"
            "Based on US8930897\n\n"
            "Provides proactive validation of transformation scripts\n"
            "using ontology-based validation.",
        )

    def run(self) -> None:
        """Run the GUI."""
        self.root.mainloop()


def main() -> None:
    """Main entry point for the GUI."""
    # Prefer loading default config if present.
    default_ontology = Path(__file__).resolve().parents[1] / "config" / "ontology_config.json"
    gui = DataIntegrationGUI()
    if default_ontology.exists():
        try:
            gui.ontology = Ontology.load_from_file(str(default_ontology))
            gui._ensure_engine()
            gui._log(f"Default ontology loaded from {default_ontology}")
        except Exception:
            pass
    gui.run()


if __name__ == "__main__":
    main()
