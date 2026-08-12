# ontology-registry — Passo 17

Registry de ontologia **versionado**: ObjectType / PropertyType / LinkType (SEMÂNTICA) + ActionType / FunctionType stubs (CINÉTICA). Mudança = nova `ontology_version`; rollback cria nova versão com o snapshot antigo.

**Patentes:** US 7,962,495 … US 10,872,067 · US20100070426 · US 9,229,966

## Escopo

- Draft → commit (imutável)
- Diff entre versões
- Rollback sem reescrever histórico

## Fora deste passo

- Mapping dataset→ObjectType / projetor / Object API → Passo 18
- Parsers regex em ingestão de linhas → Passo 18
- GUI / domínio financeiro das patentes de object modeling

## Uso

```bash
pnpm onto -- demo
pnpm --filter ontology-registry test
```
