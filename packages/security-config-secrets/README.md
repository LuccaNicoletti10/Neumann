# passo03-security-config-secrets

Passo 3: scan de dependencias (CI gate), config de ambiente remota via GUI e secrets age-style com separacao CODE/CONFIG/SECRETS/POLICY.

## Comandos

```bash
# Gate CI — falha (exit 1) se houver findings >= --fail-on
pnpm run cli -- scan-deps --lockfile fixtures/sample-lock.json --db advisories/sample.json --fail-on high

# Gerar par de chaves age-like
pnpm run cli -- secrets keygen

# Verificar layout do repo (code/, config/, secrets/, policy/)
pnpm run cli -- guard fixtures/sample-repo

# Subir API HTTP (env-config + secrets + layout scan)
pnpm run cli -- serve --port 3000 --root .
```

## Testes

```bash
pnpm test
pnpm run build
```
