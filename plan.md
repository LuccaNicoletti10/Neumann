# Plan.md — Análise + Roadmap 
## Estágios

### Stage 1 — Análise crítica (paralelo, 2 subagentes)
- **Reviewer (arquitetura)**: validar a ordem F0→F11, grafo de dependências entre fases,
  fases que podem ser paralelizadas, fases que podem ser adiadas, riscos de ordem
  (ex.: Security na F4 mas observability/audit já na F0; Entity Resolution antes de Ontology;
  Replication F5 antes de Ontology F7 — questionável), gaps técnicos (mensageria, storage,
  identidade/IAM, tenancy, observability de custos, Data Contracts), inconsistências.
  Input: texto integral da blueprint.
  
- **Planner (pragmático/Cursor)**: traduzir para um roadmap executável por 1 dev (ou time
  pequeno) usando Cursor: escolha de stack concreta (monorepo, Postgres, etc.), escopo de
  MVP vertical slice, sequência semana a semana, o que cortar/adiar, definição dos contratos
  centrais como código. Input: texto integral da blueprint.

### Stage 2 — Integração (orquestrador)
- Sintetizar as duas análises: veredicto sobre a ordem (o que está certo, o que mudar e por quê),
  roadmap final de construção (fases reordenadas com justificativa), e blueprint técnica
  final pronta para Cursor (estrutura de monorepo, módulos, contratos de API, modelo de
  dados, gates de aceite por milestone, prompts/contexto para o Cursor).
- Não há skill específica para "revisão de blueprint de arquitetura"; usar agentes
  preset `reviewer` e `plan` com guidance desenhada pelo orquestrador.

### Stage 3 — Entrega
- Arquivo único: `/mnt/agents/output/blueprint_tecnico_roadmap.md` (PT-BR).
- Estrutura: (1) Análise da blueprint original — pontos fortes/fracos; (2) Veredicto sobre a
  ordem + ordem revisada com justificativas; (3) Roadmap de construção (o que construir 1º,
  2º, 3º... e por quê); (4) Blueprint técnica pronta para Cursor (stack, monorepo, módulos,
  contratos, milestones com acceptance criteria); (5) Riscos e recomendações.
