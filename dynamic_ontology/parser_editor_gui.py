"""Graphical interface for editing parser definitions (FIG. 5A / US7962495)."""

from __future__ import annotations

import json
import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext, simpledialog, ttk
from typing import Any, Dict, List, Optional

from .core_types import ParserDefinition, ParserSubDefinition, ParserType
from .ontology import DynamicOntology
from .parser_engine import ParserEngine


class ParserEditorGUI:
    """
    Graphical interface for editing parser definitions.
    Implements the Parser Editor shown in FIG. 5A.
    """

    def __init__(self, ontology: DynamicOntology, parser_engine: ParserEngine):
        self.ontology = ontology
        self.parser_engine = parser_engine
        self.root = tk.Toplevel() if tk._default_root else tk.Tk()
        self.root.title("Parser Editor - US7962495")
        self.root.geometry("800x700")

        self._current_property_type: Optional[str] = None
        self._current_parser: Optional[ParserDefinition] = None
        self._sub_def_widgets: List[Dict[str, Any]] = []

        self._setup_ui()

    def _setup_ui(self) -> None:
        main_frame = ttk.Frame(self.root)
        main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        prop_frame = ttk.LabelFrame(main_frame, text="Property Type", padding=10)
        prop_frame.pack(fill=tk.X, pady=5)

        prop_row = ttk.Frame(prop_frame)
        prop_row.pack(fill=tk.X)

        ttk.Label(prop_row, text="Property Type:").pack(side=tk.LEFT, padx=5)
        self.prop_type_var = tk.StringVar()
        self.prop_type_combo = ttk.Combobox(
            prop_row, textvariable=self.prop_type_var, state="readonly", width=30
        )
        self.prop_type_combo.pack(side=tk.LEFT, padx=5)
        ttk.Button(prop_row, text="Load", command=self._load_property_type).pack(
            side=tk.LEFT, padx=5
        )
        ttk.Button(prop_row, text="New Parser", command=self._new_parser).pack(
            side=tk.LEFT, padx=5
        )

        self._refresh_property_types()

        parser_frame = ttk.LabelFrame(main_frame, text="Parser Type", padding=10)
        parser_frame.pack(fill=tk.X, pady=5)

        parser_row = ttk.Frame(parser_frame)
        parser_row.pack(fill=tk.X)

        ttk.Label(parser_row, text="Parser Type:").pack(side=tk.LEFT, padx=5)
        self.parser_type_var = tk.StringVar(value="Regular Expression")
        parser_type_combo = ttk.Combobox(
            parser_row,
            textvariable=self.parser_type_var,
            values=["Regular Expression", "Code Module", "Script"],
            state="readonly",
            width=20,
        )
        parser_type_combo.pack(side=tk.LEFT, padx=5)
        parser_type_combo.bind("<<ComboboxSelected>>", self._on_parser_type_change)

        ttk.Label(parser_row, text="Name:").pack(side=tk.LEFT, padx=5)
        self.parser_name_var = tk.StringVar()
        ttk.Entry(parser_row, textvariable=self.parser_name_var, width=20).pack(
            side=tk.LEFT, padx=5
        )

        expr_frame = ttk.LabelFrame(main_frame, text="Expression Pattern", padding=10)
        expr_frame.pack(fill=tk.X, pady=5)

        self.expr_text = scrolledtext.ScrolledText(expr_frame, height=4)
        self.expr_text.pack(fill=tk.X, pady=5)

        sub_frame = ttk.LabelFrame(
            main_frame, text="Property Component Mappings (510)", padding=10
        )
        sub_frame.pack(fill=tk.BOTH, expand=True, pady=5)

        header_frame = ttk.Frame(sub_frame)
        header_frame.pack(fill=tk.X)
        ttk.Label(header_frame, text="Group/Pattern", width=20).pack(side=tk.LEFT, padx=5)
        ttk.Label(header_frame, text="Property Component", width=20).pack(
            side=tk.LEFT, padx=5
        )
        ttk.Label(header_frame, text="Default Value", width=15).pack(side=tk.LEFT, padx=5)
        ttk.Label(header_frame, text="Required", width=10).pack(side=tk.LEFT, padx=5)

        self.sub_def_container = ttk.Frame(sub_frame)
        self.sub_def_container.pack(fill=tk.BOTH, expand=True, pady=5)

        btn_frame = ttk.Frame(sub_frame)
        btn_frame.pack(fill=tk.X, pady=5)
        ttk.Button(btn_frame, text="Add Mapping", command=self._add_sub_definition).pack(
            side=tk.LEFT, padx=5
        )
        ttk.Button(
            btn_frame, text="Remove Selected", command=self._remove_sub_definition
        ).pack(side=tk.LEFT, padx=5)

        constr_frame = ttk.LabelFrame(
            main_frame, text="Constraints & Default Values", padding=10
        )
        constr_frame.pack(fill=tk.X, pady=5)

        default_row = ttk.Frame(constr_frame)
        default_row.pack(fill=tk.X)
        ttk.Label(default_row, text="Default Value:").pack(side=tk.LEFT, padx=5)
        self.default_value_var = tk.StringVar()
        ttk.Entry(default_row, textvariable=self.default_value_var, width=30).pack(
            side=tk.LEFT, padx=5
        )

        self.not_required_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(
            default_row, text="Not Required", variable=self.not_required_var
        ).pack(side=tk.LEFT, padx=10)

        parser_list_frame = ttk.LabelFrame(
            main_frame, text="Parsers for this Property Type", padding=10
        )
        parser_list_frame.pack(fill=tk.X, pady=5)

        self.parser_listbox = tk.Listbox(parser_list_frame, height=5)
        self.parser_listbox.pack(fill=tk.X, pady=5)
        self.parser_listbox.bind("<<ListboxSelect>>", self._on_parser_select)

        action_frame = ttk.Frame(main_frame)
        action_frame.pack(fill=tk.X, pady=10)
        ttk.Button(action_frame, text="Save Parser", command=self._save_parser).pack(
            side=tk.LEFT, padx=5
        )
        ttk.Button(action_frame, text="Test Parser", command=self._test_parser).pack(
            side=tk.LEFT, padx=5
        )
        ttk.Button(action_frame, text="Delete Parser", command=self._delete_parser).pack(
            side=tk.LEFT, padx=5
        )
        ttk.Button(action_frame, text="Export", command=self._export_parsers).pack(
            side=tk.LEFT, padx=5
        )

        self.status_var = tk.StringVar(value="Ready")
        status_bar = ttk.Label(self.root, textvariable=self.status_var, relief=tk.SUNKEN)
        status_bar.pack(side=tk.BOTTOM, fill=tk.X)

        self._refresh_parsers()

    def _refresh_property_types(self) -> None:
        prop_types = self.ontology.list_property_types()
        self.prop_type_combo["values"] = prop_types
        if prop_types:
            self.prop_type_combo.set(prop_types[0])

    def _refresh_parsers(self) -> None:
        self.parser_listbox.delete(0, tk.END)
        prop_type_name = self.prop_type_var.get()
        if prop_type_name:
            parsers = self.ontology.get_parser_definitions(prop_type_name)
            for parser in parsers:
                self.parser_listbox.insert(
                    tk.END, f"{parser.name} ({parser.parser_type.value})"
                )

    def _load_property_type(self) -> None:
        prop_type_name = self.prop_type_var.get()
        if not prop_type_name:
            return

        prop_type = self.ontology.get_property_type(prop_type_name)
        if not prop_type:
            self.status_var.set(f"Property type '{prop_type_name}' not found")
            return

        self._current_property_type = prop_type_name
        self._refresh_parsers()
        self.status_var.set(f"Loaded property type: {prop_type_name}")

        if prop_type.parser_definitions:
            self.parser_listbox.selection_set(0)
            self._on_parser_select(None)

    def _on_parser_type_change(self, event: Any = None) -> None:
        parser_type = self.parser_type_var.get()
        if parser_type == "Regular Expression":
            self.expr_text.delete(1.0, tk.END)
            self.expr_text.insert(1.0, r"^(\w+),\s*(\w+)$")
        elif parser_type == "Code Module":
            self.expr_text.delete(1.0, tk.END)
            self.expr_text.insert(1.0, "com.example.parsers.NameParser")

    def _add_sub_definition(self) -> None:
        row_frame = ttk.Frame(self.sub_def_container)
        row_frame.pack(fill=tk.X, pady=2)

        pattern_entry = ttk.Entry(row_frame, width=20)
        pattern_entry.pack(side=tk.LEFT, padx=2)
        pattern_entry.insert(0, str(len(self._sub_def_widgets) + 1))

        comp_var = tk.StringVar()
        comp_combo = ttk.Combobox(row_frame, textvariable=comp_var, width=20)
        comp_combo.pack(side=tk.LEFT, padx=2)

        prop_type_name = self.prop_type_var.get()
        if prop_type_name:
            prop_type = self.ontology.get_property_type(prop_type_name)
            if prop_type:
                comp_combo["values"] = [c.name for c in prop_type.components]
                if prop_type.components:
                    comp_combo.set(prop_type.components[0].name)

        default_entry = ttk.Entry(row_frame, width=15)
        default_entry.pack(side=tk.LEFT, padx=2)

        required_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(row_frame, variable=required_var).pack(side=tk.LEFT, padx=5)

        ttk.Button(
            row_frame,
            text="X",
            width=3,
            command=lambda: self._remove_sub_def_row(row_frame),
        ).pack(side=tk.LEFT, padx=5)

        self._sub_def_widgets.append(
            {
                "frame": row_frame,
                "pattern": pattern_entry,
                "component": comp_combo,
                "default": default_entry,
                "required": required_var,
            }
        )

    def _remove_sub_def_row(self, frame: ttk.Frame) -> None:
        frame.destroy()
        self._sub_def_widgets = [w for w in self._sub_def_widgets if w["frame"] != frame]

    def _remove_sub_definition(self) -> None:
        if self._sub_def_widgets:
            widget = self._sub_def_widgets.pop()
            widget["frame"].destroy()

    def _on_parser_select(self, event: Any) -> None:
        selection = self.parser_listbox.curselection()
        if not selection:
            return

        idx = selection[0]
        prop_type_name = self.prop_type_var.get()
        if not prop_type_name:
            return

        prop_type = self.ontology.get_property_type(prop_type_name)
        if not prop_type or idx >= len(prop_type.parser_definitions):
            return

        parser = prop_type.parser_definitions[idx]
        self._current_parser = parser

        self.parser_name_var.set(parser.name)
        type_labels = {
            ParserType.REGULAR_EXPRESSION: "Regular Expression",
            ParserType.CODE_MODULE: "Code Module",
            ParserType.SCRIPT: "Script",
        }
        self.parser_type_var.set(type_labels.get(parser.parser_type, "Regular Expression"))
        self.expr_text.delete(1.0, tk.END)
        self.expr_text.insert(1.0, parser.expression_pattern)
        self.default_value_var.set(parser.default_values.get("_default", ""))
        self.not_required_var.set(False)

        for widget in self._sub_def_widgets:
            widget["frame"].destroy()
        self._sub_def_widgets = []

        for sub_def in parser.sub_definitions:
            self._add_sub_definition()
            widget = self._sub_def_widgets[-1]
            widget["pattern"].delete(0, tk.END)
            widget["pattern"].insert(0, sub_def.pattern)
            widget["component"].set(sub_def.property_component)
            if sub_def.default_value:
                widget["default"].delete(0, tk.END)
                widget["default"].insert(0, str(sub_def.default_value))
            widget["required"].set(sub_def.is_required)

        self.status_var.set(f"Loaded parser: {parser.name}")

    def _new_parser(self) -> None:
        self._current_parser = None
        self.parser_name_var.set("")
        self.expr_text.delete(1.0, tk.END)
        self.default_value_var.set("")
        self.not_required_var.set(False)

        for widget in self._sub_def_widgets:
            widget["frame"].destroy()
        self._sub_def_widgets = []

        self._add_sub_definition()
        self.status_var.set("New parser ready")

    def _save_parser(self) -> None:
        prop_type_name = self.prop_type_var.get()
        if not prop_type_name:
            messagebox.showerror("Error", "Please select a property type")
            return

        parser_name = self.parser_name_var.get().strip()
        if not parser_name:
            messagebox.showerror("Error", "Please enter a parser name")
            return

        parser_type_str = self.parser_type_var.get()
        if parser_type_str == "Regular Expression":
            parser_type = ParserType.REGULAR_EXPRESSION
        elif parser_type_str == "Code Module":
            parser_type = ParserType.CODE_MODULE
        else:
            parser_type = ParserType.SCRIPT

        expression = self.expr_text.get(1.0, tk.END).strip()
        if not expression:
            messagebox.showerror("Error", "Please enter an expression pattern")
            return

        sub_defs: List[ParserSubDefinition] = []
        for widget in self._sub_def_widgets:
            pattern = widget["pattern"].get().strip()
            component = widget["component"].get().strip()
            default = widget["default"].get().strip()
            required = widget["required"].get()

            if pattern and component:
                sub_defs.append(
                    ParserSubDefinition(
                        pattern=pattern,
                        property_component=component,
                        property_type_name=prop_type_name,
                        default_value=default if default else None,
                        is_required=required,
                    )
                )

        if not sub_defs:
            messagebox.showerror(
                "Error", "Please add at least one sub-definition mapping"
            )
            return

        if self._current_parser:
            self.ontology.edit_parser_definition(
                prop_type_name,
                self._current_parser.name,
                name=parser_name,
                parser_type=parser_type,
                expression_pattern=expression,
                sub_definitions=sub_defs,
                default_values={"_default": self.default_value_var.get().strip()},
            )
            self.status_var.set(f"Updated parser: {parser_name}")
        else:
            parser = self.ontology.create_parser_definition(
                prop_type_name,
                parser_name,
                parser_type,
                expression,
                sub_definitions=sub_defs,
                default_values={"_default": self.default_value_var.get().strip()},
                priority=len(self.ontology.get_parser_definitions(prop_type_name)),
            )
            if parser:
                self.status_var.set(f"Created parser: {parser_name}")
            else:
                messagebox.showerror("Error", "Failed to create parser")
                return

        self._refresh_parsers()
        self._current_parser = None

    def _test_parser(self) -> None:
        test_input = simpledialog.askstring("Test Parser", "Enter test input data:")
        if test_input is None:
            return

        prop_type_name = self.prop_type_var.get()
        if not prop_type_name:
            messagebox.showerror("Error", "Please select a property type")
            return

        prop_type = self.ontology.get_property_type(prop_type_name)
        if not prop_type:
            return

        result = prop_type.parse_input(test_input)
        if result:
            messagebox.showinfo(
                "Parser Test - Success",
                f"Input: {test_input}\n\nParsed Result:\n{json.dumps(result, indent=2)}",
            )
        else:
            messagebox.showwarning(
                "Parser Test - Failed",
                f"Input: {test_input}\n\nNo parser matched this input.",
            )

    def _delete_parser(self) -> None:
        selection = self.parser_listbox.curselection()
        if not selection:
            return

        idx = selection[0]
        prop_type_name = self.prop_type_var.get()
        if not prop_type_name:
            return

        prop_type = self.ontology.get_property_type(prop_type_name)
        if not prop_type or idx >= len(prop_type.parser_definitions):
            return

        parser = prop_type.parser_definitions[idx]
        if messagebox.askyesno("Delete Parser", f"Delete parser '{parser.name}'?"):
            self.ontology.delete_parser_definition(prop_type_name, parser.name)
            self._refresh_parsers()
            self.status_var.set(f"Deleted parser: {parser.name}")

    def _export_parsers(self) -> None:
        prop_type_name = self.prop_type_var.get()
        if not prop_type_name:
            messagebox.showerror("Error", "Please select a property type")
            return

        prop_type = self.ontology.get_property_type(prop_type_name)
        if not prop_type:
            return

        filepath = filedialog.asksaveasfilename(
            title="Export Parsers",
            defaultextension=".json",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
        )
        if filepath:
            data = {
                "property_type": prop_type_name,
                "parsers": [p.to_dict() for p in prop_type.parser_definitions],
            }
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, default=str)
            self.status_var.set(f"Exported parsers to {filepath}")

    def run(self) -> None:
        """Run the GUI (blocks if this is the root window)."""
        if isinstance(self.root, tk.Tk):
            self.root.mainloop()
        else:
            self.root.wait_window()
