"""Compatibility analysis between ontology versions."""

from __future__ import annotations

from dataclasses import dataclass

from .models import OntologySnapshot


@dataclass(frozen=True)
class CompatibilityReport:
    breaking: bool
    messages: list[str]


def analyze_compatibility(
    old: OntologySnapshot,
    new: OntologySnapshot,
) -> CompatibilityReport:
    messages: list[str] = []
    breaking = False

    old_objs = set(old.objects)
    new_objs = set(new.objects)
    removed_objs = old_objs - new_objs
    if removed_objs:
        breaking = True
        messages.append(f"Removed objects: {sorted(removed_objs)}")

    for oid in old_objs & new_objs:
        old_obj = old.objects[oid]
        new_obj = new.objects[oid]
        removed_props = set(old_obj.properties) - set(new_obj.properties)
        if removed_props:
            breaking = True
            messages.append(f"{oid}: removed properties {sorted(removed_props)}")

    for pid, old_prop in old.properties.items():
        if pid not in new.properties:
            breaking = True
            messages.append(f"Removed property: {pid}")
            continue
        new_prop = new.properties[pid]
        if old_prop.required and not new_prop.required:
            messages.append(f"{pid}: required relaxed")
        if not old_prop.required and new_prop.required:
            breaking = True
            messages.append(f"{pid}: became required")
        if old_prop.data_type != new_prop.data_type:
            breaking = True
            messages.append(
                f"{pid}: type changed {old_prop.data_type} → {new_prop.data_type}"
            )

    added = set(new.properties) - set(old.properties)
    if added:
        messages.append(f"Added properties: {sorted(added)}")

    return CompatibilityReport(breaking=breaking, messages=messages)
