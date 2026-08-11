/**
 * cli-script-debugger — tests/helpers.ts
 * Fixtures compartilhadas dos testes (cenários válidos/inválidos).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptBuilder } from '../src/core/builder.js';
import type { Ontology, ScriptDefinition } from '../src/core/types.js';

export function sampleScript(): ScriptDefinition {
  return createScriptBuilder('exemplo')
    .defineObject('pessoa', 'Person')
    .defineProperty('pessoaNome', 'Person', 'name')
    .addMapping({ entity: 'pessoa', dataField: 'id', parameter: 'personId' })
    .addMapping({ entity: 'pessoaNome', dataField: 'nome', parameter: 'personName' })
    .addCondition({ dataSource: 'id', type: 'fieldPresent' })
    .addCondition({ dataSource: 'idade', type: 'numericRange', min: 0, max: 150 })
    .addMapping({ entity: 'pessoa', dataField: 'idade', parameter: 'personAge' })
    .build();
}

export function sampleOntology(): Ontology {
  return {
    name: 'exemplo-ontology',
    parameters: [
      { name: 'personId', entity: 'pessoa', assignment: { kind: 'object', objectType: 'Person' } },
      {
        name: 'personName',
        entity: 'pessoaNome',
        assignment: { kind: 'property', objectType: 'Person', property: 'name' },
      },
      { name: 'personAge', entity: 'pessoa', assignment: { kind: 'object', objectType: 'Person' } },
    ],
  };
}

export function sampleCsv(): string {
  return 'id,nome,idade\n1,Ada,36\n2,Grace,85\n';
}

export function sampleText(): string {
  return 'registro um\nregistro dois\n';
}

export function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'cli-script-debugger-test-'));
}

export function writeFile(dir: string, name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, 'utf8');
  return path;
}
