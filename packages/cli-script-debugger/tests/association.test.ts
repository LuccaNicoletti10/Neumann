/**
 * cli-script-debugger — tests/association.test.ts
 * Testa a associação script ↔ ontologia nos modos EAGER (via config, antes do
 * run) e LAZY (durante o debugging, no primeiro uso, com cache).
 */
import { describe, expect, it } from 'vitest';

import { Validator } from '../src/core/validator.js';
import { importCsv } from '../src/core/validator.js';
import { sampleCsv, sampleOntology, sampleScript } from './helpers.js';

describe('associação EAGER (ontologia resolvida do config antes do run)', () => {
  it('resolve a ontologia antes da operação de debug', () => {
    let loads = 0;
    const validator = new Validator(sampleScript(), {
      mode: 'eager',
      loader: () => {
        loads += 1;
        return sampleOntology();
      },
    });
    // Prova: com modo eager, o loader já foi chamado ANTES de qualquer run.
    expect(loads).toBe(1);
    const verdict = validator.run(importCsv(sampleCsv()));
    expect(loads).toBe(1); // sem recargas: cache
    expect(verdict.valid).toBe(true);
  });

  it('aceita ontologia já resolvida (sem loader)', () => {
    const validator = new Validator(sampleScript(), {
      mode: 'eager',
      ontology: sampleOntology(),
    });
    expect(validator.run(importCsv(sampleCsv())).valid).toBe(true);
  });
});

describe('associação LAZY (durante o debugging, no primeiro uso, com cache)', () => {
  it('só resolve a ontologia no primeiro uso durante o debug', () => {
    let loads = 0;
    const validator = new Validator(sampleScript(), {
      mode: 'lazy',
      loader: () => {
        loads += 1;
        return sampleOntology();
      },
    });
    // Prova: nenhuma carga antes do run (associação tardia).
    expect(loads).toBe(0);
    const first = validator.run(importCsv(sampleCsv()));
    expect(loads).toBe(1); // associação aconteceu DURANTE o debugging
    expect(first.valid).toBe(true);
    const second = validator.run(importCsv(sampleCsv()));
    expect(loads).toBe(1); // cache: não recarrega
    expect(second.valid).toBe(true);
  });

  it('a associação durante o debug usa de fato a ontologia (detecta inconsistência)', () => {
    let loads = 0;
    const script = sampleScript();
    // Script define "pessoa" como OBJETO; ontologia tardia atribui como PROPRIEDADE.
    const validator = new Validator(script, {
      mode: 'lazy',
      loader: () => {
        loads += 1;
        return {
          name: 'tardia',
          parameters: [
            {
              name: 'personId',
              entity: 'pessoa',
              assignment: { kind: 'property', objectType: 'Person', property: 'id' },
            },
          ],
        };
      },
    });
    expect(loads).toBe(0);
    const verdict = validator.run(importCsv(sampleCsv()));
    expect(loads).toBe(1);
    expect(verdict.valid).toBe(false);
    expect(verdict.issues.some((i) => i.code === 'INCONSISTENT_ASSIGNMENT')).toBe(true);
  });

  it('eager e lazy produzem o mesmo veredito para o mesmo cenário', () => {
    const eager = new Validator(sampleScript(), {
      mode: 'eager',
      ontology: sampleOntology(),
    }).run(importCsv(sampleCsv()));
    const lazy = new Validator(sampleScript(), {
      mode: 'lazy',
      loader: () => sampleOntology(),
    }).run(importCsv(sampleCsv()));
    expect(lazy).toEqual(eager);
  });
});
