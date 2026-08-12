# NEUMANN — kernel da plataforma (monorepo)

**Postura:** construir as **bases** (contratos, ingestão, memória imutável, transform, ontology, actions).  
**Não** construir aplicação de domínio até você trazer a app + dados.  
Spec ativa: [`GUIA_PASSO_A_PASSO.md`](GUIA_PASSO_A_PASSO.md) · código em `packages/` · legado em `_archive/legacy-docs/`.

## Status

| Bloco | Passos | Status |
|---|---|---|
| 1 Fundação | 1–4 | **ENTREGUE** |
| 2 Connect | 5–7 | **ENTREGUE** |
| 3 Memória imutável | 8–10 | **ENTREGUE** |
| 4 Transform | 11–14 | **ENTREGUE** |
| 5 Lineage + segurança | 15+ | próximo |

**Notas kernel (não bloqueiam o gate):** storage Passo 8 em memória/FS (MinIO/Postgres = upgrade); connector Postgres com SqlClient injetável; Passo 11 executor = memória + SQL versionado (DuckDB nativo = upgrade); Passo 14 sandbox = host API guard (não isolamento OS/VM).

```bash
pnpm install && pnpm build && pnpm test
pnpm gate:bloco1          # TM0.5 + TM0.3
pnpm gate:t1.3            # connector Postgres checkpoint
pnpm dev:up               # Postgres + Jaeger + Prometheus + Grafana
```

## Pacotes (Blocos 1–4)

| Pacote | Papel |
|---|---|
| `common-build-system` / `dynamic-documentation` | Passo 1 |
| `observability` / `auto-logging-config` / `metrics-collection` | Passo 2 |
| `iam-auth-monitoring` / `security-config-secrets` | Passo 3 |
| `event-bus` / `fair-query-scheduler` / `bounded-fair-scheduler` | Passo 4 |
| `contracts` / `connector-sdk` | Passo 5 |
| `connector-postgres` + ITS/ECE/TIP | Passo 6 |
| `schema-registry` | Passo 7 |
| `history-preserving-pipeline` | Passo 8 |
| `delta-storage` | Passo 9 |
| `multi-row-transactions` | Passo 10 |
| `transformation-runner` | Passo 11 |
| `incremental-pipeline-scheduler` | Passo 12 |
| `data-quality` | Passo 13 |
| `execution-sandbox` | Passo 14 |
| LCV / EAD / VRN / CSD | patentes de suporte Passo 5 |
| `ldpc-transceiver` / `periodic-search-manager` | pacotes de suporte Bloco 1 |

## Validar Blocos 1–4

```bash
# Bloco 1
pnpm --filter common-build-system test
pnpm obs -- check
pnpm iam -- help
pnpm sec -- help
pnpm bus -- gate
pnpm fqs -- demo && pnpm bfs -- demo

# Bloco 2
pnpm contracts -- demo
pnpm csdk -- demo
pnpm gate:t1.3
pnpm sr -- demo
pnpm lcv -- demo && pnpm ead -- demo && pnpm vrn -- demo && pnpm csd -- demo
pnpm its -- demo && pnpm ece -- demo && pnpm tip -- demo

# Bloco 3
pnpm hpp -- demo
pnpm delta -- demo
pnpm mrtx -- demo

# Bloco 4
pnpm xform -- demo
pnpm ips -- demo
pnpm dq -- demo
pnpm sandbox -- demo
```

## Detalhes opcionais (IAM / secrets / suporte)

```bash
# IAM
cd packages/iam-auth-monitoring
pnpm cli register --email admin@example.com --password secret123 --admin
pnpm cli serve --port 3000

# Secrets
cd packages/security-config-secrets
pnpm cli scan-deps --lockfile fixtures/sample-lock.json --db advisories/sample.json --fail-on high
pnpm cli secrets keygen

# LDPC / PSM
pnpm --filter ldpc-transceiver test
pnpm --filter periodic-search-manager test
```
