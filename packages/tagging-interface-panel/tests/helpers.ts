/**
 * tagging-interface-panel — tests/helpers.ts
 * Fixtures compartilhadas dos testes (ontologia, painel, banco interno).
 */

import { createOntologyBuilder } from '../src/core/ontology.js';
import { createDemoInternalDatabase, createDemoOntology, TaggingInterfacePanel } from '../src/core/panel.js';
import type { PanelDeps } from '../src/core/panel.js';
import type { Ontology } from '../src/core/types.js';
import { createFixedClock, createIdGenerator, createStepClock } from '../src/core/types.js';

export { createFixedClock, createIdGenerator, createStepClock };

export function sampleOntology(): Ontology {
  return createDemoOntology();
}

export function parserDefinitions() {
  return sampleOntology().parserDefinitions;
}

export function makePanel(deps: PanelDeps = {}): TaggingInterfacePanel {
  return new TaggingInterfacePanel(sampleOntology(), {
    clock: createStepClock('2014-09-18T12:00:00.000Z', 60_000),
    newId: createIdGenerator(),
    user: 'analista',
    loggedIn: true,
    internalDb: createDemoInternalDatabase(),
    ...deps,
  });
}

export function selectCuriosity(panel: TaggingInterfacePanel): void {
  panel.select({
    contentKind: 'text',
    content: 'O rover Curiosity segue viagem em Marte usando ground travel.',
    portion: 'Curiosity',
  });
}

export function createObjectTag(panel: TaggingInterfacePanel, title?: string) {
  panel.chooseOption('object');
  return panel.createTag(title === undefined ? {} : { title });
}

export function nameOntology(): Ontology {
  return createOntologyBuilder('nomes')
    .addObjectType('Person')
    .addPropertyType({
      name: 'Name',
      components: ['Name:Last', 'Name:First'],
      representativeOf: ['Person'],
    })
    .addPropertyType({ name: 'Name:Last', representativeOf: ['Person'] })
    .addPropertyType({ name: 'Name:First', representativeOf: ['Person'] })
    .addParserDefinition({
      name: 'name-last-first',
      pattern: '{LAST NAME}, {FIRST NAME}',
      components: [
        { token: 'LAST NAME', propertyType: 'Name:Last' },
        { token: 'FIRST NAME', propertyType: 'Name:First' },
      ],
    })
    .addParserDefinition({
      name: 'name-first-last',
      pattern: '{FIRST NAME} {LAST NAME}',
      components: [
        { token: 'FIRST NAME', propertyType: 'Name:First' },
        { token: 'LAST NAME', propertyType: 'Name:Last' },
      ],
    })
    .build();
}
