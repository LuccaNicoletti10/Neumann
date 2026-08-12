# action-engine

Generic Action execution for Neumann.

Lifecycle:

```
request → authorize → validate parameters → submission criteria
→ ontology rules → side effects → audit → result
```

Rules: `create_object` · `modify_object` · `delete_object` · `create_link` · `delete_link`

Side effects (stubs): webhook · notification · connector_writeback

Preserves durable audit via injectable `AuditLog` (policy-engine).
