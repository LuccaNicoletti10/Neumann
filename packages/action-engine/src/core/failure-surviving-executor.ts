/**
 * action-engine — src/core/failure-surviving-executor.ts
 *
 * PEÇA 2 (correção) — hoje, quando uma REGRA falha, o rollback da
 * transação apaga também o registro da execução (o próprio teste
 * pg-durability afirma `getExecution(...) => undefined`). Resultado:
 * a tentativa que deu errado não deixa rastro — e é exatamente a
 * tentativa mais valiosa para diagnóstico.
 *
 * Este wrapper NÃO altera o executor existente. Ele decora `apply`:
 * se o resultado for FAILED, regrava a execução usando o store RAIZ
 * (fora de qualquer transação). O save é idempotente (ON CONFLICT DO
 * UPDATE no PgActionExecutionStore), então falhas de validação — que
 * já commitam — não duplicam.
 *
 * Semântica final:
 *   - mutações de negócio: revertem (correto, inalterado)
 *   - registro da tentativa: SEMPRE sobrevive
 *
 * Uso (context.ts):
 *   const actions = createFailureSurvivingExecutor({
 *     inner: createActionExecutor({ ... , unitOfWork }),
 *     rootExecutions: root.executions,        // fora da tx
 *     clock,
 *   });
 */

import type {
  ActionApplyRequest,
  ActionApplyResult,
  ActionExecution,
  ActionExecutionStore,
  ActionExecutor,
} from 'contracts';

export interface FailureSurvivingExecutorOptions {
  inner: ActionExecutor;
  /** ActionExecutionStore ligado ao SqlClient RAIZ (não-transacional). */
  rootExecutions: ActionExecutionStore;
  clock?: () => string;
}

export function createFailureSurvivingExecutor(
  opts: FailureSurvivingExecutorOptions,
): ActionExecutor {
  const { inner, rootExecutions } = opts;
  const clock = opts.clock ?? (() => new Date().toISOString());

  return {
    getActionType: (o, a) => inner.getActionType(o, a),
    registerActionType: (o, d) => inner.registerActionType(o, d),
    validate: (req) => inner.validate(req),
    parameterTree: inner.parameterTree
      ? (req) => inner.parameterTree!(req)
      : undefined,
    getExecution: async (id) =>
      (await rootExecutions.get(id)) ?? inner.getExecution(id),
    approve: inner.approve
      ? (id, principal) => inner.approve!(id, principal)
      : undefined,
    reject: inner.reject
      ? (id, principal) => inner.reject!(id, principal)
      : undefined,

    async apply(req: ActionApplyRequest): Promise<ActionApplyResult> {
      const result = await inner.apply(req);

      if (result.status === 'FAILED' || result.status === 'DENIED') {
        // A tx pode ter revertido o registro; regrava fora dela.
        const existing = await rootExecutions.get(result.executionId);
        if (!existing || existing.status !== result.status) {
          const record: ActionExecution = existing
            ? { ...existing, status: result.status, error: result.error, finishedAt: clock() }
            : {
                id: result.executionId,
                ontologyId: req.ontologyId,
                actionTypeId: result.actionTypeId,
                actionApiName: req.actionApiName,
                parameters: { ...req.parameters },
                principal: req.principal,
                status: result.status,
                startedAt: clock(),
                finishedAt: clock(),
                error: result.error,
              };
          try {
            await rootExecutions.save(record);
          } catch (persistErr) {
            // Nunca deixar o registro de falha mascarar o resultado real.
            console.error(
              '[action-engine] failed to persist FAILED execution record:',
              persistErr,
            );
          }
        }
      }

      return result;
    },
  };
}
