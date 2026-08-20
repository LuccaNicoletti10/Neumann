# Fixtures — empresa industrial fictícia (certificação)

Ontologia e policies **somente** neste diretório / testes de certificação.
Nenhum `packages/*/src` de produção importa estes nomes.

## ObjectTypes

Customer, Product, SalesOrder, InventoryPosition, Machine, WorkOrder

## LinkTypes

- Customer → SalesOrder (`CustomerHasOrder`)
- SalesOrder → Product (`OrderHasProduct`)
- Product → InventoryPosition (`ProductHasInventory`)
- WorkOrder → Product (`WorkOrderUsesProduct`)
- WorkOrder → Machine (`WorkOrderUsesMachine`)

## Campos sensíveis

| Campo | ObjectType |
|---|---|
| creditLimit | Customer |
| unitCost | Product |
| margin | SalesOrder |
| internalNotes | Machine |

## Roles

admin, sales, planner, operator, auditor

- sales: não vê `unitCost` / `internalNotes`
- operator: não vê `creditLimit` / `margin`
- planner: lê produção/estoque
- auditor: lê history/audit; não executa Actions (somente `read`)
- somente `allow` executa Function/Action/admin
- ontologies distintas isolam IDs iguais

Ver `domain.ts` e `packages/platform-api/tests/prompt12-certification.integration.test.ts`.
