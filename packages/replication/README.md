# replication — Passo 33

Protocolo de replicação: mutation com vetor + checkpoint, chunks incrementais, mapa de ontologia, **cross-ACL** (unidade redigida ainda avança o relógio). Sem GUI.

**Patentes:** US 8,886,601 · US 9,785,694 · US 9,330,157 · US 10,061,828 · US 8,527,461 · US 8,782,004 · US 9,715,518 · US 10,089,345 · US 10,621,198 · US 8,838,538

## Escopo (kernel)

- Mutation: `mutation_id`, `source_replica`, `logical_clock`, object/unit, operation, payload, policy, timestamp, dependencies
- Checkpoint por peer (merge dos version vectors)
- Filtro ACL: unidade não autorizada sai **redigida** (`payload: null`, `redacted: true`) — a réplica sem permissão ainda converge
- Mudança de ACL é mutation (`operation: 'acl'`)
- Plano incremental: snapshot de logical clock + chunks por intervalo de object id
- Ontology map 1:1 / 1:N / reverse link / drop list + digest SHA-256

## Gate

Réplica sem permissão converge mesmo recebendo mudança redigida.

```bash
pnpm repl -- demo
pnpm --filter replication test
```

## Fora deste passo

- Offline/conflitos de investigação (Passo 34)
- GUI / app vertical
