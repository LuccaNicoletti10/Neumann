# Discovery — Planejamento Autônomo de Produção (Tecelagem/Tinturaria)

## 1. Família Escolhida

**Família:** Tecidos planos de algodão cru e tingido para confecção (make-to-stock).

- ~24 SKUs (gramaturas 120–280 g/m², larguras 1,50–1,80 m)
- Produção em 10 teares de malha/urdume + 2 linhas de tingimento
- Ciclo típico: 8–12 dias (fio → urdume → tecido cru → tingimento → acabamento)
- Pedido médio: 1.200–12.000 kg por SKU/mês
- Estoque de segurança: 10–15 dias de cobertura por família

SKU âncora do fio de ouro: **4501 — Algodão Cru 180 g/m², largura 1,60 m**.

## 2. Fio de Ouro (SKU 4501)

| Passo | Evento | Tela/Tabela Protheus | Campo |
|------|--------|----------------------|-------|
| 1 | Venda faturada | SF2/SD2 (faturamento) | `D2_COD`, `D2_QUANT`, `D2_EMISSAO` |
| 2 | Baixa de estoque | SB2 (saldo) / SD3 (movimentação) | `B2_QATU`, `D3_COD`, `D3_QUANT` |
| 3 | Ponto de reposição | SB1 + política local | `B1_ESTMIN`, `B1_EMIN` |
| 4 | Ordem de produção | SC2 / C2 (OP) | `C2_PRODUTO`, `C2_QUANT`, `C2_DATPRI` |
| 5 | Alocação máquina | recurso/apontamento (SH1/custom) | centro de trabalho, máquina |
| 6 | Apontamento | SD3 / apontamento produção | quantidade produzida, scrap |
| 7 | Entrada em estoque | SB2 | `B2_QATU` incrementa |

## 3. Regras Tácitas (10)

1. Nunca rodar artigo claro depois de escuro na mesma máquina de tingimento sem setup completo.
2. Artigo 4501 sempre pede dobra reforçada em março (demanda de moda verão).
3. Tear T04 rende ~15% menos com fio penteado.
4. Não misturar lotes de fio de fornecedores diferentes no mesmo urdume.
5. Setup de troca de urdume ≤ 2 por turno no tear T07.
6. Tinturaria não aceita batelada < 800 kg (custo energético).
7. SKUs da família “cru” têm prioridade se cobertura < 10 dias.
8. Manutenção preventiva M04 toda sexta à tarde (8h).
9. Qualidade: pontilhado bloqueia lote até liberação do CQ.
10. Produzir múltiplo de lote mínimo (`B1_LOTEMIN`) — nunca “completar” com resto solto.

## 4. Mapa de Acesso a Dados

| Bloco | Existe? | Onde | Extração | Frequência |
|-------|---------|------|----------|------------|
| Produtos | Sim | SB1 | SQL/CSV export | Diária |
| Vendas | Sim | SD2/SF2 | SQL/relatório | Diária |
| Estoques | Sim | SB2 | SQL | Diária (05:00) |
| Produção | Sim | SC2/SD3 | SQL | Diária |
| Máquinas | Parcial | planilha + cadastro recurso | planilha/API | Semanal |
| Regras | Parcial | cabeça do planejador + Excel | YAML no planner | Sob demanda |
| BOM/estrutura | Sim | SG1 | SQL | Semanal |

## 5. Linguagem Ubíqua

| Termo têxtil | Universal |
|--------------|-----------|
| Artigo | Product |
| Tear | Machine |
| Batelada | Batch |
| Urdume | Warp |
| Partida | Run |
| Tingimento | Dyeing step / WorkCenter |
| Fio | Component (BOM) |
| Cobertura | Days of cover |
| OP | ProductionOrder |
| Saldo | InventoryPosition.available |
