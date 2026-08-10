# NEUMANN — monorepo (fundação + pacotes de patentes)

| Pacote | Patente / papel |
|---|---|
| `packages/common-build-system` | US 10,001,982 — build reproduzível |
| `packages/dynamic-documentation` | US 10,509,647 — docs dinâmicas |
| `packages/auto-logging-config` | US 11,681,606 — logging a partir do código |
| `packages/metrics-collection` | US 11,870,666 — métricas de uso |
| `packages/iam-auth-monitoring` | US 8,763,078 — IAM + monitoramento de auth |
| `packages/security-config-secrets` | EP4660856 + US20250298632A1 — scan CI, config remota, secrets age |
| `packages/ldpc-transceiver` | CA3111603 — TX/RX LDPC + QAM (64 testes) |
| `packages/periodic-search-manager` | US 10,572,487 B1 — buscas periódicas multi-fonte (40 testes) |
| `packages/fair-query-scheduler` | US 9,092,482 B2 — fair scheduling (Passo 4) |
| `packages/bounded-fair-scheduler` | US 9,715,526 B2 — fair scheduling bounded (Passo 4) |
| `packages/observability` | Passo 2 — pino + OTel; gate TM0.5 (100% requests) |
| `packages/event-bus` | Passo 4 — outbox + NOTIFY + jobs; gate TM0.3 |

```bash
pnpm install && pnpm build && pnpm test
pnpm gate:bloco1          # TM0.5 + TM0.3
pnpm dev:up               # Postgres + Jaeger + Prometheus + Grafana
```

## BLOCO 1 — status

| Passo | Gate | Como validar |
|---|---|---|
| 1 Build | 2 builds → mesmo hash | `pnpm --filter common-build-system test` |
| 2 Observabilidade | 100% requests com trace_id+actor+latência | `pnpm obs -- check` |
| 3 IAM + secrets | login + principal | `pnpm iam` / `pnpm sec` |
| 4 Event bus + fair sched | outbox entrega; restart não perde job | `pnpm bus -- gate` + `pnpm fqs` / `pnpm bfs` |

## PASSO 3 — Gate IAM

```bash
cd packages/iam-auth-monitoring
pnpm cli register --email admin@example.com --password secret123 --admin
pnpm cli serve --port 3000
# POST /login → GET /me com Bearer (todo request carrega principal)
```

## PASSO 3 — Gate segurança / secrets

```bash
cd packages/security-config-secrets
pnpm cli scan-deps --lockfile fixtures/sample-lock.json --db advisories/sample.json --fail-on high
pnpm cli secrets keygen
AGE_SECRET_KEY=... pnpm cli secrets set prod DB_PASSWORD --value s3cret
pnpm cli guard fixtures/sample-repo
```

## ldpc-transceiver (CA3111603)

```bash
pnpm --filter ldpc-transceiver test
pnpm ldpc -- simulate --snr 12 --mod 16QAM --preset qc648 --frames 5
pnpm ldpc -- serve --port 8080
```

## periodic-search-manager (US 10,572,487)

```bash
pnpm --filter periodic-search-manager test
pnpm psm -- serve --port 3000
```

## PASSO 4 — Fair scheduling

```bash
pnpm --filter fair-query-scheduler test
pnpm fqs -- demo
pnpm --filter bounded-fair-scheduler test
pnpm bfs -- demo
```
