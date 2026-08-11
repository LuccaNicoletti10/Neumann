/**
 * tagging-interface-panel — tests/ontology.test.ts
 * Testes do builder da ontologia do data fusion core.
 */
import { describe, expect, it } from 'vitest';

import {
  createOntologyBuilder,
  findObjectType,
  findPropertyType,
  isRepresentative,
} from '../src/core/ontology.js';
import { sampleOntology } from './helpers.js';

describe('ontology builder', () => {
  it('registra object types', () => {
    const ontology = sampleOntology();
    expect(findObjectType(ontology, 'Person')).toBeDefined();
    expect(findObjectType(ontology, 'Business')).toBeDefined();
  });

  it('registra property type composta com componentes e base type', () => {
    const ontology = sampleOntology();
    const name = findPropertyType(ontology, 'Name');
    expect(name).toBeDefined();
    expect(name?.components).toEqual(['Name:Last', 'Name:First']);
    expect(name?.baseType).toBe('string');
  });

  it('"Social Security Number" é representative of "Person"', () => {
    const ontology = sampleOntology();
    expect(isRepresentative(ontology, 'Social Security Number', 'Person')).toBe(true);
  });

  it('"Social Security Number" NÃO é representative of "Business"', () => {
    const ontology = sampleOntology();
    expect(isRepresentative(ontology, 'Social Security Number', 'Business')).toBe(false);
  });

  it('isRepresentative retorna false para property type inexistente', () => {
    const ontology = sampleOntology();
    expect(isRepresentative(ontology, 'Inexistente', 'Person')).toBe(false);
  });

  it('registra parser definitions com componentes', () => {
    const ontology = sampleOntology();
    const def = ontology.parserDefinitions.find((d) => d.name === 'name-last-first');
    expect(def).toBeDefined();
    expect(def?.pattern).toBe('{LAST NAME}, {FIRST NAME}');
    expect(def?.components).toHaveLength(2);
  });

  it('builder é idempotente por nome', () => {
    const ontology = createOntologyBuilder('x')
      .addObjectType('Person')
      .addObjectType('Person')
      .addPropertyType({ name: 'Name' })
      .addPropertyType({ name: 'Name', baseType: 'number' })
      .build();
    expect(ontology.objectTypes).toHaveLength(1);
    expect(ontology.propertyTypes).toHaveLength(1);
    expect(ontology.propertyTypes[0]?.baseType).toBe('string');
  });

  it('build produz cópias defensivas', () => {
    const builder = createOntologyBuilder('x').addPropertyType({
      name: 'Name',
      components: ['Name:Last'],
      representativeOf: ['Person'],
    });
    const a = builder.build();
    a.propertyTypes[0]?.components.push('adulterado');
    const b = builder.build();
    expect(b.propertyTypes[0]?.components).toEqual(['Name:Last']);
  });
});
