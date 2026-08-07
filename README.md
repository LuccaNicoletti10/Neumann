# Neumann — Data Integration Tool (US8930897)

Ontology-driven data integration with schema mapping, DSL builders, and proactive validation of transformation scripts.

## Layout

```
Neumann/
├── main.py                      # CLI + GUI entry point
├── data_integration/            # Core Python package
│   ├── ontology.py              # Objects, properties, links
│   ├── schema_map.py            # Source → ontology mappings
│   ├── object_model.py          # Runtime object instances
│   ├── dsl_builder.py           # Groovy / Python style builders
│   ├── transformation_engine.py # Transform + proactive debugger
│   └── gui.py                   # Tkinter UI
├── config/
│   ├── ontology_config.json
│   └── schema_map.json
├── scripts/
│   ├── CSVExample.groovy
│   └── PhoneTransformer.groovy
└── examples/
    ├── sample_people.csv
    ├── sample_calls.json
    └── run_cli.py
```

## Requirements

- Python 3.10+
- Tkinter (for GUI only; usually bundled with Python)

No third-party packages are required.

## Quick start

```bash
# CLI transform (CSV → Person objects)
python main.py transform \
  --source examples/sample_people.csv \
  --source-type csv \
  --output data/people_objects.json

# Validate a script against the ontology
python main.py validate --script scripts/CSVExample.groovy

# Proactive debug (stops early on validation errors when useful)
python main.py debug \
  --script scripts/CSVExample.groovy \
  --source examples/sample_people.csv

# Launch GUI
python main.py gui

# Or run the small example script
python examples/run_cli.py
```

## Core concepts

1. **Ontology** — defines object types, properties, and allowed links.
2. **Schema map** — maps source fields (CSV/JSON) onto ontology properties, with optional transforms/filters.
3. **DSL builder** — builds `ObjectModel` instances with ontology validation.
4. **Transformation engine** — executes mapped transforms and script validation.
5. **Proactive debugger** — validates as rows are processed and surfaces errors early.

## Programmatic usage

```python
from data_integration import (
    Ontology,
    SchemaMap,
    TransformationEngine,
    TransformationScript,
    CSVDataSource,
)

ontology = Ontology.load_from_file("config/ontology_config.json")
schema_map = SchemaMap.load_from_file("config/schema_map.json")
engine = TransformationEngine(ontology, schema_map)

result = engine.execute_script(
    TransformationScript("demo", open("scripts/CSVExample.groovy").read()),
    CSVDataSource("examples/sample_people.csv"),
    source_type="csv",
)
print(result.objects_created)
```
