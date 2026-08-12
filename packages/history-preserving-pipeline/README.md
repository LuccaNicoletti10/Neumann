# history-preserving-pipeline

**PASSO 8** — Dataset Store imutável / history-preserving pipeline  
Patentes: **US 9,229,952**, **US 9,483,506**, **US 9,946,738**

## O que faz

- `BlobStore` content-addressed (`sha256/<hash>`) — memória ou FS
- `ManifestStore` — `Dataset` + `DatasetVersion` COMMITTED imutáveis
- `TransactionService` — `start` / `write` / `commit` (write após commit falha)
- `BuildService` — derivation programs, DAG, catalog, `isOutOfDate`, `processQueue()`
- `traceDatasetHistory` / `compareVersions`
- Duplicate `contentHash` no mesmo dataset → **mesma** `versionId`

Campos reservados `policyId` e `lineageRef` (nullable) no contrato `CommitInput`.

## Uso

```bash
pnpm --filter history-preserving-pipeline test
pnpm hpp demo   # ou: pnpm ds demo
```

```ts
import { createHistoryPreservingPipeline } from 'history-preserving-pipeline';

const pipe = createHistoryPreservingPipeline();
const ds = pipe.createDataset({ name: 'orders' });
const tx = pipe.startTransaction(ds.id);
pipe.writeTransaction(tx.id, { rows: [] });
const v = pipe.commitTransaction(tx.id);
```

## Fora deste pacote

- Passo 9 → `packages/delta-storage`
- Passo 10 (`snapshot(at)` / replay)
- MinIO/Postgres reais (interfaces prontas; impl memória/FS)
