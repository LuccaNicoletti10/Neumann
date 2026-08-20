# Policy resource closure — 2026-08-18

## Veredito

**VERDE** — `verify:all` ×2 exit 0, sem retry/skips. Overlay `*` compila para EPID; rotas de negócio declaram policy; factories exigem `authorize`. Toda decisão de authorize passa por `engine.authorize`.

## Wildcards

| | Antes | Depois |
|---|---|---|
| Overlay `*` | `evaluateOverlay` no authorize (semântica distinta do EPID) | `compileOverlayToEpid` contra `PolicyResourceCatalog` |
| Novo ObjectType | autorizado por `*` na geração corrente | só após `publishCatalog` / commit (nova geração) |
| Field masks / classification | overlay no mesmo snapshot | overlay no mesmo snapshot; classification pós-allow no evaluator |

`PolicyRuntime.authorize` → `qualifyResource` → `engine.authorize` apenas. `evaluateOverlay` é oracle deprecado.

## Resource namespaces

```
object:{ontology}/{id}
action:{ontology}/{apiName}
link:{ontology}/{id}
function:{ontology}/{id}
ontology:{id}
admin:{name}
```

Kernel: `KERNEL_ONTOLOGY = '_'`. `ResourceIds` é a única factory. Rotas não concatenam schemes.

## Rotas classificadas

Enforcement: `registerRoutePolicyHook` (um `preHandler`).

Exceções públicas: `GET /health`, `GET /ready`, `OPTIONS` (e HEAD auto).

Negócio (todas declaram `{operation, resourceResolver, hiddenMiss}`):

| Superfície | Resource |
|---|---|
| ontology list/create/read/version/publish | `admin:ontology.*` / `ontology:{id}` |
| object/link reads + mutations HTTP | `object:{ont}/{type}` / `link:{ont}/{type}` |
| ObjectSet / aggregate / graph | `ontology:{id}` |
| catalog search/types | `admin:catalog.*` |
| Actions / validate / apply | `action:{ont}/{apiName}` |
| approvals | `admin:action-execution` |
| render | `admin:render` |
| functions list/get/execute | `admin:function.read` / `function:{ont}/{id}` |
| ER | `admin:er.*` |
| ingest | `admin:ingest` |

## Defaults removidos

| Factory | Antes | Depois |
|---|---|---|
| `createActionExecutor` | `authorize ?? allowAll` | `authorize` obrigatório |
| `createObjectPlatform` | `authorize ?? allowAll` | `authorize` obrigatório |
| HTTP overlay `*` | eval-time match | compile-time expansion |

Fixture de teste: `createAllowAllTestPolicy(catalog?)`.

## Migration

`infra/sql/0016_policy_resource_namespace.sql`

- `policy_meta.catalog jsonb NOT NULL DEFAULT '{}'`
- Rewrite `object:foo` → `object:_/foo` (idem `action:`, `link:`), including `@read`/`@modify` suffixes
- Native EPID ids (sem scheme) inalterados
- Restart: load overlay+catalog → recompile `ovl-` nodes → uma geração

## Testes

- `policy-compiler.test.ts`: wildcard ≡ explícito; ObjectType novo só após geração; persist fail; runtime não chama `evaluateOverlay`
- `route-policy.test.ts`: enumeração Fastify; concat proibido; deny antes do handler + hidden-miss
- negativos: factories sem authorize; `*` + catálogo vazio deny; classification gate

## Coverage

Ratchet global (não reduzido): statements 76 / branches 75 / functions 85 / lines 76.

Medido (`verify:coverage`):

| | statements | branches | functions | lines |
|---|---|---|---|---|
| global | 76.43 | 75.24 | 85.34 | 76.43 |
| action-engine | 75.61 (ratchet 75) | 66.04 (66) | 87.67 (87) | 75.61 (75) |
| platform-api | 70.52 (70) | 71.65 (71) | 87 (87) | 70.52 (70) |
| policy-engine | 86.71 (86) | 84.6 (84) | 92.15 (92) | 86.71 (86) |

## Débitos restantes

- Rotas POST/PUT/DELETE de objects/links ainda existem (serviço); Prompt 04 reorganiza a porta de mutação.
- `evaluateOverlay` exportado como oracle deprecado.
- `createAllowAllAuthorizer` alias deprecado de `createAllowAllTestPolicy`.
- EPID admissions (`createResource`) ainda não são API HTTP admin.
