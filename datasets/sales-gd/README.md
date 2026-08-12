# Dataset de teste — vendas GD (export do sistema)

## O que são esses arquivos

| Arquivo original | Significado | No teste vira |
|---|---|---|
| `Gd_Clientes.xlsx` | Cadastro de **clientes** | ObjectType `Customer` |
| `Gd_Fat.xls` | **Faturamento / pedidos** (o que foi vendido) | ObjectType `Invoice` |

**Não precisa de arquivo de “produto”.** No seu export, a venda já está em `Gd_Fat` (quantidade, valor, cliente). “Produto” seria catálogo de itens (SKU) — aqui não veio, e tudo bem.

## Ligação entre as bases

- Cliente: coluna `Código`
- Faturamento: coluna `Cód.Cli` → aponta para `Código` do cliente  
  (= link `Invoice → Customer`)

## Como preparar

1. Exporte do sistema (como já fez).
2. Converta/copie para esta pasta, ou rode o gerador a partir do Desktop:

```bash
# os sample/full já podem ser gerados a partir de:
# ~/Desktop/Gd_Clientes.xlsx + ~/Desktop/Gd_Fat.xls
```

Arquivos esperados pelo demo:

- `clientes.sample.csv`
- `faturamento.sample.csv`

## Rodar o teste

```bash
pnpm demo:sales
```

Isso carrega os CSVs → cria objetos Customer/Invoice → liga pelo código do cliente → percorre o grafo.
