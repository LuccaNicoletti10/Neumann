# ADR-0001: Contratos congelam por release

**Contexto:** 14 contratos centrais são a espinha dorsal; IA gerando código pode alterá-los silenciosamente.
**Decisão:** Contratos vivem em `packages/contracts/v1/`. Mudança breaking exige ADR + bump para `v2/`. CI valida golden fixtures.
**Alternativa rejeitada:** versionar por pacote semver — granular demais para 1 dev.
**Consequência:** Qualquer mudança de interface é um evento explícito e revisado.
