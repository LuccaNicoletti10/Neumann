# ADRs — Architecture Decision Records

Decisões que alteram contrato público, fonte de verdade, ou invariante de runtime vivem aqui. Sem ADR, `packages/contracts/src/v1/*` não muda.

Constituição: `.cursor/rules/neumann-engineering.mdc`.  
Mapa: [`../current-state.md`](../current-state.md).  
Alvo: [`../target-state.md`](../target-state.md).

`_archive/legacy-docs/**/docs/adr/` não é ativo.

## Quando escrever

Escreva um ADR **antes** de implementar se a mudança:

- altera tipo, função ou comportamento exportado por `contracts`;
- introduz ou remove uma API pública paralela para o mesmo conceito (segunda policy, segundo object store, segundo outbox);
- troca o adapter de persistência de produção;
- relaxa fail-closed / fail-fast (auth, authorizer, DATABASE_URL, migrations);
- muda a porta de mutação (Actions vs write HTTP vs projector);
- muda o critério de `/ready` ou bootstrap;
- promove pacote experimental a critical path (ou o inverso).

Não use ADR para rename interno sem contrato, bugfix local, ou teste novo que só reforça invariante já documentada.

## Numeração e nome

```
docs/architecture/adr/NNNN-titulo-kebab.md
```

- Série activa: **0001–0024** (último: [`0024-aip-eval-framework.md`](./0024-aip-eval-framework.md)).
- Próximo livre: **0025** (os ADRs em `_archive` não ocupam esta série).
- Título = decisão, não tópico (`uma-policy-engine-no-http`, não `policy`).
- Um ADR por decisão. “E também vamos…” vira outro arquivo.

Status: `proposed` → `accepted` | `rejected` | `superseded by NNNN`.  
Só `accepted` autoriza mudança de contrato. `proposed` não é licença para merge de breaking change.

## Template

Copie o bloco abaixo para `NNNN-titulo-kebab.md`.

```markdown
# ADR-NNNN: Título da decisão

- Status: proposed | accepted | rejected | superseded by ADR-MMMM
- Date: YYYY-MM-DD
- Deciders: (nomes)
- Contracts touched: `packages/contracts/src/v1/<file>.ts` símbolos… | none
- Packages touched: …

## Context

Por que a decisão é necessária agora. Cite arquivos e símbolos reais
(`createOntologyAuthorizer`, `ObjectRepository`, …). Aponte o gap em
`docs/architecture/current-state.md`. Não reescreva o mapa inteiro.

## Decision

A escolha, no presente. Uma fonte de verdade resultante. Comportamento
fail-closed. O que passa a ser a API pública.

## Consequences

### Positivas

- …

### Negativas / custo

- …

### Invariantes que os testes devem provar

- Negativo: …
- Restart / concurrency / idempotency se persistência: …
- O que **não** pode mais existir no caminho de produto (símbolo a
  desaparecer de `platform-api`).

## Alternatives considered

### Alt A — …

Por que foi rejeitada.

### Alt B — …

Por que foi rejeitada.

## Migration

Passos de convergência sem duas verdades no meio (feature flag que
no-op não conta). Ordem de PRs se necessário. ADR não substitui o
teste no PR que executa a migração.

## Follow-up

Itens que este ADR **não** fecha (link a current-state decisões abertas).
```

## Regras

- Alternativa rejeitada é obrigatória. ADR sem alternativas é nota, não decisão.
- “Temporário” exige critério de saída ou data/ADR sucessor.
- Superação: o ADR novo diz `supersedes NNNN`; o antigo muda o status.
- Implementação que diverge do ADR accepted → novo ADR ou revert. Não “ajustar no código”.
