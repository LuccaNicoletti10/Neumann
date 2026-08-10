# Leis dos agentes — ordem de prioridade

1. security.mdc    → invariantes de segurança (não negociável)
2. contracts.mdc   → contratos intangíveis sem ADR
3. architecture.mdc→ arquitetura, stack, cortes de escopo
4. workflow.mdc    → processo: plano → 1 task → testes verdes → commit
5. quality.mdc     → padrões anti-código-lixo

Conflito entre regras → vence a de número menor.
