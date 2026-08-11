/**
 * cli-script-debugger — src/core/config.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 11,100,154 B2 (Palantir/Nassar, "Data Integration Tool"). Este arquivo
 * implementa funcionalmente o componente: ARQUIVO DE CONFIGURAÇÃO QUE
 * IDENTIFICA O ONTOLOGY FILE — o transformation script é associado aos
 * ontology parameters por meio de um config (ex.: debug.config.json contendo
 * { "ontologyFile": "./ontologia.json" }). Inclui validação de campos e
 * resolução de caminhos RELATIVOS ao próprio arquivo de configuração.
 */

import { isAbsolute, resolve } from 'node:path';

import type {
  DebugConfig,
  DebugConfigFile,
  IndicationForm,
  SinkChannel,
} from './types.js';

const FORMS: readonly IndicationForm[] = ['message', 'acronym', 'number', 'graphic'];
const SINKS: readonly SinkChannel[] = ['debugger', 'email', 'popup'];

/** Faz o parsing e valida os campos do arquivo de configuração de debug. */
export function parseConfigFile(json: string): DebugConfigFile {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('config inválido: esperado objeto JSON');
  }
  const o = raw as Record<string, unknown>;
  for (const field of ['scriptFile', 'ontologyFile', 'dataFile'] as const) {
    const value = o[field];
    if (typeof value !== 'string' || value === '') {
      throw new Error(`config inválido: campo "${field}" obrigatório`);
    }
  }
  const dataFormatRaw = o['dataFormat'] ?? 'csv';
  if (dataFormatRaw !== 'csv' && dataFormatRaw !== 'text') {
    throw new Error('config inválido: "dataFormat" deve ser "csv" ou "text"');
  }
  const modeRaw = o['mode'];
  if (modeRaw !== undefined && modeRaw !== 'eager' && modeRaw !== 'lazy') {
    throw new Error('config inválido: "mode" deve ser "eager" ou "lazy"');
  }
  const indicationRaw = o['indication'];
  let indication: DebugConfigFile['indication'];
  if (indicationRaw !== undefined) {
    if (typeof indicationRaw !== 'object' || indicationRaw === null) {
      throw new Error('config inválido: "indication" deve ser objeto');
    }
    const i = indicationRaw as Record<string, unknown>;
    const form = i['form'];
    const sink = i['sink'];
    if (form !== undefined && !FORMS.includes(form as IndicationForm)) {
      throw new Error(`config inválido: "indication.form" deve ser um de ${FORMS.join(', ')}`);
    }
    if (sink !== undefined && !SINKS.includes(sink as SinkChannel)) {
      throw new Error(`config inválido: "indication.sink" deve ser um de ${SINKS.join(', ')}`);
    }
    indication = {
      ...(form !== undefined ? { form: form as IndicationForm } : {}),
      ...(sink !== undefined ? { sink: sink as SinkChannel } : {}),
    };
  }
  return {
    scriptFile: o['scriptFile'] as string,
    ontologyFile: o['ontologyFile'] as string,
    dataFile: o['dataFile'] as string,
    dataFormat: dataFormatRaw,
    ...(modeRaw !== undefined ? { mode: modeRaw } : {}),
    ...(indication !== undefined ? { indication } : {}),
  };
}

function resolveFrom(configDir: string, p: string): string {
  return isAbsolute(p) ? p : resolve(configDir, p);
}

/**
 * Resolve os caminhos do config RELATIVOS ao diretório do próprio arquivo de
 * configuração e aplica os defaults (mode eager, indicação message/debugger).
 */
export function resolveConfigPaths(config: DebugConfigFile, configDir: string): DebugConfig {
  return {
    configDir,
    scriptFile: resolveFrom(configDir, config.scriptFile),
    ontologyFile: resolveFrom(configDir, config.ontologyFile),
    dataFile: resolveFrom(configDir, config.dataFile),
    dataFormat: config.dataFormat,
    mode: config.mode ?? 'eager',
    indication: {
      form: config.indication?.form ?? 'message',
      sink: config.indication?.sink ?? 'debugger',
    },
  };
}
