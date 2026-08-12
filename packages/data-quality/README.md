# data-quality

**Passo 13** — métricas de qualidade + regras (condition/severity/action/scope/version/owner) + quarentena com motivo + datasets compostos (joins multi-input).

Patentes (forma funcional):
- **US 11,429,572** — rules-based cleaning → regras + actions + quarantine
- **US 9,542,446 / US 10,678,860** — composite datasets via `joinKeys`

US 11,314,698 (scheduler) = **Passo 12** (`incremental-pipeline-scheduler`), não reimplementado aqui.

## Gate

```bash
pnpm dq -- demo
```

Pós-run: 6 dimensões scoreadas; linhas que violam regras `quarantine` → `QuarantineRecord.reason`.
