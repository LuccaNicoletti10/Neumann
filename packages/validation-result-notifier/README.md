# validation-result-notifier

Núcleo de validação proativa com resultados implicit/expressed e notificação multicanal (mensagem, sigla, número, painel gráfico ASCII). Reimplementação independente dos mecanismos da patente US 10,572,529 B2.

## Mecanismos implementados

1. Núcleo de validação proativa (src/core/validation.ts): builder de transformation
script que define entidade como objeto ou propriedade de objeto; parâmetros
ontológicos que também atribuem entidade; importação de data items de fontes
estruturadas (CSV/JSON) e não estruturadas (texto); condições baseadas no data
source; mapping de data items a parâmetros; operação de debugging que determina condição
inválida por atribuição inconsistente com a definição ou mapping incompatível.
2. Resultado implicit vs expressed (src/core/results.ts): implicit não é exibido
(uso interno para prosseguir); expressed é exibido ao usuário.
3. 4 formas de indicação expressed (src/core/renderers.ts): error message (texto),
acronym (EINV-ENT-001), number (código numérico) e graphic (painel ASCII).
4. 3 canais de entrega (src/core/channels.ts): notificação em debugger application
(sink em memória), email (MailSender injetável com fake) e popup window (PopupSink
injetável com fake); ChannelRouter escolhe o canal por severidade/config.
5. Fluxo (src/core/notifier.ts): condição inválida → expressed; válida com
subsequentes → implicit; válida sendo a última → expressed "script validated".

## Instalação e scripts

```bash
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit (strict + noUncheckedIndexedAccess)
npm run build     # emite dist/
```

## Uso rápido

```typescript
import {
  ValidationNotifier,
  createDefaultChannels,
  createTransformationScript,
  importDataItems,
} from 'validation-result-notifier';

const script = createTransformationScript('exemplo')
  .defineEntityAsObject('Cliente')
  .defineEntityAsProperty('nome', 'Cliente')
  .addOntologyParameter({
    name: 'p-nome',
    defines: { entity: 'nome', kind: 'property', parentObject: 'Cliente' },
    acceptedTypes: ['record'],
  })
  .addCondition({
    id: 'c1',
    description: 'atribuição errada de propósito',
    assignment: { entity: 'nome', kind: 'object' },
    mappings: [],
  })
  .build();

const defaults = createDefaultChannels();
const notifier = new ValidationNotifier(defaults.channels);
const output = notifier.run({
  script,
  dataItems: importDataItems({ format: 'csv', content: 'id,nome\na1,Ada' }),
  notify: { channel: 'popup', form: 'graphic' },
});
// output.delivered contém apenas indicações EXPRESSED; implicit nunca é entregue.
```

## CLI

```bash
npm run cli -- validate --script script.json [--ontology onto.json] --data fonte.json \
  [--channel debugger|email|popup] [--form message|acronym|number|graphic]
npm run cli -- demo
npm run cli -- serve --port 0
```

## Servidor HTTP

- `GET /health` → `{ status: 'ok' }`
- `GET /channels` → canais, formas e limite de corpo
- `POST /validate` → corpo `{ script, dataSource, notify?: { channel, form } }`
- Corpo máximo: 8 MB (413 acima disso)

## Determinismo

Nenhum `Date.now`/`Math.random` na lógica; todos os canais e sinks são injetáveis e capturáveis.
