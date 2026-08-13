/**
 * platform-api — src/core/write-guard.ts
 *
 * PEÇA 2 ("único caminho de escrita") — enquanto o /api/v2 tiver
 * POST/DELETE diretos em /objects/, a garantia de auditoria é opcional.
 * Opcional = inexistente.
 *
 * Este hook fecha o caminho: mutação direta de objetos/links só para
 * principals de serviço na allowlist (projetor de datasets, migração).
 * Humanos e apps recebem 403 com instrução de usar Actions.
 *
 * Uso (server.ts, ANTES de registerV2Routes):
 *   registerWriteGuard(app, {
 *     allowedPrincipals: ['svc-projector', 'svc-migration'],
 *   });
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface WriteGuardOptions {
  /** Principals de SERVIÇO autorizados a escrever objetos diretamente. */
  allowedPrincipals: string[];
  /** Desliga o guard (dev/experimento). Default: ativo. */
  enabled?: boolean;
  /** Extrator de principal — deve espelhar principalOf de routes/v2.ts. */
  principalOf?: (req: FastifyRequest) => string;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Caminhos de escrita direta que passam a ser exclusivos de serviço. */
const DIRECT_WRITE = /\/api\/v2\/ontologies\/[^/]+\/(objects|links)(\/|$)/;
/** Actions continuam abertas — são O caminho. */
const ACTION_PATH = /\/api\/v2\/ontologies\/[^/]+\/actions\//;

function defaultPrincipalOf(req: FastifyRequest): string {
  const h = req.headers['x-principal'];
  if (typeof h === 'string' && h) return h;
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }
  return 'anonymous';
}

export function registerWriteGuard(
  app: FastifyInstance,
  opts: WriteGuardOptions,
): void {
  if (opts.enabled === false) return;
  const allowed = new Set(opts.allowedPrincipals);
  const principalOf = opts.principalOf ?? defaultPrincipalOf;

  app.addHook(
    'onRequest',
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!MUTATING.has(req.method)) return;
      const url = req.url.split('?')[0] ?? '';
      if (ACTION_PATH.test(url)) return;          // actions sempre passam
      if (!DIRECT_WRITE.test(url)) return;        // fora do escopo

      const principal = principalOf(req);
      if (allowed.has(principal)) return;         // serviço autorizado

      return reply.code(403).send({
        errorCode: 'DIRECT_WRITE_FORBIDDEN',
        errorName: 'ActionsOnlyWritePath',
        message:
          'Escrita direta de objetos é reservada a serviços de projeção. ' +
          'Use POST /api/v2/ontologies/{ontology}/actions/{action}/apply — ' +
          'toda mutação precisa de autorização, validação e auditoria.',
      });
    },
  );
}
