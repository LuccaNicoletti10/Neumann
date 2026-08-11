# connector-sdk

Helpers para implementar connectors sobre `contracts`:

- validação de shape do Connector
- clocks / ids determinísticos injetáveis
- `CheckpointStore` (memória) + `runSnapshot` / `runIncremental`
- `createEventFactory` (CanonicalEvent + `payload_hash`)

```bash
pnpm --filter connector-sdk test
pnpm csdk -- demo
```
