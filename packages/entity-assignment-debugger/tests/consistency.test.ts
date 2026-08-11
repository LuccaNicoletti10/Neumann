/**
 * Testes de consistência ATRIBUIÇÃO (ontologia) × DEFINIÇÃO (builder) e de
 * consistência de links — núcleo da regra de validade da operação de depuração
 * da patente US 9,984,152 B2.
 */
import { describe, expect, it } from 'vitest';
import { TransformationBuilder } from '../src/core/builder.js';
import { Ontology } from '../src/core/ontology.js';

const builder = () =>
  new TransformationBuilder('s')
    .defineObject('Pessoa', { nome: 'string' })
    .defineProperty('Endereco', { owner: 'Pessoa', valueType: 'string' })
    .createLink('resideEm', 'Pessoa', 'Cidade');

describe('Ontology: consistência atribuição × definição', () => {
  it('objeto atribuído × objeto definido (tipos compatíveis) → consistente', () => {
    const ontology = new Ontology([{ kind: 'object', name: 'Pessoa', properties: { nome: 'string' } }]);
    const def = builder().build().definitions.find((d) => d.name === 'Pessoa')!;
    const result = ontology.isConsistentWith(def);
    expect(result.consistent).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('propriedade atribuída × propriedade definida (mesmo dono e tipo) → consistente', () => {
    const ontology = new Ontology([
      { kind: 'property', name: 'Endereco', owner: 'Pessoa', valueType: 'string' },
    ]);
    const def = builder().build().definitions.find((d) => d.name === 'Endereco')!;
    expect(ontology.isConsistentWith(def).consistent).toBe(true);
  });

  it('CASO CENTRAL: ontologia atribui "Endereco" como OBJETO, builder define como PROPRIEDADE → inconsistente', () => {
    const ontology = new Ontology([{ kind: 'object', name: 'Endereco', properties: {} }]);
    const def = builder().build().definitions.find((d) => d.name === 'Endereco')!;
    const result = ontology.isConsistentWith(def);
    expect(result.consistent).toBe(false);
    expect(result.reasons[0]).toContain('Endereco');
    expect(result.reasons[0]).toContain('object');
    expect(result.reasons[0]).toContain('property');
  });

  it('ontologia atribui como propriedade, builder define como objeto → inconsistente', () => {
    const ontology = new Ontology([
      { kind: 'property', name: 'Pessoa', owner: 'Empresa', valueType: 'string' },
    ]);
    const def = builder().build().definitions.find((d) => d.name === 'Pessoa')!;
    expect(ontology.isConsistentWith(def).consistent).toBe(false);
  });

  it('dono divergente em propriedade → inconsistente', () => {
    const ontology = new Ontology([
      { kind: 'property', name: 'Endereco', owner: 'Empresa', valueType: 'string' },
    ]);
    const def = builder().build().definitions.find((d) => d.name === 'Endereco')!;
    const result = ontology.isConsistentWith(def);
    expect(result.consistent).toBe(false);
    expect(result.reasons[0]).toContain('dono');
  });

  it('tipo de valor divergente em propriedade → inconsistente', () => {
    const ontology = new Ontology([
      { kind: 'property', name: 'Endereco', owner: 'Pessoa', valueType: 'number' },
    ]);
    const def = builder().build().definitions.find((d) => d.name === 'Endereco')!;
    const result = ontology.isConsistentWith(def);
    expect(result.consistent).toBe(false);
    expect(result.reasons[0]).toContain('tipo');
  });

  it('tipo de propriedade de objeto divergente → inconsistente', () => {
    const ontology = new Ontology([{ kind: 'object', name: 'Pessoa', properties: { nome: 'number' } }]);
    const def = builder().build().definitions.find((d) => d.name === 'Pessoa')!;
    expect(ontology.isConsistentWith(def).consistent).toBe(false);
  });

  it('entidade não atribuída pela ontologia → inconsistente', () => {
    const ontology = new Ontology([]);
    const def = builder().build().definitions.find((d) => d.name === 'Pessoa')!;
    const result = ontology.isConsistentWith(def);
    expect(result.consistent).toBe(false);
    expect(result.reasons[0]).toContain('não é atribuída');
  });
});

describe('Ontology: consistência de links', () => {
  it('link atribuído com mesmas extremidades → consistente', () => {
    const ontology = new Ontology([], [{ name: 'resideEm', from: 'Pessoa', to: 'Cidade' }]);
    const link = builder().build().links[0]!;
    expect(ontology.isLinkConsistent(link).consistent).toBe(true);
  });

  it('link atribuído com extremidades divergentes → inconsistente', () => {
    const ontology = new Ontology([], [{ name: 'resideEm', from: 'Pessoa', to: 'Pais' }]);
    const link = builder().build().links[0]!;
    const result = ontology.isLinkConsistent(link);
    expect(result.consistent).toBe(false);
    expect(result.reasons[0]).toContain('resideEm');
  });

  it('link criado no builder ausente na ontologia → inconsistente', () => {
    const ontology = new Ontology([]);
    const link = builder().build().links[0]!;
    expect(ontology.isLinkConsistent(link).consistent).toBe(false);
  });
});

describe('Ontology.fromJSON', () => {
  it('carrega atribuições e links de JSON (string e objeto)', () => {
    const json = JSON.stringify({
      assignments: [{ kind: 'object', name: 'Pessoa', properties: { nome: 'string' } }],
      links: [{ name: 'resideEm', from: 'Pessoa', to: 'Cidade' }],
    });
    const fromString = Ontology.fromJSON(json);
    expect(fromString.getAssignment('Pessoa')?.kind).toBe('object');
    expect(fromString.getLink('resideEm')?.to).toBe('Cidade');

    const fromObject = Ontology.fromJSON({ assignments: [{ kind: 'property', name: 'E', owner: 'P', valueType: 'string' }] });
    expect(fromObject.getAssignment('E')?.owner).toBe('P');
  });

  it('rejeita JSON sem "assignments"', () => {
    expect(() => Ontology.fromJSON('{"foo": 1}')).toThrow(/assignments/);
  });
});
