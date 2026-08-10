/**
 * Passo 3 / US20250298632A1 (config de ambiente editavel remotamente):
 * GuiGenerator — gera a GUI (HTML standalone com form) a partir da indexed
 * data structure: um input por no folha (string/number/boolean viram
 * text/number/checkbox); schema opcional define selects para enums.
 * O form faz POST das mudancas (path -> novo valor) para a API remota.
 */
import { ConfigIndexer, isLeafType } from './config-indexer.js';
import type { IndexedConfig } from './config-indexer.js';

export interface GuiSchemaEntry {
  enum?: Array<string | number>;
  label?: string;
  help?: string;
}

export type GuiSchema = Record<string, GuiSchemaEntry>;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class GuiGenerator {
  private readonly indexer = new ConfigIndexer();

  generate(indexed: IndexedConfig, envName: string, schema: GuiSchema = {}): string {
    const fields: string[] = [];
    for (const node of this.indexer.leaves(indexed)) {
      if (!isLeafType(node.type)) continue;
      const entry = schema[node.path];
      const label = escapeHtml(entry?.label ?? node.path);
      const id = escapeHtml(node.path);
      let input: string;
      if (entry?.enum && (node.type === 'string' || node.type === 'number')) {
        const options = entry.enum
          .map((opt) => {
            const selected = opt === node.value ? ' selected' : '';
            return `<option value="${escapeHtml(String(opt))}"${selected}>${escapeHtml(String(opt))}</option>`;
          })
          .join('');
        input = `<select id="${id}" name="${id}" data-type="${node.type}">${options}</select>`;
      } else if (node.type === 'boolean') {
        const checked = node.value === true ? ' checked' : '';
        input = `<input type="checkbox" id="${id}" name="${id}" data-type="boolean"${checked}>`;
      } else if (node.type === 'number') {
        input = `<input type="number" step="any" id="${id}" name="${id}" data-type="number" value="${escapeHtml(String(node.value ?? 0))}">`;
      } else {
        input = `<input type="text" id="${id}" name="${id}" data-type="${node.type}" value="${escapeHtml(String(node.value ?? ''))}">`;
      }
      const help = entry?.help ? `<small>${escapeHtml(entry.help)}</small>` : '';
      fields.push(`<div class="field"><label for="${id}">${label}</label>${input}${help}</div>`);
    }

    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Config do ambiente ${escapeHtml(envName)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem}
.field{margin-bottom:.9rem;display:flex;flex-direction:column;gap:.25rem}
label{font-weight:600}input,select{padding:.4rem;font-size:1rem}
button{padding:.6rem 1.2rem;font-size:1rem;cursor:pointer}
#status{margin-top:1rem;white-space:pre-wrap}
</style>
</head>
<body>
<h1>Ambiente: ${escapeHtml(envName)}</h1>
<p>Edicao remota do arquivo de configuracao (artefato inalterado).</p>
<form id="cfg">
${fields.join('\n')}
<button type="submit">Aplicar mudancas</button>
</form>
<div id="status"></div>
<script>
const form = document.getElementById('cfg');
form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const changes = [];
  for (const el of form.querySelectorAll('[data-type]')) {
    const type = el.dataset.type;
    let value;
    if (type === 'boolean') value = el.checked;
    else if (type === 'number') value = el.value === '' ? null : Number(el.value);
    else value = el.value;
    changes.push({ path: el.name, value });
  }
  const status = document.getElementById('status');
  status.textContent = 'Enviando...';
  try {
    const res = await fetch('/envs/${encodeURIComponent(envName)}/apply-changes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changes }),
    });
    const body = await res.json();
    status.textContent = res.ok
      ? 'Aplicado na versao ' + body.version
      : 'Erro: ' + (body.message || res.status);
  } catch (err) { status.textContent = 'Falha: ' + err; }
});
</script>
</body>
</html>`;
  }
}