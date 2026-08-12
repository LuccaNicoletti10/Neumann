# multi-row-transactions

**PASSO 10** — Time travel, diff, transações multi-linha, replay  
Patentes: **US 8,504,542**, **US 9,619,507**

## O que faz

- `START / GET / SET / COMMIT` com writes buffered e commit atômico multi-linha
- Snapshot isolation na leitura (não vê commits com `commitTs > startTs`)
- Lease locks (acquire/release/refresh/validate) com clock injetável
- Transaction table (`putIfAbsent`, `explicitlyFail`)
- `snapshot(dataset, at)`, `replay()`, `diffVersions()`
- Gate crash: writes entre write e finalize não ficam visíveis

## Uso

```bash
pnpm --filter multi-row-transactions test
pnpm mrtx -- demo   # ou: pnpm tt -- demo
```

## Fora deste pacote

- Token Ring / RMI do paste Java
- Postgres/MinIO reais (MVCC em memória)
