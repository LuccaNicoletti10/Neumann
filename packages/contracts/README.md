# contracts

Contratos congelados v1 do NEUMANN (BLOCO 2):

- `CanonicalEvent` — envelope canônico de ingestão (`payload_hash` = sha256 do JSON canônico)
- `Connector` — `discover / schema / snapshot / read / checkpoint / health` + `capabilities[]`

Regra: connectors dependem **somente** deste pacote — nunca da Ontology.

```bash
pnpm --filter contracts test
pnpm contracts -- demo
```
