# edge-control — Passo 32

Fonte remota/edge pelo **mesmo Connector SDK**: `capabilities: ['subscribe']` → eventos entram como `CanonicalEvent`. Supervisory control (baseline, anomalia, transmissão digital) opera sobre esse envelope. **Sem GUI e sem app de fábrica.**

**Patentes:** US 11,799,877 · US 12,261,861 · US20250233873A1

## Escopo (kernel)

- Connector edge in-memory: `subscribe` / `snapshot` / `read` emitem `CanonicalEvent`
- Baseline de operador (horário UTC, localização, ações típicas, CAs já modificadas)
- Detecção: horário, localização, ação atípica, first-time CA, volume de transmissão
- Transmissão digital com `detailedView` + **porção do baseline** (claim)
- Representação de dashboard (linhas tempo/ação/user/consistência) — API, não UI

## Gate

Dados remotos no mesmo envelope canônico; zero vertical de negócio no core.

```bash
pnpm edge -- demo
pnpm --filter edge-control test
```
