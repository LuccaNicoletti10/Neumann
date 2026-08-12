# execution-sandbox

**Passo 14** — execução de transforms em sandbox com CPU/memória/timeout, FS/rede restritos, identidade registrada e audit.

Patente (forma funcional): **US20250265045A1**

## Escopo

| In | Out |
|---|---|
| Policy: maxCpuMs, maxMemoryBytes, fsAllowPrefixes, allowNetwork | Swing IDE / JFrame |
| Host: readFile/writeFile/fetch/tick guardados | Template Generator UI |
| Identity + audit log | Async DB write dual-path patent fig.6 |
| Escape via host API → deny + audit | Isolamento OS/VM; eval de strings; Swing IDE |

**Honestidade:** o transform roda no mesmo processo Node; só APIs do `SandboxHost` são barradas. Closures que importarem `node:fs` diretamente **não** são capturadas — gate cobre escapes host-mediated.

## Gate

```bash
pnpm sandbox -- demo
# aliases: sbx
```

Tentativas de `../`, `/etc`, `fetch()`, ou `tick` acima do budget → `deniedReason` + evento de audit.
