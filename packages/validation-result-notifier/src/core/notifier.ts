/**
 * validation-result-notifier — src/core/notifier.ts
 *
 * Implementação funcional INDEPENDENTE (reimplementação original, sem copiar texto
 * dos claims) dos mecanismos da patente US 10.572.529 B2 (Palantir/Nassar,
 * "Data Integration Tool").
 *
 * Componente implementado: orquestrador ValidationNotifier — executa a operação de
 * debugging, aplica a regra implicit/expressed, converte cada resultado EXPRESSED
 * em uma indicação (forma × canal escolhidos por config/severidade) e a entrega;
 * resultados IMPLICIT nunca são entregues (uso interno apenas).
 */

import {
  routeChannel,
  type ChannelName,
  type ChannelRouterConfig,
  type DeliveredIndication,
  type NotificationChannel,
} from './channels.js';
import { renderIndication, type RenderForm } from './renderers.js';
import { resultsFromVerdicts, type ValidationResult } from './results.js';
import { runDebugOperation } from './validation.js';
import type { DataItem, TransformationScript, ValidationVerdict } from './types.js';

export interface NotifyOptions {
  /** Canal explícito; ausente → roteamento por severidade/config. */
  channel?: ChannelName;
  /** Forma da indicação; ausente → 'message'. */
  form?: RenderForm;
  /** Configuração de roteamento por severidade. */
  router?: ChannelRouterConfig;
}

export interface NotifyRunInput {
  script: TransformationScript;
  dataItems: DataItem[];
  notify?: NotifyOptions;
}

export interface NotifyRunOutput {
  verdicts: ValidationVerdict[];
  results: ValidationResult[];
  /** Apenas indicações de resultados EXPRESSED; implicit nunca aparece aqui. */
  delivered: DeliveredIndication[];
}

const DEFAULT_ROUTER: ChannelRouterConfig = { fallback: 'debugger' };

export class ValidationNotifier {
  constructor(
    private readonly channels: Record<ChannelName, NotificationChannel>,
    private readonly defaultRouter: ChannelRouterConfig = DEFAULT_ROUTER,
  ) {}

  /** Executa o debug run completo e entrega as indicações expressed. */
  run(input: NotifyRunInput): NotifyRunOutput {
    const verdicts = runDebugOperation(input.script, input.dataItems);
    const results = resultsFromVerdicts(verdicts);
    const delivered: DeliveredIndication[] = [];

    for (const result of results) {
      if (result.kind === 'implicit') {
        // Resultado implicit: não exibido nem entregue; uso interno p/ prosseguir.
        continue;
      }
      const severity = result.payload.severity;
      const form = input.notify?.form ?? 'message';
      const channelName =
        input.notify?.channel ??
        routeChannel(severity, input.notify?.router ?? this.defaultRouter);
      const content = renderIndication(result, form);
      const indication: DeliveredIndication = {
        channel: channelName,
        form,
        severity,
        conditionId: result.verdict.conditionId,
        content,
      };
      this.channels[channelName].deliver(indication);
      delivered.push(indication);
    }

    return { verdicts, results, delivered };
  }
}
