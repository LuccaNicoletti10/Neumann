# connector-sdk

Helpers para implementar connectors sobre `contracts`:

- validação de shape do Connector
- clocks / ids determinísticos injetáveis
- `CheckpointStore` (memória) + `runSnapshot` / `runIncremental`
- `createEventFactory` (CanonicalEvent + `payload_hash`)
- **Write-path (Passo 25):** `writeBack` + inverse map PropertyType ↔ campo da fonte + fonte em memória

```bash
pnpm --filter connector-sdk test
pnpm csdk -- demo
pnpm csdk -- writeback
```
