# delta-storage

**PASSO 9** — Delta tree com compactação + zero-copy cache  
Patentes: **US 11,397,717**, **US 9,367,463**, **US 9,652,291**

## O que faz

- `BASE` + deltas individuais `Δ1..ΔN`
- Combined hierárquicos a cada `fanout^level` (ex.: 10, 100, 1000) — **sem** reescrever individuais
- `reconstruct(target)` via conjunto mínimo (combined + restantes)
- Gate: bytes iguais ao replay linear; compactação não altera resultado
- `ZeroCopyCache` — mesma referência `Buffer` para o mesmo content-hash

## Uso

```bash
pnpm --filter delta-storage test
pnpm delta -- demo
```

```ts
import { createDeltaTree } from 'delta-storage';

const tree = createDeltaTree({ fanout: 10 });
const item = tree.createItem('orders', { total: 0 });
tree.appendState(item.id, { total: 1 });
const r = tree.reconstruct(item.id, 1);
```

## Fora deste pacote

- Passo 10 (`snapshot(at)` / replay / leitura durante commit)
- Token Ring, B+Tree, ACID mmap do paste Java (não são o gate do Passo 9)
