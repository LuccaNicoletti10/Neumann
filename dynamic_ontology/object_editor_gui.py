"""Graphical interface for editing object types (FIG. 4 / US7962495)."""

from __future__ import annotations

import tkinter as tk
from tkinter import messagebox, scrolledtext, simpledialog, ttk
from typing import Optional

from .ontology import DynamicOntology


class ObjectTypeEditorGUI:
    """
    Graphical interface for editing object types.
    Implements the Object Type Editor shown in FIG. 4.
    """

    def __init__(self, ontology: DynamicOntology):
        self.ontology = ontology
        self.root = tk.Toplevel() if tk._default_root else tk.Tk()
        self.root.title("Object Type Editor - US7962495")
        self.root.geometry("700x500")

        self._current_object_type: Optional[str] = None
        self._setup_ui()

    def _setup_ui(self) -> None:
        main_frame = ttk.Frame(self.root)
        main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        left_frame = ttk.Frame(main_frame, width=200)
        left_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=False, padx=5)

        ttk.Label(left_frame, text="Object Types", font=("Arial", 12, "bold")).pack(
            anchor=tk.W, pady=5
        )

        self.obj_listbox = tk.Listbox(left_frame, height=15)
        self.obj_listbox.pack(fill=tk.BOTH, expand=True)
        self.obj_listbox.bind("<<ListboxSelect>>", self._on_select)

        list_btn_frame = ttk.Frame(left_frame)
        list_btn_frame.pack(fill=tk.X, pady=5)
        ttk.Button(list_btn_frame, text="Add", command=self._add_object_type).pack(
            side=tk.LEFT, padx=2
        )
        ttk.Button(list_btn_frame, text="Delete", command=self._delete_object_type).pack(
            side=tk.LEFT, padx=2
        )

        right_frame = ttk.Frame(main_frame)
        right_frame.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=5)

        ttk.Label(
            right_frame, text="Object Type Details", font=("Arial", 12, "bold")
        ).pack(anchor=tk.W, pady=5)

        name_frame = ttk.Frame(right_frame)
        name_frame.pack(fill=tk.X, pady=2)
        ttk.Label(name_frame, text="Name:").pack(side=tk.LEFT, padx=5)
        self.name_var = tk.StringVar()
        ttk.Entry(name_frame, textvariable=self.name_var, width=30).pack(
            side=tk.LEFT, padx=5
        )

        uri_frame = ttk.Frame(right_frame)
        uri_frame.pack(fill=tk.X, pady=2)
        ttk.Label(uri_frame, text="URI:").pack(side=tk.LEFT, padx=5)
        self.uri_var = tk.StringVar()
        ttk.Entry(uri_frame, textvariable=self.uri_var, width=30).pack(
            side=tk.LEFT, padx=5
        )

        base_frame = ttk.Frame(right_frame)
        base_frame.pack(fill=tk.X, pady=2)
        ttk.Label(base_frame, text="Base Type:").pack(side=tk.LEFT, padx=5)
        self.base_type_var = tk.StringVar()
        ttk.Entry(base_frame, textvariable=self.base_type_var, width=30).pack(
            side=tk.LEFT, padx=5
        )

        icon_frame = ttk.Frame(right_frame)
        icon_frame.pack(fill=tk.X, pady=2)
        ttk.Label(icon_frame, text="Icon:").pack(side=tk.LEFT, padx=5)
        self.icon_var = tk.StringVar()
        ttk.Entry(icon_frame, textvariable=self.icon_var, width=30).pack(
            side=tk.LEFT, padx=5
        )

        desc_frame = ttk.Frame(right_frame)
        desc_frame.pack(fill=tk.X, pady=2)
        ttk.Label(desc_frame, text="Description:").pack(anchor=tk.W, padx=5)
        self.desc_text = scrolledtext.ScrolledText(right_frame, height=4)
        self.desc_text.pack(fill=tk.X, pady=2, padx=5)

        prop_frame = ttk.LabelFrame(right_frame, text="Property Types", padding=5)
        prop_frame.pack(fill=tk.BOTH, expand=True, pady=5)

        self.prop_listbox = tk.Listbox(prop_frame, height=5)
        self.prop_listbox.pack(fill=tk.BOTH, expand=True, pady=5)

        prop_btn_frame = ttk.Frame(prop_frame)
        prop_btn_frame.pack(fill=tk.X)
        ttk.Button(prop_btn_frame, text="Add Property", command=self._add_property).pack(
            side=tk.LEFT, padx=2
        )
        ttk.Button(
            prop_btn_frame, text="Remove Property", command=self._remove_property
        ).pack(side=tk.LEFT, padx=2)

        ttk.Button(
            right_frame, text="Save Object Type", command=self._save_object_type
        ).pack(pady=10)

        self.status_var = tk.StringVar(value="Ready")
        status_bar = ttk.Label(self.root, textvariable=self.status_var, relief=tk.SUNKEN)
        status_bar.pack(side=tk.BOTTOM, fill=tk.X)

        self._refresh_list()

    def _refresh_list(self) -> None:
        self.obj_listbox.delete(0, tk.END)
        for name in sorted(self.ontology.list_object_types()):
            self.obj_listbox.insert(tk.END, name)

    def _on_select(self, event: object) -> None:
        selection = self.obj_listbox.curselection()
        if not selection:
            return

        name = self.obj_listbox.get(selection[0])
        obj_type = self.ontology.get_object_type(name)
        if not obj_type:
            return

        self._current_object_type = name
        self.name_var.set(obj_type.name)
        self.uri_var.set(obj_type.uri)
        self.base_type_var.set(obj_type.base_type or "")
        self.icon_var.set(obj_type.icon or "")
        self.desc_text.delete(1.0, tk.END)
        self.desc_text.insert(1.0, obj_type.description or "")

        self.prop_listbox.delete(0, tk.END)
        for prop in obj_type.property_types:
            self.prop_listbox.insert(tk.END, prop)

        self.status_var.set(f"Loaded object type: {name}")

    def _add_object_type(self) -> None:
        self._current_object_type = None
        self.name_var.set("")
        self.uri_var.set("com.example.object.")
        self.base_type_var.set("com.example.object.entity")
        self.icon_var.set("")
        self.desc_text.delete(1.0, tk.END)
        self.prop_listbox.delete(0, tk.END)
        self.status_var.set("New object type ready")

    def _delete_object_type(self) -> None:
        selection = self.obj_listbox.curselection()
        if not selection:
            return

        name = self.obj_listbox.get(selection[0])
        if messagebox.askyesno("Delete", f"Delete object type '{name}'?"):
            self.ontology.delete_object_type(name)
            self._refresh_list()
            self.status_var.set(f"Deleted object type: {name}")

    def _add_property(self) -> None:
        prop_name = simpledialog.askstring("Add Property", "Enter property type name:")
        if prop_name and prop_name.strip():
            prop_name = prop_name.strip()
            if prop_name in self.ontology.property_types:
                if self._current_object_type:
                    self.ontology.add_property_to_object_type(
                        self._current_object_type, prop_name
                    )
                    # Refresh details
                    for i, name in enumerate(self.obj_listbox.get(0, tk.END)):
                        if name == self._current_object_type:
                            self.obj_listbox.selection_clear(0, tk.END)
                            self.obj_listbox.selection_set(i)
                            self._on_select(None)
                            break
                    self.status_var.set(f"Added property: {prop_name}")
            else:
                messagebox.showerror("Error", f"Property type '{prop_name}' not found")

    def _remove_property(self) -> None:
        selection = self.prop_listbox.curselection()
        if not selection or not self._current_object_type:
            return

        prop_name = self.prop_listbox.get(selection[0])
        obj_type = self.ontology.get_object_type(self._current_object_type)
        if obj_type and prop_name in obj_type.property_types:
            obj_type.property_types.remove(prop_name)
            self.prop_listbox.delete(selection[0])
            self.status_var.set(f"Removed property: {prop_name}")

    def _save_object_type(self) -> None:
        name = self.name_var.get().strip()
        if not name:
            messagebox.showerror("Error", "Please enter a name")
            return

        uri = self.uri_var.get().strip()
        if not uri:
            uri = f"com.example.object.{name.lower()}"

        base_type = self.base_type_var.get().strip() or None
        icon = self.icon_var.get().strip() or None
        description = self.desc_text.get(1.0, tk.END).strip() or None

        if self._current_object_type and self._current_object_type != name:
            self.ontology.delete_object_type(self._current_object_type)
            self._current_object_type = None

        if self._current_object_type:
            self.ontology.edit_object_type(
                self._current_object_type,
                display_name=name,
                uri=uri,
                base_type=base_type,
                icon=icon,
                description=description,
            )
        else:
            self.ontology.create_object_type(
                name, name, uri, base_type, icon, description
            )
            self._current_object_type = name

        self._refresh_list()
        self.status_var.set(f"Saved object type: {name}")

    def run(self) -> None:
        if isinstance(self.root, tk.Tk):
            self.root.mainloop()
        else:
            self.root.wait_window()
